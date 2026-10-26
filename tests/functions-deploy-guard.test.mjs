// P0: Owner-signed, contract-scoped Functions release guard. Every test uses temporary directories, SYNTHETIC keys
// generated in memory, a real throw-away git repository and a MOCK runner. The real Firebase CLI is never started,
// no cloud resource is contacted, and no real Owner key exists anywhere in this repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  chmodSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync
} from 'node:fs';
import { lstat, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, dirname, relative } from 'node:path';
import {
  CONTRACT_KEYS, INSTALL_ARGUMENTS, ReleaseGuardError, assertReleaseContract, assertScopedFunctionsDeployArgs, buildScopedFirebaseArgs,
  parseDeploymentManifestText, parseGuardArguments, readFunctionSourceText, runFunctionsDeploy, sanitizedToolEnv
} from '../scripts/functions-release-guard.mjs';
import {
  ApprovalError, DEFAULT_TRUST_ANCHOR_PATH, canonicalPayload, defaultAmbientRoots, loadTrustAnchor, parseApprovalArtifact, payloadDigest,
  publicKeyFingerprint, signApproval, verifyApproval
} from '../scripts/release-approval.mjs';
import {
  PACKAGE_PREFIX, PackageIntegrityError, disposePackage, exportSourcePackage, listSourceEntries, openRepository, verifyExportedPackage,
  verifyInstalledPackage, capturePackageIdentity, assertPackageIdentity, objectId, resolveSourceCommit
} from '../scripts/functions-source-package.mjs';
import { NPM_SANDBOX_PREFIX, NpmSandboxError, assertNpmSandbox, createNpmSandbox, disposeNpmSandbox, npmInstallEnvironment } from '../scripts/npm-sandbox.mjs';
import {
  GIT_GLOBAL_OPTIONS, GitSandboxError, assertSafeGitArguments, gitEnvironment, makeGit, resolveGitBinary
} from '../scripts/git-sandbox.mjs';
import { buildPlan } from '../scripts/release-approval-cli.mjs';
import { functionsAllowlistFor } from '../scripts/deployment-manifest.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
const manifestText = readFileSync(join(repoRoot, 'config', 'deployment-manifest.json'), 'utf8');
const indexText = readFileSync(join(repoRoot, 'functions', 'index.js'), 'utf8');
const manifest = parseDeploymentManifestText(manifestText);
const source = readFunctionSourceText(indexText);
const UAT = manifest.environments.uat.firebaseProjectId;
const PROD = manifest.environments.prod.firebaseProjectId;
const SCHEDULER = 'aggregatePresenceSessions';
const SHA = 'a7f272648e38f36dfee7b7e8bf2d5529659d8194';
const TREE = 'c1eb5635caa14d069c1ca2056748ce2f53c6bf8d';
const NOW = new Date('2026-10-26T02:00:00Z');
const uatAllowlist = functionsAllowlistFor(manifest, 'uat');
const CALLABLES_24 = uatAllowlist.filter(name => name !== SCHEDULER);
const gitState = (overrides = {}) => ({ sha: SHA, tree: TREE, dirty: false, ...overrides });
const contract24 = (overrides = {}) => ({
  contractVersion: 2, releaseId: 's02-uat-24-callables', environment: 'uat', firebaseProjectId: UAT, sourceSha: SHA, sourceTree: TREE,
  functions: [...CALLABLES_24], expectedFunctionCount: 24, exclusions: [SCHEDULER], scheduledFunctionsApproved: [],
  notBefore: '2026-10-26T01:00:00Z', expiresAt: '2026-10-27T01:00:00Z', ...overrides
});
const check = (contract, extra = {}) => assertReleaseContract({ manifest, contract, environment: 'uat', project: UAT, git: gitState(), source, now: NOW, ...extra });

// ===================== release contract semantics (payload rules) =====================
test('the UAT manifest is the R2 shape: 25 eligible Functions of which exactly one is scheduled', () => {
  assert.equal(uatAllowlist.length, 25);
  assert.deepEqual([...source.scheduled], [SCHEDULER]);
  assert.equal(CALLABLES_24.length, 24);
});

test('a valid 24-Function payload is accepted and builds only an explicitly scoped command', () => {
  const contract = check(contract24());
  const args = buildScopedFirebaseArgs(contract);
  assert.deepEqual(args.slice(0, 2), ['deploy', '--only']);
  const parts = args[2].split(',');
  assert.equal(parts.length, 24);
  assert.ok(parts.every(part => /^functions:[A-Za-z][A-Za-z0-9_]*$/.test(part)));
  assert.ok(!parts.includes(`functions:${SCHEDULER}`), 'the scheduler is excluded');
  assert.deepEqual(args.slice(3, 5), ['--project', UAT]);
  assert.doesNotThrow(() => assertScopedFunctionsDeployArgs(args, contract));
});

test('the scheduled Function is excluded unless it is separately and explicitly approved', () => {
  const withScheduler = contract24({ functions: [...uatAllowlist], expectedFunctionCount: 25, exclusions: [] });
  assert.throws(() => check(withScheduler), /scheduled Function and is not listed in scheduledFunctionsApproved/);
  assert.equal(check(contract24({ functions: [...uatAllowlist], expectedFunctionCount: 25, exclusions: [], scheduledFunctionsApproved: [SCHEDULER] })).functions.length, 25);
  assert.throws(() => check(contract24({ scheduledFunctionsApproved: [SCHEDULER] })), /not in functions/);
  assert.throws(() => check(contract24({ scheduledFunctionsApproved: ['saveDashboardProject'] })), /not in functions|not a scheduled/);
});

test('an unexpected 25th Function fails the count and the exclusions accounting', () => {
  assert.throws(() => check(contract24({ functions: [...uatAllowlist], expectedFunctionCount: 24, exclusions: [] })), /expectedFunctionCount 24 does not match the 25/);
  assert.throws(() => check(contract24({ expectedFunctionCount: 25 })), /expectedFunctionCount 25 does not match the 24/);
  assert.throws(() => check(contract24({ functions: [...CALLABLES_24, SCHEDULER], expectedFunctionCount: 25 })), ReleaseGuardError);
});

test('a manifest-eligible Function that is neither named nor explicitly excluded is rejected', () => {
  assert.throws(() => check(contract24({ functions: CALLABLES_24.slice(1), expectedFunctionCount: 23 })), new RegExp(`neither deployed nor explicitly excluded: ${CALLABLES_24[0]}`));
});

test('an unknown Function is rejected', () => {
  assert.throws(() => check(contract24({ functions: [...CALLABLES_24.slice(1), 'totallyNewFunction'] })), /totallyNewFunction" is not a managed uat Function/);
});

test('names that are not plain Function names (wildcards, scopes, lists) are rejected', () => {
  for (const bad of ['*', 'functions', 'functions:saveDashboardProject', 'a,b', 'group.fn', ' ', 'save Dashboard']) {
    assert.throws(() => check(contract24({ functions: [bad, ...CALLABLES_24.slice(1)] })), ReleaseGuardError, bad);
  }
});

test('the wrong project is rejected (flag, payload and Production crossover)', () => {
  assert.throws(() => check(contract24(), { project: 'some-other-project' }), /--project "some-other-project"/);
  assert.throws(() => check(contract24({ firebaseProjectId: PROD })), /is not the uat project/);
  assert.throws(() => check(contract24({ firebaseProjectId: PROD }), { project: PROD }), /is not the uat project/);
  assert.throws(() => check(contract24(), { project: PROD }), /--project .* is not the uat project/);
  assert.throws(() => check(contract24(), { project: '' }), /explicit Firebase project id/);
});

test('a missing or unknown environment is rejected', () => {
  for (const environment of [undefined, '', 'staging', 'production']) {
    assert.throws(() => check(contract24(), { environment }), /environment .* missing or unknown|manifest has no environment/);
  }
  assert.throws(() => check(contract24({ environment: 'prod' })), /differs from the requested environment/);
  assert.throws(() => parseGuardArguments(['--project', UAT, '--approval', '/x/approval.json']), /--env is required/);
});

test('an incomplete payload is rejected; the retired free-text authorizationRef is an unknown key', () => {
  assert.throws(() => check(undefined), /missing or not an object/);
  assert.throws(() => check(null), ReleaseGuardError);
  assert.throws(() => check([]), ReleaseGuardError);
  for (const key of Object.keys(contract24())) {
    const { [key]: _removed, ...rest } = contract24();
    assert.throws(() => check(rest), new RegExp(`missing "${key}"`));
  }
  assert.throws(() => check({ ...contract24(), authorizationRef: 'Owner said yes' }), /unknown key "authorizationRef"/);
  assert.throws(() => check({ ...contract24(), surprise: true }), /unknown key "surprise"/);
  assert.throws(() => check(contract24({ contractVersion: 1 })), /contractVersion must be 2/);
  assert.deepEqual([...CONTRACT_KEYS].sort(), Object.keys(contract24()).sort());
});

test('source commit, tree and working-tree state must match; the approval window is enforced', () => {
  assert.throws(() => check(contract24({ sourceSha: 'f65efd57b6a7906c0772f9cde4333cff4ed09f54' })), /is not the checked-out HEAD/);
  assert.throws(() => check(contract24({ sourceSha: 'a7f2726' })), /full 40-character/);
  assert.throws(() => check(contract24({ sourceSha: SHA.toUpperCase() })), /full 40-character/);
  assert.throws(() => check(contract24({ sourceTree: 'd'.repeat(40) })), /differs from the tree of the source commit/);
  assert.throws(() => check(contract24(), { git: gitState({ dirty: true }) }), /uncommitted tracked changes/);
  assert.throws(() => check(contract24(), { git: gitState({ dirty: undefined }) }), /uncommitted tracked changes|unknown/);
  assert.throws(() => check(contract24(), { git: undefined }), ReleaseGuardError);
  assert.throws(() => check(contract24(), { now: new Date('2026-10-27T01:00:00Z') }), /expired at/);
  assert.throws(() => check(contract24(), { now: new Date('2026-10-26T00:59:59Z') }), /not valid until/);
  assert.throws(() => check(contract24({ expiresAt: '2026-11-30T01:00:00Z' })), /may not exceed 14 days/);
  assert.throws(() => check(contract24({ expiresAt: '2026-10-26T01:00:00Z' })), /expiresAt must be after notBefore/);
  assert.throws(() => check(contract24({ notBefore: 'tomorrow' })), /UTC timestamps/);
});

test('Production and UAT stay isolated', () => {
  const prodAllowlist = functionsAllowlistFor(manifest, 'prod');
  const prod = overrides => ({ ...contract24(), environment: 'prod', firebaseProjectId: PROD, functions: [...prodAllowlist], expectedFunctionCount: prodAllowlist.length, exclusions: [], scheduledFunctionsApproved: prodAllowlist.filter(name => source.scheduled.has(name)), ...overrides });
  const run = (contract, project = PROD) => assertReleaseContract({ manifest, contract, environment: 'prod', project, git: gitState(), source, now: NOW });
  assert.equal(run(prod()).environment, 'prod');
  const forbidden = manifest.environments.prod.functionsNeverDeploy.productionWeekSync[0];
  assert.throws(() => run(prod({ functions: [forbidden, ...prodAllowlist.slice(1)] })), /forbidden in prod|not a managed prod/);
  assert.throws(() => run(prod({ firebaseProjectId: UAT }), UAT), /is not the prod project/);
  assert.throws(() => check(contract24({ firebaseProjectId: PROD }), { project: PROD }), /is not the uat project/);
  const preserved = manifest.environments.prod.functionsPreserveExisting[0];
  assert.throws(() => run(prod({ functions: [preserved, ...prodAllowlist.slice(1)] })), /preserved prod Function/);
});

// ===================== raw Firebase argument lists (the R2 incident shapes) =====================
test('unscoped "--only functions" is rejected, with and without a project', () => {
  assert.throws(() => assertScopedFunctionsDeployArgs(['deploy', '--only', 'functions']), /not an individually named Function/);
  assert.throws(() => assertScopedFunctionsDeployArgs(['deploy', '--only', 'functions', '--project', UAT]), /not an individually named Function/);
  assert.throws(() => assertScopedFunctionsDeployArgs(['deploy', '--project', UAT]), /exactly one --only/);
  assert.throws(() => assertScopedFunctionsDeployArgs(['deploy']), ReleaseGuardError);
  assert.throws(() => assertScopedFunctionsDeployArgs(['deploy', '--only', 'functions:*', '--project', UAT]), ReleaseGuardError);
  assert.throws(() => assertScopedFunctionsDeployArgs(['deploy', '--only', 'functions:a.b', '--project', UAT]), ReleaseGuardError);
  assert.throws(() => assertScopedFunctionsDeployArgs(['deploy', '--only', 'functions:saveDashboardProject,hosting', '--project', UAT]), /"hosting"/);
  assert.throws(() => assertScopedFunctionsDeployArgs(['deploy', '--only', 'functions:saveDashboardProject', '--only', 'functions:deleteDashboardProject', '--project', UAT]), /exactly one --only/);
  assert.throws(() => assertScopedFunctionsDeployArgs(['deploy', '--only', 'functions:saveDashboardProject']), /explicit --project/);
});

test('destructive or widening flags are rejected', () => {
  for (const extra of [['--force'], ['--except', 'functions:x'], ['--non-interactive'], ['--config', 'firebase.uat.json']]) {
    assert.throws(() => assertScopedFunctionsDeployArgs(['deploy', '--only', 'functions:saveDashboardProject', '--project', UAT, ...extra]), /not allowed/, extra.join(' '));
  }
});

test('the CLI wrapper never accepts raw Firebase flags or the retired --contract', () => {
  for (const flag of [['--only', 'functions'], ['--force'], ['--except', 'x'], ['--all'], ['--contract', 'config/release-contracts/x.json']]) {
    assert.throws(() => parseGuardArguments(['--env', 'uat', '--project', UAT, '--approval', '/x/a.json', ...flag]), /Unsupported argument/);
  }
  assert.throws(() => parseGuardArguments(['--env', 'uat', '--project', UAT]), /--approval is required/);
  assert.throws(() => parseGuardArguments(['--env', 'uat', '--approval', '/x/a.json']), /--project is required/);
});

// ===================== Owner approval: signature, canonical payload, tamper evidence =====================
const ownerKeys = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  return { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKeyPem, keyId: publicKeyFingerprint(publicKeyPem) };
};
const OWNER = ownerKeys();
const OTHER = ownerKeys();
const trusted = [{ keyId: OWNER.keyId, publicKeyPem: OWNER.publicKeyPem }];

