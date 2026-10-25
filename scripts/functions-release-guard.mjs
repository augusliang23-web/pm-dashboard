// Fail-closed guard for repository-managed Cloud Functions releases.
//
// Why this exists: S02 R2 was authorised for 24 callable Functions, but an unscoped
// a Firebase CLI deploy with a bare `--only functions` scope updated all 25 managed Functions, including the scheduled
// aggregatePresenceSessions (and moved 13 Functions from Node 20 to 22). The deployment manifest already says
// "never an unscoped deployment", but nothing enforced it.
//
// Model: config/deployment-manifest.json says which Functions an environment is ELIGIBLE to deploy (allowlist).
// It is NOT authorisation. A release contract (config/release-contracts/*.json, committed and reviewed) names the
// exact Functions this ONE release may update. This module refuses unless the contract, the manifest, the Firebase
// project, the source SHA and the generated command all agree, and it only ever generates
//   deploy --only functions:a,functions:b,... --project <id> --message <text>   (arguments to the Firebase CLI)
//
// LIMITATION (by design, cannot be fixed in a wrapper): nothing here can stop someone from running the Firebase CLI
// directly. This is a guard for repository-managed releases and a reviewable approval record, not a sandbox.
// Nothing in this module starts the Firebase CLI unless the wrapper is run with --execute; tests inject a mock runner.
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ENVIRONMENTS, functionsAllowlistFor, functionsPreservedFor, loadDeploymentManifest } from './deployment-manifest.mjs';

const execFileAsync = promisify(execFile);

export class ReleaseGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseGuardError';
  }
}

export const CONTRACT_DIRECTORY = join('config', 'release-contracts');
export const CONTRACT_KEYS = Object.freeze([
  'contractVersion', 'releaseId', 'environment', 'firebaseProjectId', 'sourceSha', 'functions',
  'expectedFunctionCount', 'exclusions', 'scheduledFunctionsApproved', 'authorizationRef'
]);
const FUNCTION_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

function neverDeployNames(environment) {
  return Object.values(environment.functionsNeverDeploy || {}).flat();
}

// Exported Function names and which of them are scheduled, read statically from the Functions entry point.
export async function readFunctionSource(rootDir) {
  const source = await readFile(join(rootDir, 'functions', 'index.js'), 'utf8');
  const exported = [...source.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=/gm)].map(match => match[1]);
  const scheduled = [...source.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=\s*onSchedule\(/gm)].map(match => match[1]);
  return { exported: new Set(exported), scheduled: new Set(scheduled) };
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStringList = value => Array.isArray(value) && value.every(item => typeof item === 'string');

// Pure validation. Returns the contract when every rule holds; otherwise throws one error listing every problem.
export function assertReleaseContract({ manifest, contract, environment, project, git, source }) {
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

  if (contract.contractVersion !== 1) problem('contractVersion must be 1');
  if (typeof contract.releaseId !== 'string' || !RELEASE_ID.test(contract.releaseId)) problem('releaseId must be 3-64 characters of [A-Za-z0-9._-]');
  if (typeof contract.authorizationRef !== 'string' || !contract.authorizationRef.trim()) problem('authorizationRef (a reference to the Owner authorisation for THIS release) is required; the manifest allowlist is eligibility, not authorisation');

  const manifestEnvironment = manifest.environments?.[environment];
  if (!manifestEnvironment) problem(`the manifest has no environment "${environment}"`);
  if (contract.environment !== environment) problem(`contract environment "${contract.environment}" differs from the requested environment "${environment}"`);
  if (manifestEnvironment) {
    if (contract.firebaseProjectId !== manifestEnvironment.firebaseProjectId) problem(`contract project "${contract.firebaseProjectId}" is not the ${environment} project "${manifestEnvironment.firebaseProjectId}"`);
    if (project !== manifestEnvironment.firebaseProjectId) problem(`--project "${project}" is not the ${environment} project "${manifestEnvironment.firebaseProjectId}"`);
  }
  if (contract.firebaseProjectId !== project) problem(`contract project "${contract.firebaseProjectId}" differs from --project "${project}"`);

  if (typeof contract.sourceSha !== 'string' || !FULL_SHA.test(contract.sourceSha)) problem('sourceSha must be a full 40-character lowercase SHA');
  else if (git?.sha !== contract.sourceSha) problem(`contract sourceSha ${contract.sourceSha} is not the checked-out HEAD ${git?.sha || 'unknown'}`);
  if (git?.dirty !== false) problem('the working tree has uncommitted tracked changes (or its state is unknown)');

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
  if (problems.length) throw new ReleaseGuardError(`Unsafe Firebase CLI command rejected:${problems.join('; ')}.`);
  return { only: selected, project, message };
}

