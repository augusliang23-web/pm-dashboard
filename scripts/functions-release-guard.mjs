// Fail-closed guard for repository-managed Cloud Functions releases.
//
// Why this exists: S02 R2 was authorised for 24 callable Functions, but a Firebase CLI deploy with a bare
// `--only functions` scope updated all 25 managed Functions, including the scheduled aggregatePresenceSessions (and
// moved 13 Functions from Node 20 to 22). The deployment manifest already says "never an unscoped deployment", but
// nothing enforced it.
//
// Model (v2):
//  * config/deployment-manifest.json says which Functions an environment is ELIGIBLE to deploy. It is not authorisation.
//  * The SOURCE is a frozen commit. The AUTHORISATION is a separate, Owner-signed approval artifact stored OUTSIDE the
//    repository (scripts/release-approval.mjs). The approval names that commit and its tree, the environment, the
//    Firebase project, the exact Functions, the count, the exclusions and a validity window. A commit never has to
//    contain its own SHA: the approval is created after the source commit exists.
//  * The approval is verified against a pinned, root-owned trust anchor. No anchor or no valid signature => FAIL CLOSED.
//  * What is released is rebuilt from the approved commit's tree into an isolated package
//    (scripts/functions-source-package.mjs); the working tree, untracked files and symlinks never enter it.
//  * The only command produced is
//      deploy --only functions:a,functions:b,... --project <id> --message <text>   (arguments to the Firebase CLI)
//
// LIMITATION (by design, cannot be fixed in a wrapper): nothing here can stop an operator with unrestricted cloud
// credentials from running the Firebase CLI directly, and this is not organisation-wide authorisation. It protects
// repository-managed releases and makes the approval independently verifiable.
// Nothing here starts the Firebase CLI unless the wrapper is run with --execute; tests inject a mock runner.
import { spawn } from 'node:child_process';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENVIRONMENTS, functionsAllowlistFor, functionsPreservedFor } from './deployment-manifest.mjs';
import { ApprovalError, DEFAULT_TRUST_ANCHOR_PATH, assertOutside, loadTrustAnchor, verifyApproval } from './release-approval.mjs';
import {
  PackageIntegrityError, assertPackageFirebaseConfig, assertPackageIdentity, capturePackageIdentity, disposePackage, exportSourcePackage,
  listSourceEntries, openRepository, readFromCommit, resolveSourceCommit, verifyExportedPackage, verifyInstalledPackage
} from './functions-source-package.mjs';
import { GitSandboxError } from './git-sandbox.mjs';
import { assertNpmSandbox, createNpmSandbox, disposeNpmSandbox, npmInstallEnvironment, sanitizedToolEnv } from './npm-sandbox.mjs';

export class ReleaseGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseGuardError';
  }
}

export const CONTRACT_VERSION = 2;
export const MAX_APPROVAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const CONTRACT_KEYS = Object.freeze([
  'contractVersion', 'releaseId', 'environment', 'firebaseProjectId', 'sourceSha', 'sourceTree', 'functions',
  'expectedFunctionCount', 'exclusions', 'scheduledFunctionsApproved', 'notBefore', 'expiresAt'
]);
const FUNCTION_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

function neverDeployNames(environment) {
  return Object.values(environment.functionsNeverDeploy || {}).flat();
}

// Exported Function names and which of them are scheduled, read statically from the Functions entry point text.
export function readFunctionSourceText(source) {
  const exported = [...source.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=/gm)].map(match => match[1]);
  const scheduled = [...source.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=\s*onSchedule\(/gm)].map(match => match[1]);
  return { exported: new Set(exported), scheduled: new Set(scheduled) };
}

export async function readFunctionSource(rootDir) {
  return readFunctionSourceText(await readFile(join(rootDir, 'functions', 'index.js'), 'utf8'));
}

