import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Source-of-truth per-environment Function policy. This module only reads and validates the manifest and computes
// CLI flag values; it never runs Firebase CLI. A separately authorized deployment must first enumerate live
// Functions, then classify them as managed, preserved, forbidden, or unknown with the validator below.
export class DeploymentManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeploymentManifestError';
  }
}

export const ENVIRONMENTS = Object.freeze(['prod', 'uat']);

export async function loadDeploymentManifest(rootDir) {
  const manifest = JSON.parse(await readFile(join(rootDir, 'config', 'deployment-manifest.json'), 'utf8'));
  if (manifest.version !== 1) throw new DeploymentManifestError(`Unsupported deployment manifest version ${manifest.version}.`);
  for (const name of ENVIRONMENTS) {
    if (!manifest.environments?.[name]) throw new DeploymentManifestError(`Deployment manifest is missing environment "${name}".`);
  }
  return manifest;
}

function neverDeployNames(env) {
  return Object.values(env.functionsNeverDeploy || {}).flat();
}

// The exact, sorted set of function names this environment may ever deploy, and nothing else.
export function functionsAllowlistFor(manifest, name) {
  const env = manifest.environments[name];
  if (!env) throw new DeploymentManifestError(`Unknown environment "${name}".`);
  return [...env.functionsAllowlist].sort();
}

export function functionsPreservedFor(manifest, name) {
  const env = manifest.environments[name];
  if (!env) throw new DeploymentManifestError(`Unknown environment "${name}".`);
  return [...env.functionsPreserveExisting].sort();
}

// The `--only functions:...` value for a real Firebase CLI publish. This is the only place that string is
// assembled; nothing in this repository is authorized to build an unscoped Firebase CLI deploy or a bare
// `--only functions` for this manifest's environments.
export function buildFunctionsOnlyFlag(manifest, name, requestedNames = functionsAllowlistFor(manifest, name)) {
  const managed = new Set(functionsAllowlistFor(manifest, name));
  const names = [...new Set(requestedNames)];
  if (!names.length) throw new DeploymentManifestError(`Environment "${name}" has an empty functions allowlist; refusing to build a deploy flag.`);
  const disallowed = names.filter(fn => !managed.has(fn));
  if (disallowed.length) throw new DeploymentManifestError(`Environment "${name}" cannot deploy non-managed Functions: ${disallowed.join(', ')}.`);
  return names.map(fn => `functions:${fn}`).join(',');
}

export function assertLiveFunctionInventory(manifest, name, liveDeployedNames) {
  const managed = new Set(functionsAllowlistFor(manifest, name));
  const preserved = new Set(functionsPreservedFor(manifest, name));
  const forbidden = new Set(neverDeployNames(manifest.environments[name]));
  const live = [...new Set(liveDeployedNames)];
  const forbiddenLive = live.filter(fn => forbidden.has(fn));
  const unknownLive = live.filter(fn => !managed.has(fn) && !preserved.has(fn) && !forbidden.has(fn));
  if (forbiddenLive.length || unknownLive.length) {
    throw new DeploymentManifestError(
      `Environment "${name}" has forbidden live Functions: ${forbiddenLive.join(', ') || 'none'}; ` +
      `unknown live Functions: ${unknownLive.join(', ') || 'none'}. Investigate before deploying.`
    );
  }
  return {
    allowlisted: [...managed], live, managed: live.filter(fn => managed.has(fn)),
    preserved: live.filter(fn => preserved.has(fn)), unexpected: []
  };
}

// Retain the original read-only validation entry point for existing callers.
export const assertNoLiveFunctionOutsideAllowlist = assertLiveFunctionInventory;

// ── Reviewed release plans (manifest.releases) ────────────────────────────────────────────────────────────────
// A release names the exact subset of an environment's managed Functions it may deploy, the dedicated runtime
// identity of each, and the inventory it must leave behind. Everything here is a pure check; nothing deploys.
export function releaseFor(manifest, id) {
  const release = manifest.releases?.[id];
  if (!release) throw new DeploymentManifestError(`Unknown release "${id}".`);
  if (!manifest.environments[release.environment]) throw new DeploymentManifestError(`Release "${id}" names an unknown environment.`);
  return release;
}

