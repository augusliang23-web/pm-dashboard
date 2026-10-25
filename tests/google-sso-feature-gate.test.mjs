// S02 R4: fail-closed rollout gates for UAT Google SSO. Mock auth only; nothing here contacts Firebase or Google.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { resolveGoogleSsoGates, GOOGLE_SSO_DISABLED_MESSAGES } from '../js/google-sso-gate.mjs';
import { createGoogleAuthFlow } from '../js/google-auth-flow.mjs';
import { renderSsoTarget, assertNoProductionSso } from '../scripts/uat-sso-build-boundary.mjs';
import { buildHosting } from '../scripts/build-hosting.mjs';
import { loadHostingEnv } from '../scripts/hosting-env.mjs';
import { renderEnvConfig } from '../scripts/env-config.mjs';

const root = new URL('..', import.meta.url).pathname;
const raw = readFileSync(join(root, 'index.html'), 'utf8');
const uatHtml = renderSsoTarget(raw, 'uat');
const prodHtml = renderSsoTarget(raw, 'prod');
const sha = text => createHash('sha256').update(text).digest('hex');
const PR81_PRODUCTION_INDEX_SHA256 = 'ea2c9f487b83ec064575c80123ed64ee2bd039cb120f79f8bbc21eb2d1cdf30f';
const CLOSED = { state: 'A', googleLinkingEnabled: false, googleSignInEnabled: false };

// ---- mock auth harness: records every call a Google/Firebase operation could make ----
function harness({ gates, record = { role: 'admin', authUid: 'uid-1', googleSubject: '' }, uid = 'uid-1', email = 'admin@example.com' } = {}) {
  const calls = [];
  const user = { uid, providerData: [{ providerId: 'password' }, { providerId: 'google.com', uid: 'sub-1', email }] };
  const auth = { currentUser: { uid } };
  class GoogleAuthProvider { constructor() { calls.push('new GoogleAuthProvider'); } setCustomParameters() { calls.push('setCustomParameters'); } }
  const api = {
    GoogleAuthProvider,
    EmailAuthProvider: { credential: () => { calls.push('EmailAuthProvider.credential'); return {}; } },
    beforeAuthStateChanged: () => { calls.push('beforeAuthStateChanged'); },
    reauthenticateWithCredential: async () => { calls.push('reauthenticateWithCredential'); },
    signInWithEmailAndPassword: async (_a, e) => { calls.push(`signInWithEmailAndPassword:${e}`); return { user }; },
    signInWithPopup: async () => { calls.push('signInWithPopup'); return { user }; },
    linkWithPopup: async () => { calls.push('linkWithPopup'); return { user }; },
    unlink: async () => { calls.push('unlink'); },
    signOut: async () => { calls.push('signOut'); }
  };
  const flow = createGoogleAuthFlow({
    auth, api, gates,
    getSession: () => ({ uid, email, generation: 1, record })
  });
  const googleCalls = () => calls.filter(c => /Google|Popup|link|reauth|unlink/i.test(c) && c !== 'beforeAuthStateChanged');
  return { flow, calls, googleCalls };
}
const rejection = async promise => { try { await promise; } catch (error) { return error; } assert.fail('expected a rejection'); };
const gatesFor = ({ signIn, link }) => ({ signIn: () => signIn, link: () => link });

// ---- GATE 2: flag resolution defaults to FALSE and fails closed ----
test('both gates default to FALSE when configuration is absent', () => {
  for (const missing of [undefined, null]) assert.deepEqual({ ...resolveGoogleSsoGates(missing) }, { ...CLOSED, valid: true });
});

test('unknown or malformed configuration resolves to FALSE/FALSE', () => {
  const malformed = [
    {}, [], 'true', 1, true, { googleLinkingEnabled: true }, { googleSignInEnabled: true },
    { googleLinkingEnabled: 'true', googleSignInEnabled: 'false' }, { googleLinkingEnabled: 1, googleSignInEnabled: 0 },
    { googleLinkingEnabled: true, googleSignInEnabled: false, extra: true }, { googleLinkingEnabled: null, googleSignInEnabled: null },
    { googleLinkingEnabled: true, googleSignInEnabled: undefined }
  ];
  for (const config of malformed) {
    const gates = resolveGoogleSsoGates(config);
    assert.equal(gates.googleLinkingEnabled, false, JSON.stringify(config));
    assert.equal(gates.googleSignInEnabled, false, JSON.stringify(config));
    assert.equal(gates.valid, false);
  }
});

