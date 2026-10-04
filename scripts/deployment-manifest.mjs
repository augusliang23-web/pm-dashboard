import { createHash } from 'node:crypto';
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

// SHA-256 of the single approved runtime-identity project role (verified against the exact string by the tests).
const APPROVED_RUNTIME_ROLE_SHA256 = '75b21ab9fc1e4613ec9d8f0baf313188a5c410a412fb49cfbd246a3ebb289ae6';

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
  // Exactly one project role is approved for the runtime identities. It is compared by SHA-256 digest (anchored
  // equality on the whole string, no coercion) so this surface never declares a datastore role literal, which the
  // sync-boundary policy reserves for its own structured policy. Any other value, type or spelling is refused.
  if (typeof release.serviceAccountProjectRole !== 'string'
    || createHash('sha256').update(release.serviceAccountProjectRole).digest('hex') !== APPROVED_RUNTIME_ROLE_SHA256) {
    problems.push('runtime identities may hold exactly the one approved Firestore project role');
  }
  if (release.serviceAccountMaxUserManagedKeys !== 0) problems.push('runtime identities may have zero user-managed keys');
  if (release.targetRuntime !== 'nodejs22') problems.push('target runtime must be nodejs22');
  // Baseline inventory arithmetic is derived from policy, with strict integers (no string coercion).
  const base = release.baseline || {};
  const isCount = value => Number.isInteger(value) && value >= 0;
  for (const key of ['liveFunctionCount', 'liveManaged', 'livePreserved']) if (!isCount(base[key])) problems.push(`baseline.${key} must be a non-negative integer`);
  if (isCount(base.livePreserved) && base.livePreserved !== preserved.size) problems.push(`baseline.livePreserved must equal the preserved list size (${preserved.size})`);
  const expectedLiveManaged = managed.size - (release.newFunctions || []).length;
  if (isCount(base.liveManaged) && base.liveManaged !== expectedLiveManaged) problems.push(`baseline.liveManaged must equal managed minus new Functions (${expectedLiveManaged})`);
  if (isCount(base.liveFunctionCount) && isCount(base.liveManaged) && isCount(base.livePreserved) && base.liveFunctionCount !== base.liveManaged + base.livePreserved) {
    problems.push('baseline.liveFunctionCount must equal liveManaged + livePreserved');
  }
  const baselineTotal = release.baseline.liveFunctionCount;
  const expectedTotal = baselineTotal + (release.newFunctions || []).length;
  const post = release.postRelease;
  for (const key of ['liveFunctionCount', 'managed', 'preserved']) if (!isCount(post?.[key])) problems.push(`postRelease.${key} must be a non-negative integer`);
  if (post.liveFunctionCount !== expectedTotal) problems.push(`post-release total must be baseline ${baselineTotal} + new ${(release.newFunctions || []).length} = ${expectedTotal}`);
  if (post.managed + post.preserved !== post.liveFunctionCount) problems.push('post-release managed + preserved must equal the total');
  if (post.managed !== env.functionsAllowlist.length) problems.push('post-release managed count must equal the environment allowlist size');
  if (post.preserved !== preserved.size) problems.push('post-release preserved count must equal the preserved list size');
  if (release.baseline.liveManaged + (release.newFunctions || []).length !== post.managed) problems.push('baseline managed + new Functions must equal post-release managed');
  // Critical safety metadata is validated at runtime, not only pinned by tests.
  if (!/^[0-9a-f]{40}$/.test(release.runtimeTargetSourceSha || '')) problems.push('runtimeTargetSourceSha must be a full 40-character commit SHA');
  if (release.environment !== 'prod') problems.push('this release plan must target the prod environment');
  if (release.rulesDeployRequired !== true) problems.push('rulesDeployRequired must be true');
  if (release.rulesFile !== env.firestoreRulesFile || release.rulesFile !== 'firestore.rules') problems.push('rulesFile must be the Production firestore.rules');
  if (release.hostingDeployRequired !== true) problems.push('hostingDeployRequired must be true');
  const pages = release.productionPages || {};
  if (pages.separateReleaseSurface !== true) problems.push('Production Pages must be a separate release surface');
  const prerequisites = ['functions', 'rules', 'hosting', 'authenticatedSmoke'];
  if (!Array.isArray(pages.mergeOnlyAfter) || prerequisites.some(item => !pages.mergeOnlyAfter.includes(item)) || pages.mergeOnlyAfter.length !== prerequisites.length) {
    problems.push(`Production Pages may merge only after: ${prerequisites.join(', ')}`);
  }
  const contract = release.runtimeTargetSecurityContracts?.saveDashboardProject;
  if (!names.includes('saveDashboardProject') || contract?.visibilityRefusalReason !== 'visibility-admin-only' || !Array.isArray(contract?.rules) || contract.rules.length < 4) {
    problems.push('the runtime target security contract for saveDashboardProject (Admin-only visibility) must be pinned');
  }
  if (!Array.isArray(release.runtimeTargetIncludedPullRequests) || !release.runtimeTargetIncludedPullRequests.includes(42)) problems.push('the runtime target must record that it includes PR #42');
  const untouched = release.untouchedManagedFunctions || [];
  for (const fn of untouched) if (!managed.has(fn)) problems.push(`untouched Function "${fn}" is not managed`);
  const rollback = release.rollbackBaseline || {};
  if (rollback.fullRollbackMethod !== 'PINNED_BASELINE_SOURCE_PLUS_CONFIG_REDEPLOYMENT') problems.push('full rollback must be PINNED_BASELINE_SOURCE_PLUS_CONFIG_REDEPLOYMENT');
  if (rollback.trafficShiftClassification !== 'EMERGENCY_MITIGATION_ONLY') problems.push('traffic shifting must be classified EMERGENCY_MITIGATION_ONLY');
  if (!/^[0-9a-f]{40}$/.test(rollback.sourceCommit || '')) problems.push('rollbackBaseline.sourceCommit must be a full commit SHA');
  for (const key of ['sourceTreeDigest', 'sourceZipSha256']) if (!/^[0-9a-f]{64}$/.test(rollback[key] || '')) problems.push(`rollbackBaseline.${key} must be a SHA-256`);
  const existingNames = (names || []).filter(fn => !(release.newFunctions || []).includes(fn));
  for (const fn of existingNames) {
    if (!/^\d+$/.test(rollback.sourceGenerations?.[fn] || '')) problems.push(`rollbackBaseline.sourceGenerations is missing "${fn}"`);
    if (!release.baseline.priorRevisions?.[fn]) problems.push(`baseline.priorRevisions is missing "${fn}"`);
  }
  for (const fn of Object.keys(rollback.sourceGenerations || {})) if (!existingNames.includes(fn)) problems.push(`rollbackBaseline.sourceGenerations names non-release Function "${fn}"`);
  const baselineConfig = rollback.config || {};
  for (const field of CONFIG_FIELDS) if (!SNAPSHOT_VALIDATORS[field](baselineConfig[field])) problems.push(`rollbackBaseline.config.${field} must be an explicit normalized value`);
  for (const field of ['runtime', 'serviceAccount', 'invoker', 'generation']) if (!SNAPSHOT_VALIDATORS[field](rollback[field])) problems.push(`rollbackBaseline.${field} must be an explicit normalized value`);
  const target = release.targetConfiguration || {};
  for (const field of ['runtime', 'invoker', 'generation', ...CONFIG_FIELDS]) {
    const value = CONFIG_FIELDS.includes(field) ? target.config?.[field] : target[field];
    if (!SNAPSHOT_VALIDATORS[field](value)) problems.push(`targetConfiguration.${field} must be an explicit normalized value`);
  }
  if (target.runtime !== release.targetRuntime) problems.push('targetConfiguration.runtime must equal the target runtime');
  const review = release.executionFreeze?.reviewedReleasePlan;
  if (!review || review.recordedOutsideRepository !== true || review.freezeMustEqualReviewedSha !== true
    || JSON.stringify(review.safetyCriticalFiles) !== JSON.stringify(SAFETY_CRITICAL_PLAN_FILES)) {
    problems.push('executionFreeze.reviewedReleasePlan must require an externally recorded reviewed SHA/digest equal to the freeze, over the exact safety-critical files');
  }
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

