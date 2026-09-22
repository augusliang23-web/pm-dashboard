import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  DeploymentManifestError, ENVIRONMENTS, assertNoLiveFunctionOutsideAllowlist,
  buildFunctionsOnlyFlag, functionsAllowlistFor, loadDeploymentManifest, validateManifestAgainstSource
} from '../scripts/deployment-manifest.mjs';
import { HOSTING_TARGETS } from '../scripts/hosting-env.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = await loadDeploymentManifest(repoRoot);

test('the manifest declares exactly the two approved environments', () => {
  assert.deepEqual(ENVIRONMENTS, ['prod', 'uat']);
  assert.deepEqual(Object.keys(manifest.environments).sort(), ['prod', 'uat']);
});

test('the manifest is fully consistent with functions/index.js, hosting targets, and Firebase project ids', async () => {
  await assert.doesNotReject(validateManifestAgainstSource(repoRoot, manifest));
});

test('every function exported by functions/index.js is covered exactly once (allowlist xor never-deploy) per environment', async () => {
  const indexSource = await readFile(join(repoRoot, 'functions', 'index.js'), 'utf8');
  const sourceExports = [...indexSource.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=/gm)].map(m => m[1]).sort();
  assert.equal(sourceExports.length, 20, 'sanity: functions/index.js export count changed; update this test deliberately');

  for (const name of ENVIRONMENTS) {
    const env = manifest.environments[name];
    const allow = new Set(env.functionsAllowlist);
    const never = new Set(Object.values(env.functionsNeverDeploy || {}).flat());
    assert.deepEqual([...allow].filter(fn => never.has(fn)), [], `${name}: allowlist and never-deploy must not overlap`);
    for (const fn of sourceExports) {
      assert.equal(allow.has(fn) !== never.has(fn), true, `${name}: "${fn}" must be in exactly one of allowlist/never-deploy`);
    }
  }
});

test('Production never deploys the Executive milestone Callables (Control Plane decision 2: UAT runtime only)', () => {
  const prod = manifest.environments.prod;
  const executiveFunctions = [
    'addExecutiveMilestoneUpdate', 'createExecutiveMilestoneChangeRequest', 'withdrawExecutiveMilestoneChangeRequest',
    'decideExecutiveMilestoneChangeRequest', 'applyDirectExecutiveMilestoneChange', 'initializeExecutiveMilestoneLiveTimeline',
    'saveExecutiveMilestoneTimelineConfig', 'setExecutiveRagOverride'
  ];
  for (const fn of executiveFunctions) {
    assert.ok(!prod.functionsAllowlist.includes(fn), `Production allowlist must not include "${fn}"`);
    assert.ok(prod.functionsNeverDeploy.executiveMilestone?.includes(fn), `Production functionsNeverDeploy.executiveMilestone must explicitly name "${fn}"`);
  }
  assert.deepEqual([...executiveFunctions].sort(), [...prod.functionsNeverDeploy.executiveMilestone].sort());
});

test('Production never deploys the Production-to-UAT sync Callables (Control Plane decision 3)', () => {
  const prod = manifest.environments.prod;
  const syncFunctions = ['syncProductionWeeksToUat', 'getProductionWeekSyncStatus', 'restoreUatWeeksSnapshot'];
  for (const fn of syncFunctions) {
    assert.ok(!prod.functionsAllowlist.includes(fn), `Production allowlist must not include "${fn}"`);
    assert.ok(prod.functionsNeverDeploy.productionWeekSync?.includes(fn), `Production functionsNeverDeploy.productionWeekSync must explicitly name "${fn}"`);
  }
  assert.deepEqual([...syncFunctions].sort(), [...prod.functionsNeverDeploy.productionWeekSync].sort());
});

test('Production keeps exactly the eight-function dashboard write/Gantt contract plus the shared presence scheduler', () => {
  assert.deepEqual(functionsAllowlistFor(manifest, 'prod'), [
    'aggregatePresenceSessions', 'createDashboardWeek', 'deleteDashboardProject', 'saveDashboardGanttTemplateSettings',
    'saveDashboardGanttWindowSettings', 'saveDashboardProject', 'saveDashboardWeekFields', 'setDashboardProjectAttention',
    'setDashboardWeekRelease'
  ].sort());
});

test('UAT allows every function; nothing is silently excluded there', () => {
  assert.equal(functionsAllowlistFor(manifest, 'uat').length, 20);
  assert.deepEqual(manifest.environments.uat.functionsNeverDeploy, {});
});