test('staged rollout states A, B and C are the only valid combinations', () => {
  assert.deepEqual({ ...resolveGoogleSsoGates({ googleLinkingEnabled: false, googleSignInEnabled: false }) }, { ...CLOSED, valid: true });
  assert.deepEqual({ ...resolveGoogleSsoGates({ googleLinkingEnabled: true, googleSignInEnabled: false }) }, { state: 'B', googleLinkingEnabled: true, googleSignInEnabled: false, valid: true });
  assert.deepEqual({ ...resolveGoogleSsoGates({ googleLinkingEnabled: true, googleSignInEnabled: true }) }, { state: 'C', googleLinkingEnabled: true, googleSignInEnabled: true, valid: true });
  const invalid = resolveGoogleSsoGates({ googleLinkingEnabled: false, googleSignInEnabled: true });
  assert.deepEqual({ ...invalid }, { state: 'invalid', googleLinkingEnabled: false, googleSignInEnabled: false, valid: false });
});

test('linking ON never turns sign-in ON', () => {
  assert.equal(resolveGoogleSsoGates({ googleLinkingEnabled: true, googleSignInEnabled: false }).googleSignInEnabled, false);
});

test('resolved gates are immutable', () => {
  const gates = resolveGoogleSsoGates({ googleLinkingEnabled: true, googleSignInEnabled: true });
  assert.throws(() => { 'use strict'; gates.googleSignInEnabled = false; }, TypeError);
  assert.throws(() => { 'use strict'; resolveGoogleSsoGates(undefined).googleLinkingEnabled = true; }, TypeError);
});

// ---- GATE 3: disabled behaviour (state A) ----
test('state A: Google sign-in refuses before any provider, popup or Firebase Google call', async () => {
  for (const gates of [undefined, {}, gatesFor({ signIn: false, link: false }), { signIn: () => 'true', link: () => 1 }, { signIn: 'yes', link: true }]) {
    const { flow, googleCalls } = harness({ gates });
    const error = await rejection(flow.google());
    assert.equal(error.code, 'sso/disabled');
    assert.equal(error.userSafe, true);
    assert.equal(error.message, GOOGLE_SSO_DISABLED_MESSAGES.signIn);
    assert.deepEqual(googleCalls(), []);
    assert.equal(flow.operation, '');
  }
});

test('state A: account linking refuses before re-authentication, popup or Firebase call', async () => {
  const { flow, googleCalls, calls } = harness({ gates: gatesFor({ signIn: false, link: false }) });
  const error = await rejection(flow.link('correct horse'));
  assert.equal(error.code, 'sso/disabled');
  assert.equal(error.message, GOOGLE_SSO_DISABLED_MESSAGES.linking);
  assert.deepEqual(googleCalls(), []);
  assert.ok(!calls.includes('signOut'), 'a refused operation must not touch the session');
});

test('state A: password login is unchanged and still works', async () => {
  const { flow, calls } = harness({ gates: gatesFor({ signIn: false, link: false }) });
  await flow.password('pm@example.com', 'pw');
  assert.deepEqual(calls.filter(c => c.startsWith('signInWithEmailAndPassword')), ['signInWithEmailAndPassword:pm@example.com']);
  assert.ok(!calls.some(c => /Google|Popup/.test(c)));
});

// ---- GATE 4: staged enablement ----
test('state B: Admin may link; Google sign-in stays refused', async () => {
  const { flow, calls } = harness({ gates: gatesFor({ signIn: false, link: true }) });
  const result = await flow.link('pw');
  assert.equal(result.status, 'pending-approval', 'a new link still needs Owner subject approval');
  assert.ok(calls.includes('linkWithPopup'));
  const signIn = await rejection(flow.google());
  assert.equal(signIn.code, 'sso/disabled');
  assert.ok(!calls.includes('signInWithPopup'));
});

test('state B: linking is Admin-only even when enabled', async () => {
  for (const record of [{ role: 'pm', authUid: 'uid-1' }, { role: 'vip', authUid: 'uid-1' }, { role: 'admin', authUid: 'someone-else' }, null]) {
    const { flow, googleCalls } = harness({ gates: gatesFor({ signIn: false, link: true }), record });
    const error = await rejection(flow.link('pw'));
    assert.equal(error.userSafe, true);
    assert.deepEqual(googleCalls(), []);
  }
});