// ── Live-state snapshots (fail-closed) ───────────────────────────────────────────────────────────────────────
// A snapshot is { [functionName]: record } read from the live project. Evidence is only accepted when it is COMPLETE:
// the exact expected Function set is present (derived from the manifest, never from the snapshot's own keys) and every
// record carries EVERY field below with a normalized explicit value. Nothing is inferred from absence: a field that is
// legitimately empty in GCP output must be modelled as an explicit token (for example invoker "none"), never as a
// missing property, and a missing or malformed field is a failure. Two missing-or-empty records never compare equal.
//
// Authoritative read-back sources (see the runbook, "Snapshot capture"): the Cloud Functions API describe of the Gen 2
// Function (`runtime`, `generation`, `updateTime`) and the Cloud Run service that backs it (serving revision, runtime
// identity, resources, timeout, concurrency, max instances, ingress, traffic allocation, and the invoker IAM policy).
export const IDENTITY_FIELDS = Object.freeze(['runtime', 'revision', 'serviceAccount', 'invoker', 'updateTime']);
export const CONFIG_FIELDS = Object.freeze(['memory', 'cpu', 'timeoutSeconds', 'maxInstanceRequestConcurrency', 'maxInstanceCount', 'ingress']);
export const SERVING_FIELDS = Object.freeze(['generation', 'trafficRevision', 'trafficPercent']);
export const SNAPSHOT_FIELDS = Object.freeze([...IDENTITY_FIELDS, ...CONFIG_FIELDS, ...SERVING_FIELDS]);