test('a correctly signed approval verifies and returns exactly the signed payload', () => {
  const artifact = signApproval({ payload: contract24(), privateKeyPem: OWNER.privateKeyPem });
  assert.equal(artifact.keyId, OWNER.keyId);
  assert.deepEqual(verifyApproval({ artifact, trustedKeys: trusted }), contract24());
});

test('the canonical payload is order-independent for name lists and stable', () => {
  const reversed = contract24({ functions: [...CALLABLES_24].reverse() });
  assert.equal(canonicalPayload(reversed), canonicalPayload(contract24()));
  assert.equal(payloadDigest(reversed), payloadDigest(contract24()));
  assert.notEqual(payloadDigest(contract24({ releaseId: 's02-uat-other' })), payloadDigest(contract24()));
});

test('a fabricated authorizationRef or any unsigned approval is rejected', () => {
  for (const fake of [
    { authorizationRef: 'Owner approved this release' },
    { schema: 'pmdash-functions-release-approval/v1', payload: contract24(), authorizationRef: 'Owner approved' },
    { schema: 'pmdash-functions-release-approval/v1', payload: contract24(), keyId: OWNER.keyId },
    { schema: 'pmdash-functions-release-approval/v1', payload: { ...contract24(), authorizationRef: 'x' }, keyId: OWNER.keyId, signature: 'AAAA' },
    'Owner approved', 42, null, []
  ]) assert.throws(() => verifyApproval({ artifact: fake, trustedKeys: trusted }), ApprovalError, JSON.stringify(fake));
});

test('invalid or missing approval structure is rejected', () => {
  const good = signApproval({ payload: contract24(), privateKeyPem: OWNER.privateKeyPem });
  for (const broken of [
    { ...good, schema: 'v2' }, { ...good, payload: undefined }, { ...good, keyId: 'abc' }, { ...good, signature: '' },
    { ...good, signature: good.signature.slice(0, -4) }, { ...good, signature: `${good.signature}A` }, { ...good, extra: 1 }, { ...good, signature: 'not base64 !!' }
  ]) assert.throws(() => parseApprovalArtifact(broken), ApprovalError);
});

test('a tampered payload invalidates the approval (function list, count, scheduled approval, sha, project, environment, window)', () => {
  const good = signApproval({ payload: contract24(), privateKeyPem: OWNER.privateKeyPem });
  const tamper = changes => ({ ...good, payload: { ...good.payload, ...changes } });
  for (const changes of [
    { functions: [...CALLABLES_24.slice(1), SCHEDULER] }, { functions: [...CALLABLES_24, SCHEDULER] }, { expectedFunctionCount: 25 },
    { exclusions: [] }, { scheduledFunctionsApproved: [SCHEDULER] }, { sourceSha: 'b'.repeat(40) }, { sourceTree: 'e'.repeat(40) },
    { firebaseProjectId: PROD }, { environment: 'prod' }, { releaseId: 'another-release' }, { expiresAt: '2026-11-08T01:00:00Z' }
  ]) assert.throws(() => verifyApproval({ artifact: tamper(changes), trustedKeys: trusted }), /does not match its payload/, JSON.stringify(changes).slice(0, 60));
});

test('an approval signed by a different key, or with a corrupted signature, is rejected', () => {
  const foreign = signApproval({ payload: contract24(), privateKeyPem: OTHER.privateKeyPem });
  assert.throws(() => verifyApproval({ artifact: foreign, trustedKeys: trusted }), /not in the trust anchor/);
  // Claiming the trusted key id while signing with another key must still fail the signature check.
  assert.throws(() => verifyApproval({ artifact: { ...foreign, keyId: OWNER.keyId }, trustedKeys: trusted }), /does not match its payload/);
  const good = signApproval({ payload: contract24(), privateKeyPem: OWNER.privateKeyPem });
  const flipped = Buffer.from(good.signature, 'base64'); flipped[0] ^= 0xff;
  assert.throws(() => verifyApproval({ artifact: { ...good, signature: flipped.toString('base64') }, trustedKeys: trusted }), /does not match its payload/);
  assert.throws(() => verifyApproval({ artifact: good, trustedKeys: [] }), /No trusted Owner key/);
});

// ===================== trust anchor: the COMPLETE ancestor chain (synthetic filesystem) =====================
const anchorJson = (keys = trusted, schema = 'pmdash-release-trust/v1') => JSON.stringify({ schema, keys });
const ANCHOR = '/etc/pmdash/functions-release-trust.json';
const DIR = { type: 'dir', uid: 0, mode: 0o040755 };
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
const eacces = () => Object.assign(new Error('EACCES'), { code: 'EACCES' });
// A tiny in-memory filesystem: lstat/realpath/access/readFile with symlink resolution. `writable` lists paths the
// executing user can write (as reported by access()); `uid` is the executing user.
function fakeFs(overrides = {}, { uid = 501, writable = [], onRead } = {}) {
  const entries = { '/': DIR, '/etc': DIR, '/etc/pmdash': DIR, [ANCHOR]: { type: 'file', uid: 0, mode: 0o100644, content: anchorJson() }, ...overrides };
  const get = path => { const entry = entries[path]; if (!entry) throw enoent(); return entry; };
  const stat = entry => ({
    uid: entry.uid, mode: entry.mode, dev: 1, ino: entry.ino ?? 7, size: (entry.content ?? '').length, mtimeMs: entry.mtimeMs ?? 1,
    isFile: () => entry.type === 'file', isDirectory: () => entry.type === 'dir', isSymbolicLink: () => entry.type === 'link'
  });
  const fs = {
    entries,
    // lstat follows intermediate links (like the OS) but never the final component.
    lstat: async path => (path === '/' ? stat(get('/')) : stat(get(join(await fs.realpath(dirname(path)), basename(path))))),
    realpath: async path => {
      let resolved = '';
      for (const part of path.split('/').filter(Boolean)) {
        resolved += `/${part}`;
        for (let hops = 0; get(resolved).type === 'link'; hops += 1) { if (hops > 20) throw Object.assign(new Error('ELOOP'), { code: 'ELOOP' }); resolved = get(resolved).target; }
      }
      return resolved || '/';
    },
    access: async path => { if (!writable.includes(path)) throw eacces(); },
    readFile: async path => { const entry = get(path); onRead?.(entry); return entry.content; },
    getuid: () => uid
  };
  return fs;
}
const load = (fs, extra = {}) => loadTrustAnchor({ path: ANCHOR, forbiddenRoots: [repoRoot], ambientRoots: [], io: fs, ...extra });
const macOsLayout = (extra = {}) => ({
  '/etc': { type: 'link', uid: 0, mode: 0o120755, target: '/private/etc' }, '/private': DIR, '/private/etc': DIR, '/private/etc/pmdash': DIR,
  '/private/etc/pmdash/functions-release-trust.json': { type: 'file', uid: 0, mode: 0o100644, content: anchorJson() }, ...extra
});

test('a root-owned anchor under a root-owned, closed ancestor chain is accepted', async () => {
  assert.deepEqual(await load(fakeFs()), trusted);
});

test('the macOS layout (root-owned /etc -> /private/etc alias) is accepted', async () => {
  const fs = fakeFs(macOsLayout());
  delete fs.entries['/etc/pmdash']; delete fs.entries[ANCHOR];
  assert.deepEqual(await load(fs), trusted);
});

test('an absent trust anchor fails closed and tells the Owner how to bootstrap', async () => {
  const fs = fakeFs(); delete fs.entries[ANCHOR];
  await assert.rejects(load(fs), /Trust anchor rejected: .*does not exist.*Owner bootstrap required/s);
  await assert.rejects(loadTrustAnchor({ forbiddenRoots: [repoRoot], ambientRoots: [], io: fs }), /Owner bootstrap required/);
  assert.equal(DEFAULT_TRUST_ANCHOR_PATH, '/etc/pmdash/functions-release-trust.json');
});

test('a replaceable ancestor directory invalidates the anchor even when the file itself looks root-owned', async () => {
  for (const [path, replacement, pattern] of [
    ['/etc/pmdash', { ...DIR, uid: 501 }, /\/etc\/pmdash is not owned by root/],
    ['/etc', { ...DIR, uid: 501 }, /\/etc is not owned by root/],
    ['/', { ...DIR, uid: 501 }, /\/ is not owned by root/],
    ['/etc/pmdash', { ...DIR, mode: 0o040775 }, /writable by group or others/],
    ['/etc', { ...DIR, mode: 0o040757 }, /writable by group or others/],
    ['/etc', { ...DIR, mode: 0o041777 }, /writable by group or others/],
    ['/etc/pmdash', { type: 'file', uid: 0, mode: 0o100644 }, /is not a directory/]
  ]) {
    await assert.rejects(load(fakeFs({ [path]: replacement })), pattern, `${path} ${pattern}`);
  }
  // Ownership/mode can look fine while the executing user can still write (ACLs, group membership): access() says so.
  await assert.rejects(load(fakeFs({}, { writable: ['/etc/pmdash'] })), /\/etc\/pmdash is writable by the executing user/);
  await assert.rejects(load(fakeFs({}, { writable: ['/etc'] })), /\/etc is writable by the executing user/);
});

test('a symlink anywhere on the path must be root-owned and every directory behind it is validated', async () => {
  await assert.rejects(load(fakeFs(macOsLayout({ '/etc': { type: 'link', uid: 501, mode: 0o120755, target: '/private/etc' } }))), /symbolic link not owned by root/);
  await assert.rejects(load(fakeFs(macOsLayout({ '/private': { ...DIR, uid: 501 } }))), /\/private is not owned by root/);
  await assert.rejects(load(fakeFs(macOsLayout({ '/private/etc': { ...DIR, mode: 0o040777 } }))), /writable by group or others/);
  await assert.rejects(load(fakeFs({ [ANCHOR]: { type: 'link', uid: 501, mode: 0o120755, target: '/etc/pmdash/other.json' }, '/etc/pmdash/other.json': { type: 'file', uid: 0, mode: 0o100644, content: anchorJson() } })), /symbolic link not owned by root/);
});

test('a same-user writable trust file is not a trust anchor', async () => {
  await assert.rejects(load(fakeFs({ [ANCHOR]: { type: 'file', uid: 501, mode: 0o100644, content: anchorJson() } })), /not owned by root/);
  await assert.rejects(load(fakeFs({ [ANCHOR]: { type: 'file', uid: 0, mode: 0o100664, content: anchorJson() } })), /writable by group or others/);
  await assert.rejects(load(fakeFs({ [ANCHOR]: { type: 'file', uid: 0, mode: 0o100666, content: anchorJson() } })), /writable by group or others/);
  await assert.rejects(load(fakeFs({}, { writable: [ANCHOR] })), /writable by the executing user/);
  await assert.rejects(load(fakeFs({ [ANCHOR]: { type: 'dir', uid: 0, mode: 0o040755 } })), /not a regular file/);
});

