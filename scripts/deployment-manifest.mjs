import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Source-of-truth per-environment deployment allowlist (config/deployment-manifest.json). This module only reads
// and validates that file and computes CLI flag values from it; it never runs the Firebase CLI. Publishing
// Functions in particular needs one more step this module deliberately does not perform: a read-only enumeration
// of the project's LIVE deployed Functions, diffed against functionsAllowlist, before any `--only functions:...`
// invocation runs for real. That live-enumeration step requires cloud access and its own explicit authorization.
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

// The `--only functions:...` value for a real Firebase CLI publish. This is the only place that string is
// assembled; nothing in this repository is authorized to build an unscoped Firebase CLI deploy or a bare
// `--only functions` for this manifest's environments.
export function buildFunctionsOnlyFlag(manifest, name) {
  const names = functionsAllowlistFor(manifest, name);
  if (!names.length) throw new DeploymentManifestError(`Environment "${name}" has an empty functions allowlist; refusing to build a deploy flag.`);
  return names.map(fn => `functions:${fn}`).join(',');
}

export function assertNoLiveFunctionOutsideAllowlist(manifest, name, liveDeployedNames) {
  const allowed = new Set(functionsAllowlistFor(manifest, name));
  const unexpected = [...new Set(liveDeployedNames)].filter(fn => !allowed.has(fn));
  if (unexpected.length) {
    throw new DeploymentManifestError(
      `Environment "${name}" has live deployed Functions outside the manifest allowlist: ${unexpected.join(', ')}. ` +
      'Resolve this (update the manifest deliberately, or investigate the drift) before deploying.'
    );
  }
  return { allowlisted: [...allowed], live: [...new Set(liveDeployedNames)], unexpected };
}

export async function validateManifestAgainstSource(rootDir, manifest) {
  const indexSource = await readFile(join(rootDir, 'functions', 'index.js'), 'utf8');
  const sourceExports = [...indexSource.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=/gm)].map(match => match[1]).sort();

  const problems = [];
  for (const name of ENVIRONMENTS) {
    const env = manifest.environments[name];
    const allow = new Set(env.functionsAllowlist);
    const never = new Set(neverDeployNames(env));
    const overlap = [...allow].filter(fn => never.has(fn));
    if (overlap.length) problems.push(`${name}: functionsAllowlist and functionsNeverDeploy overlap: ${overlap.join(', ')}`);

    const union = new Set([...allow, ...never]);
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