export function parseGuardArguments(argv) {
  const args = [...argv];
  const parsed = { environment: '', project: '', contract: '', execute: false, confirmProduction: false };
  const value = flag => {
    const next = args.shift();
    if (!next || next.startsWith('-')) throw new ReleaseGuardError(`${flag} requires a value.`);
    return next;
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--env') parsed.environment = value(flag);
    else if (flag === '--project') parsed.project = value(flag);
    else if (flag === '--contract') parsed.contract = value(flag);
    else if (flag === '--execute') parsed.execute = true;
    else if (flag === '--confirm-production') parsed.confirmProduction = true;
    else throw new ReleaseGuardError(`Unsupported argument "${flag}". Usage: node scripts/deploy-functions.mjs --env <${ENVIRONMENTS.join('|')}> --project <firebase-project-id> --contract <config/release-contracts/file.json> [--execute] [--confirm-production]. The wrapper never accepts --only, --force or any raw Firebase flag.`);
  }
  if (!parsed.environment) throw new ReleaseGuardError('--env is required.');
  if (!parsed.project) throw new ReleaseGuardError('--project is required (the Firebase project is never inferred).');
  if (!parsed.contract) throw new ReleaseGuardError('--contract is required: a Functions release needs a reviewed release contract.');
  return parsed;
}

async function defaultGetGitState(rootDir, contractPath) {
  const options = { cwd: rootDir };
  const status = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=no'], options);
  const head = await execFileAsync('git', ['rev-parse', 'HEAD'], options);
  const tracked = await execFileAsync('git', ['ls-files', '--error-unmatch', '--', contractPath], options).then(() => true, () => false);
  return { dirty: status.stdout.trim() !== '', sha: head.stdout.trim(), contractTracked: tracked };
}

async function defaultRun(command, args, { cwd }) {
  const packageDir = join(cwd, 'node_modules', `${command}-tools`);
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8').catch(() => {
    throw new ReleaseGuardError(`${command}-tools is not installed here. Run npm ci first.`);
  }));
  const child = spawn(process.execPath, [join(packageDir, manifest.bin[command]), ...args], { cwd, stdio: 'inherit' });
  return new Promise((resolveExit, reject) => {
    child.on('error', reject);
    child.on('close', code => resolveExit(code ?? 1));
  });
}

// Entry point used by scripts/deploy-functions.mjs. Dry-run is the default: the Firebase CLI starts only with
// --execute, and only after every check above has passed.
export async function runFunctionsDeploy(argv, options = {}) {
  const {
    rootDir = resolve(fileURLToPath(new URL('..', import.meta.url))),
    run = defaultRun, log = console.log, getGitState = defaultGetGitState
  } = options;
  const parsed = parseGuardArguments(argv);

  const contractFile = resolve(rootDir, parsed.contract);
  const relativePath = relative(resolve(rootDir, CONTRACT_DIRECTORY), contractFile);
  if (!relativePath || relativePath.startsWith('..') || relativePath.includes(`..${sep}`) || !contractFile.endsWith('.json')) {
    throw new ReleaseGuardError(`The release contract must be a committed .json file under ${CONTRACT_DIRECTORY}/.`);
  }
  let contract;
  try {
    contract = JSON.parse(await readFile(contractFile, 'utf8'));
  } catch (error) {
    throw new ReleaseGuardError(`Could not read the release contract ${parsed.contract}: ${error.message}`);
  }

  const manifest = await loadDeploymentManifest(rootDir);
  const git = await getGitState(rootDir, relative(rootDir, contractFile));
  if (git.contractTracked !== true) throw new ReleaseGuardError('The release contract is not a tracked (committed) file; a release approval must be reviewable in git.');
  const source = await readFunctionSource(rootDir);
  assertReleaseContract({ manifest, contract, environment: parsed.environment, project: parsed.project, git, source });

  if (parsed.environment === 'prod' && parsed.execute && !parsed.confirmProduction) {
    throw new ReleaseGuardError('Deploying Production Functions requires --confirm-production.');
  }
  const args = buildScopedFirebaseArgs(contract);
  assertScopedFunctionsDeployArgs(args, contract);
  log(`Release ${contract.releaseId} (${parsed.environment}, ${contract.firebaseProjectId}): ${contract.functions.length} Functions, ${contract.exclusions.length} explicitly excluded.`);
  log(`> ${['firebase', ...args].join(' ')}`);
  if (!parsed.execute) {
    log('Dry run: the Firebase CLI was not started. Re-run with --execute to deploy.');
    return 0;
  }
  const code = await run('firebase', args, { cwd: rootDir });
  if (code !== 0) throw new ReleaseGuardError(`The Firebase CLI exited with code ${code}; nothing was verified as deployed.`);
  return 0;
}
