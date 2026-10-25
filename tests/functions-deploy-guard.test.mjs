// P0: contract-scoped Functions release guard. Every test uses a temporary root and a MOCK runner; the real Firebase
// CLI is never started and no cloud resource is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTRACT_KEYS, ReleaseGuardError, assertReleaseContract, assertScopedFunctionsDeployArgs, buildScopedFirebaseArgs,
  parseGuardArguments, readFunctionSource, runFunctionsDeploy
} from '../scripts/functions-release-guard.mjs';
import { functionsAllowlistFor, loadDeploymentManifest } from '../scripts/deployment-manifest.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
const manifest = await loadDeploymentManifest(repoRoot);
const source = await readFunctionSource(repoRoot);
const UAT = manifest.environments.uat.firebaseProjectId;
const PROD = manifest.environments.prod.firebaseProjectId;
const SHA = 'a7f272648e38f36dfee7b7e8bf2d5529659d8194';
const SCHEDULER = 'aggregatePresenceSessions';
const uatAllowlist = functionsAllowlistFor(manifest, 'uat');
const CALLABLES_24 = uatAllowlist.filter(name => name !== SCHEDULER);
const git = (overrides = {}) => ({ sha: SHA, dirty: false, contractTracked: true, ...overrides });
const contract24 = (overrides = {}) => ({
  contractVersion: 1, releaseId: 's02-uat-24-callables', environment: 'uat', firebaseProjectId: UAT, sourceSha: SHA,
  functions: [...CALLABLES_24], expectedFunctionCount: 24, exclusions: [SCHEDULER], scheduledFunctionsApproved: [],
  authorizationRef: 'Owner authorisation for exactly 24 callable Functions (example)', ...overrides
});
const check = (contract, extra = {}) => assertReleaseContract({ manifest, contract, environment: 'uat', project: UAT, git: git(), source, ...extra });

// ---- the R2 shape: exactly 24 callables, scheduler excluded ----
test('the UAT manifest is the R2 shape: 25 eligible Functions of which exactly one is scheduled', () => {
  assert.equal(uatAllowlist.length, 25);
  assert.deepEqual([...source.scheduled], [SCHEDULER]);
  assert.equal(CALLABLES_24.length, 24);
});

test('a valid 24-Function release is accepted and builds only an explicitly scoped command', () => {
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
  const approved = contract24({ functions: [...uatAllowlist], expectedFunctionCount: 25, exclusions: [], scheduledFunctionsApproved: [SCHEDULER] });
  assert.equal(check(approved).functions.length, 25, 'an explicit named approval is the only way in');
  assert.throws(() => check(contract24({ scheduledFunctionsApproved: [SCHEDULER] })), /not in functions/);
  assert.throws(() => check(contract24({ scheduledFunctionsApproved: ['saveDashboardProject'] })), /not in functions|not a scheduled/);
});

test('an unexpected 25th Function fails the count and the exclusions accounting', () => {
  assert.throws(() => check(contract24({ functions: [...uatAllowlist], expectedFunctionCount: 24, exclusions: [] })), /expectedFunctionCount 24 does not match the 25/);
  assert.throws(() => check(contract24({ expectedFunctionCount: 25 })), /expectedFunctionCount 25 does not match the 24/);
  assert.throws(() => check(contract24({ functions: [...CALLABLES_24, SCHEDULER], expectedFunctionCount: 25 })), ReleaseGuardError);
});

test('a manifest-eligible Function that is neither named nor explicitly excluded is rejected', () => {
  const missing = CALLABLES_24.slice(1);
  assert.throws(() => check(contract24({ functions: missing, expectedFunctionCount: 23 })), new RegExp(`neither deployed nor explicitly excluded: ${CALLABLES_24[0]}`));
});

