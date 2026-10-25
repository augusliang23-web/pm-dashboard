// Real-browser check of the UAT Google SSO rollout gates. SYNTHETIC ONLY: the UAT build is re-pointed at a fake
// Firebase project and every request that is not localhost or the gstatic SDK CDN is intercepted, so no request
// can reach UAT, Production, Firebase Auth or Google. Run: node scripts/verification/google-sso-feature-gate-browser.mjs
// Needs puppeteer from pdf-service (PM_PUPPETEER_FROM may point at another pdf-service/package.json).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import { buildHosting } from '../build-hosting.mjs';
import { loadHostingEnv } from '../hosting-env.mjs';
import { renderEnvConfig } from '../env-config.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
const puppeteerFrom = process.env.PM_PUPPETEER_FROM || new URL('../../pdf-service/package.json', import.meta.url).pathname;
const puppeteer = createRequire(puppeteerFrom)('puppeteer');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
// Google / Firebase Auth endpoints (fonts and the SDK CDN are page assets, not authentication).
const GOOGLE_AUTH = /^(identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|www\.googleapis\.com\/identitytoolkit|accounts\.google\.com|apis\.google\.com|[^/]*\.firebaseapp\.com)/;
const STATES = [
  { name: 'A (linking OFF / sign-in OFF)', googleSso: { googleLinkingEnabled: false, googleSignInEnabled: false }, signInVisible: false },
  { name: 'B (linking ON / sign-in OFF)', googleSso: { googleLinkingEnabled: true, googleSignInEnabled: false }, signInVisible: false },
  { name: 'C (linking ON / sign-in ON)', googleSso: { googleLinkingEnabled: true, googleSignInEnabled: true }, signInVisible: true },
  { name: 'absent configuration', googleSso: undefined, signInVisible: false },
  { name: 'malformed configuration', googleSso: { googleLinkingEnabled: 'true', googleSignInEnabled: 'true' }, signInVisible: false, raw: true }
];