test('an anchor under an agent-writable location (repository, home, temp, working directory) is refused', async () => {
  const under = root => ({ path: `${root}/trust.json`, io: fakeFs({ [`${root}/trust.json`]: { type: 'file', uid: 0, mode: 0o100644, content: anchorJson() }, [root]: DIR }) });
  const inRepo = under(join(repoRoot, 'config'));
  await assert.rejects(loadTrustAnchor({ path: inRepo.path, forbiddenRoots: [repoRoot], ambientRoots: [], io: inRepo.io }), /stored outside/);
  const home = under('/home/agent');
  await assert.rejects(loadTrustAnchor({ path: home.path, forbiddenRoots: [], ambientRoots: ['/home/agent'], io: home.io }), /stored outside/);
  await assert.rejects(loadTrustAnchor({ path: ANCHOR, forbiddenRoots: [], ambientRoots: ['/etc'], io: fakeFs() }), /stored outside/);
  await assert.rejects(loadTrustAnchor({ path: 'trust.json', forbiddenRoots: [repoRoot], ambientRoots: [], io: fakeFs() }), /must be absolute/);
  assert.ok(defaultAmbientRoots().includes(process.cwd()) && defaultAmbientRoots().includes(tmpdir()));
});

test('a trust file that changes while it is being read is refused', async () => {
  await assert.rejects(load(fakeFs({}, { onRead: entry => { entry.mtimeMs = 99; } })), /changed while it was being read/);
});

test('an anchor with no keys, the wrong schema, bad key ids or non-Ed25519 keys is refused', async () => {
  const withContent = content => fakeFs({ [ANCHOR]: { type: 'file', uid: 0, mode: 0o100644, content } });
  await assert.rejects(load(withContent(anchorJson([]))), /lists no trusted keys/);
  await assert.rejects(load(withContent(anchorJson(trusted, 'other/v1'))), /must be/);
  await assert.rejects(load(withContent('not json')), /not valid JSON/);
  await assert.rejects(load(withContent(JSON.stringify({ schema: 'pmdash-release-trust/v1', keys: trusted, extra: 1 }))), /must be/);
  await assert.rejects(load(withContent(anchorJson([{ keyId: OTHER.keyId, publicKeyPem: OWNER.publicKeyPem }]))), /not the fingerprint/);
  await assert.rejects(load(withContent(anchorJson([...trusted, ...trusted]))), /duplicate key/);
  await assert.rejects(load(withContent(anchorJson([{ keyId: OWNER.keyId, publicKeyPem: 'not a key' }]))), /not a valid PEM/);
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'pem' });
  await assert.rejects(load(withContent(anchorJson([{ keyId: 'sha256:' + '0'.repeat(64), publicKeyPem: ec }]))), /Only Ed25519/);
});

// A trust anchor that this user created under the OS temp directory is refused by the ancestor-chain / ownership
// validation, but WHICH check fires first depends on the platform's temp layout: macOS has a per-user temp directory
// (the user-owned ancestor is "not owned by root"), Linux has a root-owned, sticky, world-writable /tmp ("writable by
// group or others"). Only these named refusals of the trust-anchor validation are accepted, each with the Owner
// bootstrap hint; success, a different error or any other refusal text fails the test.
const USER_CREATED_ANCHOR_REFUSALS = [
  /^Trust anchor rejected: .+ is not owned by root, so its owner could replace the trust anchor\. Owner bootstrap required/s,
  /^Trust anchor rejected: .+ is writable by group or others, so the trust anchor could be replaced\. Owner bootstrap required/s,
  /^Trust anchor rejected: .+ is writable by the executing user\. Owner bootstrap required/s,
  /^Trust anchor rejected: .+ is not owned by root, so the executing user could rewrite it\. Owner bootstrap required/s
];
const refusedAsUserCreatedAnchor = promise => assert.rejects(promise, error => {
  assert.ok(error instanceof ApprovalError, `not a trust-anchor refusal: ${error?.message}`);
  assert.ok(USER_CREATED_ANCHOR_REFUSALS.some(pattern => pattern.test(error.message)), `unexpected trust-anchor refusal: ${error.message}`);
  return true;
});

test('the user-created-anchor matcher accepts only trust-anchor refusals, never success or an unrelated failure', async () => {
  await assert.rejects(refusedAsUserCreatedAnchor(Promise.resolve([])), /Missing expected rejection/);
  await assert.rejects(refusedAsUserCreatedAnchor(Promise.reject(new Error('boom'))), /not a trust-anchor refusal: boom/);
  await assert.rejects(refusedAsUserCreatedAnchor(Promise.reject(new ApprovalError('Trust anchor rejected: /x does not exist or cannot be resolved.'))), /unexpected trust-anchor refusal/);
  await assert.rejects(refusedAsUserCreatedAnchor(Promise.reject(new ApprovalError('Trust anchor rejected: /x is writable by group or others. Owner bootstrap required'))), /unexpected trust-anchor refusal/);
});

test('macOS and Linux temp layouts both refuse a user-created anchor, each for its own deterministic reason', async () => {
  const anchor = { type: 'file', uid: 501, mode: 0o100644, content: anchorJson() };
  const options = path => ({ path, forbiddenRoots: [repoRoot], ambientRoots: [] });
  // Linux: root-owned /tmp that anyone can write to (sticky bit), user-owned directory below it.
  const linux = fakeFs({ '/tmp': { ...DIR, mode: 0o041777 }, '/tmp/trust-anchor-x': { ...DIR, uid: 501, mode: 0o040700 }, '/tmp/trust-anchor-x/trust.json': anchor });
  await assert.rejects(loadTrustAnchor({ ...options('/tmp/trust-anchor-x/trust.json'), io: linux }), /^ApprovalError: Trust anchor rejected: \/tmp is writable by group or others, so the trust anchor could be replaced\./);
  await refusedAsUserCreatedAnchor(loadTrustAnchor({ ...options('/tmp/trust-anchor-x/trust.json'), io: linux }));
  // macOS: root-owned /private/var/folders/xx, user-owned per-user temp directory below it.
  const mac = fakeFs({
    '/private': DIR, '/private/var': DIR, '/private/var/folders': DIR, '/private/var/folders/xx': DIR,
    '/private/var/folders/xx/yy': { ...DIR, uid: 501, mode: 0o040700 }, '/private/var/folders/xx/yy/trust.json': anchor
  });
  await assert.rejects(loadTrustAnchor({ ...options('/private/var/folders/xx/yy/trust.json'), io: mac }), /^ApprovalError: Trust anchor rejected: \/private\/var\/folders\/xx\/yy is not owned by root, so its owner could replace the trust anchor\./);
  await refusedAsUserCreatedAnchor(loadTrustAnchor({ ...options('/private/var/folders/xx/yy/trust.json'), io: mac }));
});

test('the REAL filesystem: a file this (non-root) process created, or a missing path, can never be an anchor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trust-anchor-'));
  try {
    writeFileSync(join(dir, 'trust.json'), anchorJson());
    await refusedAsUserCreatedAnchor(loadTrustAnchor({ path: join(dir, 'trust.json'), forbiddenRoots: [repoRoot], ambientRoots: [] }));
    await assert.rejects(loadTrustAnchor({ path: join(dir, 'trust.json'), forbiddenRoots: [repoRoot] }), /stored outside/, 'the temp directory is an ambient, agent-writable root');
    await assert.rejects(loadTrustAnchor({ path: join(dir, 'missing', 'trust.json'), forbiddenRoots: [repoRoot], ambientRoots: [] }), /does not exist/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no real Owner trust anchor is configured on this machine, so the default path is refused (skipped once the Owner bootstraps)', { skip: existsSync(DEFAULT_TRUST_ANCHOR_PATH) }, async () => {
  await assert.rejects(loadTrustAnchor({ forbiddenRoots: [repoRoot] }), /does not exist or cannot be resolved.*Owner bootstrap required/s);
});

// ===================== real throw-away repository: SOURCE COMMIT -> OWNER APPROVAL -> VALIDATION -> COMMAND =====================
const run = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim();

function makeRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guard-repo-')));
  run(root, 'init', '-q');
  mkdirSync(join(root, 'config')); mkdirSync(join(root, 'functions'));
  writeFileSync(join(root, 'config', 'deployment-manifest.json'), manifestText);
  writeFileSync(join(root, 'functions', 'index.js'), indexText);
  writeFileSync(join(root, 'functions', 'package.json'), '{"name":"functions","private":true}\n');
  writeFileSync(join(root, 'functions', 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(root, 'functions', 'helper.js'), 'module.exports = 1;\n');
  writeFileSync(join(root, 'firebase.json'), '{"functions":{"source":"functions"}}\n');
  writeFileSync(join(root, 'unrelated-secret.txt'), 'must never be packaged\n');
  run(root, 'add', '-A'); run(root, 'commit', '-q', '-m', 'source');
  return { root, sha: run(root, 'rev-parse', 'HEAD'), tree: run(root, 'rev-parse', 'HEAD^{tree}') };
}

const cleanups = [];
function world({ commits = 1 } = {}) {
  const repo = makeRepo();
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'guard-owner-')));
  cleanups.push(() => { rmSync(repo.root, { recursive: true, force: true }); rmSync(base, { recursive: true, force: true }); });
  const trustAnchor = join(base, 'etc', 'trust.json');
  mkdirSync(dirname(trustAnchor));
  writeFileSync(trustAnchor, anchorJson());
  const w = { ...repo, base, trustAnchor, approvalPath: join(base, 'approval.json'), firstSha: repo.sha };
  if (commits > 1) {
    writeFileSync(join(repo.root, 'functions', 'helper.js'), 'module.exports = 2;\n');
    run(repo.root, 'commit', '-q', '-am', 'second');
    w.sha = run(repo.root, 'rev-parse', 'HEAD'); w.tree = run(repo.root, 'rev-parse', 'HEAD^{tree}');
  }
  return w;
}
test.after(() => { for (const clean of cleanups) clean(); });

const payloadFor = (w, overrides = {}) => contract24({ sourceSha: w.sha, sourceTree: w.tree, ...overrides });
function approve(w, payload = payloadFor(w), privateKeyPem = OWNER.privateKeyPem) {
  writeFileSync(w.approvalPath, JSON.stringify(signApproval({ payload, privateKeyPem })));
}
// io where the whole ancestor chain of the Owner-bootstrapped trust anchor is presented as root-owned and closed
// (a synthetic stand-in for the sudo bootstrap); everything else is the real filesystem. The executing user is 501.
const FAKE_STAT = type => ({ uid: 0, mode: type === 'dir' ? 0o040755 : 0o100644, dev: 1, ino: 11, size: 100, mtimeMs: 5, isFile: () => type === 'file', isDirectory: () => type === 'dir', isSymbolicLink: () => false });
const worldIo = w => {
  const chain = new Set();
  for (let path = w.trustAnchor; ; path = dirname(path)) { chain.add(path); if (path === '/') break; }
  return {
    realpath, access: async () => { throw eacces(); }, getuid: () => 501, readFile: async path => readFileSync(path, 'utf8'),
    lstat: async path => (chain.has(path) ? FAKE_STAT(path === w.trustAnchor ? 'file' : 'dir') : lstat(path))
  };
};

// What a legitimate `npm ci --ignore-scripts --bin-links` leaves behind for the SDK the Firebase CLI needs.
async function legitInstall(functionsDir) {
  const modules = join(functionsDir, 'node_modules');
  mkdirSync(join(modules, 'firebase-functions', 'lib', 'bin'), { recursive: true });
  mkdirSync(join(modules, '.bin'), { recursive: true });
  writeFileSync(join(modules, 'firebase-functions', 'package.json'), JSON.stringify({ name: 'firebase-functions', version: '6.6.0', bin: { 'firebase-functions': './lib/bin/firebase-functions.js' } }));
  writeFileSync(join(modules, 'firebase-functions', 'lib', 'bin', 'firebase-functions.js'), '#!/usr/bin/env node\nconsole.log("sdk");\n', { mode: 0o755 });
  symlinkSync('../firebase-functions/lib/bin/firebase-functions.js', join(modules, '.bin', 'firebase-functions'));
}

async function drive(w, argv, extra = {}) {
  const calls = extra.calls ?? []; const logs = []; const snapshots = [];
  let packagePath = null;
  const makeTempDir = async () => (packagePath = await mkdtemp(join(await realpath(tmpdir()), PACKAGE_PREFIX)));
  const runner = async (command, args, context) => {
    calls.push([command, args, context]);
    snapshots.push(listFiles(context.cwd));
    if (command === 'npm') { await legitInstall(context.cwd); await extra.onInstall?.({ packageRoot: dirname(context.cwd), functionsDir: context.cwd }); }
    return extra.exitCode ?? 0;
  };
  const code = await runFunctionsDeploy(argv, { rootDir: w.root, run: runner, log: line => logs.push(line), io: worldIo(w), ambientRoots: [], now: () => NOW, makeTempDir, ...extra.options });
  return { code, calls, logs, snapshots, packagePath };
}
const firebaseCalls = calls => calls.filter(([command]) => command === 'firebase');
function listFiles(root, directory = root) {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (lstatSync(full).isSymbolicLink()) { out.push(`${full.slice(root.length + 1)} (symlink)`); continue; }
    if (entry.isDirectory()) out.push(...listFiles(root, full)); else out.push(full.slice(root.length + 1));
  }
  return out.sort();
}
const args = (w, ...more) => ['--env', 'uat', '--project', UAT, '--approval', w.approvalPath, '--trust-anchor', w.trustAnchor, ...more];
const rejectsWith = (promise, pattern) => assert.rejects(promise, error => error instanceof Error && pattern.test(error.message), String(pattern));