test('an unknown Function is rejected', () => {
  assert.throws(() => check(contract24({ functions: [...CALLABLES_24.slice(1), 'totallyNewFunction'] })), /totallyNewFunction" is not a managed uat Function/);
});

test('names that are not plain Function names (wildcards, scopes, lists) are rejected', () => {
  for (const bad of ['*', 'functions', 'functions:saveDashboardProject', 'a,b', 'group.fn', ' ', 'save Dashboard']) {
    assert.throws(() => check(contract24({ functions: [bad, ...CALLABLES_24.slice(1)] })), ReleaseGuardError, bad);
  }
});

test('the wrong project is rejected (flag, contract and Production crossover)', () => {
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
  assert.throws(() => parseGuardArguments(['--project', UAT, '--contract', 'config/release-contracts/x.json']), /--env is required/);
});

test('a missing or incomplete approval contract is rejected', () => {
  assert.throws(() => check(undefined), /missing or not an object/);
  assert.throws(() => check(null), ReleaseGuardError);
  assert.throws(() => check([]), ReleaseGuardError);
  for (const key of Object.keys(contract24())) {
    const { [key]: _removed, ...rest } = contract24();
    assert.throws(() => check(rest), new RegExp(`missing "${key}"`));
  }
  assert.throws(() => check({ ...contract24(), surprise: true }), /unknown key "surprise"/);
  assert.throws(() => check(contract24({ authorizationRef: '   ' })), /authorizationRef/);
  assert.throws(() => check(contract24({ contractVersion: 2 })), /contractVersion/);
  assert.throws(() => parseGuardArguments(['--env', 'uat', '--project', UAT]), /--contract is required/);
});

test('the manifest allowlist alone is never authorisation', () => {
  // Every eligible Function named, but no authorisation reference: still refused.
  assert.throws(() => check(contract24({ functions: [...uatAllowlist], expectedFunctionCount: 25, exclusions: [], scheduledFunctionsApproved: [SCHEDULER], authorizationRef: '' })), /authorizationRef/);
});

test('an incorrect, short or stale source SHA, or a dirty tree, is rejected', () => {
  assert.throws(() => check(contract24({ sourceSha: 'f65efd57b6a7906c0772f9cde4333cff4ed09f54' })), /is not the checked-out HEAD/);
  assert.throws(() => check(contract24({ sourceSha: 'a7f2726' })), /full 40-character/);
  assert.throws(() => check(contract24({ sourceSha: SHA.toUpperCase() })), /full 40-character/);
  assert.throws(() => check(contract24(), { git: git({ dirty: true }) }), /uncommitted tracked changes/);
  assert.throws(() => check(contract24(), { git: git({ dirty: undefined }) }), /uncommitted tracked changes|unknown/);
  assert.throws(() => check(contract24(), { git: undefined }), ReleaseGuardError);
});

test('Production and UAT stay isolated', () => {
  const prodAllowlist = functionsAllowlistFor(manifest, 'prod');
  const prod = environmentContract => ({ ...contract24(), environment: 'prod', firebaseProjectId: PROD, functions: [...prodAllowlist], expectedFunctionCount: prodAllowlist.length, exclusions: [], scheduledFunctionsApproved: prodAllowlist.filter(name => source.scheduled.has(name)), ...environmentContract });
  assert.equal(assertReleaseContract({ manifest, contract: prod(), environment: 'prod', project: PROD, git: git(), source }).environment, 'prod');
  // UAT-only Production-to-UAT sync Functions can never be named in a Production release.
  const forbidden = manifest.environments.prod.functionsNeverDeploy.productionWeekSync[0];
  assert.throws(() => assertReleaseContract({ manifest, contract: prod({ functions: [forbidden, ...prodAllowlist.slice(1)] }), environment: 'prod', project: PROD, git: git(), source }), /forbidden in prod|not a managed prod/);
  // A Production release cannot target the UAT project, and a UAT release cannot target Production.
  assert.throws(() => assertReleaseContract({ manifest, contract: prod({ firebaseProjectId: UAT }), environment: 'prod', project: UAT, git: git(), source }), /is not the prod project/);
  assert.throws(() => check(contract24({ firebaseProjectId: PROD }), { project: PROD }), /is not the uat project/);
  // Preserved Production Functions (the Executive set) cannot be deployed.
  const preserved = manifest.environments.prod.functionsPreserveExisting[0];
  assert.throws(() => assertReleaseContract({ manifest, contract: prod({ functions: [preserved, ...prodAllowlist.slice(1)] }), environment: 'prod', project: PROD, git: git(), source }), /preserved prod Function/);
});

// ---- raw Firebase argument lists: the commands behind the R2 incident ----
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

test('the CLI wrapper never accepts raw Firebase flags', () => {
  for (const flag of [['--only', 'functions'], ['--force'], ['--except', 'x'], ['--all']]) {
    assert.throws(() => parseGuardArguments(['--env', 'uat', '--project', UAT, '--contract', 'config/release-contracts/x.json', ...flag]), /Unsupported argument/);
  }
});

// ---- end to end through the wrapper, with a mock runner ----
function fixtureRoot(contract) {
  const dir = mkdtempSync(join(tmpdir(), 'functions-guard-'));
  mkdirSync(join(dir, 'config', 'release-contracts'), { recursive: true });
  mkdirSync(join(dir, 'functions'), { recursive: true });
  cpSync(join(repoRoot, 'config', 'deployment-manifest.json'), join(dir, 'config', 'deployment-manifest.json'));
  cpSync(join(repoRoot, 'functions', 'index.js'), join(dir, 'functions', 'index.js'));
  if (contract !== undefined) writeFileSync(join(dir, 'config', 'release-contracts', 'release.json'), typeof contract === 'string' ? contract : JSON.stringify(contract));
  return dir;
}
const contractArg = 'config/release-contracts/release.json';
const baseArgs = ['--env', 'uat', '--project', UAT, '--contract', contractArg];

async function drive(contract, argv = baseArgs, state = git()) {
  const dir = fixtureRoot(contract);
  const calls = []; const logs = [];
  try {
    const code = await runFunctionsDeploy(argv, { rootDir: dir, run: async (command, args) => { calls.push([command, args]); return 0; }, log: line => logs.push(line), getGitState: async () => state });
    return { code, calls, logs };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const rejects = async (promise, pattern) => assert.rejects(promise, error => error instanceof ReleaseGuardError && pattern.test(error.message));

test('dry-run is the default: the command is printed and the runner is never called', async () => {
  const { code, calls, logs } = await drive(contract24());
  assert.equal(code, 0);
  assert.deepEqual(calls, []);
  assert.ok(logs.some(line => line.startsWith('> firebase deploy --only functions:')));
  assert.ok(logs.some(line => /Firebase CLI was not started/.test(line)));
});

test('--execute calls the runner exactly once with the scoped arguments and nothing else', async () => {
  const { calls } = await drive(contract24(), [...baseArgs, '--execute']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'firebase');
  assert.equal(calls[0][1].length, 7);
  assert.equal(calls[0][1][2].split(',').length, 24);
  assert.ok(!calls[0][1].join(' ').includes(SCHEDULER));
  assert.ok(!calls[0][1].includes('functions') && !calls[0][1].includes('--force'));
});

test('every rejection happens before the runner is reached', async () => {
  const cases = [
    [undefined, baseArgs, git(), /Could not read the release contract/],
    ['not json', baseArgs, git(), /Could not read the release contract/],
    [contract24({ functions: [...uatAllowlist], expectedFunctionCount: 25, exclusions: [] }), [...baseArgs, '--execute'], git(), /scheduled Function/],
    [contract24({ sourceSha: 'b'.repeat(40) }), [...baseArgs, '--execute'], git(), /checked-out HEAD/],
    [contract24(), [...baseArgs, '--execute'], git({ contractTracked: false }), /not a tracked/],
    [contract24(), ['--env', 'uat', '--project', PROD, '--contract', contractArg, '--execute'], git(), /--project/],
    [contract24(), ['--env', 'uat', '--contract', contractArg, '--execute'], git(), /--project is required/],
    [contract24(), ['--project', UAT, '--contract', contractArg, '--execute'], git(), /--env is required/],
    [contract24(), ['--env', 'uat', '--project', UAT, '--execute'], git(), /--contract is required/],
    [contract24(), ['--env', 'uat', '--project', UAT, '--contract', '../outside.json', '--execute'], git(), /under config\/release-contracts/],
    [contract24(), ['--env', 'uat', '--project', UAT, '--contract', 'package.json', '--execute'], git(), /under config\/release-contracts/]
  ];
  for (const [contract, argv, state, pattern] of cases) {
    const dir = fixtureRoot(contract);
    const calls = [];
    try {
      await rejects(runFunctionsDeploy(argv, { rootDir: dir, run: async (...call) => { calls.push(call); return 0; }, log: () => {}, getGitState: async () => state }), pattern);
      assert.deepEqual(calls, [], String(pattern));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a Production execute needs --confirm-production; a failing CLI is reported as not deployed', async () => {
  const prodAllowlist = functionsAllowlistFor(manifest, 'prod');
  const prod = { ...contract24(), environment: 'prod', firebaseProjectId: PROD, functions: prodAllowlist, expectedFunctionCount: prodAllowlist.length, exclusions: [], scheduledFunctionsApproved: prodAllowlist.filter(name => source.scheduled.has(name)) };
  const argv = ['--env', 'prod', '--project', PROD, '--contract', contractArg];
  await rejects(drive(prod, [...argv, '--execute']), /--confirm-production/);
  assert.equal((await drive(prod, [...argv, '--execute', '--confirm-production'])).calls.length, 1);
  const dir = fixtureRoot(contract24());
  try {
    await rejects(runFunctionsDeploy([...baseArgs, '--execute'], { rootDir: dir, run: async () => 3, log: () => {}, getGitState: async () => git() }), /exited with code 3/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the guard never starts the real Firebase CLI by itself (static check)', () => {
  const guard = readFileSync(join(repoRoot, 'scripts', 'functions-release-guard.mjs'), 'utf8');
  assert.equal([...guard.matchAll(/spawn\(/g)].length, 1, 'exactly one spawn, inside defaultRun');
  assert.match(guard, /if \(!parsed\.execute\)/);
  assert.doesNotMatch(guard, /--only['"]?\s*,\s*['"]functions['"]/);
  assert.doesNotMatch(guard, /buildFunctionsOnlyFlag/, 'the allowlist-default flag builder is never used for releases');
  const wrapper = readFileSync(join(repoRoot, 'scripts', 'deploy-functions.mjs'), 'utf8');
  assert.doesNotMatch(wrapper, /spawn|execFile|firebase deploy/);
});

test('any committed release contract has exactly the contract keys (this change ships the guard, not an approval)', () => {
  const directory = join(repoRoot, 'config', 'release-contracts');
  let files = [];
  try { files = readdirSync(directory).filter(name => name.endsWith('.json')); } catch { files = []; }
  for (const file of files) {
    const contract = JSON.parse(readFileSync(join(directory, file), 'utf8'));
    assert.deepEqual(Object.keys(contract).sort(), [...CONTRACT_KEYS].sort(), file);
  }
});