const isString = value => typeof value === 'string';
const isPositiveInteger = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
export const INGRESS_VALUES = Object.freeze(['ALLOW_ALL', 'ALLOW_INTERNAL_ONLY', 'ALLOW_INTERNAL_AND_GCLB']);
const SNAPSHOT_VALIDATORS = Object.freeze({
  runtime: value => isString(value) && /^nodejs\d+$/.test(value),
  revision: value => isString(value) && /^[a-z0-9][a-z0-9-]*$/.test(value),
  serviceAccount: value => isString(value) && /^[A-Za-z0-9][A-Za-z0-9@._-]*$/.test(value),
  invoker: value => isString(value) && /^[A-Za-z][A-Za-z0-9-]*$/.test(value),
  updateTime: value => isString(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)),
  // Normalized Cloud Run quantities: memory as Mi/Gi ("256Mi"), CPU as a decimal string ("1"); never "256M" or 1.
  memory: value => isString(value) && /^[1-9]\d*(Mi|Gi)$/.test(value),
  cpu: value => isString(value) && /^(0\.\d+|[1-9]\d*(\.\d+)?)$/.test(value),
  timeoutSeconds: isPositiveInteger,
  maxInstanceRequestConcurrency: isPositiveInteger,
  maxInstanceCount: isPositiveInteger,
  ingress: value => INGRESS_VALUES.includes(value),
  generation: value => value === 'GEN_2',
  trafficRevision: value => isString(value) && /^[a-z0-9][a-z0-9-]*$/.test(value),
  trafficPercent: value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100,
});

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Names that must be live before the release: managed MINUS the release's new Functions, PLUS preserved.
export function expectedBeforeNames(manifest, id) {
  const release = assertReleasePlan(manifest, id);
  const env = manifest.environments[release.environment];
  const added = new Set(release.newFunctions || []);
  return [...env.functionsAllowlist.filter(fn => !added.has(fn)), ...env.functionsPreserveExisting].sort();
}

// Names that must be live after the release: every managed Function plus every preserved Function.
export function expectedAfterNames(manifest, id) {
  const release = assertReleasePlan(manifest, id);
  const env = manifest.environments[release.environment];
  return [...env.functionsAllowlist, ...env.functionsPreserveExisting].sort();
}