test('SYNTHETIC FLOW: source commit -> external Owner approval -> validation -> exact scoped command', async () => {
  const w = world();
  // 1. SOURCE COMMIT exists first and is frozen (its SHA is not inside itself).
  assert.match(w.sha, /^[0-9a-f]{40}$/);
  // 2. The Agent derives an UNSIGNED plan from that commit; the Owner reviews its digest.
  const plan = await buildPlan({ rootDir: w.root, environment: 'uat', project: UAT, sourceSha: w.sha, functions: CALLABLES_24, releaseId: 's02-uat-24-callables', now: new Date('2026-10-26T01:00:00Z') });
  assert.equal(plan.expectedFunctionCount, 24);
  assert.deepEqual(plan.exclusions, [SCHEDULER]);
  assert.deepEqual(plan.scheduledFunctionsApproved, []);
  assert.equal(plan.sourceSha, w.sha);
  assert.equal(plan.sourceTree, w.tree);
  // 3. EXTERNAL OWNER APPROVAL: signed with the Owner's key (synthetic here), stored outside the repository.
  approve(w, plan);
  assert.ok(!w.approvalPath.startsWith(w.root));
  // 4. VALIDATION + 5. EXACT SCOPED DEPLOY COMMAND (mock runner).
  const { code, calls, logs } = await drive(w, args(w, '--execute'));
  assert.equal(code, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(0, 2), ['npm', ['ci', '--ignore-scripts', '--bin-links', '--no-audit', '--no-fund']]);
  assert.deepEqual(calls[0][1], [...INSTALL_ARGUMENTS]);
  assert.equal(calls[1][0], 'firebase');
  assert.deepEqual(calls[1][1], buildScopedFirebaseArgs(plan));
  assert.equal(calls[1][1][2].split(',').length, 24);
  assert.ok(!calls[1][1].join(' ').includes(SCHEDULER));
  assert.ok(logs.some(line => line.includes(`Approved source commit ${w.sha}`)));
});

test('dry-run is the default: nothing is executed and the isolated package is removed', async () => {
  const w = world(); approve(w);
  const { code, calls, logs, packagePath } = await drive(w, args(w));
  assert.equal(code, 0);
  assert.deepEqual(calls, []);
  assert.ok(logs.some(line => line.startsWith('> firebase deploy --only functions:')));
  assert.ok(logs.some(line => /Firebase CLI was not started/.test(line)));
  assert.ok(packagePath && !existsSync(packagePath), 'the package is disposed');
});

test('the CLI runs against the isolated package, never the working tree', async () => {
  const w = world(); approve(w);
  const { calls, snapshots, packagePath } = await drive(w, args(w, '--execute'));
  for (const [, , context] of calls) {
    assert.ok(!context.cwd.startsWith(w.root), 'never the repository working tree');
    assert.ok(context.cwd.startsWith(join(realpathSync(tmpdir()), PACKAGE_PREFIX)));
  }
  assert.equal(calls[1][2].toolRoot, w.root, 'only the tool binary comes from the repository');
  assert.deepEqual(snapshots[1].filter(file => !file.startsWith('functions/node_modules/')), ['firebase.json', 'functions/helper.js', 'functions/index.js', 'functions/package-lock.json', 'functions/package.json']);
  assert.ok(snapshots[1].includes('functions/node_modules/.bin/firebase-functions (symlink)'), 'the npm-created SDK link is present');
  assert.ok(!existsSync(packagePath), 'removed afterwards');
});

test('untracked malicious Functions source, node_modules and credentials never enter the package; the user tree is left alone', async () => {
  const w = world(); approve(w);
  writeFileSync(join(w.root, 'functions', 'evil.js'), 'require("child_process").execSync("curl evil");\n');
  writeFileSync(join(w.root, 'functions', '.runtimeconfig.json'), '{"secret":"x"}\n');
  mkdirSync(join(w.root, 'functions', 'node_modules', 'bad'), { recursive: true });
  writeFileSync(join(w.root, 'functions', 'node_modules', 'bad', 'index.js'), 'evil\n');
  const { snapshots } = await drive(w, args(w, '--execute'));
  for (const files of snapshots) {
    assert.ok(!files.some(file => /evil|runtimeconfig|node_modules\/bad|unrelated/.test(file)), files.join(','));
  }
  assert.ok(existsSync(join(w.root, 'functions', 'evil.js')), 'the working tree is never cleaned');
});

test('untracked symlinks (to files, directories or outside paths) never enter the package', async () => {
  const w = world(); approve(w);
  symlinkSync('/etc', join(w.root, 'functions', 'leak'));
  symlinkSync(join(w.root, 'unrelated-secret.txt'), join(w.root, 'functions', 'secret-link.js'));
  symlinkSync('../../..', join(w.root, 'functions', 'escape'));
  const { snapshots } = await drive(w, args(w, '--execute'));
  for (const files of snapshots) assert.ok(!files.some(file => /leak|secret-link|escape/.test(file)) && files.filter(file => file.endsWith('(symlink)')).every(file => file === 'functions/node_modules/.bin/firebase-functions (symlink)'), files.join(','));
  assert.ok(lstatSync(join(w.root, 'functions', 'leak')).isSymbolicLink(), 'the working tree is left untouched');
});

test('a symlink committed to the approved source is refused, not packaged', async () => {
  const w = world();
  symlinkSync('/etc/passwd', join(w.root, 'functions', 'tracked-link.js'));
  run(w.root, 'add', '-A'); run(w.root, 'commit', '-q', '-m', 'adds a tracked symlink');
  w.sha = run(w.root, 'rev-parse', 'HEAD'); w.tree = run(w.root, 'rev-parse', 'HEAD^{tree}');
  approve(w);
  await rejectsWith(drive(w, args(w, '--execute')), /symbolic link; refusing to package/);
});

test('a local git replace ref cannot change what an approved object id exports', async () => {
  const w = world(); approve(w);
  const original = run(w.root, 'rev-parse', `${w.sha}:functions/helper.js`);
  const evil = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: w.root, input: 'module.exports = "replaced";\n', encoding: 'utf8' }).trim();
  run(w.root, 'replace', original, evil);
  const { snapshots, calls } = await drive(w, args(w, '--execute'));
  assert.equal(calls.length, 2, 'the real object content was exported and verified');
  assert.ok(snapshots[1].includes('functions/helper.js'));
});

test('dirty tracked source is rejected before anything runs', async () => {
  const w = world(); approve(w);
  writeFileSync(join(w.root, 'functions', 'helper.js'), 'module.exports = "edited locally";\n');
  const calls = [];
  await rejectsWith(drive(w, args(w, '--execute'), { options: { run: async (...call) => { calls.push(call); return 0; } } }), /uncommitted tracked changes/);
  assert.deepEqual(calls, []);
});

test('a missing source commit is rejected', async () => {
  const w = world(); approve(w, payloadFor(w, { sourceSha: 'b'.repeat(40), sourceTree: 'c'.repeat(40) }));
  await rejectsWith(drive(w, args(w, '--execute')), /source commit b{40} does not exist/);
});

test('an approval for a different (older) source commit than the checked-out HEAD is rejected', async () => {
  const w = world({ commits: 2 });
  approve(w, contract24({ sourceSha: w.firstSha, sourceTree: run(w.root, 'rev-parse', `${w.firstSha}^{tree}`) }));
  await rejectsWith(drive(w, args(w, '--execute')), /is not the checked-out HEAD/);
});

test('a source tree that does not match the approved tree is rejected', async () => {
  const w = world(); approve(w, payloadFor(w, { sourceTree: 'f'.repeat(40) }));
  await rejectsWith(drive(w, args(w, '--execute')), /differs from the tree of the source commit/);
});

test('wrong environment or project at the wrapper is rejected', async () => {
  const w = world(); approve(w);
  await rejectsWith(drive(w, ['--env', 'uat', '--project', PROD, '--approval', w.approvalPath, '--trust-anchor', w.trustAnchor, '--execute']), /--project/);
  await rejectsWith(drive(w, ['--env', 'prod', '--project', PROD, '--approval', w.approvalPath, '--trust-anchor', w.trustAnchor, '--execute']), /differs from the requested environment/);
  await rejectsWith(drive(w, ['--project', UAT, '--approval', w.approvalPath, '--trust-anchor', w.trustAnchor, '--execute']), /--env is required/);
});

test('a missing, unreadable or in-repository approval is rejected', async () => {
  const w = world();
  await rejectsWith(drive(w, args(w, '--execute')), /does not exist/);
  writeFileSync(w.approvalPath, 'not json');
  await rejectsWith(drive(w, args(w, '--execute')), /not readable JSON/);
  const inside = join(w.root, 'approval.json');
  writeFileSync(inside, JSON.stringify(signApproval({ payload: payloadFor(w), privateKeyPem: OWNER.privateKeyPem })));
  await rejectsWith(drive(w, ['--env', 'uat', '--project', UAT, '--approval', inside, '--trust-anchor', w.trustAnchor, '--execute']), /stored outside/);
});

test('a fabricated, tampered or wrongly signed approval is rejected end to end', async () => {
  const w = world();
  writeFileSync(w.approvalPath, JSON.stringify({ authorizationRef: 'Owner approved', payload: payloadFor(w) }));
  await rejectsWith(drive(w, args(w, '--execute')), /exactly schema, payload, keyId and signature/);
  approve(w);
  const artifact = JSON.parse(readFileSync(w.approvalPath, 'utf8'));
  artifact.payload.functions = [...artifact.payload.functions, SCHEDULER]; artifact.payload.expectedFunctionCount = 25;
  writeFileSync(w.approvalPath, JSON.stringify(artifact));
  await rejectsWith(drive(w, args(w, '--execute')), /does not match its payload/);
  approve(w, payloadFor(w), OTHER.privateKeyPem);
  await rejectsWith(drive(w, args(w, '--execute')), /not in the trust anchor/);
});

test('a validly signed payload that breaks the rules is still rejected (extra scheduled Function, count, expiry)', async () => {
  let w = world();
  approve(w, payloadFor(w, { functions: [...uatAllowlist], expectedFunctionCount: 25, exclusions: [] }));
  await rejectsWith(drive(w, args(w, '--execute')), /scheduled Function and is not listed in scheduledFunctionsApproved/);
  w = world(); approve(w, payloadFor(w, { expectedFunctionCount: 25 }));
  await rejectsWith(drive(w, args(w, '--execute')), /expectedFunctionCount 25 does not match/);
  w = world(); approve(w, payloadFor(w, { notBefore: '2026-10-01T00:00:00Z', expiresAt: '2026-10-02T00:00:00Z' }));
  await rejectsWith(drive(w, args(w, '--execute')), /expired at/);
});

test('an absent, same-user or ancestor-replaceable trust anchor fails closed even with a perfectly signed approval', async () => {
  const w = world(); approve(w);
  const calls = [];
  const realIo = { realpath, lstat, access: async () => { throw eacces(); }, getuid: () => 501, readFile: async path => readFileSync(path, 'utf8') };
  const options = { run: async (...call) => { calls.push(call); return 0; }, io: realIo };
  // Real filesystem: the anchor file and its parent directories belong to this user.
  await refusedAsUserCreatedAnchor(drive(w, args(w, '--execute'), { options }));
  await rejectsWith(drive(w, ['--env', 'uat', '--project', UAT, '--approval', w.approvalPath, '--trust-anchor', join(w.base, 'missing.json'), '--execute'], { options }), /Trust anchor rejected/);
  // The default path is absent here: nothing may run.
  const absent = { run: options.run, io: { ...realIo, realpath: async path => { if (path === DEFAULT_TRUST_ANCHOR_PATH) throw enoent(); return realpath(path); } } };
  await rejectsWith(drive(w, ['--env', 'uat', '--project', UAT, '--approval', w.approvalPath, '--execute'], { options: absent }), /does not exist or cannot be resolved.*Owner bootstrap required/s);
  // A root-owned file whose DIRECTORY is replaceable by the executing user (anchor chain is not closed).
  const replaceable = { run: options.run, io: { ...worldIo(w), lstat: async path => (path === dirname(w.trustAnchor) ? { ...FAKE_STAT('dir'), uid: 501 } : worldIo(w).lstat(path)) } };
  await rejectsWith(drive(w, args(w, '--execute'), { options: replaceable }), /is not owned by root, so its owner could replace the trust anchor/);
  assert.deepEqual(calls, [], 'no tool is ever started without a valid trust anchor');
});