// The manifest is read from the approved commit, never from the working tree.
export function parseDeploymentManifestText(text) {
  let manifest;
  try { manifest = JSON.parse(text); } catch { throw new ReleaseGuardError('config/deployment-manifest.json in the approved commit is not valid JSON.'); }
  if (manifest?.version !== 1) throw new ReleaseGuardError(`Unsupported deployment manifest version ${manifest?.version}.`);
  for (const name of ENVIRONMENTS) if (!manifest.environments?.[name]) throw new ReleaseGuardError(`The deployment manifest is missing environment "${name}".`);
  return manifest;
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStringList = value => Array.isArray(value) && value.every(item => typeof item === 'string');

// Pure validation of the (signature-verified) approval payload. Returns it when every rule holds; otherwise throws
// one error listing every problem.
export function assertReleaseContract({ manifest, contract, environment, project, git, source, now = new Date() }) {
  const problems = [];
  const problem = text => problems.push(text);
  if (!ENVIRONMENTS.includes(environment)) problem(`environment "${environment}" is missing or unknown (expected one of ${ENVIRONMENTS.join(', ')})`);
  if (typeof project !== 'string' || !project) problem('an explicit Firebase project id is required');
  if (!isPlainObject(contract)) {
    throw new ReleaseGuardError(`Release contract is missing or not an object. ${problems.join('; ')}`.trim());
  }
  const keys = Object.keys(contract);
  for (const key of CONTRACT_KEYS) if (!keys.includes(key)) problem(`contract is missing "${key}"`);
  for (const key of keys) if (!CONTRACT_KEYS.includes(key)) problem(`contract has unknown key "${key}"`);
  if (problems.length) throw new ReleaseGuardError(`Release contract rejected: ${problems.join('; ')}.`);

  if (contract.contractVersion !== CONTRACT_VERSION) problem(`contractVersion must be ${CONTRACT_VERSION}`);
  if (typeof contract.releaseId !== 'string' || !RELEASE_ID.test(contract.releaseId)) problem('releaseId must be 3-64 characters of [A-Za-z0-9._-]');

  const manifestEnvironment = manifest.environments?.[environment];
  if (!manifestEnvironment) problem(`the manifest has no environment "${environment}"`);
  if (contract.environment !== environment) problem(`contract environment "${contract.environment}" differs from the requested environment "${environment}"`);
  if (manifestEnvironment) {
    if (contract.firebaseProjectId !== manifestEnvironment.firebaseProjectId) problem(`contract project "${contract.firebaseProjectId}" is not the ${environment} project "${manifestEnvironment.firebaseProjectId}"`);
    if (project !== manifestEnvironment.firebaseProjectId) problem(`--project "${project}" is not the ${environment} project "${manifestEnvironment.firebaseProjectId}"`);
  }
  if (contract.firebaseProjectId !== project) problem(`contract project "${contract.firebaseProjectId}" differs from --project "${project}"`);

  if (typeof contract.sourceSha !== 'string' || !FULL_SHA.test(contract.sourceSha)) problem('sourceSha must be a full 40-character lowercase SHA');
  else if (git?.sha !== contract.sourceSha) problem(`approved sourceSha ${contract.sourceSha} is not the checked-out HEAD ${git?.sha || 'unknown'}`);
  if (typeof contract.sourceTree !== 'string' || !FULL_SHA.test(contract.sourceTree)) problem('sourceTree must be a full 40-character lowercase tree id');
  else if (git?.tree !== contract.sourceTree) problem(`approved sourceTree ${contract.sourceTree} differs from the tree of the source commit (${git?.tree || 'unknown'})`);
  if (git?.dirty !== false) problem('the working tree has uncommitted tracked changes (or its state is unknown)');

  if (typeof contract.notBefore !== 'string' || !ISO_UTC.test(contract.notBefore) || typeof contract.expiresAt !== 'string' || !ISO_UTC.test(contract.expiresAt)) {
    problem('notBefore and expiresAt must be UTC timestamps like 2026-10-27T01:00:00Z');
  } else {
    const start = Date.parse(contract.notBefore);
    const end = Date.parse(contract.expiresAt);
    if (!(end > start)) problem('expiresAt must be after notBefore');
    else if (end - start > MAX_APPROVAL_WINDOW_MS) problem('the approval window may not exceed 14 days');
    if (now.getTime() < start) problem(`the approval is not valid until ${contract.notBefore}`);
    if (now.getTime() >= end) problem(`the approval expired at ${contract.expiresAt}`);
  }

  const names = contract.functions;
  const exclusions = contract.exclusions;
  if (!isStringList(names) || !names.length) problem('functions must be a non-empty array of Function names');
  if (!isStringList(exclusions)) problem('exclusions must be an array of Function names (use [] only when nothing is excluded)');
  if (!isStringList(contract.scheduledFunctionsApproved)) problem('scheduledFunctionsApproved must be an array of Function names');
  if (!Number.isInteger(contract.expectedFunctionCount) || contract.expectedFunctionCount < 1) problem('expectedFunctionCount must be a positive integer');

  if (isStringList(names) && names.length && manifestEnvironment) {
    const managed = new Set(functionsAllowlistFor(manifest, environment));
    const preserved = new Set(functionsPreservedFor(manifest, environment));
    const forbidden = new Set(neverDeployNames(manifestEnvironment));
    if (new Set(names).size !== names.length) problem('functions contains duplicates');
    if (Number.isInteger(contract.expectedFunctionCount) && contract.expectedFunctionCount !== names.length) {
      problem(`expectedFunctionCount ${contract.expectedFunctionCount} does not match the ${names.length} named Functions`);
    }
    for (const name of names) {
      if (!FUNCTION_NAME.test(name)) { problem(`"${name}" is not a plain Function name (no wildcards, groups, prefixes or lists)`); continue; }
      if (forbidden.has(name)) problem(`"${name}" is forbidden in ${environment}`);
      else if (preserved.has(name)) problem(`"${name}" is a preserved ${environment} Function and may not be deployed`);
      else if (!managed.has(name)) problem(`"${name}" is not a managed ${environment} Function (unknown to the manifest, or belongs to another environment)`);
      if (source && !source.exported.has(name)) problem(`"${name}" is not exported by functions/index.js`);
    }
    if (isStringList(exclusions)) {
      if (new Set(exclusions).size !== exclusions.length) problem('exclusions contains duplicates');
      for (const name of exclusions) {
        if (names.includes(name)) problem(`"${name}" is both deployed and excluded`);
        if (!managed.has(name)) problem(`excluded "${name}" is not a managed ${environment} Function`);
      }
      // Every eligible Function must be accounted for: either named in this release or explicitly excluded.
      const unaccounted = [...managed].filter(name => !names.includes(name) && !exclusions.includes(name));
      if (unaccounted.length) problem(`managed Functions neither deployed nor explicitly excluded: ${unaccounted.sort().join(', ')}`);
    }
    // A scheduled Function can only be updated by an explicit, named approval; it is never implied by a list.
    const scheduled = source?.scheduled ?? new Set();
    const approved = isStringList(contract.scheduledFunctionsApproved) ? contract.scheduledFunctionsApproved : [];
    for (const name of names) if (scheduled.has(name) && !approved.includes(name)) problem(`"${name}" is a scheduled Function and is not listed in scheduledFunctionsApproved`);
    for (const name of approved) {
      if (!names.includes(name)) problem(`scheduledFunctionsApproved lists "${name}", which is not in functions`);
      else if (!scheduled.has(name)) problem(`scheduledFunctionsApproved lists "${name}", which is not a scheduled Function`);
    }
  }
  if (problems.length) throw new ReleaseGuardError(`Release contract rejected: ${problems.join('; ')}.`);
  return contract;
}

// The only Firebase CLI argument list this module will ever produce.
export function buildScopedFirebaseArgs(contract) {
  return [
    'deploy', '--only', contract.functions.map(name => `functions:${name}`).join(','),
    '--project', contract.firebaseProjectId, '--message', `${contract.releaseId} ${contract.sourceSha.slice(0, 7)}`
  ];
}

// Validates ANY Firebase CLI argument list against the scoped-deploy rules (used on our own output as a second
// check, and directly testable against the unsafe commands that caused the R2 incident).
export function assertScopedFunctionsDeployArgs(args, contract) {
  const problems = [];
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new ReleaseGuardError('Firebase arguments must be an array of strings.');
  if (args[0] !== 'deploy') problems.push('the command must be "deploy"');
  let only = null; let project = null; let message = null; let onlyCount = 0; let projectCount = 0;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--only') { onlyCount += 1; only = args[++index]; }
    else if (arg === '--project') { projectCount += 1; project = args[++index]; }
    else if (arg === '--message') { message = args[++index]; }
    else problems.push(`flag or argument "${arg}" is not allowed (no --force, --except, wildcards or extra targets)`);
  }
  if (onlyCount !== 1) problems.push('exactly one --only is required (an unscoped deploy is forbidden)');
  if (projectCount !== 1 || !project || project.startsWith('-')) problems.push('exactly one explicit --project is required');
  if (message !== null && (typeof message !== 'string' || message.startsWith('-'))) problems.push('--message needs a text value');
  let selected = [];
  if (onlyCount === 1) {
    if (typeof only !== 'string' || !only) problems.push('--only needs a value');
    else {
      selected = only.split(',');
      for (const part of selected) {
        if (!/^functions:[A-Za-z][A-Za-z0-9_]*$/.test(part)) problems.push(`--only part "${part}" is not an individually named Function ("functions:<name>"); bare "functions", wildcards, groups and other targets are forbidden`);
      }
      if (new Set(selected).size !== selected.length) problems.push('--only contains duplicates');
    }
  }
  if (contract) {
    const expected = contract.functions.map(name => `functions:${name}`);
    if (selected.length !== expected.length || expected.some(name => !selected.includes(name))) problems.push('--only does not match the contract Function list exactly');
    if (project !== contract.firebaseProjectId) problems.push(`--project "${project}" differs from the contract project "${contract.firebaseProjectId}"`);
  }
  if (problems.length) throw new ReleaseGuardError(`Unsafe Firebase CLI command rejected: ${problems.join('; ')}.`);
  return { only: selected, project, message };
}