setTimeout(() => { console.error('google-sso-feature-gate-browser: timed out'); process.exit(2); }, 240000).unref();
const results = [];
const dir = await mkdtemp(join(tmpdir(), 'sso-gate-browser-'));
const uatEnv = await loadHostingEnv(root, 'uat');
await buildHosting({ rootDir: root, outDir: dir, env: uatEnv });
const server = createServer(async (request, response) => {
  try {
    const file = new URL(request.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
    const body = await readFile(join(dir, file));
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

async function runState(state) {
  // Fake project: nothing here can name the real UAT or Production project.
  const env = { ...uatEnv, googleSso: state.googleSso, firebaseConfig: { ...uatEnv.firebaseConfig, apiKey: 'fake-api-key', authDomain: 'sso-gate-test.firebaseapp.com', projectId: 'sso-gate-test', appId: '1:1:web:fake', messagingSenderId: '1' } };
  let config = renderEnvConfig(env);
  if (state.raw) config = config.replace(/googleSso: Object\.freeze\(\{[\s\S]*?\}\)/, `googleSso: Object.freeze({ googleLinkingEnabled: 'true', googleSignInEnabled: 'true' })`);
  await writeFile(join(dir, 'env-config.js'), config);
  const page = await browser.newPage();
  const attempted = [], googleRequests = [], popups = [], passwordRequests = [], consoleErrors = [];
  page.on('popup', p => popups.push(p.url()));
  page.on('pageerror', error => consoleErrors.push(String(error.message || error)));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (process.env.SSO_GATE_DEBUG) console.error('REQ', request.method(), request.url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) return request.continue();
    attempted.push(`${url.hostname}${url.pathname}`);
    if (url.pathname.includes('accounts:signInWithPassword')) {
      passwordRequests.push(url.pathname);
      return request.respond({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } }) });
    }
    if (GOOGLE_AUTH.test(`${url.hostname}${url.pathname}`) || url.pathname.includes('/__/auth/')) googleRequests.push(`${url.hostname}${url.pathname}`);
    return request.abort();
  });
  if (process.env.SSO_GATE_DEBUG) { page.on('requestfailed', r => console.error('FAILED', r.url(), r.failure()?.errorText)); page.on('response', r => console.error('RESP', r.status(), r.url())); page.on('console', m => console.error('CONSOLE', m.text().slice(0, 200))); }
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.handleGoogleLogin === 'function', { timeout: 30000 });
  await new Promise(done => setTimeout(done, 1500));

  const visible = id => page.evaluate(selector => { const el = document.getElementById(selector); if (!el) return 'missing'; const s = getComputedStyle(el); return !el.hidden && s.display !== 'none' && s.visibility !== 'hidden'; }, id);
  const evidence = { state: state.name };
  evidence.googleLoginVisible = await visible('googleLoginBtn');
  evidence.accountSecurityButtonVisible = await visible('accountSecurityBtn');
  evidence.accountSecurityDialogOpen = await page.evaluate(() => document.getElementById('accountSecurityOverlay').classList.contains('open'));
  evidence.passwordButtonVisible = await visible('passwordLoginBtn');
  assert.equal(evidence.googleLoginVisible, state.signInVisible, `${state.name}: Google login visibility`);
  assert.equal(evidence.accountSecurityButtonVisible, false, `${state.name}: Account Security button must stay hidden when signed out`);
  assert.equal(evidence.accountSecurityDialogOpen, false);
  assert.equal(evidence.passwordButtonVisible, true, `${state.name}: password login button`);

  // Direct handler calls (what a console user or stale click could do) -- allowed to reach Google only in state C.
  await page.evaluate(() => { window.handleGoogleLogin(); window.openAccountSecurity(); window.linkGoogleAccount(); });
  await new Promise(done => setTimeout(done, 1500));
  evidence.authMessageAfterDirectGoogleCall = await page.evaluate(() => document.getElementById('authMsg').textContent);
  evidence.googleRequestsAfterDirectCalls = [...googleRequests];
  evidence.popups = [...popups];
  evidence.accountSecurityDialogOpenAfterDirectCall = await page.evaluate(() => document.getElementById('accountSecurityOverlay').classList.contains('open'));
  assert.equal(evidence.accountSecurityDialogOpenAfterDirectCall, false);
  if (state.signInVisible) {
    assert.ok(googleRequests.length > 0 || popups.length > 0, 'state C: an enabled Google sign-in attempt should start');
  } else {
    assert.deepEqual(googleRequests, [], `${state.name}: no Google/Firebase auth request may start`);
    assert.deepEqual(popups, [], `${state.name}: no popup may start`);
    assert.match(evidence.authMessageAfterDirectGoogleCall, /^Google sign-in is not available yet\. Please sign in with your password\.$/);
  }
  assert.doesNotMatch(evidence.authMessageAfterDirectGoogleCall, /firebase|auth\/|googleapis/i);

  // Password login must still reach the Firebase password endpoint, in every state, and never a Google endpoint.
  const before = googleRequests.length;
  await page.evaluate(() => { document.getElementById('email').value = 'pm@example.invalid'; document.getElementById('password').value = 'not-a-real-password'; window.handleLogin(); });
  await new Promise(done => setTimeout(done, 2500));
  evidence.passwordEndpointRequests = [...passwordRequests];
  evidence.loginMessage = await page.evaluate(() => document.getElementById('authMsg').textContent);
  assert.ok(passwordRequests.length >= 1, `${state.name}: password sign-in request`);
  assert.equal(googleRequests.length, before, `${state.name}: password login must not call Google`);
  assert.match(evidence.loginMessage, /Login Failed: Please check your email and password\./);
  evidence.consoleErrors = consoleErrors;
  await page.close();
  results.push(evidence);
}

try {
  for (const state of STATES) await runState(state);
  console.log(JSON.stringify({ result: 'PASS', origin: 'local synthetic', states: results.length, evidence: results }, null, 2));
} finally {
  await browser.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