test('an unscoped deployment cannot be requested through the wrapper', async () => {
  const w = world(); approve(w);
  for (const extra of [['--only', 'functions'], ['--force'], ['--contract', 'x.json']]) {
    await rejectsWith(drive(w, [...args(w), ...extra]), /Unsupported argument/);
  }
});

test('a Production execute needs --confirm-production; a failing install or CLI is reported as not deployed', async () => {
  const prodAllowlist = functionsAllowlistFor(manifest, 'prod');
  const w = world();
  approve(w, payloadFor(w, { environment: 'prod', firebaseProjectId: PROD, functions: prodAllowlist, expectedFunctionCount: prodAllowlist.length, exclusions: [], scheduledFunctionsApproved: prodAllowlist.filter(name => source.scheduled.has(name)) }));
  const prodArgs = ['--env', 'prod', '--project', PROD, '--approval', w.approvalPath, '--trust-anchor', w.trustAnchor];
  await rejectsWith(drive(w, [...prodArgs, '--execute']), /--confirm-production/);
  assert.equal((await drive(w, [...prodArgs, '--execute', '--confirm-production'])).calls.length, 2);
  approve(w);
  await rejectsWith(drive(w, args(w, '--execute'), { exitCode: 3 }), /Installing the isolated package dependencies failed with code 3/);
  let n = 0;
  await rejectsWith(drive(w, args(w, '--execute'), { options: { run: async (command, args, context) => { if (command === 'npm') await legitInstall(context.cwd); return n++ === 0 ? 0 : 7; } } }), /exited with code 7/);
});

// ===================== immutable package integrity (unit level) =====================
test('the export is exactly the commit tree and any later tampering is detected', async () => {
  const w = world();
  const git = makeGit(w.root);
  const entries = await listSourceEntries(git, w.sha);
  const root = await exportSourcePackage({ git, entries });
  try {
    assert.equal((await verifyExportedPackage({ git, root, entries })).length, entries.length);
    writeFileSync(join(root, 'functions', 'helper.js'), 'tampered\n');
    await assert.rejects(verifyExportedPackage({ git, root, entries }), /differs from the approved commit/);
    writeFileSync(join(root, 'functions', 'helper.js'), 'module.exports = 1;\n');
    writeFileSync(join(root, 'functions', 'extra.js'), 'x\n');
    await assert.rejects(verifyExportedPackage({ git, root, entries }), /extra: functions\/extra\.js/);
    rmSync(join(root, 'functions', 'extra.js'));
    symlinkSync('/etc/passwd', join(root, 'functions', 'link.js'));
    await assert.rejects(verifyExportedPackage({ git, root, entries }), PackageIntegrityError);
    rmSync(join(root, 'functions', 'link.js'));
    await assert.rejects(verifyExportedPackage({ git, root, entries, extraForbiddenFiles: ['firebase.json'] }), /must never be part of the deployment package/);
  } finally { await disposePackage(root); }
  assert.ok(!existsSync(root));
});

test('disposePackage only removes directories it created', async () => {
  const stray = mkdtempSync(join(realpathSync(tmpdir()), 'not-ours-'));
  try {
    await assert.rejects(disposePackage(stray), /not one of our packages/);
    await assert.rejects(disposePackage(join(stray, 'nested')), /not one of our packages/);
    await assert.rejects(disposePackage(tmpdir()), PackageIntegrityError);
    assert.ok(existsSync(stray));
  } finally { rmSync(stray, { recursive: true, force: true }); }
});

test('hostile git trees are refused: non-regular entries, submodule, path tricks and a missing required file', async () => {
  const w = world();
  const git = makeGit(w.root);
  const fake = lines => async args => (args[0] === 'ls-tree' ? Buffer.from(lines.join('\0') + '\0') : git(args));
  const ok = ['100644 blob ' + '1'.repeat(40) + '\tfirebase.json', '100644 blob ' + '2'.repeat(40) + '\tfunctions/index.js', '100644 blob ' + '3'.repeat(40) + '\tfunctions/package.json', '100644 blob ' + '4'.repeat(40) + '\tfunctions/package-lock.json'];
  assert.equal((await listSourceEntries(fake(ok), w.sha)).length, 4);
  await assert.rejects(listSourceEntries(fake([...ok, '160000 commit ' + '5'.repeat(40) + '\tfunctions/sub']), w.sha), /submodule/);
  await assert.rejects(listSourceEntries(fake([...ok, '120000 blob ' + '5'.repeat(40) + '\tfunctions/link']), w.sha), /symbolic link/);
  await assert.rejects(listSourceEntries(fake([...ok, '100644 blob ' + '5'.repeat(40) + '\tfunctions/../evil.js']), w.sha), /Unexpected path/);
  await assert.rejects(listSourceEntries(fake([...ok, '100644 blob ' + '5'.repeat(40) + '\tfunctions/.git/config']), w.sha), /Unexpected path/);
  await assert.rejects(listSourceEntries(fake([...ok, '100644 blob ' + '5'.repeat(40) + '\tfunctions/a b.js']), w.sha), /Unexpected path/);
  await assert.rejects(listSourceEntries(fake(ok.slice(1)), w.sha), /has no firebase\.json/);
});

test('firebase.json hooks or a redirected source directory are refused', async () => {
  const { assertPackageFirebaseConfig } = await import('../scripts/functions-source-package.mjs');
  assert.doesNotThrow(() => assertPackageFirebaseConfig('{"functions":{"source":"functions"}}'));
  for (const bad of ['{"functions":{"source":"../elsewhere"}}', '{"functions":[{"source":"functions"}]}', '{"functions":{"source":"functions","predeploy":["rm -rf ."]}}', '{"functions":{"source":"functions","postdeploy":["x"]}}', '{}', 'not json']) {
    assert.throws(() => assertPackageFirebaseConfig(bad), PackageIntegrityError, bad);
  }
});

// ===================== hardening 3, blocker 1: controlled Git execution =====================
const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
};
const executable = (path, body) => { writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return path; };

test('the git environment is an allow-list: no inherited GIT_*, HOME or XDG configuration, trusted PATH', () => {
  const env = gitEnvironment();
  assert.deepEqual(Object.keys(env).filter(key => key.startsWith('GIT_')).sort(), ['GIT_ATTR_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_SYSTEM', 'GIT_NO_REPLACE_OBJECTS', 'GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT']);
  for (const bad of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_PARAMETERS', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_SSH_COMMAND', 'GIT_TEMPLATE_DIR', 'GIT_EXEC_PATH']) assert.ok(!(bad in env), bad);
  assert.equal(env.HOME, '/nonexistent');
  assert.equal(env.XDG_CONFIG_HOME, '/nonexistent');
  assert.equal(env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  for (const option of ['core.hooksPath=/dev/null', 'core.fsmonitor=false', 'core.pager=cat', 'credential.helper=', 'core.sshCommand=false']) assert.ok(GIT_GLOBAL_OPTIONS.includes(option), option);
});

test('every git child gets exactly that environment and global options, whatever the parent environment holds', async () => {
  const seen = [];
  const recorder = (binary, args, options) => { seen.push({ binary, args, options }); return Object.assign(Promise.resolve({ stdout: Buffer.from('ok\n') }), { child: null }); };
  await withEnv({ GIT_DIR: '/decoy/.git', GIT_WORK_TREE: '/decoy', GIT_INDEX_FILE: '/decoy/index', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: '/evil', GIT_OBJECT_DIRECTORY: '/decoy/objects', GIT_ALTERNATE_OBJECT_DIRECTORIES: '/decoy/objects', GIT_SSH_COMMAND: 'evil', GIT_TEMPLATE_DIR: '/decoy/t', HOME: '/home/agent', XDG_CONFIG_HOME: '/home/agent/.config' }, async () => {
    const git = makeGit('/some/root', { binary: '/usr/bin/git', run: recorder });
    assert.equal(textOfBuffer(await git(['rev-parse', 'HEAD'])), 'ok');
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].binary, '/usr/bin/git');
  assert.deepEqual(seen[0].options.env, { ...gitEnvironment() });
  assert.equal(seen[0].options.cwd, '/some/root');
  assert.deepEqual(seen[0].args.slice(0, GIT_GLOBAL_OPTIONS.length), [...GIT_GLOBAL_OPTIONS]);
  assert.deepEqual(seen[0].args.slice(GIT_GLOBAL_OPTIONS.length), ['rev-parse', 'HEAD']);
});
const textOfBuffer = buffer => buffer.toString('utf8').trim();

test('git arguments are allow-listed: no option injection, no unknown subcommands, no unsafe paths', () => {
  const sha = 'a'.repeat(40);
  for (const good of [['rev-parse', 'HEAD'], ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], ['ls-tree', '-r', '-t', '-z', '--full-tree', sha, '--', 'firebase.json', 'functions'], ['cat-file', 'blob', sha], ['show', `${sha}:functions/index.js`], ['hash-object', '--no-filters', '--stdin'], ['status', '--porcelain', '--untracked-files=no']]) {
    assert.doesNotThrow(() => assertSafeGitArguments(good), good.join(' '));
  }
  for (const bad of [
    ['config', 'core.fsmonitor', '/evil'], ['fetch', 'origin'], ['clone', 'x'], ['rev-parse', '--git-dir'], ['rev-parse', '--exec-path=/evil'],
    ['cat-file', 'blob', '--output=/tmp/x'], ['cat-file', 'blob', `${sha};rm -rf /`], ['cat-file', 'blob', 'HEAD:../../etc/passwd'], ['show', `${sha}:../x`],
    ['show', `${sha}:/etc/passwd`], ['ls-tree', sha, '--', '../escape'], ['ls-tree', sha, '--', '/abs'], ['ls-tree', sha, '--', 'a b'], ['ls-tree', sha, '--', '.git/config'],
    ['rev-parse', '-c', 'core.hooksPath=/evil'], ['rev-parse', `--upload-pack=/evil`], ['rev-parse', 'HEAD\0evil'], [], 'rev-parse', ['--version'], ['rev-parse', 42]
  ]) assert.throws(() => assertSafeGitArguments(bad), GitSandboxError, JSON.stringify(bad));
});

test('git is found by absolute path in OS directories only', async () => {
  assert.equal(await resolveGitBinary({ candidates: ['/a/git', '/b/git'], probe: async path => path === '/b/git' }), '/b/git');
  await assert.rejects(resolveGitBinary({ candidates: ['/a/git'], probe: async () => false }), /No trusted git executable/);
});