export function assertSnapshotComplete(manifest, id, snapshot, phase) {
  if (!['before', 'after'].includes(phase)) throw new DeploymentManifestError(`Unknown snapshot phase "${phase}".`);
  const label = `${phase} snapshot`;
  if (!isPlainRecord(snapshot)) throw new DeploymentManifestError(`The ${label} must be an object keyed by Function name.`);
  const release = releaseFor(manifest, id);
  const env = manifest.environments[release.environment];
  const expected = phase === 'before' ? expectedBeforeNames(manifest, id) : expectedAfterNames(manifest, id);
  const present = Object.keys(snapshot);
  const forbidden = new Set(neverDeployNames(env));
  const problems = [];
  for (const fn of expected) if (!present.includes(fn)) problems.push(`${fn}: missing from the ${label}`);
  for (const fn of present) {
    if (expected.includes(fn)) continue;
    problems.push(`${fn}: ${forbidden.has(fn) ? 'forbidden UAT-only' : 'unexpected'} Function in the ${label}`);
  }
  for (const fn of expected) {
    if (!(fn in snapshot)) continue;
    const record = snapshot[fn];
    if (!isPlainRecord(record)) { problems.push(`${fn}: malformed record in the ${label}`); continue; }
    for (const field of SNAPSHOT_FIELDS) {
      const value = record[field];
      if (!Object.hasOwn(record, field)) problems.push(`${fn}.${field}: missing from the ${label}`);
      else if (!SNAPSHOT_VALIDATORS[field](value)) problems.push(`${fn}.${field}: invalid value in the ${label}`);
    }
    // Serving state is evidence only when the latest ready revision carries 100% of traffic.
    if (SNAPSHOT_FIELDS.every(field => Object.hasOwn(record, field)) && !problems.some(problem => problem.startsWith(`${fn}.`))) {
      if (record.trafficRevision !== record.revision) problems.push(`${fn}.trafficRevision: ${record.trafficRevision} is not the latest ready revision ${record.revision}`);
      if (record.trafficPercent !== 100) problems.push(`${fn}.trafficPercent: ${record.trafficPercent}, expected 100`);
    }
  }
  const expectedCount = expected.length;
  if (!problems.length && present.length !== expectedCount) problems.push(`expected ${expectedCount} Functions, found ${present.length}`);
  if (problems.length) throw new DeploymentManifestError(`Incomplete ${label}:\n- ${problems.join('\n- ')}`);
  return true;
}

function snapshotDifferences(before, after, names) {
  const differences = [];
  for (const fn of names) {
    for (const field of SNAPSHOT_FIELDS) if (before[fn][field] !== after[fn][field]) differences.push(`${fn}.${field}: ${before[fn][field]} -> ${after[fn][field]}`);
  }
  return differences;
}

// The Executive Functions (preserved) must be unchanged by a Core release: revision, runtime, service account,
// invoker and update time. Both snapshots must first be complete.
export function assertPreservedFunctionsUnchanged(manifest, id, before, after) {
  const release = releaseFor(manifest, id);
  assertSnapshotComplete(manifest, id, before, 'before');
  assertSnapshotComplete(manifest, id, after, 'after');
  const differences = snapshotDifferences(before, after, functionsPreservedFor(manifest, release.environment));
  if (differences.length) throw new DeploymentManifestError(`Preserved Functions changed:\n- ${differences.join('\n- ')}`);
  return true;
}

// Every live Function outside the release (managed-but-untouched and preserved) must be unchanged. The compared set
// is derived from the manifest and release plan, not from whatever the snapshots happen to contain.
export function assertNonSelectedUnchanged(manifest, id, before, after) {
  const release = assertReleasePlan(manifest, id);
  assertSnapshotComplete(manifest, id, before, 'before');
  assertSnapshotComplete(manifest, id, after, 'after');
  const selected = new Set(release.functions);
  const names = expectedBeforeNames(manifest, id).filter(fn => !selected.has(fn));
  const differences = snapshotDifferences(before, after, names);
  if (differences.length) throw new DeploymentManifestError(`Non-selected Functions changed:\n- ${differences.join('\n- ')}`);
  return true;
}