export function assertReleasePlan(manifest, id) {
  const release = releaseFor(manifest, id);
  const env = manifest.environments[release.environment];
  const managed = new Set(env.functionsAllowlist);
  const preserved = new Set(env.functionsPreserveExisting);
  const forbidden = new Set(neverDeployNames(env));
  const problems = [];
  const names = release.functions;
  if (!Array.isArray(names) || !names.length) problems.push('functions must be a non-empty array');
  else {
    if (new Set(names).size !== names.length) problems.push('functions contains duplicates');
    for (const fn of names) {
      if (!/^[A-Za-z0-9_]+$/.test(fn)) problems.push(`"${fn}" is not a plain Function name (no wildcards or scopes)`);
      if (!managed.has(fn)) problems.push(`"${fn}" is not a managed ${release.environment} Function`);
      if (preserved.has(fn)) problems.push(`"${fn}" is a preserved Function and may not be deployed`);
      if (forbidden.has(fn)) problems.push(`"${fn}" is forbidden in ${release.environment}`);
      if ((release.untouchedManagedFunctions || []).includes(fn)) problems.push(`"${fn}" is declared untouched by this release`);
    }
    const accounts = release.runtimeServiceAccounts || {};
    for (const fn of names) if (!accounts[fn]) problems.push(`"${fn}" has no dedicated runtime service account`);
    for (const fn of Object.keys(accounts)) if (!names.includes(fn)) problems.push(`runtime service account listed for non-release Function "${fn}"`);
    const values = Object.values(accounts);
    if (new Set(values).size !== values.length) problems.push('runtime service accounts must be unique per Function');
    for (const account of values) if (!/^pmdash-[a-z0-9-]+$/.test(account)) problems.push(`"${account}" is not a pmdash-* identity`);
    for (const fn of release.newFunctions || []) if (!names.includes(fn)) problems.push(`new Function "${fn}" is not in the release`);
  }
  // The exact least-privilege role is pinned by tests/production-promotion-v2.test.mjs; here only broad roles are refused.
  if (typeof release.serviceAccountProjectRole !== 'string' || /(owner|editor|admin|iam)/i.test(release.serviceAccountProjectRole)) problems.push('runtime identities may hold one least-privilege Firestore role only');
  if (release.serviceAccountMaxUserManagedKeys !== 0) problems.push('runtime identities may have zero user-managed keys');
  if (release.targetRuntime !== 'nodejs22') problems.push('target runtime must be nodejs22');
  const baselineTotal = release.baseline.liveFunctionCount;
  const expectedTotal = baselineTotal + (release.newFunctions || []).length;
  const post = release.postRelease;
  if (post.liveFunctionCount !== expectedTotal) problems.push(`post-release total must be baseline ${baselineTotal} + new ${(release.newFunctions || []).length} = ${expectedTotal}`);
  if (post.managed + post.preserved !== post.liveFunctionCount) problems.push('post-release managed + preserved must equal the total');
  if (post.managed !== env.functionsAllowlist.length) problems.push('post-release managed count must equal the environment allowlist size');
  if (post.preserved !== preserved.size) problems.push('post-release preserved count must equal the preserved list size');
  if (release.baseline.liveManaged + (release.newFunctions || []).length !== post.managed) problems.push('baseline managed + new Functions must equal post-release managed');
  if (problems.length) throw new DeploymentManifestError(`Release "${id}" is invalid:\n- ${problems.join('\n- ')}`);
  return release;
}

// The `--only` value for a release: exactly its reviewed subset, each Function named individually.
export function buildReleaseFunctionsOnlyFlag(manifest, id) {
  const release = assertReleasePlan(manifest, id);
  return buildFunctionsOnlyFlag(manifest, release.environment, release.functions);
}

// Run after the release: the live inventory must be exactly the planned total, all known, with preserved intact.
export function assertPostReleaseInventory(manifest, id, liveDeployedNames) {
  const release = assertReleasePlan(manifest, id);
  const result = assertLiveFunctionInventory(manifest, release.environment, liveDeployedNames);
  const problems = [];
  if (result.live.length !== release.postRelease.liveFunctionCount) problems.push(`expected ${release.postRelease.liveFunctionCount} live Functions, found ${result.live.length}`);
  if (result.managed.length !== release.postRelease.managed) problems.push(`expected ${release.postRelease.managed} managed, found ${result.managed.length}`);
  if (result.preserved.length !== release.postRelease.preserved) problems.push(`expected ${release.postRelease.preserved} preserved, found ${result.preserved.length}`);
  for (const fn of release.functions) if (!result.live.includes(fn)) problems.push(`release Function "${fn}" is not live`);
  if (problems.length) throw new DeploymentManifestError(`Post-release inventory for "${id}" is wrong:\n- ${problems.join('\n- ')}`);
  return result;
}

// Snapshot shape: { [functionName]: { runtime, revision, serviceAccount, invoker, updateTime } } read from the live project.
const SNAPSHOT_FIELDS = ['runtime', 'revision', 'serviceAccount', 'invoker', 'updateTime'];
function snapshotDifferences(before, after, names) {
  const differences = [];
  for (const fn of names) {
    if (!before[fn] || !after[fn]) { differences.push(`${fn}: missing from ${before[fn] ? 'the after' : 'the before'} snapshot`); continue; }
    for (const field of SNAPSHOT_FIELDS) if (before[fn][field] !== after[fn][field]) differences.push(`${fn}.${field}: ${before[fn][field]} -> ${after[fn][field]}`);
  }
  return differences;
}