test('redirecting git through the inherited environment has no effect: the approved repository and content are used', async () => {
  const w = world(); approve(w);
  const decoy = makeRepo();
  cleanups.push(() => rmSync(decoy.root, { recursive: true, force: true }));
  writeFileSync(join(decoy.root, 'functions', 'helper.js'), 'module.exports = "DECOY";\n');
  run(decoy.root, 'commit', '-q', '-am', 'decoy');
  const marker = join(w.base, 'fsmonitor-ran');
  const evil = executable(join(w.base, 'evil.sh'), `touch '${marker}'`);
  const redirect = {
    GIT_DIR: join(decoy.root, '.git'), GIT_WORK_TREE: decoy.root, GIT_INDEX_FILE: join(decoy.root, '.git', 'index'),
    GIT_OBJECT_DIRECTORY: join(decoy.root, '.git', 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: join(decoy.root, '.git', 'objects'),
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: evil, GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: join(w.base, 'hooks'),
    GIT_SSH_COMMAND: evil, GIT_TEMPLATE_DIR: join(w.base, 'templates'), HOME: w.base, XDG_CONFIG_HOME: w.base
  };
  // Prove the attack is real: with this environment an unprotected `git status` would run the injected fsmonitor command.
  withEnvSync(redirect, () => { try { execFileSync('git', ['status'], { cwd: w.root, stdio: 'ignore' }); } catch { /* the decoy may fail; only the marker matters */ } });
  assert.ok(existsSync(marker), 'the injected config really executes through unprotected git');
  rmSync(marker);
  const { snapshots, calls } = await withEnv(redirect, () => drive(w, args(w, '--execute')));
  assert.equal(calls.length, 2);
  assert.ok(!existsSync(marker), 'the injected fsmonitor command was NOT executed');
  assert.ok(snapshots[1].includes('functions/helper.js'));
});
function withEnvSync(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try { return fn(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test('repository-local git config and hooks cannot execute code during guard operations', async () => {
  const w = world(); approve(w);
  const marker = join(w.base, 'ran');
  const evil = executable(join(w.base, 'evil.sh'), `touch '${marker}'`);
  run(w.root, 'config', 'core.fsmonitor', evil);
  mkdirSync(join(w.base, 'hooks'));
  executable(join(w.base, 'hooks', 'post-index-change'), `touch '${marker}'`);
  executable(join(w.root, '.git', 'hooks', 'post-index-change'), `touch '${marker}'`);
  run(w.root, 'config', 'core.hooksPath', join(w.base, 'hooks'));
  writeFileSync(join(w.root, 'functions', 'helper.js'), 'module.exports = 1;\n'); // touch the file so the index needs a refresh
  utimesSync(join(w.root, 'functions', 'helper.js'), new Date(), new Date(Date.now() + 5000));
  try { execFileSync('git', ['status'], { cwd: w.root, stdio: 'ignore' }); } catch { /* ignore */ }
  assert.ok(existsSync(marker), 'the repository-local configuration really executes through unprotected git');
  rmSync(marker);
  utimesSync(join(w.root, 'functions', 'helper.js'), new Date(), new Date(Date.now() + 9000));
  const { calls } = await drive(w, args(w, '--execute'));
  assert.equal(calls.length, 2);
  assert.ok(!existsSync(marker), 'neither the fsmonitor command nor any hook was executed by the guard');
});

test('the intended repository is verified: wrong top level, bare repository, symlinked .git and alternate object databases are refused', async () => {
  const w = world();
  const real = makeGit(w.root);
  const lie = (command, answer) => async args => (args.join(' ') === command ? Buffer.from(`${answer}\n`) : real(args));
  const other = realpathSync(mkdtempSync(join(tmpdir(), 'other-repo-')));
  cleanups.push(() => rmSync(other, { recursive: true, force: true }));
  await assert.rejects(openRepository(w.root, { git: lie('rev-parse --show-toplevel', other) }), /not the intended repository/);
  await assert.rejects(openRepository(w.root, { git: lie('rev-parse --is-bare-repository', 'true') }), /bare repository/);
  await assert.rejects(openRepository(w.root, { git: lie('rev-parse --show-object-format', 'md5') }), /Unsupported object format/);
  assert.equal((await openRepository(w.root)).root, w.root);
  // alternates configured through the repository itself
  mkdirSync(join(w.root, '.git', 'objects', 'info'), { recursive: true });
  writeFileSync(join(w.root, '.git', 'objects', 'info', 'alternates'), `${other}\n`);
  await assert.rejects(openRepository(w.root), /alternate object database/);
  rmSync(join(w.root, '.git', 'objects', 'info', 'alternates'));
  // a symlinked .git
  const moved = join(other, 'moved-git');
  cpSync(join(w.root, '.git'), moved, { recursive: true }); rmSync(join(w.root, '.git'), { recursive: true });
  symlinkSync(moved, join(w.root, '.git'));
  await assert.rejects(openRepository(w.root), /\.git is a symbolic link|not the intended repository/);
  await assert.rejects(openRepository(join(w.base, 'does-not-exist')), Error);
});

test('an alternate object database from the environment cannot substitute approved content', async () => {
  const w = world(); approve(w);
  const alt = realpathSync(mkdtempSync(join(tmpdir(), 'alt-objects-')));
  cleanups.push(() => rmSync(alt, { recursive: true, force: true }));
  const evil = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: w.root, input: 'module.exports = "alt";\n', encoding: 'utf8', env: { ...process.env, GIT_OBJECT_DIRECTORY: alt } }).trim();
  assert.match(evil, /^[0-9a-f]{40}$/);
  const { calls, snapshots } = await withEnv({ GIT_ALTERNATE_OBJECT_DIRECTORIES: alt, GIT_OBJECT_DIRECTORY: alt }, () => drive(w, args(w, '--execute')));
  assert.equal(calls.length, 2);
  assert.ok(snapshots[1].includes('functions/helper.js'));
});

function looseObjectPath(root, oid) { return join(root, '.git', 'objects', oid.slice(0, 2), oid.slice(2)); }
function rewriteLooseObject(root, oid, mutate) {
  const path = looseObjectPath(root, oid);
  const raw = inflateSync(readFileSync(path));
  const nul = raw.indexOf(0);
  const type = raw.subarray(0, raw.indexOf(32)).toString();
  const body = mutate(Buffer.from(raw.subarray(nul + 1)));
  chmodSync(path, 0o644);
  writeFileSync(path, deflateSync(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body])));
}

test('substituted commit, tree or blob objects are detected because every object is re-hashed', async () => {
  const w = world(); approve(w);
  const git = makeGit(w.root);
  const blob = run(w.root, 'rev-parse', `${w.sha}:functions/helper.js`);
  const subtree = run(w.root, 'rev-parse', `${w.sha}:functions`);
  // a corrupt/substituted BLOB under its approved id
  rewriteLooseObject(w.root, blob, body => Buffer.from('substituted\n'));
  await rejectsWith(drive(w, args(w, '--execute')), /does not match its id|hash mismatch|corrupt/);
  // a substituted subtree (same id, different listing): swap the helper entry's object id
  const w2 = world();
  const subtree2 = run(w2.root, 'rev-parse', `${w2.sha}:functions`);
  rewriteLooseObject(w2.root, subtree2, body => { const copy = Buffer.from(body); copy[copy.length - 1] ^= 0xff; return copy; });
  await assert.rejects(listSourceEntries(makeGit(w2.root), w2.sha, { tree: w2.tree }), /does not match its id|hash mismatch|not a tree object/);
  // a substituted root tree
  const w3 = world();
  rewriteLooseObject(w3.root, w3.tree, body => { const copy = Buffer.from(body); copy[copy.length - 1] ^= 0xff; return copy; });
  await assert.rejects(listSourceEntries(makeGit(w3.root), w3.sha, { tree: w3.tree }), /root tree object .* does not match its id|hash mismatch|not a tree object/);
  // a substituted commit object
  const w4 = world();
  rewriteLooseObject(w4.root, w4.sha, body => Buffer.from(body.toString().replace('source', 'SOURCE')));
  await assert.rejects(resolveSourceCommit(makeGit(w4.root), w4.sha), /commit object .* does not match its id|hash mismatch|corrupt|does not exist in this repository/);
  assert.ok(git && subtree);
  // our object-id computation agrees with Git's own for the same bytes
  assert.equal(objectId('blob', Buffer.from('x\n')), execFileSync('git', ['hash-object', '--stdin'], { input: 'x\n', encoding: 'utf8' }).trim());
});

test('our own re-hashing rejects forged commit and tree bytes even when git itself does not complain', async () => {
  const w = world();
  const real = makeGit(w.root);
  const forge = (oid, type) => async (args, options) => (args[0] === 'cat-file' && args[1] === type && args[2] === oid ? Buffer.from('forged bytes') : real(args, options));
  await assert.rejects(resolveSourceCommit(forge(w.sha, 'commit'), w.sha), /commit object .* does not match its id/);
  await assert.rejects(listSourceEntries(forge(w.tree, 'tree'), w.sha, { tree: w.tree }), /root tree object .* does not match its id/);
  const subtree = run(w.root, 'rev-parse', `${w.sha}:functions`);
  await assert.rejects(listSourceEntries(forge(subtree, 'tree'), w.sha, { tree: w.tree }), /tree object for functions does not match its id/);
  const blob = run(w.root, 'rev-parse', `${w.sha}:functions/helper.js`);
  const entries = await listSourceEntries(real, w.sha, { tree: w.tree });
  await assert.rejects(exportSourcePackage({ git: forge(blob, 'blob'), entries }), /blob for functions\/helper\.js does not match its id/);
  assert.equal((await listSourceEntries(real, w.sha, { tree: w.tree })).length, 5, 'the real objects verify');
});

test('tool children (npm, Firebase CLI) lose code-injection variables but keep operator credentials', () => {
  const env = sanitizedToolEnv({ PATH: '/usr/bin', HOME: '/home/u', GOOGLE_APPLICATION_CREDENTIALS: '/home/u/adc.json', NODE_OPTIONS: '--require /evil.js', NODE_PATH: '/evil', GIT_DIR: '/decoy', GIT_SSH_COMMAND: 'evil', BASH_ENV: '/evil', LD_PRELOAD: '/evil.so', DYLD_INSERT_LIBRARIES: '/evil', npm_config_registry: 'http://evil', NPM_CONFIG_REGISTRY: 'http://evil', npm_config_ignore_scripts: 'false' });
  assert.equal(env.PATH, '/usr/bin'); assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, '/home/u/adc.json'); assert.equal(env.HOME, '/home/u');
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'GIT_DIR', 'GIT_SSH_COMMAND', 'BASH_ENV', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'npm_config_registry', 'NPM_CONFIG_REGISTRY', 'npm_config_ignore_scripts']) assert.ok(!(key in env), key);
});

// ===================== hardening 3, blocker 2: post-install integrity =====================
const blocked = async (w, extra, pattern) => {
  const calls = [];
  await rejectsWith(drive(w, args(w, '--execute'), { ...extra, calls }), pattern);
  assert.deepEqual(firebaseCalls(calls), [], 'the Firebase CLI is never started after a failed post-install check');
  return calls;
};
const nm = ({ functionsDir }) => join(functionsDir, 'node_modules');
const installWith = effect => ({ onInstall: async context => { mkdirSync(nm(context), { recursive: true }); await effect(context); } });

test('a clean, legitimate install passes: only files under functions/node_modules appear and the CLI runs after verification', async () => {
  const w = world(); approve(w);
  const { calls, snapshots } = await drive(w, args(w, '--execute'), installWith(({ functionsDir }) => {
    mkdirSync(join(nm({ functionsDir }), 'dep'), { recursive: true });
    writeFileSync(join(nm({ functionsDir }), 'dep', 'index.js'), 'module.exports = 1;\n');
    writeFileSync(join(nm({ functionsDir }), '.package-lock.json'), '{}\n');
  }));
  assert.equal(calls.length, 2);
  assert.ok(snapshots[1].includes('functions/node_modules/dep/index.js'));
  assert.ok(snapshots[1].includes('functions/helper.js'));
});

test('absolute /etc, relative-escape and nested-escape symlinks injected by installation are refused (never on the list, and never allowed to leave)', async () => {
  for (const [name, target, nested] of [['abs', '/etc', false], ['rel', '../../../../../../../..', false], ['nested', '../../../../../../../../..', true]]) {
    const inject = ({ functionsDir }) => {
      const base = nm({ functionsDir });
      const parent = nested ? join(base, 'a', 'b') : base;
      mkdirSync(parent, { recursive: true });
      symlinkSync(target, join(parent, `evil-${name}`));
    };
    const linkPath = `functions/node_modules/${nested ? 'a/b/' : ''}evil-${name}`;
    await blocked(withWorld(), { ...installWith(inject) }, /not a validated dependency link or on the reviewed in-package list/);
    // even when someone lists it as "reviewed", a target outside the package is never accepted
    await blocked(withWorld(), { ...installWith(inject), options: { allowedSymlinks: [linkPath] } }, /resolves outside the package/);
  }
});
function withWorld() { const w = world(); approve(w); w.args = args(w, '--execute'); return w; }

test('a symlink inserted AFTER installation verification (just before the CLI) is caught by the final re-scan', async () => {
  const w = withWorld();
  await blocked(w, { options: { beforeCli: async ({ packageRoot }) => { mkdirSync(join(packageRoot, 'functions', 'node_modules'), { recursive: true }); symlinkSync('/etc', join(packageRoot, 'functions', 'node_modules', 'late')); } } }, /not a validated dependency link or on the reviewed in-package list/);
  const w2 = withWorld();
  await blocked(w2, { options: { beforeCli: async ({ packageRoot }) => { writeFileSync(join(packageRoot, 'functions', 'index.js'), 'require("child_process");\n'); } } }, /differs from the approved commit/);
});

test('broken and circular symlinks are refused even when listed', async () => {
  const broken = ({ functionsDir }) => symlinkSync('does-not-exist', join(nm({ functionsDir }), 'broken'));
  await blocked(withWorld(), installWith(broken), /not a validated dependency link or on the reviewed in-package list/);
  await blocked(withWorld(), { ...installWith(broken), options: { allowedSymlinks: ['functions/node_modules/broken'] } }, /broken or circular/);
  const circular = ({ functionsDir }) => { symlinkSync('b', join(nm({ functionsDir }), 'a')); symlinkSync('a', join(nm({ functionsDir }), 'b')); };
  await blocked(withWorld(), { ...installWith(circular), options: { allowedSymlinks: ['functions/node_modules/a', 'functions/node_modules/b'] } }, /broken or circular/);
});

test('a reviewed in-package symlink is permitted; the same link unreviewed is refused', async () => {
  const link = ({ functionsDir }) => {
    mkdirSync(join(nm({ functionsDir }), 'pkg'), { recursive: true });
    writeFileSync(join(nm({ functionsDir }), 'pkg', 'real.js'), 'x\n');
    symlinkSync('real.js', join(nm({ functionsDir }), 'pkg', 'alias.js'));
  };
  const w = withWorld();
  const { calls } = await drive(w, args(w, '--execute'), { ...installWith(link), options: { allowedSymlinks: ['functions/node_modules/pkg/alias.js'] } });
  assert.equal(calls.length, 2);
  await blocked(withWorld(), installWith(link), /not a validated dependency link or on the reviewed in-package list/);
});