// The configuration a Function must carry, as normalized explicit values: the pinned values of one record.
const CONFIGURATION_FIELDS = Object.freeze(['runtime', 'serviceAccount', 'invoker', 'generation', ...CONFIG_FIELDS]);

function configurationOf(source) {
  return {
    runtime: source.runtime, serviceAccount: source.serviceAccount, invoker: source.invoker, generation: source.generation,
    ...Object.fromEntries(CONFIG_FIELDS.map(field => [field, source.config?.[field]])),
  };
}

function configurationDifferences(label, record, expected) {
  const problems = [];
  for (const field of CONFIGURATION_FIELDS) {
    if (record[field] !== expected[field]) problems.push(`${label}.${field}: ${record[field]} != ${expected[field]}`);
  }
  return problems;
}

// The live pre-release state of the seven existing Functions must BE the pinned rollback baseline. If Stage 0 reads
// something else, the pinned FULL-rollback contract no longer describes Production and the release must not start.
export function assertBaselineMatchesPinned(manifest, id, before) {
  const release = assertReleasePlan(manifest, id);
  assertSnapshotComplete(manifest, id, before, 'before');
  const expected = configurationOf(release.rollbackBaseline);
  const problems = [];
  for (const fn of release.functions.filter(name => !(release.newFunctions || []).includes(name))) {
    problems.push(...configurationDifferences(fn, before[fn], expected).map(item => `${item} (live baseline differs from the pinned rollback baseline)`));
    if (before[fn].revision !== release.baseline.priorRevisions[fn]) problems.push(`${fn}.revision: ${before[fn].revision} != pinned baseline revision ${release.baseline.priorRevisions[fn]}`);
  }
  if (problems.length) throw new DeploymentManifestError(`The live baseline does not match the pinned rollback baseline:\n- ${problems.join('\n- ')}`);
  return true;
}

// After the release every selected Function runs the target runtime under its dedicated identity, with the intended
// complete runtime configuration, and its newly created revision serves 100% of traffic (enforced for every record by
// assertSnapshotComplete: the latest ready revision carries 100%). (Existing ones must also
// have a new revision and an UNCHANGED configuration; a new Function has no prior record.)
export function assertSelectedFunctionsDeployed(manifest, id, before, after) {
  const release = assertReleasePlan(manifest, id);
  assertSnapshotComplete(manifest, id, before, 'before');
  assertSnapshotComplete(manifest, id, after, 'after');
  const target = configurationOf(release.targetConfiguration);
  const problems = [];
  for (const fn of release.functions) {
    const record = after[fn];
    if (record.runtime !== release.targetRuntime) problems.push(`${fn}: runtime ${record.runtime}, expected ${release.targetRuntime}`);
    if (!record.serviceAccount.startsWith(`${release.runtimeServiceAccounts[fn]}@`)) problems.push(`${fn}: runtime identity ${record.serviceAccount}, expected ${release.runtimeServiceAccounts[fn]}@…`);
    if (before[fn] && before[fn].revision === record.revision) problems.push(`${fn}: no new revision was created`);
    for (const field of ['invoker', 'generation', ...CONFIG_FIELDS]) {
      if (record[field] !== target[field]) problems.push(`${fn}.${field}: ${record[field]} != intended ${target[field]}`);
      if (before[fn] && record[field] !== before[fn][field]) problems.push(`${fn}.${field}: changed by the redeploy (${before[fn][field]} -> ${record[field]})`);
    }
  }
  if (problems.length) throw new DeploymentManifestError(`Selected Functions are not as planned:\n- ${problems.join('\n- ')}`);
  return true;
}