export function parseGuardArguments(argv) {
  const args = [...argv];
  const parsed = { environment: '', project: '', approval: '', trustAnchor: '', execute: false, confirmProduction: false };
  const value = flag => {
    const next = args.shift();
    if (!next || next.startsWith('-')) throw new ReleaseGuardError(`${flag} requires a value.`);
    return next;
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--env') parsed.environment = value(flag);
    else if (flag === '--project') parsed.project = value(flag);
    else if (flag === '--approval') parsed.approval = value(flag);
    else if (flag === '--trust-anchor') parsed.trustAnchor = value(flag);
    else if (flag === '--execute') parsed.execute = true;
    else if (flag === '--confirm-production') parsed.confirmProduction = true;
    else throw new ReleaseGuardError(`Unsupported argument "${flag}". Usage: node scripts/deploy-functions.mjs --env <${ENVIRONMENTS.join('|')}> --project <firebase-project-id> --approval <Owner-signed approval file outside the repository> [--trust-anchor <root-owned file>] [--execute] [--confirm-production]. The wrapper never accepts --only, --force, --contract or any raw Firebase flag.`);
  }
  if (!parsed.environment) throw new ReleaseGuardError('--env is required.');
  if (!parsed.project) throw new ReleaseGuardError('--project is required (the Firebase project is never inferred).');
  if (!parsed.approval) throw new ReleaseGuardError('--approval is required: a Functions release needs an Owner-signed approval stored outside the repository.');
  return parsed;
}