test('installation cannot modify approved source or add unexpected generated source', async () => {
  await blocked(withWorld(), installWith(({ functionsDir }) => writeFileSync(join(functionsDir, 'index.js'), 'module.exports = {};\n')), /differs from the approved commit/);
  await blocked(withWorld(), installWith(({ functionsDir }) => writeFileSync(join(functionsDir, 'package.json'), '{"scripts":{"postinstall":"evil"}}\n')), /differs from the approved commit/);
  await blocked(withWorld(), installWith(({ functionsDir }) => writeFileSync(join(functionsDir, 'generated.js'), 'evil\n')), /Unexpected content in the package after installation/);
  await blocked(withWorld(), installWith(({ functionsDir }) => writeFileSync(join(functionsDir, '.npmrc'), 'registry=http://evil\n')), /Unexpected content/);
  await blocked(withWorld(), installWith(({ packageRoot }) => writeFileSync(join(packageRoot, 'postinstall.js'), 'evil\n')), /Unexpected content/);
  await blocked(withWorld(), installWith(({ packageRoot }) => mkdirSync(join(packageRoot, 'extra-dir'))), /Unexpected content/);
  await blocked(withWorld(), installWith(({ functionsDir }) => rmSync(join(functionsDir, 'helper.js'))), /missing from the package/);
});

test('special files and hard links are refused', async () => {
  await blocked(withWorld(), installWith(({ functionsDir }) => execFileSync('mkfifo', [join(nm({ functionsDir }), 'pipe')])), /special file or unexpected filesystem object/);
  const outside = join(tmpdir(), `outside-${process.pid}-${Date.now()}.txt`);
  writeFileSync(outside, 'secret\n');
  try {
    await blocked(withWorld(), installWith(({ functionsDir }) => linkSync(outside, join(nm({ functionsDir }), 'hardlink'))), /hard link/);
  } finally { rmSync(outside, { force: true }); }
});

test('the staging directory cannot be replaced between verification and the CLI', async () => {
  for (const replace of ['directory', 'symlink']) {
    const w = withWorld();
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'swap-')));
    cleanups.push(() => rmSync(elsewhere, { recursive: true, force: true }));
    await blocked(w, { options: { beforeCli: async ({ packageRoot }) => {
      renameSync(packageRoot, `${packageRoot}-moved`);
      cleanups.push(() => rmSync(`${packageRoot}-moved`, { recursive: true, force: true }));
      if (replace === 'symlink') symlinkSync(elsewhere, packageRoot); else { mkdirSync(packageRoot, { mode: 0o700 }); cpSync(`${packageRoot}-moved`, packageRoot, { recursive: true }); }
    } } }, replace === 'symlink' ? /not a real directory/ : /replaced after it was verified/);
  }
});

test('staging identity checks: symlinks, foreign owners and group/other access are refused', async () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'identity-')));
  cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  const dir = join(parent, 'd'); mkdirSync(dir, { mode: 0o700 });
  const identity = await capturePackageIdentity(dir);
  await assertPackageIdentity(dir, identity);
  await assert.rejects(assertPackageIdentity(dir, { ...identity, ino: identity.ino + 1 }), /replaced after it was verified/);
  const link = join(parent, 'link'); symlinkSync(dir, link);
  await assert.rejects(capturePackageIdentity(link), /not a real directory/);
  const open = join(parent, 'open'); mkdirSync(open, { mode: 0o755 }); chmodSync(open, 0o755);
  await assert.rejects(capturePackageIdentity(open), /accessible to other users/);
});