// FULL rollback of the seven existing Functions = pinned baseline source + configuration REDEPLOYED, then read back.
// Cloud Run traffic shifting is EMERGENCY MITIGATION ONLY and never satisfies this check: a restored Function must
// carry a NEW revision (proof that a redeploy happened) that serves 100% of traffic, whose complete runtime
// configuration (runtime, Gen 2, identity, invoker, memory, CPU, timeout, concurrency, max instances, ingress) is read
// back and equals the pinned baseline, and whose source identity (`sourceTreeDigest`, a read-back of the deployed
// source) equals the pinned baseline source. Anything missing or malformed fails; nothing is inferred.
export function assertFullRollbackVerified(manifest, id, baseline, restored) {
  const release = assertReleasePlan(manifest, id);
  const pinned = release.rollbackBaseline;
  assertBaselineMatchesPinned(manifest, id, baseline);
  const expected = configurationOf(pinned);
  const existing = release.functions.filter(fn => !(release.newFunctions || []).includes(fn));
  const problems = [];
  if (!isPlainRecord(restored)) throw new DeploymentManifestError('The restored snapshot must be an object keyed by Function name.');
  for (const fn of existing) {
    const record = restored[fn];
    if (!isPlainRecord(record)) { problems.push(`${fn}: missing or malformed in the restored snapshot`); continue; }
    for (const field of SNAPSHOT_FIELDS) {
      if (!Object.hasOwn(record, field)) problems.push(`${fn}.${field}: missing from the restored snapshot`);
      else if (!SNAPSHOT_VALIDATORS[field](record[field])) problems.push(`${fn}.${field}: invalid value in the restored snapshot`);
    }
    if (typeof record.sourceTreeDigest !== 'string' || !/^[0-9a-f]{64}$/.test(record.sourceTreeDigest)) problems.push(`${fn}.sourceTreeDigest: missing or invalid`);
    if (problems.some(problem => problem.startsWith(`${fn}.`))) continue;
    if (record.revision === baseline[fn].revision) problems.push(`${fn}: revision equals the baseline revision — traffic shifting alone is EMERGENCY MITIGATION, not a full rollback`);
    if (record.trafficRevision !== record.revision) problems.push(`${fn}.trafficRevision: ${record.trafficRevision} is not the newly redeployed revision ${record.revision}`);
    if (record.trafficPercent !== 100) problems.push(`${fn}.trafficPercent: ${record.trafficPercent}, the redeployed revision must serve 100%`);
    problems.push(...configurationDifferences(fn, record, expected).map(item => `${item} (pinned baseline)`));
    if (record.sourceTreeDigest !== pinned.sourceTreeDigest) problems.push(`${fn}.sourceTreeDigest does not equal the pinned baseline source`);
  }
  for (const fn of Object.keys(restored)) if (!existing.includes(fn) && !expectedAfterNames(manifest, id).includes(fn)) problems.push(`${fn}: unexpected Function in the restored snapshot`);
  const others = expectedBeforeNames(manifest, id).filter(fn => !release.functions.includes(fn));
  for (const fn of others) {
    const record = restored[fn];
    if (!isPlainRecord(record)) { problems.push(`${fn}: missing from the restored snapshot`); continue; }
    for (const field of SNAPSHOT_FIELDS) if (record[field] !== baseline[fn][field]) problems.push(`${fn}.${field}: changed by the rollback`);
  }
  if (problems.length) throw new DeploymentManifestError(`Full rollback is not verified:\n- ${problems.join('\n- ')}`);
  return true;
}

// ── Release identities: runtime target source, reviewed release plan, execution freeze, live rollback baseline ────
// 1. runtimeTargetSourceSha (in the manifest): the commit whose runtime-relevant source is approved for deployment.
// 2. reviewed release plan: the exact commit (and content digest) of the safety-critical plan files that was
//    independently approved. A commit cannot contain its own SHA, so it is recorded OUTSIDE the repository by the
//    Control Plane after the final reviewed PR is merged, and handed to the execution gate as an input.
// 3. execution freeze SHA: the commit the release is run from. It MUST EQUAL the reviewed release-plan SHA; any later
//    commit, however small, needs a new independent review and a new recorded pin.
// 4. live Production rollback baseline: the pinned live state (`rollbackBaseline`, `baseline`), unrelated to 1-3.
//
// Runtime integrity: only plan/test paths may differ between (1) and (3). Fail-closed: unknown paths count as runtime.
const PLAN_ONLY_FILES = new Set(['config/deployment-manifest.json', 'scripts/deployment-manifest.mjs']);
const PLAN_ONLY_PREFIXES = ['docs/', 'tests/'];