const defaultIo = {
  lstat, realpath, access, readFile: path => readFile(path, 'utf8'),
  getuid: () => (typeof process.getuid === 'function' ? process.getuid() : -1)
};

export { sanitizedToolEnv };

// Deterministic, lockfile-only, script-free installation arguments. npm-created `.bin` links are kept (`--bin-links`):
// the Firebase CLI discovers the Functions SDK through functions/node_modules/.bin/firebase-functions. Those links are
// never trusted blindly: the post-install scan accepts only validated single-hop links inside node_modules/.bin.
export const INSTALL_ARGUMENTS = Object.freeze(['ci', '--ignore-scripts', '--bin-links', '--no-audit', '--no-fund']);

// Runs one tool. Firebase is started from the isolated package (cwd) using the tool installed in the repository
// (toolRoot); npm is only used to install the package's own dependencies without lifecycle scripts, inside the private
// npm sandbox (two distinct empty config files, private home and cache).
async function defaultRun(command, args, { cwd, toolRoot, npmSandbox }) {
  let executable; let executableArgs;
  if (command === 'firebase') {
    const packageDir = join(toolRoot, 'node_modules', 'firebase-tools');
    const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8').catch(() => {
      throw new ReleaseGuardError('firebase-tools is not installed here. Run npm ci first.');
    }));
    executable = process.execPath; executableArgs = [join(packageDir, manifest.bin.firebase), ...args];
  } else if (command === 'npm') {
    executable = 'npm'; executableArgs = args;
  } else {
    throw new ReleaseGuardError(`Refusing to run "${command}".`);
  }
  if (command === 'npm') await assertNpmSandbox(npmSandbox);
  const env = command === 'npm' ? npmInstallEnvironment(npmSandbox) : sanitizedToolEnv();
  const child = spawn(executable, executableArgs, { cwd, stdio: 'inherit', env });
  return new Promise((resolveExit, reject) => {
    child.on('error', reject);
    child.on('close', code => resolveExit(code ?? 1));
  });
}