test('state B: linking requires the current password', async () => {
  const { flow, googleCalls } = harness({ gates: gatesFor({ signIn: false, link: true }) });
  await rejection(flow.link(''));
  assert.deepEqual(googleCalls(), []);
});

test('state C: Google sign-in works and linking stays independently gated', async () => {
  const { flow, calls } = harness({ gates: gatesFor({ signIn: true, link: true }) });
  await flow.google();
  assert.ok(calls.includes('signInWithPopup'));
});

test('sign-in and linking gates are evaluated independently by the flow', async () => {
  const signInOnly = harness({ gates: gatesFor({ signIn: true, link: false }) });
  await signInOnly.flow.google();
  assert.ok(signInOnly.calls.includes('signInWithPopup'));
  assert.equal((await rejection(signInOnly.flow.link('pw'))).code, 'sso/disabled');
  const linkOnly = harness({ gates: gatesFor({ signIn: false, link: true }) });
  assert.equal((await rejection(linkOnly.flow.google())).code, 'sso/disabled');
});

test('gates are re-read on every call (no cached open state)', async () => {
  let open = true;
  const { flow, calls } = harness({ gates: { signIn: () => open, link: () => open } });
  await flow.google();
  open = false;
  const before = calls.length;
  await rejection(flow.google());
  assert.equal(calls.length, before);
});

test('no Google flow ever provisions roles or identities: the API surface is auth-only', async () => {
  const { flow, calls } = harness({ gates: gatesFor({ signIn: true, link: true }) });
  await flow.google();
  await flow.link('pw');
  assert.ok(calls.every(c => /^(new GoogleAuthProvider|setCustomParameters|EmailAuthProvider\.credential|beforeAuthStateChanged|reauthenticateWithCredential|signInWithPopup|linkWithPopup|unlink|signOut|signInWithEmailAndPassword:.*)$/.test(c)), calls.join(','));
  const flowSource = readFileSync(join(root, 'js/google-auth-flow.mjs'), 'utf8');
  assert.doesNotMatch(flowSource, /firestore|setDoc|updateDoc|addDoc|writeBatch|runTransaction|httpsCallable|localStorage|sessionStorage|URLSearchParams|location\./i);
});

// ---- browser wiring (UAT-rendered index.html) ----
const ssoBlock = (html, id) => html.match(new RegExp(`// @uat-admin-sso begin ${id}\\n[\\s\\S]*?(?=\\/\\* @uat-admin-sso production ${id})`))?.[0] ?? '';
const sso6 = ssoBlock(raw, 'sso-6');

test('Google controls start hidden in markup and are shown only through the gates', () => {
  assert.match(uatHtml, /<button id="googleLoginBtn"[^>]*\bhidden\b/);
  assert.match(uatHtml, /<button id="accountSecurityBtn"[^>]*\bhidden\b/);
  assert.match(sso6, /document\.getElementById\('googleLoginBtn'\)\.hidden=!googleSignInOpen\(\)/);
  assert.match(sso6, /document\.getElementById\('accountSecurityBtn'\)\.hidden=!googleLinkingOpen\(\)\|\|normalizeDashboardRole\(record\.role\)!=='admin'/);
  assert.ok(!/googleLoginBtn'\)\.hidden=false/.test(raw) && !/accountSecurityBtn'\)\.hidden=false/.test(raw));
});

