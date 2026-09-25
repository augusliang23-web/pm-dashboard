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
  if (problems.length) throw new DeploymentManifestError(`Deployment manifest is inconsistent with source:\n- ${problems.join('\n- ')}`);
  return true;
}