const textOf = buffer => buffer.toString('utf8').trim();

// Entry point used by scripts/deploy-functions.mjs. Dry-run is the default: the Firebase CLI starts only with
// --execute, and only after every check below has passed. The dry-run performs the same verification and builds
// (then removes) the isolated package, so what it reports is what --execute would use.
export async function runFunctionsDeploy(argv, options = {}) {
  const {
    rootDir = resolve(fileURLToPath(new URL('..', import.meta.url))),
    run = defaultRun, log = console.log, io = defaultIo, now = () => new Date(), makeTempDir,
    // Test seams only: ambient roots for the trust-anchor location check, the reviewed in-package symlink list
    // (empty by default; external targets are never allowed) and a hook that runs between the last verification and the CLI.
    ambientRoots, allowedSymlinks = [], beforeCli = null
  } = options;
  const parsed = parseGuardArguments(argv);
  const realRoot = await io.realpath(rootDir);

  // 1. The Owner approval: an external file, never inside the repository.
  const approvalFile = resolve(parsed.approval);
  let realApproval;
  try { realApproval = await io.realpath(approvalFile); } catch { throw new ReleaseGuardError(`The release approval ${parsed.approval} does not exist.`); }
  try { assertOutside(realApproval, [realRoot], 'The release approval'); } catch (error) { throw new ReleaseGuardError(error.message); }
  let artifact;
  try { artifact = JSON.parse(await io.readFile(approvalFile)); } catch (error) { throw new ReleaseGuardError(`The release approval is not readable JSON: ${error.message}`); }

  // 2. Independently verifiable: pinned, root-owned trust anchor + signature over the exact payload.
  const trustedKeys = await loadTrustAnchor({ path: parsed.trustAnchor ? resolve(parsed.trustAnchor) : DEFAULT_TRUST_ANCHOR_PATH, forbiddenRoots: [realRoot], io, ...(ambientRoots ? { ambientRoots } : {}) });
  const payload = verifyApproval({ artifact, trustedKeys });

  // 3. The intended repository (sanitized Git environment, no alternates) and the approved source commit. Everything
  //    below is read from THAT commit, not from the working tree.
  const repository = await openRepository(realRoot);
  const { git, objectFormat } = repository;
  const source = await resolveSourceCommit(git, payload.sourceSha, objectFormat);
  const manifest = parseDeploymentManifestText(await readFromCommit(git, source.sha, 'config/deployment-manifest.json'));
  const functionSource = readFunctionSourceText(await readFromCommit(git, source.sha, 'functions/index.js'));
  assertPackageFirebaseConfig(await readFromCommit(git, source.sha, 'firebase.json'));
  const head = textOf(await git(['rev-parse', 'HEAD']));
  const dirty = textOf(await git(['status', '--porcelain', '--untracked-files=no'])) !== '';
  assertReleaseContract({
    manifest, contract: payload, environment: parsed.environment, project: parsed.project,
    git: { sha: head, tree: source.tree, dirty }, source: functionSource, now: now()
  });

  if (parsed.environment === 'prod' && parsed.execute && !parsed.confirmProduction) {
    throw new ReleaseGuardError('Deploying Production Functions requires --confirm-production.');
  }
  const args = buildScopedFirebaseArgs(payload);
  assertScopedFunctionsDeployArgs(args, payload);

  // 4. Immutable package from the approved tree (no working-tree files, no links), verified against that tree.
  const entries = await listSourceEntries(git, source.sha, { objectFormat, tree: source.tree });
  const packageRoot = await exportSourcePackage({ git, entries, objectFormat, makeTempDir });
  try {
    const identity = await capturePackageIdentity(packageRoot);
    const forbidden = { extraForbiddenFiles: [basename(realApproval)], allowedSymlinks, objectFormat };
    await verifyExportedPackage({ git, root: packageRoot, entries, ...forbidden });
    log(`Release ${payload.releaseId} (${parsed.environment}, ${payload.firebaseProjectId}): ${payload.functions.length} Functions, ${payload.exclusions.length} explicitly excluded.`);
    log(`Approved source commit ${source.sha} (tree ${source.tree}) verified; isolated package of ${entries.length} tracked files built from it. Approval signed by ${artifact.keyId}.`);
    log(`> ${['firebase', ...args].join(' ')}`);
    if (!parsed.execute) {
      log('Dry run: the Firebase CLI was not started and the isolated package was removed. Re-run with --execute to deploy.');
      return 0;
    }
    // npm gets a private sandbox: two DISTINCT empty config files (npm refuses one path in both roles), an empty home
    // and a private cache. Both config files exist before `npm ci` starts and are removed afterwards.
    const npmSandbox = await createNpmSandbox();
    let installed;
    try {
      await assertNpmSandbox(npmSandbox);
      installed = await run('npm', [...INSTALL_ARGUMENTS], { cwd: join(packageRoot, 'functions'), toolRoot: realRoot, npmSandbox });
    } finally {
      await disposeNpmSandbox(npmSandbox);
    }
    if (installed !== 0) throw new ReleaseGuardError(`Installing the isolated package dependencies failed with code ${installed}; nothing was deployed.`);
    // Post-install: the staging directory is the same one, the whole upload tree is scanned again (no link may leave
    // it, no unexpected file appeared, every approved file is byte-identical, the Firebase Functions SDK entry the CLI
    // needs is present and genuine) and the scan is repeated immediately before the CLI starts. A same-user actor can
    // still race the last instant; that window is narrowed, not removed.
    const installedChecks = { git, root: packageRoot, entries, ...forbidden, requireSdkEntry: true };
    await assertPackageIdentity(packageRoot, identity);
    await verifyInstalledPackage(installedChecks);
    if (typeof beforeCli === 'function') await beforeCli({ packageRoot });
    await assertPackageIdentity(packageRoot, identity);
    await verifyInstalledPackage(installedChecks);
    const code = await run('firebase', args, { cwd: packageRoot, toolRoot: realRoot });
    if (code !== 0) throw new ReleaseGuardError(`The Firebase CLI exited with code ${code}; nothing was verified as deployed.`);
    return 0;
  } finally {
    await disposePackage(packageRoot);
  }
}

export { ApprovalError, GitSandboxError, PackageIntegrityError };