test('direct handlers refuse when their gate is closed and the flow receives the same gates', () => {
  assert.match(sso6, /window\.handleGoogleLogin=async\(\)=>\{if\(!IS_UAT_PROFILE\)return;if\(!googleSignInOpen\(\)\)\{showAuthError\(GOOGLE_SSO_DISABLED_MESSAGES\.signIn\);return;\}/);
  assert.match(sso6, /window\.openAccountSecurity=\(\)=>\{\s*if\(!googleLinkingOpen\(\)\|\|currentRole!=='admin'\|\|!approvedDashboardIdentity\|\|!currentUser\)return;/);
  assert.match(sso6, /window\.linkGoogleAccount=async\(\)=>\{\s*if\(!IS_UAT_PROFILE\|\|currentRole!=='admin'\)return;\s*if\(!googleLinkingOpen\(\)\)\{[^}]*GOOGLE_SSO_DISABLED_MESSAGES\.linking/);
  assert.match(sso6, /createGoogleAuthFlow\(\{auth,gates:\{signIn:googleSignInOpen,link:googleLinkingOpen\}/);
  assert.match(sso6, /const googleGates=resolveGoogleSsoGates\(IS_UAT_PROFILE\?PM_ENV\.googleSso:undefined\)/);
});

test('gates are never read from user-editable sources or written to Firestore', () => {
  assert.doesNotMatch(sso6, /localStorage|sessionStorage|URLSearchParams|location\.(search|hash|href)|document\.cookie|setDoc|updateDoc|addDoc/);
  assert.equal([...sso6.matchAll(/PM_ENV\.googleSso/g)].length, 1, 'PM_ENV.googleSso is read exactly once, by the resolver');
});

test('login still uses the unchanged password path in every state', () => {
  assert.match(raw, /await googleAuthFlow\.password\(email, pass\);/);
  assert.match(raw, /<button id="passwordLoginBtn" onclick="handleLogin\(\)">Sign In<\/button>/);
});

test('ssoErrorMessage never exposes raw Firebase codes or messages', () => {
  const source = sso6.match(/function ssoErrorMessage\(error\)\{[\s\S]*?\n\}\n/)?.[0];
  assert.ok(source);
  const ssoErrorMessage = new Function('GOOGLE_SSO_DISABLED_MESSAGES', `${source}\nreturn ssoErrorMessage;`)(GOOGLE_SSO_DISABLED_MESSAGES);
  const providerDisabled = Object.assign(new Error('Firebase: Error (auth/operation-not-allowed).'), { code: 'auth/operation-not-allowed' });
  assert.equal(ssoErrorMessage(providerDisabled), GOOGLE_SSO_DISABLED_MESSAGES.signIn);
  for (const error of [
    Object.assign(new Error('Firebase: Error (auth/internal-error). projects/x/accounts'), { code: 'auth/internal-error' }),
    Object.assign(new Error('Firebase: Error (auth/network-request-failed).'), { code: 'auth/network-request-failed' }),
    new TypeError('Failed to fetch https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=SECRET'),
    undefined, null, 'string error'
  ]) {
    const message = ssoErrorMessage(error);
    assert.equal(message, 'Sign-in failed. Try again or use your password.');
    assert.doesNotMatch(message, /firebase|auth\/|googleapis|key=|projects\//i);
  }
  assert.equal(ssoErrorMessage(new Error('plain')), 'Sign-in failed. Try again or use your password.');
  assert.equal(ssoErrorMessage(Object.assign(new Error('app message'), { userSafe: true })), 'app message');
  assert.equal(ssoErrorMessage(Object.assign(new Error('x'), { code: 'auth/invalid-credential' })), 'The password you entered is not correct.');
});

// ---- build-controlled configuration ----
test('the committed UAT environment declares both gates OFF; Production declares none', async () => {
  const uat = await loadHostingEnv(root, 'uat');
  assert.deepEqual(uat.googleSso, { googleLinkingEnabled: false, googleSignInEnabled: false });
  const prod = await loadHostingEnv(root, 'prod');
  assert.equal(Object.hasOwn(prod, 'googleSso'), false);
});

test('UAT env-config.js carries frozen gates; Production rendering is unchanged and gate-free', async () => {
  const uat = await loadHostingEnv(root, 'uat');
  for (const [config, expected] of [[undefined, undefined], [{ googleLinkingEnabled: false, googleSignInEnabled: false }, { googleLinkingEnabled: false, googleSignInEnabled: false }], [{ googleLinkingEnabled: true, googleSignInEnabled: false }, { googleLinkingEnabled: true, googleSignInEnabled: false }], [{ googleLinkingEnabled: true, googleSignInEnabled: true }, { googleLinkingEnabled: true, googleSignInEnabled: true }]]) {
    const sandbox = { window: {} };
    vm.runInNewContext(renderEnvConfig({ ...uat, googleSso: config }), sandbox);
    const env = sandbox.window.PM_DASHBOARD_ENV;
    assert.deepEqual(env.googleSso && { ...env.googleSso }, expected);
    assert.ok(Object.isFrozen(env));
    if (expected) assert.ok(Object.isFrozen(env.googleSso));
  }
  const prod = await loadHostingEnv(root, 'prod');
  const rendered = renderEnvConfig(prod);
  assert.equal(rendered, readFileSync(join(root, 'env-config.js'), 'utf8'), 'Production env-config.js is unchanged');
  assert.doesNotMatch(rendered, /googleSso|googleLinkingEnabled|googleSignInEnabled/);
});

function fixtureRoot(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'sso-gate-env-'));
  mkdirSync(join(dir, 'env'));
  mkdirSync(join(dir, 'pdf-service/src/targets'), { recursive: true });
  cpSync(join(root, 'pdf-service/src/targets/registry.json'), join(dir, 'pdf-service/src/targets/registry.json'));
  for (const name of ['uat', 'prod']) {
    const env = JSON.parse(readFileSync(join(root, 'env', `${name}.json`), 'utf8'));
    mutate(name, env);
    writeFileSync(join(dir, 'env', `${name}.json`), JSON.stringify(env));
  }
  return dir;
}

test('invalid or malformed gate configuration fails the build instead of being guessed', async () => {
  for (const bad of [
    { googleLinkingEnabled: false, googleSignInEnabled: true }, { googleLinkingEnabled: 'true', googleSignInEnabled: false }, { googleLinkingEnabled: true },
    { googleLinkingEnabled: true, googleSignInEnabled: false, extra: 1 }, 'on', [], null
  ]) {
    const dir = fixtureRoot((name, env) => { if (name === 'uat') env.googleSso = bad; });
    try { await assert.rejects(loadHostingEnv(dir, 'uat'), /googleSso/, JSON.stringify(bad)); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('valid staged states build; Production refuses to carry the gates', async () => {
  for (const good of [undefined, { googleLinkingEnabled: false, googleSignInEnabled: false }, { googleLinkingEnabled: true, googleSignInEnabled: false }, { googleLinkingEnabled: true, googleSignInEnabled: true }]) {
    const dir = fixtureRoot((name, env) => { if (name === 'uat' && good) env.googleSso = good; if (name === 'uat' && !good) delete env.googleSso; });
    try { await loadHostingEnv(dir, 'uat'); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const dir = fixtureRoot((name, env) => { if (name === 'prod') env.googleSso = { googleLinkingEnabled: false, googleSignInEnabled: false }; });
  try { await assert.rejects(loadHostingEnv(dir, 'prod'), /Production stays password-only/); } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- GATE 6: production isolation ----
test('Production build has no Google UI, linking UI, SDK imports, SSO modules, handlers or gate config', async () => {
  const out = mkdtempSync(join(tmpdir(), 'sso-gate-prod-'));
  try {
    const build = await buildHosting({ rootDir: root, outDir: out, env: await loadHostingEnv(root, 'prod') });
    const entries = build.files.map(file => [file, readFileSync(join(out, file), 'utf8')]);
    assertNoProductionSso(entries);
    for (const file of ['js/google-auth-flow.mjs', 'js/google-sso-gate.mjs', 'js/dashboard-identity.js']) assert.ok(!build.files.includes(file), file);
    const everything = entries.map(([, text]) => text).join('\n');
    assert.doesNotMatch(everything, /Admin Google sign-in|googleLoginBtn|accountSecurity|Link Google account|GoogleAuthProvider|signInWithPopup|linkWithPopup|handleGoogleLogin|linkGoogleAccount|googleSso|googleLinkingEnabled|googleSignInEnabled|google-sso-gate|resolveGoogleSsoGates/);
    assert.equal(sha(readFileSync(join(out, 'index.html'), 'utf8')), PR81_PRODUCTION_INDEX_SHA256, 'Production index.html is byte-identical to the PR81 baseline');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('forbidden gate or SSO names injected into Production are rejected', () => {
  for (const value of ['googleSso', 'googleLinkingEnabled', 'googleSignInEnabled', 'google-sso-gate', 'resolveGoogleSsoGates']) {
    assert.throws(() => assertNoProductionSso([['env-config.js', value]]), /Production artifact contains UAT SSO/);
  }
  assert.equal(sha(prodHtml), PR81_PRODUCTION_INDEX_SHA256);
});

test('UAT build ships the gate module and OFF gates; Google UI stays hidden until a gate opens', async () => {
  const out = mkdtempSync(join(tmpdir(), 'sso-gate-uat-'));
  try {
    const build = await buildHosting({ rootDir: root, outDir: out, env: await loadHostingEnv(root, 'uat') });
    assert.ok(build.files.includes('js/google-sso-gate.mjs'));
    const envConfig = readFileSync(join(out, 'env-config.js'), 'utf8');
    assert.match(envConfig, /googleLinkingEnabled: false,\s+googleSignInEnabled: false/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