test('verifyInstalledPackage accepts only the approved files plus generated node_modules content', async () => {
  const w = world();
  const { git, objectFormat } = await openRepository(w.root);
  const entries = await listSourceEntries(git, w.sha, { objectFormat, tree: w.tree });
  const root = await exportSourcePackage({ git, entries, objectFormat });
  try {
    const clean = await verifyInstalledPackage({ git, root, entries, objectFormat });
    assert.equal(clean.generated, 0);
    mkdirSync(join(root, 'functions', 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(root, 'functions', 'node_modules', 'x', 'a.js'), 'a\n');
    assert.equal((await verifyInstalledPackage({ git, root, entries, objectFormat })).generated, 1);
    writeFileSync(join(root, 'functions', 'sneaky.js'), 'a\n');
    await assert.rejects(verifyInstalledPackage({ git, root, entries, objectFormat }), /Unexpected content/);
  } finally { await disposePackage(root); }
});

// ===================== npm compatibility: distinct sanitized configs and validated dependency .bin links =====================
test('the npm sandbox gives userconfig and globalconfig two DISTINCT, existing, empty, private files', async () => {
  const sandbox = await createNpmSandbox();
  try {
    await assertNpmSandbox(sandbox);
    assert.notEqual(sandbox.userconfig, sandbox.globalconfig);
    for (const file of [sandbox.userconfig, sandbox.globalconfig]) {
      assert.ok(file.startsWith(`${sandbox.root}/`) && file !== '/dev/null');
      assert.equal(lstatSync(file).isFile(), true);
      assert.equal(readFileSync(file).length, 0);
      assert.equal(lstatSync(file).mode & 0o077, 0, 'private file');
    }
    assert.equal(lstatSync(sandbox.root).mode & 0o077, 0, 'private directory');
    assert.ok(existsSync(sandbox.home) && existsSync(sandbox.cache));
    assert.ok(sandbox.root.startsWith(realpathSync(tmpdir())) && basename(sandbox.root).startsWith(NPM_SANDBOX_PREFIX));
  } finally { await disposeNpmSandbox(sandbox); }
  assert.ok(!existsSync(sandbox.root), 'removed afterwards');
});

test('an npm sandbox that would recreate the collision, carry configuration or credentials, or escape its directory is refused', async () => {
  const sandbox = await createNpmSandbox();
  try {
    await assert.rejects(assertNpmSandbox({ ...sandbox, globalconfig: sandbox.userconfig }), /two different files/);
    await assert.rejects(assertNpmSandbox({ ...sandbox, userconfig: '/dev/null' }), /not inside the private sandbox/);
    await assert.rejects(assertNpmSandbox({ ...sandbox, userconfig: join(homedirForTest(), '.npmrc') }), /not inside the private sandbox/);
    await assert.rejects(assertNpmSandbox(undefined), /npm sandbox is required/);
    writeFileSync(sandbox.userconfig, '//registry.npmjs.org/:_authToken=secret\n');
    await assert.rejects(assertNpmSandbox(sandbox), /not empty; the sandbox must not carry configuration or credentials/);
    writeFileSync(sandbox.userconfig, '');
    rmSync(sandbox.globalconfig);
    await assert.rejects(assertNpmSandbox(sandbox), /does not exist as a regular file before installation/);
    symlinkSync('/dev/null', sandbox.globalconfig);
    await assert.rejects(assertNpmSandbox(sandbox), /regular file/);
    rmSync(sandbox.globalconfig); writeFileSync(sandbox.globalconfig, '');
    chmodSync(sandbox.root, 0o755);
    await assert.rejects(assertNpmSandbox(sandbox), /private real directory/);
    chmodSync(sandbox.root, 0o700);
  } finally { await disposeNpmSandbox(sandbox); }
  await assert.rejects(disposeNpmSandbox({ root: tmpdir() }), NpmSandboxError);
  await assert.rejects(disposeNpmSandbox({ root: mkdtempSync(join(realpathSync(tmpdir()), 'not-npm-')) }), /not one of our npm sandboxes/);
});
const homedirForTest = () => process.env.HOME || '/home/user';

test('the npm environment is deterministic: sandbox configs/home/cache, no inherited npm configuration, tokens or HOME/XDG', async () => {
  const sandbox = await createNpmSandbox();
  try {
    const env = npmInstallEnvironment(sandbox, {
      PATH: '/usr/bin', HOME: '/home/u', XDG_CONFIG_HOME: '/home/u/.config', NPM_TOKEN: 'tok', NODE_AUTH_TOKEN: 'tok2', NPM_CONFIG_REGISTRY: 'http://evil', npm_config_userconfig: '/home/u/.npmrc',
      'npm_config_//registry.npmjs.org/:_authToken': 'secret', NODE_OPTIONS: '--require /evil.js', GIT_DIR: '/decoy', GOOGLE_APPLICATION_CREDENTIALS: '/adc.json'
    });
    assert.equal(env.npm_config_userconfig, sandbox.userconfig);
    assert.equal(env.npm_config_globalconfig, sandbox.globalconfig);
    assert.notEqual(env.npm_config_userconfig, env.npm_config_globalconfig);
    assert.equal(env.npm_config_cache, sandbox.cache);
    assert.equal(env.HOME, sandbox.home); assert.equal(env.XDG_CONFIG_HOME, sandbox.home);
    assert.equal(env.npm_config_ignore_scripts, 'true');
    for (const key of ['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_CONFIG_REGISTRY', 'npm_config_//registry.npmjs.org/:_authToken', 'NODE_OPTIONS', 'GIT_DIR']) assert.ok(!(key in env), key);
    assert.equal(env.PATH, '/usr/bin');
  } finally { await disposeNpmSandbox(sandbox); }
});

test('REAL npm accepts the sandbox environment: both config roles load without collision (no network, no install)', async () => {
  const sandbox = await createNpmSandbox();
  const cwd = mkdtempSync(join(tmpdir(), 'npm-smoke-'));
  try {
    const env = npmInstallEnvironment(sandbox);
    const out = execFileSync('npm', ['config', 'get', 'userconfig', 'globalconfig', 'ignore-scripts'], { cwd, env, encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(out, [`userconfig=${sandbox.userconfig}`, `globalconfig=${sandbox.globalconfig}`, 'ignore-scripts=true']);
  } finally { rmSync(cwd, { recursive: true, force: true }); await disposeNpmSandbox(sandbox); }
});

test('the guard hands npm two distinct, existing, empty config files at install time and removes them afterwards', async () => {
  const w = world(); approve(w);
  let seen = null;
  const { calls } = await drive(w, args(w, '--execute'), { options: { run: async (command, args, context) => {
    if (command === 'npm') {
      await legitInstall(context.cwd);
      seen = { ...context.npmSandbox, userExists: existsSync(context.npmSandbox.userconfig), globalExists: existsSync(context.npmSandbox.globalconfig), userSize: readFileSync(context.npmSandbox.userconfig).length, globalSize: readFileSync(context.npmSandbox.globalconfig).length };
    }
    return 0;
  } } });
  assert.equal(calls.length, 0, 'custom runner replaces the recorder');
  assert.ok(seen && seen.userExists && seen.globalExists && seen.userSize === 0 && seen.globalSize === 0);
  assert.notEqual(seen.userconfig, seen.globalconfig);
  assert.ok(!existsSync(seen.root), 'the sandbox is removed after installation');
});

test('the sandbox is removed even when npm fails', async () => {
  const w = world(); approve(w);
  let root = null;
  await rejectsWith(drive(w, args(w, '--execute'), { options: { run: async (command, args, context) => { if (command === 'npm') root = context.npmSandbox.root; return 9; } } }), /failed with code 9/);
  assert.ok(root && !existsSync(root));
});

test('SDK entry: the genuine npm-created link to the SDK\'s declared bin is required and accepted', async () => {
  const w = world();
  const { git, objectFormat } = await openRepository(w.root);
  const entries = await listSourceEntries(git, w.sha, { objectFormat, tree: w.tree });
  const root = await exportSourcePackage({ git, entries, objectFormat });
  try {
    await assert.rejects(verifyInstalledPackage({ git, root, entries, objectFormat, requireSdkEntry: true }), /\.bin\/firebase-functions is missing/);
    await legitInstall(join(root, 'functions'));
    const result = await verifyInstalledPackage({ git, root, entries, objectFormat, requireSdkEntry: true });
    assert.deepEqual(result.sdk, { link: 'functions/node_modules/.bin/firebase-functions', target: 'functions/node_modules/firebase-functions/lib/bin/firebase-functions.js' });
    assert.ok(statSync(join(root, 'functions/node_modules/firebase-functions/lib/bin/firebase-functions.js')).mode & 0o111);
  } finally { await disposePackage(root); }
});

const binLink = (name, target, { nested } = {}) => ({ functionsDir }) => {
  const dir = nested ? join(nm({ functionsDir }), 'a', 'node_modules', '.bin') : join(nm({ functionsDir }), '.bin');
  mkdirSync(dir, { recursive: true });
  symlinkSync(target, join(dir, name));
};

test('legitimate npm-created .bin links (relative, single hop, into the same node_modules, incl. nested and scoped) are accepted', async () => {
  const w = withWorld();
  const { calls } = await drive(w, args(w, '--execute'), installWith(({ functionsDir }) => {
    const modules = nm({ functionsDir });
    mkdirSync(join(modules, 'tool', 'bin'), { recursive: true }); writeFileSync(join(modules, 'tool', 'bin', 'cli.js'), 'x\n', { mode: 0o755 });
    symlinkSync('../tool/bin/cli.js', join(modules, '.bin', 'tool'));
    mkdirSync(join(modules, '@scope', 'pkg', 'dist'), { recursive: true }); writeFileSync(join(modules, '@scope', 'pkg', 'dist', 'run.js'), 'x\n', { mode: 0o755 });
    symlinkSync('../@scope/pkg/dist/run.js', join(modules, '.bin', 'scoped'));
    mkdirSync(join(modules, 'a', 'node_modules', 'inner'), { recursive: true }); writeFileSync(join(modules, 'a', 'node_modules', 'inner', 'main.js'), 'x\n');
    mkdirSync(join(modules, 'a', 'node_modules', '.bin'), { recursive: true });
    symlinkSync('../inner/main.js', join(modules, 'a', 'node_modules', '.bin', 'inner'));
  }));
  assert.equal(calls.length, 2);
});

test('unsafe dependency links are refused: external absolute, relative escape, nested escape, broken, circular, chains, directories, absolute-inside', async () => {
  const outside = join(tmpdir(), `bin-outside-${process.pid}.js`); writeFileSync(outside, 'x\n', { mode: 0o755 });
  try {
    for (const [name, effect, pattern] of [
      ['absolute external', binLink('evil', '/bin/sh'), /must be a relative link/],
      ['absolute /etc', binLink('evil', '/etc/passwd'), /must be a relative link/],
      ['relative escape', ({ functionsDir }) => binLink('evil', relative(join(nm({ functionsDir }), '.bin'), outside))({ functionsDir }), /resolves outside/],
      ['nested escape', binLink('evil', '../../../../../../../../../../../../etc/passwd', { nested: true }), /resolves outside|broken/],
      ['broken', binLink('evil', '../missing/nothing.js'), /broken \(its target does not exist\)/],
      ['circular', ({ functionsDir }) => { binLink('a', 'b')({ functionsDir }); binLink('b', 'a')({ functionsDir }); }, /points at another link|broken/],
      ['directory', ({ functionsDir }) => { mkdirSync(join(nm({ functionsDir }), 'dir'), { recursive: true }); binLink('evil', '../dir')({ functionsDir }); }, /regular file/],
      ['chain', ({ functionsDir }) => { writeFileSync(join(nm({ functionsDir }), 'real.js'), 'x\n'); symlinkSync('real.js', join(nm({ functionsDir }), 'hop')); binLink('evil', '../hop')({ functionsDir }); }, /another link \(chains are refused\)|not a validated dependency link/],
      ['nested link into a sibling package', ({ functionsDir }) => { mkdirSync(join(nm({ functionsDir }), 'sibling'), { recursive: true }); writeFileSync(join(nm({ functionsDir }), 'sibling', 'x.js'), 'x\n'); binLink('evil', '../../../sibling/x.js', { nested: true })({ functionsDir }); }, /own node_modules/],
      ['link to another .bin entry', ({ functionsDir }) => { writeFileSync(join(nm({ functionsDir }), '.bin', 'plain'), 'x\n'); binLink('evil', 'plain')({ functionsDir }); }, /own node_modules/]
    ]) {
      const w = withWorld();
      const calls = [];
      await assert.rejects(drive(w, args(w, '--execute'), { ...installWith(effect), calls }), pattern, name);
      assert.deepEqual(firebaseCalls(calls), [], `${name}: the CLI is never started`);
    }
  } finally { rmSync(outside, { force: true }); }
});

test('a link that is not an npm .bin link stays refused unless reviewed (no global symlink trust)', async () => {
  await blocked(withWorld(), installWith(({ functionsDir }) => { mkdirSync(join(nm({ functionsDir }), 'pkg'), { recursive: true }); writeFileSync(join(nm({ functionsDir }), 'pkg', 'real.js'), 'x\n'); symlinkSync('real.js', join(nm({ functionsDir }), 'pkg', 'alias.js')); }), /not a validated dependency link or on the reviewed in-package list/);
  await blocked(withWorld(), installWith(({ functionsDir }) => { mkdirSync(join(functionsDir, '.bin'), { recursive: true }); writeFileSync(join(functionsDir, 'real.js'), 'x\n'); symlinkSync('../real.js', join(functionsDir, '.bin', 'tool')); }), /not a validated dependency link|Unexpected content/);
});

test('a malicious replacement of the Firebase Functions SDK entry is refused (regular launcher, re-pointed link, external target, removed or non-executable entry)', async () => {
  const sdk = ({ functionsDir }) => join(nm({ functionsDir }), '.bin', 'firebase-functions');
  for (const [name, effect, pattern] of [
    ['regular launcher script', context => { rmSync(sdk(context)); writeFileSync(sdk(context), '#!/bin/sh\ncurl evil\n', { mode: 0o755 }); }, /must be the npm-created link/],
    ['external target', context => { rmSync(sdk(context)); symlinkSync('/bin/sh', sdk(context)); }, /must be a relative link/],
    ['re-pointed to another internal file', context => { mkdirSync(join(nm(context), 'evil-pkg'), { recursive: true }); writeFileSync(join(nm(context), 'evil-pkg', 'x.js'), '#!/usr/bin/env node\n', { mode: 0o755 }); rmSync(sdk(context)); symlinkSync('../evil-pkg/x.js', sdk(context)); }, /instead of the SDK's declared bin/],
    ['link removed', context => rmSync(sdk(context)), /\.bin\/firebase-functions is missing/],
    ['target not executable', context => chmodSync(join(nm(context), 'firebase-functions', 'lib', 'bin', 'firebase-functions.js'), 0o644), /not an executable regular file/],
    ['SDK bin declaration removed', context => writeFileSync(join(nm(context), 'firebase-functions', 'package.json'), '{"name":"firebase-functions"}'), /declares no "firebase-functions" bin/],
    ['SDK declares another package\'s file and the link follows it', context => { mkdirSync(join(nm(context), 'other'), { recursive: true }); writeFileSync(join(nm(context), 'other', 'x.js'), '#!/usr/bin/env node\n', { mode: 0o755 }); writeFileSync(join(nm(context), 'firebase-functions', 'package.json'), JSON.stringify({ bin: { 'firebase-functions': '../other/x.js' } })); rmSync(sdk(context)); symlinkSync('../other/x.js', sdk(context)); }, /declared by firebase-functions resolves outside the package/],
    ['SDK declares a bin outside itself', context => writeFileSync(join(nm(context), 'firebase-functions', 'package.json'), JSON.stringify({ bin: { 'firebase-functions': '../../.bin/x' } })), /resolves outside the package|broken or the SDK's declared bin is missing/]
  ]) {
    const calls = [];
    const w = withWorld();
    await assert.rejects(drive(w, args(w, '--execute'), { ...installWith(effect), calls }), pattern, name);
    assert.deepEqual(firebaseCalls(calls), [], `${name}: the CLI is never started`);
  }
});

test('an external link injected after the SDK entry was verified is still caught by the final scan', async () => {
  const w = withWorld();
  await blocked(w, { options: { beforeCli: async ({ packageRoot }) => { symlinkSync('/etc/passwd', join(packageRoot, 'functions', 'node_modules', '.bin', 'late-evil')); } } }, /must be a relative link/);
  const w2 = withWorld();
  await blocked(w2, { options: { beforeCli: async ({ packageRoot }) => { rmSync(join(packageRoot, 'functions', 'node_modules', '.bin', 'firebase-functions')); symlinkSync('../../index.js', join(packageRoot, 'functions', 'node_modules', '.bin', 'firebase-functions')); } } }, /resolves outside|does not resolve to a package|instead of the SDK/);
});

test('OPTIONAL real end-to-end npm ci probe (set PMDASH_REAL_NPM_TEST=1; needs registry access)', { skip: process.env.PMDASH_REAL_NPM_TEST !== '1' }, () => {
  const output = execFileSync('node', [join(repoRoot, 'scripts', 'verification', 'functions-package-npm-compat.mjs')], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const report = JSON.parse(output);
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.steps.npmCi.exitCode, 0);
  assert.equal(report.steps.firebaseCliDiscovery.insideNodeModules, true);
});

// ===================== Owner tooling (plan / sign / trust) =====================
test('the Owner workflow tooling: plan prints a reviewable digest, sign needs that digest and an external key, trust refuses private keys', async () => {
  const { main } = await import('../scripts/release-approval-cli.mjs');
  const w = world();
  const lines = []; const log = line => lines.push(line);
  const planFile = join(w.base, 'plan.json');
  await main(['plan', '--env', 'uat', '--project', UAT, '--source-sha', w.sha, '--functions', CALLABLES_24.join(','), '--release-id', 's02-uat-24-callables', '--out', planFile], { rootDir: w.root, log });
  const digest = /payload-sha256=([0-9a-f]{64})/.exec(lines.join('\n'))?.[1];
  assert.ok(digest);
  assert.match(lines.join('\n'), /UNSIGNED PLAN - review before signing/);
  const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  assert.equal(payloadDigest(plan), digest);
  // Owner side (synthetic key outside the repository).
  const keyFile = join(w.base, 'owner.pem'); writeFileSync(keyFile, OWNER.privateKeyPem, { mode: 0o600 });
  const out = join(w.base, 'signed.json');
  await assert.rejects(main(['sign', '--plan', planFile, '--key', keyFile, '--out', out, '--expect-digest', 'a'.repeat(64)], { rootDir: w.root, log }), /differs from the digest the Owner reviewed/);
  await main(['sign', '--plan', planFile, '--key', keyFile, '--out', out, '--expect-digest', digest], { rootDir: w.root, log });
  assert.deepEqual(verifyApproval({ artifact: JSON.parse(readFileSync(out, 'utf8')), trustedKeys: trusted }), plan);
  // The signing key and the approval can never live inside the repository.
  const insideKey = join(w.root, 'owner.pem'); writeFileSync(insideKey, OWNER.privateKeyPem);
  await assert.rejects(main(['sign', '--plan', planFile, '--key', insideKey, '--out', join(w.base, 'x.json'), '--expect-digest', digest], { rootDir: w.root, log }), /stored outside/);
  await assert.rejects(main(['sign', '--plan', planFile, '--key', keyFile, '--out', join(w.root, 'x.json'), '--expect-digest', digest], { rootDir: w.root, log }), /stored outside/);
  // `trust` converts a PUBLIC key into the anchor content and refuses a private key.
  const pubFile = join(w.base, 'owner.pub.pem'); writeFileSync(pubFile, OWNER.publicKeyPem);
  const trustLines = []; await main(['trust', '--public-key', pubFile], { rootDir: w.root, log: line => trustLines.push(line) });
  assert.deepEqual(await load(fakeFs({ [ANCHOR]: { type: 'file', uid: 0, mode: 0o100644, content: trustLines.join('\n') } })), trusted);
  await assert.rejects(main(['trust', '--public-key', keyFile], { rootDir: w.root, log }), /contains a private key/);
  // A plan that breaks the rules cannot even be proposed.
  await assert.rejects(main(['plan', '--env', 'uat', '--project', UAT, '--source-sha', w.sha, '--functions', [...CALLABLES_24, SCHEDULER].join(','), '--release-id', 's02-uat-25'], { rootDir: w.root, log }), /scheduled Function and is not listed in scheduledFunctionsApproved/);
  await assert.rejects(main(['plan', '--env', 'uat', '--project', UAT, '--source-sha', 'b'.repeat(40), '--functions', CALLABLES_24.join(','), '--release-id', 's02-uat-24'], { rootDir: w.root, log }), /does not exist/);
});

// ===================== no real tools, no secrets =====================
test('the guard never starts the real Firebase CLI by itself and ships no signing key', () => {
  const guard = readFileSync(join(repoRoot, 'scripts', 'functions-release-guard.mjs'), 'utf8');
  assert.equal([...guard.matchAll(/spawn\(/g)].length, 1, 'exactly one spawn, inside defaultRun');
  assert.match(guard, /if \(!parsed\.execute\)/);
  assert.doesNotMatch(guard, /--only['"]?\s*,\s*['"]functions['"]/);
  assert.doesNotMatch(guard, /buildFunctionsOnlyFlag/, 'the allowlist-default flag builder is never used for releases');
  const wrapper = readFileSync(join(repoRoot, 'scripts', 'deploy-functions.mjs'), 'utf8');
  assert.doesNotMatch(wrapper, /spawn|execFile|firebase deploy/);
  for (const file of ['release-approval.mjs', 'release-approval-cli.mjs', 'functions-release-guard.mjs', 'functions-source-package.mjs']) {
    assert.doesNotMatch(readFileSync(join(repoRoot, 'scripts', file), 'utf8'), /BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY/);
  }
});

test('no release contract or approval is committed, and the repository contains no private key', () => {
  assert.ok(!existsSync(join(repoRoot, 'config', 'release-contracts')), 'approvals live outside the repository');
});