test('buildFunctionsOnlyFlag names each function individually and never emits a bare "functions" scope', () => {
  for (const name of ENVIRONMENTS) {
    const flag = buildFunctionsOnlyFlag(manifest, name);
    assert.doesNotMatch(flag, /(^|,)functions(,|$)/, 'must never be the unscoped "functions" target');
    const parts = flag.split(',');
    assert.ok(parts.every(part => /^functions:[A-Za-z0-9_]+$/.test(part)));
    assert.deepEqual(parts.map(part => part.slice('functions:'.length)).sort(), functionsAllowlistFor(manifest, name));
  }
});

test('assertNoLiveFunctionOutsideAllowlist passes for a live list inside the allowlist and throws for one outside it', () => {
  const allowed = functionsAllowlistFor(manifest, 'prod');
  assert.doesNotThrow(() => assertNoLiveFunctionOutsideAllowlist(manifest, 'prod', allowed.slice(0, 2)));
  assert.throws(
    () => assertNoLiveFunctionOutsideAllowlist(manifest, 'prod', [...allowed, 'addExecutiveMilestoneUpdate']),
    error => error instanceof DeploymentManifestError && error.message.includes('addExecutiveMilestoneUpdate')
  );
});

test('each environment\'s hostingTarget and pdfTarget resolve to that environment\'s Firebase project', async () => {
  const { loadHostingEnv } = await import('../scripts/hosting-env.mjs');
  const registry = JSON.parse(await readFile(join(repoRoot, 'pdf-service', 'src', 'targets', 'registry.json'), 'utf8'));
  for (const name of ENVIRONMENTS) {
    const env = manifest.environments[name];
    assert.equal(HOSTING_TARGETS[env.hostingTarget], env.firebaseProjectId);
    const hostingEnvName = name === 'prod' ? 'prod' : 'uat';
    const hostingEnv = await loadHostingEnv(repoRoot, hostingEnvName);
    assert.equal(hostingEnv.firebaseProjectId, env.firebaseProjectId);
    const pdfTarget = registry.targets[env.pdfTarget];
    assert.ok(pdfTarget, `pdfTarget "${env.pdfTarget}" must exist in the pdf-service registry`);
    assert.equal(pdfTarget.firebaseProjectId, env.firebaseProjectId);
  }
});

test('each environment\'s firestoreRulesFile exists and is not the other environment\'s file', async () => {
  const { access } = await import('node:fs/promises');
  const prod = manifest.environments.prod;
  const uat = manifest.environments.uat;
  await assert.doesNotReject(access(join(repoRoot, prod.firestoreRulesFile)));
  await assert.doesNotReject(access(join(repoRoot, uat.firestoreRulesFile)));
  assert.notEqual(prod.firestoreRulesFile, uat.firestoreRulesFile);
  assert.equal(prod.firestoreRulesFile, 'firestore.rules');
  assert.equal(uat.firestoreRulesFile, 'firestore.uat.rules');
});

test('no source file builds a bare "firebase deploy --only functions" or an unscoped "firebase deploy"', async () => {
  const { readdir } = await import('node:fs/promises');
  const targets = [];
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  for (const value of Object.values(pkg.scripts)) targets.push(value);
  for (const dir of ['scripts', 'pdf-service/scripts']) {
    for (const entry of await readdir(join(repoRoot, dir), { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile()) continue;
      targets.push(await readFile(join(repoRoot, dir, entry.name), 'utf8').catch(() => ''));
    }
  }
  // Comment-only lines are prose describing this behavior (including this file's own module docstring), not code;
  // stripping them avoids flagging a sentence like "the only place a `firebase deploy` invocation is built" while
  // still catching a real invocation on a code line, even one a trailing comment shares a line with.
  const stripCommentOnlyLines = text => text.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
  for (const text of targets) {
    for (const match of stripCommentOnlyLines(text).matchAll(/firebase\s+deploy\b[^\n]*/gi)) {
      assert.doesNotMatch(match[0], /--only\s+functions\s*(?:$|[^:\w])/, `bare functions scope found: ${match[0]}`);
      const hasOnly = /--only\s+\S/.test(match[0]);
      assert.ok(hasOnly, `unscoped firebase deploy found: ${match[0]}`);
    }
  }
});

test('this module never exposes a way to actually run a Functions deploy (source contains no deploy invocation)', async () => {
  const source = await readFile(join(repoRoot, 'scripts', 'deployment-manifest.mjs'), 'utf8');
  assert.doesNotMatch(source, /child_process|spawn|execFile|exec\(/, 'deployment-manifest.mjs must stay a pure allowlist/validator, not a deploy runner');
});
