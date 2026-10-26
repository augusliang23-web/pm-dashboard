// P0: Owner-signed, contract-scoped Functions release guard. Every test uses temporary directories, SYNTHETIC keys
// generated in memory, a real throw-away git repository and a MOCK runner. The real Firebase CLI is never started,
// no cloud resource is contacted, and no real Owner key exists anywhere in this repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync
} from 'node:fs';
import { lstat, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  CONTRACT_KEYS, ReleaseGuardError, assertReleaseContract, assertScopedFunctionsDeployArgs, buildScopedFirebaseArgs,
  parseDeploymentManifestText, parseGuardArguments, readFunctionSourceText, runFunctionsDeploy
} from '../scripts/functions-release-guard.mjs';
import {
  ApprovalError, DEFAULT_TRUST_ANCHOR_PATH, canonicalPayload, loadTrustAnchor, parseApprovalArtifact, payloadDigest,
  publicKeyFingerprint, signApproval, verifyApproval
} from '../scripts/release-approval.mjs';
import {
  PACKAGE_PREFIX, PackageIntegrityError, disposePackage, exportSourcePackage, listSourceEntries, makeGit, verifyExportedPackage
} from '../scripts/functions-source-package.mjs';
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

// ===================== trust anchor (pinned, root-owned, outside the repository) =====================
const anchorJson = (keys = trusted, schema = 'pmdash-release-trust/v1') => JSON.stringify({ schema, keys });
const fakeStat = ({ uid = 0, mode = 0o100644, file = true, dir = false, link = false } = {}) => ({ uid, mode, isFile: () => file, isDirectory: () => dir, isSymbolicLink: () => link });
const anchorIo = ({ content = anchorJson(), fileStat = fakeStat(), dirStat = fakeStat({ mode: 0o040755, file: false, dir: true }), missing = false } = {}) => ({
  lstat: async path => { if (missing) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return path.endsWith('.json') ? fileStat : dirStat; },
  readFile: async () => content
});
const ANCHOR = '/etc/pmdash/functions-release-trust.json';
const load = (io, extra = {}) => loadTrustAnchor({ path: ANCHOR, forbiddenRoots: [repoRoot], io, ...extra });

test('a root-owned, not group/other-writable anchor outside the repository is accepted', async () => {
  const keys = await load(anchorIo());
  assert.deepEqual(keys, trusted);
});

test('an absent trust anchor fails closed and tells the Owner how to bootstrap', async () => {
  await assert.rejects(load(anchorIo({ missing: true })), /Trust anchor rejected: .*does not exist.*Owner bootstrap required/s);
  await assert.rejects(loadTrustAnchor({ forbiddenRoots: [repoRoot], io: anchorIo({ missing: true }) }), /Owner bootstrap required/);
  assert.equal(DEFAULT_TRUST_ANCHOR_PATH, '/etc/pmdash/functions-release-trust.json');
});