// Release-plan integrity: every file whose content decides release scope, safety checks, rollback or their pins.
export const SAFETY_CRITICAL_PLAN_FILES = Object.freeze([
  'config/deployment-manifest.json',
  'scripts/deployment-manifest.mjs',
  'docs/production-user-permissions-v2-promotion.md',
  'tests/deployment-manifest.test.mjs',
  'tests/production-promotion-v2.test.mjs',
]);

export function runtimeRelevantChanges(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.some(path => typeof path !== 'string' || !path)) {
    throw new DeploymentManifestError('Changed paths must be a list of non-empty path strings (from `git diff --name-only`).');
  }
  const isPlanOnly = path => !path.split('/').includes('..')
    && (PLAN_ONLY_FILES.has(path) || PLAN_ONLY_PREFIXES.some(prefix => path.startsWith(prefix)));
  return changedPaths.filter(path => !isPlanOnly(path));
}

// sha256 over each safety-critical file's path and exact bytes, in the fixed order above. A missing file throws, so a
// deleted plan file can never produce a digest. Any byte change (including whitespace) changes the digest.
export async function computeReleasePlanDigest(rootDir) {
  const hash = createHash('sha256');
  for (const path of SAFETY_CRITICAL_PLAN_FILES) {
    let bytes;
    try { bytes = await readFile(join(rootDir, path)); } catch { throw new DeploymentManifestError(`Safety-critical release-plan file is missing: ${path}`); }
    hash.update(`${path}\0${createHash('sha256').update(bytes).digest('hex')}\n`);
  }
  return hash.digest('hex');
}

export async function assertExecutionFreeze(manifest, id, { runtimeTargetSha, reviewedReleasePlanSha, reviewedReleasePlanDigest, freezeSha, planRoot, changedPaths }) {
  const sha = value => /^[0-9a-f]{40}$/.test(value || '');
  if (!sha(reviewedReleasePlanSha)) throw new DeploymentManifestError('The reviewed release-plan SHA must be a recorded full commit SHA (recorded by the Control Plane after the final reviewed merge).');
  if (!/^[0-9a-f]{64}$/.test(reviewedReleasePlanDigest || '')) throw new DeploymentManifestError('The reviewed release-plan digest must be a recorded SHA-256.');
  if (!sha(freezeSha)) throw new DeploymentManifestError('The execution freeze must be a recorded full commit SHA.');
  if (typeof planRoot !== 'string' || !planRoot) throw new DeploymentManifestError('The execution gate needs the root of the frozen checkout to digest the release plan.');
  if (freezeSha !== reviewedReleasePlanSha) throw new DeploymentManifestError('The execution freeze SHA does not equal the independently reviewed release-plan SHA; a changed plan needs a new independent review and a new recorded pin.');
  const digest = await computeReleasePlanDigest(planRoot);
  if (digest !== reviewedReleasePlanDigest) throw new DeploymentManifestError('The release plan digest of the frozen checkout does not equal the independently reviewed release plan digest (a safety-critical plan file changed after review).');
  if (JSON.stringify(manifest) !== JSON.stringify(await loadDeploymentManifest(planRoot))) throw new DeploymentManifestError('The manifest in use is not the manifest of the frozen checkout.');
  const release = assertReleasePlan(manifest, id);
  if (reviewedReleasePlanSha === release.runtimeTargetSourceSha) throw new DeploymentManifestError('The reviewed release-plan SHA cannot be the runtime target source; the plan files differ from it.');
  if (runtimeTargetSha !== release.runtimeTargetSourceSha) throw new DeploymentManifestError('The recorded runtime target source does not equal the approved runtime target source.');
  const runtime = runtimeRelevantChanges(changedPaths);
  if (runtime.length) throw new DeploymentManifestError(`Runtime-relevant source changed since the approved runtime target source; re-baseline required:\n- ${runtime.join('\n- ')}`);
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