// The Executive Functions (preserved) must be byte-for-byte unchanged by a Core release: revision, runtime, service
// account, invoker and update time. Any difference, or a missing Function, is a failure.
export function assertPreservedFunctionsUnchanged(manifest, environment, before, after) {
  const differences = snapshotDifferences(before, after, functionsPreservedFor(manifest, environment));
  if (differences.length) throw new DeploymentManifestError(`Preserved Functions changed:\n- ${differences.join('\n- ')}`);
  return true;
}

// Every live Function outside the release (managed or preserved) must be unchanged after the release.
export function assertNonSelectedUnchanged(manifest, id, before, after) {
  const release = assertReleasePlan(manifest, id);
  const selected = new Set(release.functions);
  const names = Object.keys(before).filter(fn => !selected.has(fn));
  const differences = snapshotDifferences(before, after, names);
  for (const fn of Object.keys(after)) if (!selected.has(fn) && !before[fn]) differences.push(`${fn}: appeared during the release`);
  if (differences.length) throw new DeploymentManifestError(`Non-selected Functions changed:\n- ${differences.join('\n- ')}`);
  return true;
}

// Dedicated runtime identities declared in source: { functionName: 'pmdash-...' }.
export async function readSourceServiceAccounts(rootDir) {
  const found = {};
  for (const file of ['project-dashboard-writes.js', 'user-permissions.js']) {
    const text = await readFile(join(rootDir, 'functions', file), 'utf8');
    for (const match of text.matchAll(/^const (\w+) = (?:dashboardOnCall\('([a-z0-9-]+)@'|onCall\(\{ serviceAccount: '([a-z0-9-]+)@' \})/gm)) {
      found[match[1]] = match[2] || match[3];
    }
  }
  return found;
}

export async function validateManifestAgainstSource(rootDir, manifest) {
  const indexSource = await readFile(join(rootDir, 'functions', 'index.js'), 'utf8');
  const sourceExports = [...indexSource.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=/gm)].map(match => match[1]).sort();

  const problems = [];
  for (const name of ENVIRONMENTS) {
    const env = manifest.environments[name];
    const categories = [
      ['managed', env.functionsAllowlist],
      ['preserved', env.functionsPreserveExisting],
      ['forbidden', neverDeployNames(env)]
    ];
    for (const [label, names] of categories) {
      if (!Array.isArray(names)) {
        problems.push(`${name}: ${label} Function list must be an array.`);
      } else if (new Set(names).size !== names.length) {
        problems.push(`${name}: ${label} Function list contains duplicate names.`);
      }
    }
    if (categories.some(([, names]) => !Array.isArray(names))) continue;
    const allNames = categories.flatMap(([, names]) => names);
    const overlaps = [...new Set(allNames)].filter(fn => allNames.filter(item => item === fn).length > 1);
    if (overlaps.length) problems.push(`${name}: Function policy categories overlap: ${overlaps.join(', ')}`);

    const union = new Set(allNames);
    const missing = sourceExports.filter(fn => !union.has(fn));
    const extra = [...union].filter(fn => !sourceExports.includes(fn));
    if (missing.length) problems.push(`${name}: functions/index.js exports not covered by the manifest: ${missing.join(', ')}`);
    if (extra.length) problems.push(`${name}: manifest names functions that do not exist in functions/index.js: ${extra.join(', ')}`);

    const hostingTargets = (await import('./hosting-env.mjs')).HOSTING_TARGETS;
    if (hostingTargets[env.hostingTarget] !== env.firebaseProjectId) {
      problems.push(`${name}: hostingTarget "${env.hostingTarget}" resolves to a different Firebase project than firebaseProjectId.`);
    }
  }
  const sourceAccounts = await readSourceServiceAccounts(rootDir);
  for (const id of Object.keys(manifest.releases || {})) {
    try {
      const release = assertReleasePlan(manifest, id);
      for (const fn of release.functions) {
        if (sourceAccounts[fn] !== release.runtimeServiceAccounts[fn]) {
          problems.push(`release ${id}: ${fn} declares runtime identity "${sourceAccounts[fn]}" in source but "${release.runtimeServiceAccounts[fn]}" in the plan`);
        }
        if (!sourceExports.includes(fn)) problems.push(`release ${id}: ${fn} does not exist in functions/index.js`);
      }
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (problems.length) throw new DeploymentManifestError(`Deployment manifest is inconsistent with source:\n- ${problems.join('\n- ')}`);
  return true;
}