test('an anchor the executing user can rewrite is not a trust anchor', async () => {
  await assert.rejects(load(anchorIo({ fileStat: fakeStat({ uid: 501 }) })), /not owned by root/);
  await assert.rejects(load(anchorIo({ fileStat: fakeStat({ mode: 0o100664 }) })), /writable by group or others/);
  await assert.rejects(load(anchorIo({ fileStat: fakeStat({ mode: 0o100666 }) })), /writable by group or others/);
  await assert.rejects(load(anchorIo({ dirStat: fakeStat({ uid: 501, mode: 0o040755, file: false, dir: true }) })), /not owned by root/);
  await assert.rejects(load(anchorIo({ dirStat: fakeStat({ mode: 0o040777, file: false, dir: true }) })), /writable by group or others/);
  await assert.rejects(load(anchorIo({ fileStat: fakeStat({ link: true }) })), /symbolic link/);
  await assert.rejects(load(anchorIo({ fileStat: fakeStat({ file: false }) })), /not a regular file/);
  // The real filesystem: a file created by this (non-root) test process can never qualify.
  const dir = mkdtempSync(join(tmpdir(), 'trust-anchor-'));
  try {
    writeFileSync(join(dir, 'trust.json'), anchorJson());
    await assert.rejects(loadTrustAnchor({ path: join(dir, 'trust.json'), forbiddenRoots: [repoRoot] }), process.getuid?.() === 0 ? /Trust anchor rejected/ : /not owned by root/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an anchor inside the repository or at a relative path is refused', async () => {
  await assert.rejects(loadTrustAnchor({ path: join(repoRoot, 'config', 'trust.json'), forbiddenRoots: [repoRoot], io: anchorIo() }), /stored outside/);
  await assert.rejects(loadTrustAnchor({ path: 'trust.json', forbiddenRoots: [repoRoot], io: anchorIo() }), /must be absolute/);
});

test('an anchor with no keys, the wrong schema, bad key ids or non-Ed25519 keys is refused', async () => {
  await assert.rejects(load(anchorIo({ content: anchorJson([]) })), /lists no trusted keys/);
  await assert.rejects(load(anchorIo({ content: anchorJson(trusted, 'other/v1') })), /must be/);
  await assert.rejects(load(anchorIo({ content: 'not json' })), /not valid JSON/);
  await assert.rejects(load(anchorIo({ content: JSON.stringify({ schema: 'pmdash-release-trust/v1', keys: trusted, extra: 1 }) })), /must be/);
  await assert.rejects(load(anchorIo({ content: anchorJson([{ keyId: OTHER.keyId, publicKeyPem: OWNER.publicKeyPem }]) })), /not the fingerprint/);
  await assert.rejects(load(anchorIo({ content: anchorJson([...trusted, ...trusted]) })), /duplicate key/);
  await assert.rejects(load(anchorIo({ content: anchorJson([{ keyId: OWNER.keyId, publicKeyPem: 'not a key' }]) })), /not a valid PEM/);
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'pem' });
  await assert.rejects(load(anchorIo({ content: anchorJson([{ keyId: 'sha256:' + '0'.repeat(64), publicKeyPem: ec }]) })), /Only Ed25519/);
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
// io where only the Owner-bootstrapped trust anchor (and its directory) is presented as root-owned.
const worldIo = w => ({
  realpath,
  lstat: async path => (path === w.trustAnchor ? fakeStat() : path === dirname(w.trustAnchor) ? fakeStat({ mode: 0o040755, file: false, dir: true }) : lstat(path)),
  readFile: async path => readFileSync(path, 'utf8')
});

async function drive(w, argv, extra = {}) {
  const calls = []; const logs = []; const snapshots = [];
  let packagePath = null;
  const makeTempDir = async () => (packagePath = await mkdtemp(join(await realpath(tmpdir()), PACKAGE_PREFIX)));
  const runner = async (command, args, context) => {
    calls.push([command, args, context]);
    snapshots.push(listFiles(context.cwd));
    return extra.exitCode ?? 0;
  };
  const code = await runFunctionsDeploy(argv, { rootDir: w.root, run: runner, log: line => logs.push(line), io: worldIo(w), now: () => NOW, makeTempDir, ...extra.options });
  return { code, calls, logs, snapshots, packagePath };
}
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
  assert.deepEqual(calls[0].slice(0, 2), ['npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']]);
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
  assert.deepEqual(snapshots[1], ['firebase.json', 'functions/helper.js', 'functions/index.js', 'functions/package-lock.json', 'functions/package.json']);
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
    assert.ok(!files.some(file => /evil|runtimeconfig|node_modules|unrelated/.test(file)), files.join(','));
  }
  assert.ok(existsSync(join(w.root, 'functions', 'evil.js')), 'the working tree is never cleaned');
});

test('untracked symlinks (to files, directories or outside paths) never enter the package', async () => {
  const w = world(); approve(w);
  symlinkSync('/etc', join(w.root, 'functions', 'leak'));
  symlinkSync(join(w.root, 'unrelated-secret.txt'), join(w.root, 'functions', 'secret-link.js'));
  symlinkSync('../../..', join(w.root, 'functions', 'escape'));
  const { snapshots } = await drive(w, args(w, '--execute'));
  for (const files of snapshots) assert.ok(!files.some(file => /leak|secret-link|escape|symlink/.test(file)), files.join(','));
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

test('an absent or user-writable trust anchor fails closed even with a perfectly signed approval', async () => {
  const w = world(); approve(w);
  const calls = [];
  const options = { run: async (...call) => { calls.push(call); return 0; }, io: { realpath, lstat, readFile: async path => readFileSync(path, 'utf8') } };
  await rejectsWith(drive(w, args(w, '--execute'), { options }), /Trust anchor rejected: .*not owned by root.*Owner bootstrap required/s);
  await rejectsWith(drive(w, ['--env', 'uat', '--project', UAT, '--approval', w.approvalPath, '--trust-anchor', join(w.base, 'missing.json'), '--execute'], { options }), /Trust anchor rejected/);
  const absent = { run: options.run, io: { realpath, lstat: async path => { if (path === DEFAULT_TRUST_ANCHOR_PATH) throw new Error('ENOENT'); return lstat(path); }, readFile: options.io.readFile } };
  await rejectsWith(drive(w, ['--env', 'uat', '--project', UAT, '--approval', w.approvalPath, '--execute'], { options: absent }), /does not exist or cannot be read.*Owner bootstrap required/s);
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
  await rejectsWith(drive(w, args(w, '--execute'), { options: { run: async () => (n++ === 0 ? 0 : 7) } }), /exited with code 7/);
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
  assert.deepEqual(await load(anchorIo({ content: trustLines.join('\n') })), trusted);
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
