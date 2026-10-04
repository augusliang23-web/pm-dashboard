// Pins the User Permissions V2 Production promotion plan (config/deployment-manifest.json `releases.userPermissionsV2`
// and docs/production-user-permissions-v2-promotion.md). Pure checks: nothing here talks to Firebase or deploys.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dashboardSource } from './helpers/dashboard-source.mjs';
import {
  CONFIG_FIELDS, DeploymentManifestError, SAFETY_CRITICAL_PLAN_FILES, SNAPSHOT_FIELDS, assertBaselineMatchesPinned, assertExecutionFreeze,
  computeReleasePlanDigest, assertFullRollbackVerified, assertLiveFunctionInventory, assertNonSelectedUnchanged,
  assertPostReleaseInventory, assertPreservedFunctionsUnchanged, assertReleasePlan, assertSelectedFunctionsDeployed,
  assertSnapshotComplete, buildFunctionsOnlyFlag, buildReleaseFunctionsOnlyFlag, expectedAfterNames, expectedBeforeNames,
  functionsAllowlistFor, functionsPreservedFor, loadDeploymentManifest, readSourceServiceAccounts, releaseFor,
  runtimeRelevantChanges, buildObservedFunctionRecord, validateManifestAgainstSource
} from '../scripts/deployment-manifest.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = await loadDeploymentManifest(repoRoot);
const ID = 'userPermissionsV2';
const release = releaseFor(manifest, ID);
const runbook = await readFile(join(repoRoot, 'docs', 'production-user-permissions-v2-promotion.md'), 'utf8');
const clone = () => structuredClone(manifest);

const EIGHT = [
  'setUserPermissionOverrides', 'createDashboardWeek', 'saveDashboardWeekFields', 'saveDashboardProject',
  'deleteDashboardProject', 'saveDashboardGanttTemplateSettings', 'saveDashboardGanttWindowSettings', 'setDashboardWeekRelease',
];
const EXECUTIVE = [
  'addExecutiveMilestoneUpdate', 'createExecutiveMilestoneChangeRequest', 'withdrawExecutiveMilestoneChangeRequest',
  'decideExecutiveMilestoneChangeRequest', 'applyDirectExecutiveMilestoneChange', 'initializeExecutiveMilestoneLiveTimeline',
  'saveExecutiveMilestoneTimelineConfig', 'setExecutiveRagOverride',
];
const UAT_ONLY = ['syncProductionWeeksToUat', 'getProductionWeekSyncStatus', 'restoreUatWeeksSnapshot'];
const IDENTITIES = {
  setUserPermissionOverrides: 'pmdash-user-perms', createDashboardWeek: 'pmdash-create-week', saveDashboardWeekFields: 'pmdash-week-fields',
  saveDashboardProject: 'pmdash-save-project', deleteDashboardProject: 'pmdash-delete-project',
  saveDashboardGanttTemplateSettings: 'pmdash-gantt-template', saveDashboardGanttWindowSettings: 'pmdash-gantt-window',
  setDashboardWeekRelease: 'pmdash-week-release',
};
const LIVE_BEFORE = [...functionsAllowlistFor(manifest, 'prod').filter(fn => fn !== 'setUserPermissionOverrides'), ...EXECUTIVE];

test('the release selector is exactly the eight reviewed Functions, each named individually', () => {
  assert.deepEqual(release.functions, EIGHT);
  const flag = buildReleaseFunctionsOnlyFlag(manifest, ID);
  assert.equal(flag, EIGHT.map(fn => `functions:${fn}`).join(','));
  assert.equal(flag.split(',').length, 8);
  assert.ok(flag.split(',').every(part => /^functions:[A-Za-z0-9_]+$/.test(part)));
  assert.doesNotMatch(flag, /(^|,)functions(,|$)/);
});

test('the selector never includes setDashboardProjectAttention, the presence scheduler, any Executive or UAT-only Function', () => {
  const selected = buildReleaseFunctionsOnlyFlag(manifest, ID).split(',').map(part => part.slice('functions:'.length));
  for (const fn of ['setDashboardProjectAttention', 'aggregatePresenceSessions', ...EXECUTIVE, ...UAT_ONLY]) {
    assert.ok(!selected.includes(fn), `${fn} must not be selected`);
  }
  assert.deepEqual(release.untouchedManagedFunctions, ['aggregatePresenceSessions', 'setDashboardProjectAttention']);
});

test('Production policy: ten managed, the exact eight preserved Executive Functions, the exact three forbidden UAT-only Functions', () => {
  assert.equal(functionsAllowlistFor(manifest, 'prod').length, 10);
  assert.deepEqual(functionsPreservedFor(manifest, 'prod'), [...EXECUTIVE].sort());
  assert.deepEqual([...manifest.environments.prod.functionsNeverDeploy.productionWeekSync].sort(), [...UAT_ONLY].sort());
  assert.deepEqual(Object.keys(manifest.environments.prod.functionsNeverDeploy), ['productionWeekSync']);
  for (const fn of EXECUTIVE) assert.ok(!functionsAllowlistFor(manifest, 'prod').includes(fn));
  for (const fn of UAT_ONLY) assert.ok(!functionsAllowlistFor(manifest, 'prod').includes(fn));
});

test('inventory contract: 17 live + 1 new = 18 = 10 managed + 8 preserved (not 17 + 8)', () => {
  assert.equal(LIVE_BEFORE.length, 17);
  assert.deepEqual(release.baseline, { ...release.baseline, liveFunctionCount: 17, liveManaged: 9, livePreserved: 8 });
  assert.deepEqual(release.postRelease, { liveFunctionCount: 18, managed: 10, preserved: 8 });
  assert.deepEqual(release.newFunctions, ['setUserPermissionOverrides']);
  assert.equal(assertLiveFunctionInventory(manifest, 'prod', LIVE_BEFORE).live.length, 17);
  const after = [...LIVE_BEFORE, 'setUserPermissionOverrides'];
  const result = assertPostReleaseInventory(manifest, ID, after);
  assert.equal(result.live.length, 18);
  assert.equal(result.managed.length, 10);
  assert.equal(result.preserved.length, 8);
  assert.match(runbook, /POST_RELEASE_FUNCTION_INVENTORY = 18 = 10 MANAGED \+ 8 PRESERVED/);
  assert.match(runbook, /FINAL_PRODUCTION_FUNCTION_SCOPE = 8/);
});

test('post-release inventory fails closed: unknown, UAT-only, missing, extra or lookalike Functions are rejected', () => {
  const after = [...LIVE_BEFORE, 'setUserPermissionOverrides'];
  for (const bad of [
    [...after, 'randomUnknownFunction'], [...after, 'syncProductionWeeksToUat'], [...after, 'addExecutiveMilestoneUpdates'],
    after.filter(fn => fn !== 'setUserPermissionOverrides'),            // release Function missing (17)
    after.filter(fn => fn !== 'setExecutiveRagOverride'),               // an Executive Function missing (17)
    after.filter(fn => fn !== 'setDashboardWeekRelease'),
  ]) {
    assert.throws(() => assertPostReleaseInventory(manifest, ID, bad), DeploymentManifestError);
  }
});

test('release plan validation rejects every unsafe edit (mutation resistance)', () => {
  const mutate = edit => { const m = clone(); edit(m.releases[ID], m); return m; };
  const rejected = [
    ['wildcard name', r => { r.functions[0] = 'functions'; }],
    ['wildcard glob', r => { r.functions.push('save*'); }],
    ['duplicate Function', r => { r.functions.push('createDashboardWeek'); }],
    ['seventh unreviewed managed Function', r => { r.functions.push('setDashboardProjectAttention'); }],
    ['presence scheduler', r => { r.functions.push('aggregatePresenceSessions'); }],
    ['Executive Function', r => { r.functions.push('setExecutiveRagOverride'); }],
    ['UAT-only Function', r => { r.functions.push('syncProductionWeeksToUat'); }],
    ['dropped Function', r => { r.functions.pop(); }],
    ['missing identity', r => { delete r.runtimeServiceAccounts.setDashboardWeekRelease; }],
    ['shared identity', r => { r.runtimeServiceAccounts.saveDashboardProject = 'pmdash-delete-project'; }],
    ['non-pmdash identity', r => { r.runtimeServiceAccounts.createDashboardWeek = 'default-compute'; }],
    ['broader role', r => { r.serviceAccountProjectRole = 'roles/editor'; }],
    ['user-managed keys allowed', r => { r.serviceAccountMaxUserManagedKeys = 1; }],
    ['wrong runtime', r => { r.targetRuntime = 'nodejs20'; }],
    ['wrong total', r => { r.postRelease.liveFunctionCount = 25; }],
    ['wrong managed count', r => { r.postRelease.managed = 9; }],
    ['wrong preserved count', r => { r.postRelease.preserved = 7; }],
  ];
  for (const [label, edit] of rejected) assert.throws(() => assertReleasePlan(mutate(edit), ID), DeploymentManifestError, label);
  assert.doesNotThrow(() => assertReleasePlan(manifest, ID));
});

test('manifest validation also rejects a release whose identities disagree with the Function source', async () => {
  const wrong = clone();
  wrong.releases[ID].runtimeServiceAccounts.createDashboardWeek = 'pmdash-gantt-window';
  await assert.rejects(validateManifestAgainstSource(repoRoot, wrong), DeploymentManifestError);
  await assert.doesNotReject(validateManifestAgainstSource(repoRoot, manifest));
});

test('service-account plan: eight unique pmdash identities that match the dedicated identity declared in source', async () => {
  assert.deepEqual(release.runtimeServiceAccounts, IDENTITIES);
  assert.equal(new Set(Object.values(IDENTITIES)).size, 8);
  const source = await readSourceServiceAccounts(repoRoot);
  for (const [fn, account] of Object.entries(IDENTITIES)) assert.equal(source[fn], account, `${fn} source identity`);
  assert.equal(release.serviceAccountProjectRole, 'roles/datastore.user');
  assert.equal(release.serviceAccountMaxUserManagedKeys, 0);
  for (const account of Object.values(IDENTITIES)) {
    assert.ok(runbook.includes(`${account}@project-manager-dashboar-a067f.iam.gserviceaccount.com`) || runbook.includes(account), `${account} documented`);
  }
});

test('the Function code needs Firestore access only (roles/datastore.user is sufficient)', async () => {
  for (const file of ['project-dashboard-writes.js', 'user-permissions.js']) {
    const text = await readFile(join(repoRoot, 'functions', file), 'utf8');
    const modules = [...text.matchAll(/require\('([^']+)'\)/g)].map(match => match[1]);
    for (const name of modules) {
      assert.ok(name.startsWith('./') || ['firebase-functions/v2/https', 'firebase-admin/firestore'].includes(name), `${file} requires ${name}`);
    }
  }
});

test('the Production deploy flow never builds a wildcard or unscoped Functions deployment', () => {
  assert.throws(() => buildFunctionsOnlyFlag(manifest, 'prod', []), DeploymentManifestError);
  assert.throws(() => buildFunctionsOnlyFlag(manifest, 'prod', ['setDashboardProjectAttention', 'addExecutiveMilestoneUpdate']), DeploymentManifestError);
  const commands = [...runbook.matchAll(/```bash\n([\s\S]*?)```/g)].map(match => match[1]).join('\n');
  for (const match of commands.matchAll(/firebase\s+deploy\b[^\n]*/g)) {
    assert.match(match[0], /--only\s+\S/, `unscoped deploy: ${match[0]}`);
    assert.doesNotMatch(match[0], /--only\s+functions(?![:\w])/, `bare functions scope: ${match[0]}`);
  }
  const functionsDeploy = commands.match(/firebase deploy --only (functions:[^\s]+)/)?.[1];
  assert.equal(functionsDeploy, buildReleaseFunctionsOnlyFlag(manifest, ID), 'the runbook selector equals the manifest-built selector');
  assert.ok(!/firebase deploy --only functions\s/.test(commands));
});

test('rules and Hosting stages are required, use Production files only, and Production Pages stays separate', async () => {
  assert.equal(release.rulesDeployRequired, true);
  assert.equal(release.rulesFile, 'firestore.rules');
  assert.equal(manifest.environments.prod.firestoreRulesFile, 'firestore.rules');
  assert.equal(release.hostingDeployRequired, true);
  assert.deepEqual(release.productionPages, { pullRequest: 40, separateReleaseSurface: true, mergeOnlyAfter: ['functions', 'rules', 'hosting', 'authenticatedSmoke'] });
  assert.match(runbook, /npx firebase deploy --only firestore:rules --project project-manager-dashboar-a067f/);
  assert.match(runbook, /npm run deploy:hosting:prod:dry/);
  assert.match(runbook, /npm run deploy:hosting:prod\n/);
  assert.match(runbook, /never\*\* `firestore\.uat\.rules`/);
  assert.match(runbook, /DO NOT merge PR #40 until/);
  const rules = await readFile(join(repoRoot, 'firestore.rules'), 'utf8');
  for (const needed of ['match /userPermissions/{email}', 'match /userPermissionAudit/{auditId}', 'function normalizedDashboardRole()']) assert.ok(rules.includes(needed), needed);
  assert.match(rules, /match \/weeks\/\{weekId\} \{\n\s+allow read: if hasDashboardAccess\(\);/, 'Production keeps broad /weeks reads');
  assert.ok(!/canManageWeeks|canReleaseWeeks|week\.release|week\.manage/.test(rules), 'Production rules must not use the UAT delegated draft-read logic');
  const stages = [...runbook.matchAll(/^### Stage (\d+) — (.+)$/gm)].map(match => `${match[1]}:${match[2]}`);
  const order = ['Runtime identities', 'Deploy exactly the eight', 'Verify runtime', 'Verify the eight Executive', 'Deploy Production rules', 'Deploy Production Firebase Hosting', 'Authenticated Production smoke', 'STOP POINT before `production-pages`'];
  let cursor = -1;
  for (const label of order) {
    const index = stages.findIndex(stage => stage.includes(label));
    assert.ok(index > cursor, `stage "${label}" must exist after the previous one`);
    cursor = index;
  }
});

test('rollback baseline IDs are pinned in both the manifest and the runbook', () => {
  assert.equal(release.rollback.rulesetId, '7ed64612-dc1c-4856-baf1-f627972046b6');
  assert.equal(release.rollback.hostingVersion, 'd8b102f996a1366b');
  assert.equal(release.rollback.hostingRelease, '1790984982984000');
  assert.equal(release.baseline.productionPagesSha, '932c6e2bda17acad9ffc8fc0153421dcd93410dd');
  assert.equal(release.baseline.iamEtag, 'BwZcleH3jJo=');
  assert.equal(release.runtimeTargetSourceSha, '57ef1caad37c186adfe8536b6cb22d6302fdfc21');
  for (const value of [release.rollback.rulesetId, release.rollback.hostingVersion, release.rollback.hostingRelease, release.baseline.productionPagesSha, release.runtimeTargetSourceSha]) {
    assert.ok(runbook.includes(value), `${value} appears in the runbook`);
  }
  const sevenExisting = EIGHT.filter(fn => fn !== 'setUserPermissionOverrides');
  assert.deepEqual(Object.keys(release.baseline.priorRevisions).sort(), [...sevenExisting].sort());
  for (const [fn, revision] of Object.entries(release.baseline.priorRevisions)) {
    assert.ok(revision.startsWith(fn.toLowerCase().slice(0, 12)) || revision.startsWith(fn.toLowerCase()), `${fn} prior revision`);
    assert.ok(runbook.includes(`\`${revision}\``), `${fn} prior revision ${revision} in runbook`);
  }
  assert.match(runbook, /`setUserPermissionOverrides` has no prior revision/);
  assert.match(runbook, /inert/);
});

test('Node 22 contract: only the eight move; Executive, presence scheduler and attention stay on Node 20', () => {
  assert.equal(release.targetRuntime, 'nodejs22');
  assert.equal(release.baseline.runtime, 'nodejs20');
  assert.match(runbook, /Do not broaden the release to migrate other Node 20 Functions/);
  assert.match(runbook, /2026-10-30/);
  assert.match(runbook, /1\.14\.5/);
});

test('invoker strategy forbids the UAT workaround and automatic invoker fallbacks in Production', () => {
  assert.match(runbook, /Do not assume UAT's organization-policy workaround applies to Production/);
  assert.match(runbook, /Do\s+\*\*not\*\* disable invoker IAM checks/);
  const commands = [...runbook.matchAll(/```bash\n([\s\S]*?)```/g)].map(match => match[1]).join('\n');
  assert.doesNotMatch(commands, /invoker-iam-check|add-iam-policy-binding[^\n]*allUsers/, 'no runnable command applies the UAT workaround or a manual public binding');
});

test('Production data: no seeding and no migration are part of the release', () => {
  assert.match(runbook, /No `userPermissions` migration is required/);
  assert.match(runbook, /Do not seed Production permissions during the release/);
});

test('PR #36 is recorded as superseded and PR #40 as a gated downstream surface', () => {
  assert.match(runbook, /SUPERSEDED — DO NOT MERGE/);
  assert.match(runbook, /Base `606fe7e`\s+\| stale/);
  assert.match(runbook, /Old 3-function selector \| obsolete/);
  assert.match(runbook, /Old IAM scope \(3 identities\) \| obsolete/);
  assert.match(runbook, /PR #40 \(`production-pages`, selective V2 port\) is a separate release surface/);
});

test('no stage in the runbook performs or claims a deployment', () => {
  assert.match(runbook, /\*\*This document performs nothing\.\*\*/);
  assert.doesNotMatch(runbook, /\bDEPLOYED\b|(?<!nothing here )has been deployed/);
});


// ── Snapshot completeness (fail-closed) ──────────────────────────────────────────────────────────────────────
const PROJECT = 'project-manager-dashboar-a067f';
const FIELDS = [...SNAPSHOT_FIELDS];
const beforeNames = expectedBeforeNames(manifest, ID);
const afterNames = expectedAfterNames(manifest, ID);
const record = (fn, over = {}) => {
  const revision = over.revision ?? `${fn.toLowerCase()}-00001-aaa`;
  return {
    functionRuntime: 'nodejs20', revision, serviceAccount: '842441149281-compute@developer.gserviceaccount.com',
    invoker: 'allUsers', updateTime: '2026-09-19T14:59:45Z', functionGeneration: 'GEN_2',
    memory: '256Mi', cpu: '1', timeoutSeconds: 60, maxInstanceRequestConcurrency: 80, maxInstanceCount: 20, ingress: 'ALLOW_ALL',
    trafficRevision: revision, trafficPercent: 100, reconciling: false, serviceGeneration: '7', observedGeneration: '7',
    terminalConditionState: 'CONDITION_SUCCEEDED', latestCreatedRevision: revision, cloudRunExecutionEnvironmentPolicy: 'EXECUTION_ENVIRONMENT_UNSPECIFIED', ...over,
  };
};
// The seven existing Functions read back as the pinned baseline: the revisions the plan pins.
const baselineRecord = fn => record(fn, release.baseline.priorRevisions[fn] ? { revision: release.baseline.priorRevisions[fn] } : {});
const beforeSnapshot = () => Object.fromEntries(beforeNames.map(fn => [fn, baselineRecord(fn)]));
function afterSnapshot() {
  const snap = Object.fromEntries(afterNames.map(fn => [fn, baselineRecord(fn)]));
  for (const fn of EIGHT) {
    snap[fn] = record(fn, { functionRuntime: 'nodejs22', revision: `${fn.toLowerCase()}-00002-bbb`, serviceAccount: `${IDENTITIES[fn]}@${PROJECT}.iam.gserviceaccount.com`, updateTime: '2026-10-10T01:00:00Z' });
  }
  return snap;
}
const expectFail = (fn, label) => assert.throws(fn, DeploymentManifestError, label);

test('expected snapshot name sets are derived from the manifest: before = 9 managed + 8 preserved (17), after = 10 + 8 (18)', () => {
  assert.equal(beforeNames.length, 17);
  assert.equal(afterNames.length, 18);
  assert.ok(!beforeNames.includes('setUserPermissionOverrides'));
  assert.ok(afterNames.includes('setUserPermissionOverrides'));
  assert.deepEqual(beforeNames, [...LIVE_BEFORE].sort());
});

test('valid complete before/after snapshots pass every assertion', () => {
  const before = beforeSnapshot();
  const after = afterSnapshot();
  assert.equal(assertSnapshotComplete(manifest, ID, before, 'before'), true);
  assert.equal(assertSnapshotComplete(manifest, ID, after, 'after'), true);
  assert.equal(assertPreservedFunctionsUnchanged(manifest, ID, before, after), true);
  assert.equal(assertNonSelectedUnchanged(manifest, ID, before, after), true);
  assert.equal(assertSelectedFunctionsDeployed(manifest, ID, before, after), true);
});

test('snapshots made only of empty records {} are rejected (empty objects are not evidence)', () => {
  const before = Object.fromEntries(beforeNames.map(fn => [fn, {}]));
  const after = Object.fromEntries(afterNames.map(fn => [fn, {}]));
  expectFail(() => assertSnapshotComplete(manifest, ID, before, 'before'));
  expectFail(() => assertSnapshotComplete(manifest, ID, after, 'after'));
  expectFail(() => assertPreservedFunctionsUnchanged(manifest, ID, before, after), 'preserved');
  expectFail(() => assertNonSelectedUnchanged(manifest, ID, before, after), 'non-selected');
});

test('a required field missing from before only, after only, or both is rejected for every field and Function kind', () => {
  for (const fn of ['setDashboardProjectAttention', 'aggregatePresenceSessions', 'setExecutiveRagOverride', 'saveDashboardProject']) {
    for (const field of FIELDS) {
      const before = beforeSnapshot(); const after = afterSnapshot();
      delete before[fn][field];
      expectFail(() => assertNonSelectedUnchanged(manifest, ID, before, after), `${fn}.${field} missing from before`);
      expectFail(() => assertPreservedFunctionsUnchanged(manifest, ID, before, after), `${fn}.${field} missing from before`);
      const before2 = beforeSnapshot(); const after2 = afterSnapshot();
      delete after2[fn][field];
      expectFail(() => assertNonSelectedUnchanged(manifest, ID, before2, after2), `${fn}.${field} missing from after`);
      expectFail(() => assertPreservedFunctionsUnchanged(manifest, ID, before2, after2), `${fn}.${field} missing from after`);
      const before3 = beforeSnapshot(); const after3 = afterSnapshot();
      delete before3[fn][field]; delete after3[fn][field];
      expectFail(() => assertNonSelectedUnchanged(manifest, ID, before3, after3), `${fn}.${field} absent from both`);
      expectFail(() => assertPreservedFunctionsUnchanged(manifest, ID, before3, after3), `${fn}.${field} absent from both`);
    }
  }
});

test('invalid field values are rejected: empty, null, number, array, bad runtime, bad timestamp', () => {
  const bad = { functionRuntime: ['', null, 22, 'node20', 'nodejs'], revision: ['', null, 'Bad Revision!'], serviceAccount: ['', null, 'has space'], invoker: ['', null, undefined, 'all users'], updateTime: ['', 'yesterday', null, 5] };
  for (const [field, values] of Object.entries(bad)) {
    for (const value of values) {
      const before = beforeSnapshot();
      before.setDashboardProjectAttention[field] = value;
      expectFail(() => assertSnapshotComplete(manifest, ID, before, 'before'), `${field}=${String(value)}`);
    }
  }
  for (const malformed of [null, 'x', [], 7]) {
    const before = beforeSnapshot();
    before.aggregatePresenceSessions = malformed;
    expectFail(() => assertSnapshotComplete(manifest, ID, before, 'before'), `record=${JSON.stringify(malformed)}`);
  }
  expectFail(() => assertSnapshotComplete(manifest, ID, null, 'before'));
  expectFail(() => assertSnapshotComplete(manifest, ID, [], 'before'));
});

test('a non-selected, preserved or scheduler Function absent from BOTH snapshots is rejected', () => {
  for (const fn of ['setDashboardProjectAttention', 'aggregatePresenceSessions', 'setExecutiveRagOverride', 'addExecutiveMilestoneUpdate', 'initializeExecutiveMilestoneLiveTimeline']) {
    const before = beforeSnapshot(); const after = afterSnapshot();
    delete before[fn]; delete after[fn];
    expectFail(() => assertNonSelectedUnchanged(manifest, ID, before, after), `${fn} absent from both (non-selected)`);
    expectFail(() => assertPreservedFunctionsUnchanged(manifest, ID, before, after), `${fn} absent from both (preserved)`);
  }
  const before = beforeSnapshot(); const after = afterSnapshot();
  delete after.setDashboardProjectAttention;
  expectFail(() => assertNonSelectedUnchanged(manifest, ID, before, after), 'removed during the release');
});

test('a selected Function missing from either snapshot, or a missing new Function, is rejected', () => {
  const before = beforeSnapshot(); const after = afterSnapshot();
  delete after.setUserPermissionOverrides;
  expectFail(() => assertSnapshotComplete(manifest, ID, after, 'after'));
  const before2 = beforeSnapshot(); delete before2.createDashboardWeek;
  expectFail(() => assertSnapshotComplete(manifest, ID, before2, 'before'));
  const before3 = beforeSnapshot(); before3.setUserPermissionOverrides = record('setUserPermissionOverrides');
  expectFail(() => assertSnapshotComplete(manifest, ID, before3, 'before'), 'the new Function must be absent before the release');
  assert.equal(assertSnapshotComplete(manifest, ID, before, 'before'), true);
});

test('unexpected, UAT-only and lookalike Functions in either snapshot are rejected', () => {
  for (const extra of ['syncProductionWeeksToUat', 'getProductionWeekSyncStatus', 'restoreUatWeeksSnapshot', 'randomUnknownFunction', 'addExecutiveMilestoneUpdates']) {
    const after = afterSnapshot(); after[extra] = record(extra);
    expectFail(() => assertSnapshotComplete(manifest, ID, after, 'after'), `${extra} in after`);
    expectFail(() => assertPreservedFunctionsUnchanged(manifest, ID, beforeSnapshot(), after), `${extra} in after (preserved check)`);
    expectFail(() => assertNonSelectedUnchanged(manifest, ID, beforeSnapshot(), after), `${extra} in after (non-selected check)`);
    const before = beforeSnapshot(); before[extra] = record(extra);
    expectFail(() => assertSnapshotComplete(manifest, ID, before, 'before'), `${extra} in before`);
  }
});

test('any change to a preserved or non-selected Function is rejected, and selected Functions may change', () => {
  for (const fn of [...EXECUTIVE, 'setDashboardProjectAttention', 'aggregatePresenceSessions']) {
    for (const field of FIELDS) {
      const before = beforeSnapshot(); const after = afterSnapshot();
      after[fn][field] = field === 'functionRuntime' ? 'nodejs22' : field === 'updateTime' ? '2026-12-01T00:00:00Z' : `${after[fn][field]}-changed`;
      expectFail(() => assertNonSelectedUnchanged(manifest, ID, before, after), `${fn}.${field}`);
      if (EXECUTIVE.includes(fn)) expectFail(() => assertPreservedFunctionsUnchanged(manifest, ID, before, after), `${fn}.${field}`);
    }
  }
});

test('selected Functions must end on nodejs22, their dedicated identity and a new revision', () => {
  for (const [edit, label] of [
    [(after) => { after.createDashboardWeek.functionRuntime = 'nodejs20'; }, 'functionRuntime'],
    [(after) => { after.saveDashboardProject.serviceAccount = '842441149281-compute@developer.gserviceaccount.com'; }, 'identity'],
    [(after) => { after.setDashboardWeekRelease.revision = after.setDashboardWeekRelease.trafficRevision = release.baseline.priorRevisions.setDashboardWeekRelease; }, 'no new revision'],
    [(after) => { after.setUserPermissionOverrides.serviceAccount = `pmdash-create-week@${PROJECT}.iam.gserviceaccount.com`; }, 'wrong identity'],
  ]) {
    const after = afterSnapshot(); edit(after);
    expectFail(() => assertSelectedFunctionsDeployed(manifest, ID, beforeSnapshot(), after), label);
  }
});

// ── FULL rollback vs emergency traffic mitigation ────────────────────────────────────────────────────────────
const pinned = release.rollbackBaseline;
const SEVEN = EIGHT.filter(fn => fn !== 'setUserPermissionOverrides');
function restoredSnapshot() {
  const base = beforeSnapshot();
  const restored = {};
  for (const fn of beforeNames) restored[fn] = { ...base[fn] };
  for (const fn of SEVEN) {
    const revision = `${fn.toLowerCase()}-00003-ccc`;
    restored[fn] = { ...base[fn], revision, latestCreatedRevision: revision, trafficRevision: revision, trafficPercent: 100, updateTime: '2026-10-12T00:00:00Z', sourceTreeDigest: pinned.sourceTreeDigest };
  }
  return restored;
}

test('FULL rollback = pinned baseline source + configuration redeployment: the manifest classifies traffic shifting as emergency mitigation only', () => {
  assert.equal(pinned.fullRollbackMethod, 'PINNED_BASELINE_SOURCE_PLUS_CONFIG_REDEPLOYMENT');
  assert.equal(pinned.trafficShiftClassification, 'EMERGENCY_MITIGATION_ONLY');
  assert.equal(pinned.sourceCommit, 'f4244beedacb9f6cc40addc533c3e8316e56aa96');
  assert.equal(pinned.nodeEngine, '20');
  assert.deepEqual(Object.keys(pinned.sourceGenerations).sort(), [...SEVEN].sort());
  assert.deepEqual(Object.keys(release.baseline.priorRevisions).sort(), [...SEVEN].sort());
  assert.equal(assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restoredSnapshot()), true);
});

test('a traffic-only restore (baseline revision serving) is never accepted as a full rollback', () => {
  for (const fn of SEVEN) {
    const restored = restoredSnapshot();
    restored[fn].revision = restored[fn].trafficRevision = beforeSnapshot()[fn].revision;
    expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), `${fn} traffic only`);
  }
});

test('full rollback verification fails on any wrong runtime, identity, invoker, source identity or incomplete evidence', () => {
  for (const fn of SEVEN) {
    for (const [field, value] of [['functionRuntime', 'nodejs22'], ['serviceAccount', `pmdash-save-project@${PROJECT}.iam.gserviceaccount.com`], ['invoker', 'none'], ['sourceTreeDigest', 'f'.repeat(64)]]) {
      const restored = restoredSnapshot(); restored[fn][field] = value;
      expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), `${fn}.${field}`);
    }
    const missing = restoredSnapshot(); delete missing[fn].sourceTreeDigest;
    expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), missing), `${fn} no source read-back`);
    const gone = restoredSnapshot(); delete gone[fn];
    expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), gone), `${fn} absent`);
  }
  for (const fn of [...EXECUTIVE, 'setDashboardProjectAttention', 'aggregatePresenceSessions']) {
    const restored = restoredSnapshot(); restored[fn].revision = 'changed-00009-zzz';
    expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), `${fn} changed`);
    const absent = restoredSnapshot(); delete absent[fn];
    expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), absent), `${fn} absent`);
  }
  expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), null));
});

test('the runbook never calls a traffic shift a rollback: it is emergency mitigation that proves no control-plane restoration', () => {
  const state = runbook.slice(runbook.indexOf('## Rollback classification'), runbook.indexOf('## Partial-failure'));
  assert.match(runbook, /EMERGENCY TRAFFIC MITIGATION/);
  assert.match(runbook, /TRAFFIC_SHIFT = EMERGENCY_MITIGATION_ONLY/);
  assert.match(runbook, /PINNED BASELINE SOURCE \+ CONFIG REDEPLOYMENT/);
  for (const proof of ['service template', 'runtime configuration', 'runtime service account', 'control-plane metadata', 'deployment configuration', 'callable integration']) {
    assert.ok(runbook.includes(proof), `mitigation does not prove ${proof}`);
  }
  assert.doesNotMatch(runbook, /Preferred restore for each existing Function/i);
  const trafficLines = runbook.split('\n').filter(line => /update-traffic/.test(line));
  assert.ok(trafficLines.length >= 1);
  for (const line of trafficLines) {
    const at = runbook.indexOf(line);
    assert.match(runbook.slice(Math.max(0, at - 500), at), /Emergency mitigation/, 'a traffic command must sit under the emergency-mitigation label');
  }
  assert.match(state, /not a rollback/i);
  assert.match(runbook, /f4244beedacb9f6cc40addc533c3e8316e56aa96/);
  assert.match(runbook, /Node 20 deployability/);
  assert.match(runbook, /STOP\.[^\n]*(silently|traffic-only)|do \*\*not\*\* fall back/i);
});

// ── Rollback state machine A–F (UI first once published) ─────────────────────────────────────────────────────
function stateSection(letter) {
  const start = runbook.indexOf(`### State ${letter} `);
  assert.ok(start >= 0, `state ${letter} exists`);
  const end = runbook.indexOf('\n### ', start + 5);
  return runbook.slice(start, end < 0 ? undefined : end);
}
// First occurrence of each step must follow the first occurrence of the previous one (a step mentioned earlier than
// its turn, for example rules before Hosting, is an ordering violation).
const orderIn = (text, labels) => labels.reduce((cursor, label) => {
  const at = text.indexOf(label);
  assert.ok(at >= 0, `"${label}" must be present`);
  assert.ok(at > cursor, `"${label}" must come after the previous step`);
  return at;
}, -1);

test('rollback states A–F are all documented with the required ordering', () => {
  for (const letter of ['A', 'B', 'C', 'D', 'E', 'F']) stateSection(letter);
  orderIn(stateSection('E'), ['restore Firebase Hosting', 'confirm the old UI', 'keep `setUserPermissionOverrides` live', 'restore `userPermissions`', 'preserve `userPermissionAudit`', 'full rollback of the seven', 'restore Production rules', 'leave inert or delete `setUserPermissionOverrides`', 'identities']);
  orderIn(stateSection('D'), ['verify `userPermissions`', 'full rollback of the seven', 'restore Production rules', 'new callable']);
  orderIn(stateSection('F'), ['restore the `production-pages`', 'permission state', 'consumer Functions', 'permission callable']);
  orderIn(stateSection('C'), ['full rollback of the seven', 'new callable', 'identities']);
  orderIn(stateSection('B'), ['full rollback', 'inert']);
  assert.match(stateSection('A'), /No application behavior changed/);
  assert.match(stateSection('F'), /Do not roll back the healthy/);
  assert.match(runbook, /restore\/disable that UI BEFORE removing backend capabilities/);
});

test('permission-state rollback captures the empty baseline, restores it through the audited callable and preserves audit', () => {
  assert.match(runbook, /`userPermissions` collection is empty/);
  assert.match(runbook, /capture and verify the baseline immediately before the release/i);
  assert.match(runbook, /no stale override remains/i);
  assert.match(runbook, /never delete `userPermissionAudit`/i);
  assert.match(runbook, /Do not seed Production permissions/);
});

// ── Release-plan runtime validator (B2-1) and execution freeze (B2-2) ────────────────────────────────────────
test('release plan validation rejects every unsafe safety-metadata edit', () => {
  const mutate = edit => { const m = clone(); edit(m.releases[ID], m); return m; };
  const rejected = [
    ['short runtime target SHA', r => { r.runtimeTargetSourceSha = '57ef1ca'; }],
    ['non-hex runtime target SHA', r => { r.runtimeTargetSourceSha = 'z'.repeat(40); }],
    ['UAT environment', r => { r.environment = 'uat'; }],
    ['unknown environment', r => { r.environment = 'staging'; }],
    ['rules not required', r => { r.rulesDeployRequired = false; }],
    ['UAT rules file', r => { r.rulesFile = 'firestore.uat.rules'; }],
    ['hosting not required', r => { r.hostingDeployRequired = false; }],
    ['pages not separate', r => { r.productionPages.separateReleaseSurface = false; }],
    ['pages without hosting gate', r => { r.productionPages.mergeOnlyAfter = ['functions', 'rules', 'authenticatedSmoke']; }],
    ['pages without smoke gate', r => { r.productionPages.mergeOnlyAfter = ['functions', 'rules', 'hosting']; }],
    ['pages extra gate', r => { r.productionPages.mergeOnlyAfter.push('anything'); }],
    ['broad role', r => { r.serviceAccountProjectRole = 'roles/owner'; }],
    ['non-role', r => { r.serviceAccountProjectRole = 'datastore'; }],
    ['new Function not in release', r => { r.newFunctions = ['brandNewFunction']; }],
    ['untouched overlaps release', r => { r.untouchedManagedFunctions.push('createDashboardWeek'); }],
    ['untouched not managed', r => { r.untouchedManagedFunctions = ['addExecutiveMilestoneUpdate']; }],
    ['arithmetic: baseline managed', r => { r.baseline.liveManaged = 8; }],
    ['arithmetic: baseline total', r => { r.baseline.liveFunctionCount = 18; }],
    ['traffic shift as full rollback', r => { r.rollbackBaseline.fullRollbackMethod = 'CLOUD_RUN_TRAFFIC_SHIFT'; }],
    ['traffic shift not mitigation', r => { r.rollbackBaseline.trafficShiftClassification = 'ROLLBACK'; }],
    ['short rollback commit', r => { r.rollbackBaseline.sourceCommit = 'f4244be'; }],
    ['bad source digest', r => { r.rollbackBaseline.sourceTreeDigest = 'abc'; }],
    ['missing source generation', r => { delete r.rollbackBaseline.sourceGenerations.setDashboardWeekRelease; }],
    ['extra source generation', r => { r.rollbackBaseline.sourceGenerations.setUserPermissionOverrides = '1'; }],
    ['missing prior revision', r => { delete r.baseline.priorRevisions.saveDashboardProject; }],
  ];
  for (const [label, edit] of rejected) assert.throws(() => assertReleasePlan(mutate(edit), ID), DeploymentManifestError, label);
  assert.doesNotThrow(() => assertReleasePlan(manifest, ID));
});

test('exact approved pins are asserted for this release (least-privilege role, keys, runtime target source)', () => {
  assert.equal(release.serviceAccountProjectRole, 'roles/datastore.user');
  assert.equal(release.serviceAccountMaxUserManagedKeys, 0);
  assert.equal(release.environment, 'prod');
  assert.equal(release.runtimeTargetSourceSha, '57ef1caad37c186adfe8536b6cb22d6302fdfc21');
});

// A throwaway copy of the safety-critical plan files, so "edits after review" can be applied without touching the repo.
async function planCopy() {
  const root = await mkdtemp(join(tmpdir(), 'plan-pin-'));
  for (const path of SAFETY_CRITICAL_PLAN_FILES) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await cp(join(repoRoot, path), join(root, path));
  }
  return root;
}
const REVIEWED_SHA = 'c'.repeat(40);
const PLAN_ONLY_PATHS = ['docs/production-user-permissions-v2-promotion.md', 'tests/production-promotion-v2.test.mjs', 'config/deployment-manifest.json', 'scripts/deployment-manifest.mjs'];
async function freezeInputs(root, over = {}) {
  return {
    runtimeTargetSha: release.runtimeTargetSourceSha, reviewedReleasePlanSha: REVIEWED_SHA, reviewedReleasePlanDigest: await computeReleasePlanDigest(root),
    freezeSha: REVIEWED_SHA, planRoot: root, changedPaths: PLAN_ONLY_PATHS, ...over,
  };
}
const freezeManifest = async root => loadDeploymentManifest(root);

test('SECONDARY runtime-target comparison permits reviewed plan differences from the older runtime target only', async () => {
  const root = await planCopy();
  try {
    const gate = over => freezeInputs(root, over).then(inputs => assertExecutionFreeze(manifest, ID, inputs));
    assert.equal(await gate(), true);
    assert.equal(await gate({ changedPaths: [] }), true);
    for (const path of ['functions/project-dashboard-writes.js', 'firestore.rules', 'index.html', 'js/permission-registry.mjs', 'package.json', 'firebase.json',
      'scripts/build-hosting.mjs', '.github/workflows/ci.yml', 'docs/../index.html', 'config/other.json', 'unknown-new-file']) {
      assert.deepEqual(runtimeRelevantChanges([path]), [path], path);
      await assert.rejects(gate({ changedPaths: [...PLAN_ONLY_PATHS, path] }), DeploymentManifestError, path);
    }
    await assert.rejects(gate({ runtimeTargetSha: '2'.repeat(40) }), DeploymentManifestError);
    await assert.rejects(gate({ freezeSha: 'main' }), DeploymentManifestError);
    assert.throws(() => runtimeRelevantChanges(['']), DeploymentManifestError);
    assert.throws(() => runtimeRelevantChanges('docs/x.md'), DeploymentManifestError);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the runbook separates the approved runtime target source, the PR #41 candidate head and the future execution freeze', () => {
  assert.match(runbook, /Approved runtime target source/);
  assert.match(runbook, /PR #41 release-plan commits/);
  assert.match(runbook, /Execution freeze SHA/);
  assert.doesNotMatch(runbook, /Verify `main` is still `(1c2ec79|57ef1caa)/);
  assert.match(runbook, /git diff --name-only 57ef1caad37c186adfe8536b6cb22d6302fdfc21 <freeze-sha>/);
  assert.match(runbook, /re-baseline/);
});

test('every runbook bash block that loops or runs IAM / service-account commands fails closed', () => {
  const blocks = [...runbook.matchAll(/```bash\n([\s\S]*?)```/g)].map(match => match[1]);
  const iamBlocks = blocks.filter(block => /gcloud (iam|projects add-iam-policy-binding)/.test(block));
  assert.ok(iamBlocks.length >= 3, 'create, grant and verify blocks exist');
  for (const block of iamBlocks) assert.match(block, /^set -euo pipefail$/m, 'IAM block must set -euo pipefail');
  for (const block of blocks.filter(b => /\bfor\b[\s\S]*\bdo\b/.test(b))) assert.match(block, /^set -euo pipefail$/m, 'loops must set -euo pipefail');
});

test('the earlier local rules-test flake is recorded accurately, without claiming a root cause', () => {
  assert.match(runbook, /one transient local failure/i);
  assert.match(runbook, /exact cause unknown/i);
  assert.match(runbook, /14\/14/);
  assert.doesNotMatch(runbook, /root cause (was|is) /i);
});


// ── Post-PR #42 runtime target ───────────────────────────────────────────────────────────────────────────────
const TARGET = '57ef1caad37c186adfe8536b6cb22d6302fdfc21';
const writesSource = await readFile(join(repoRoot, 'functions', 'project-dashboard-writes.js'), 'utf8');

test('the runtime target is main 57ef1caa (PR #39 + PR #42), recorded in the manifest and the runbook', () => {
  assert.equal(release.runtimeTargetSourceSha, TARGET);
  assert.deepEqual(release.runtimeTargetIncludedPullRequests, [39, 42]);
  assert.match(runbook, /PRODUCTION_TARGET_SOURCE = 57ef1caad37c186adfe8536b6cb22d6302fdfc21/);
  assert.match(runbook, /intentionally includes PR #42/);
  assert.doesNotMatch(runbook, /Approved feature source/);
});

test('PR #42 does not change the scope: the plan is still the same eight Functions, and only saveDashboardProject runs the new logic', () => {
  assert.deepEqual(release.functions, EIGHT);
  assert.match(runbook, /FINAL_PRODUCTION_FUNCTION_SCOPE = 8` remains valid/);
  const users = [...writesSource.matchAll(/buildProjectPatch\(/g)].length;
  // definition + the single call in saveDashboardProject (+ none elsewhere)
  assert.equal(users, 2, 'buildProjectPatch is defined once and called once');
  const callSite = writesSource.slice(writesSource.indexOf('const saveDashboardProject = '), writesSource.indexOf('const deleteDashboardProject = '));
  assert.match(callSite, /buildProjectPatch\(/);
  for (const other of ['deleteDashboardProject', 'setDashboardProjectAttention', 'setDashboardWeekRelease', 'saveDashboardWeekFields', 'createDashboardWeek', 'saveDashboardGanttTemplateSettings', 'saveDashboardGanttWindowSettings']) {
    const start = writesSource.indexOf(`const ${other} = `);
    const ends = [writesSource.indexOf('\nconst ', start + 10), writesSource.indexOf('\nmodule.exports', start)].filter(index => index > start);
    const body = writesSource.slice(start, Math.min(...ends));
    assert.doesNotMatch(body, /assertVisibilityAuthority|buildProjectPatch/, `${other} does not use the visibility logic`);
  }
});

test('target saveDashboardProject security contract: Admin-only visibility, project.manage create/delete only, ownership never confers it', () => {
  const contract = release.runtimeTargetSecurityContracts.saveDashboardProject;
  assert.equal(contract.visibilityRefusalReason, 'visibility-admin-only');
  assert.equal(contract.runtimeSourceFile, 'functions/project-dashboard-writes.js');
  assert.match(writesSource, /function assertVisibilityAuthority\(actor, draft, liveProject\) \{\n  if \(normalized\(actor\?\.role\) === 'admin'\) return;/);
  assert.match(writesSource, /securityError\('permission-denied', 'visibility-admin-only'/);
  // Both paths enforce it: create (no live project) and edit (against the live project), after their own authorization.
  assert.match(writesSource, /canCreateProject\(actor\)\) \{[\s\S]{0,260}\}\n\s+assertVisibilityAuthority\(actor, draft, undefined\);/);
  assert.match(writesSource, /canMutateProject\(\{ actor, project: liveProject \}\)\) \{[\s\S]{0,200}\}\n\s+assertVisibilityAuthority\(actor, draft, liveProject\);/);
  // project.manage stays create/delete only; ownership-based editing keeps its own check.
  assert.match(writesSource, /function canCreateProject\(actorOrRole\) \{\n  return actorCan\(asActor\(actorOrRole\), 'project\.manage'\);/);
  assert.match(writesSource, /function canMutateProject\(\{ actor, project \}\) \{\n  if \(normalized\(actor\?\.role\) === 'admin'\) return true;/);
});

test('the runtime contract is exercised by the Functions suite, not re-implemented in this PR', async () => {
  const contract = release.runtimeTargetSecurityContracts.saveDashboardProject;
  const functionsTest = await readFile(join(repoRoot, contract.runtimeContractTest), 'utf8');
  for (const title of ['create: a project.manage PM cannot create', 'edit: an owner PM cannot hide or archive', 'Admin behavior is unchanged', 'project.manage grants create/delete only']) {
    assert.ok(functionsTest.includes(title), `Functions contract test "${title}" exists`);
  }
  assert.match(runbook, /project-visibility-authority\.test\.cjs/);
  for (const rule of contract.rules) assert.ok(rule.length > 20);
});

test('Production Hosting source includes the PR #42 conflict-reload hardening, and the runbook pins it', () => {
  const html = dashboardSource('production');
  assert.match(html, /reloaded = await loadUserPermissionsTarget\(target, reloadSequence\);/);
  assert.match(html, /the latest settings could not be loaded\. Select the user again to review them/);
  assert.match(html, /if \(select\) select\.value = '';/);
  const conflict = html.slice(html.indexOf('reloaded = await loadUserPermissionsTarget'), html.indexOf('reloaded = await loadUserPermissionsTarget') + 1400);
  const success = conflict.indexOf('The latest settings are shown');
  const failure = conflict.indexOf('could not be loaded');
  assert.ok(success >= 0 && failure > success, 'the fresh-settings claim sits only on the successful-reload branch');
  assert.match(conflict.slice(0, success), /if \(reloaded\)/);
  assert.match(release.runtimeTargetHostingContract.conflictReload, /must not claim fresh settings/);
  assert.match(runbook, /the latest settings could not be loaded/);
  assert.match(runbook, /Target Firebase Hosting contract \(PR #42 frontend\)/);
});

test('the live rollback baseline is NOT replaced by the new runtime target', () => {
  assert.notEqual(release.rollbackBaseline.sourceCommit, release.runtimeTargetSourceSha);
  assert.equal(release.rollbackBaseline.sourceCommit, 'f4244beedacb9f6cc40addc533c3e8316e56aa96');
  assert.equal(release.rollbackBaseline.sourceTreeDigest, 'e4e00a1d17b7f6ceceaf25288a830c220c2be854ff02295487c4bc951bdfcb11');
  assert.equal(release.rollbackBaseline.sourceZipSha256, '0138d5864a6f1da3056a032535efdaef33374b1a09a64d1bcade767e70ed3123');
  assert.deepEqual(release.baseline.priorRevisions, {
    createDashboardWeek: 'createdashboardweek-00005-yap', saveDashboardWeekFields: 'savedashboardweekfields-00005-yul',
    saveDashboardProject: 'savedashboardproject-00007-hit', deleteDashboardProject: 'deletedashboardproject-00005-rix',
    saveDashboardGanttTemplateSettings: 'savedashboardgantttemplatesettings-00004-fix',
    saveDashboardGanttWindowSettings: 'savedashboardganttwindowsettings-00002-pir', setDashboardWeekRelease: 'setdashboardweekrelease-00005-qey',
  });
  assert.equal(release.rollbackBaseline.functionRuntime, 'nodejs20');
  assert.match(runbook, /live Production rollback baseline is \*\*not\*\* changed|rollback baseline is \*\*not\*\* changed/);
});

test('execution freeze is measured from the post-PR #42 target: the old 1c2ec79 target no longer passes, and PR #42 paths are runtime-relevant', async () => {
  const root = await planCopy();
  try {
    for (const path of ['functions/project-dashboard-writes.js', 'index.html', 'functions/test/project-visibility-authority.test.cjs']) {
      assert.deepEqual(runtimeRelevantChanges([path]), [path]);
    }
    const gate = over => freezeInputs(root, over).then(inputs => assertExecutionFreeze(manifest, ID, inputs));
    await assert.rejects(gate({ runtimeTargetSha: '1c2ec79a4b92b3dbcc7670d95ec31b3bba021e32' }), DeploymentManifestError);
    assert.equal(await gate({ changedPaths: ['docs/production-user-permissions-v2-promotion.md', 'tests/production-promotion-v2.test.mjs'] }), true);
    await assert.rejects(gate({ changedPaths: ['functions/project-dashboard-writes.js'] }), DeploymentManifestError);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release plan validation requires the runtime-target security contract and the PR #42 record', () => {
  const mutate = edit => { const m = clone(); edit(m.releases[ID]); return m; };
  for (const [label, edit] of [
    ['contract removed', r => { delete r.runtimeTargetSecurityContracts; }],
    ['wrong refusal reason', r => { r.runtimeTargetSecurityContracts.saveDashboardProject.visibilityRefusalReason = 'other'; }],
    ['rules dropped', r => { r.runtimeTargetSecurityContracts.saveDashboardProject.rules = []; }],
    ['PR #42 not recorded', r => { r.runtimeTargetIncludedPullRequests = [39]; }],
  ]) assert.throws(() => assertReleasePlan(mutate(edit), ID), DeploymentManifestError, label);
});

// ── Final safety remediation, blocker 1: FULL rollback proves the complete runtime configuration ────────────────
const CONFIG_WRONG = {
  functionGeneration: 'GEN_1', memory: '512Mi', cpu: '2', timeoutSeconds: 540, maxInstanceRequestConcurrency: 1, maxInstanceCount: 100, ingress: 'ALLOW_INTERNAL_ONLY',
  functionRuntime: 'nodejs22', invoker: 'none', serviceAccount: `pmdash-save-project@${PROJECT}.iam.gserviceaccount.com`,
};
const NOT_NORMALIZED = {
  functionGeneration: ['GEN_1', 'gen_2', 2, null], memory: ['256M', '256MB', '0Mi', 256, '', null], cpu: [1, '0', '1 ', '', null],
  timeoutSeconds: ['60', 0, -1, 60.5, null, NaN], maxInstanceRequestConcurrency: ['80', 0, null], maxInstanceCount: ['20', 0, 1.5, null],
  ingress: ['allow_all', 'ALL', '', null], trafficRevision: ['', 'Bad Rev', null], trafficPercent: [50, 0, '100', 101, null],
};

test('FULL rollback reads back the complete pinned configuration: runtime, Gen 2, identity, invoker, memory, CPU, timeout, concurrency, max instances, ingress', () => {
  assert.deepEqual(CONFIG_FIELDS, ['memory', 'cpu', 'timeoutSeconds', 'maxInstanceRequestConcurrency', 'maxInstanceCount', 'ingress']);
  assert.deepEqual(pinned.config, { memory: '256Mi', cpu: '1', timeoutSeconds: 60, maxInstanceRequestConcurrency: 80, maxInstanceCount: 20, ingress: 'ALLOW_ALL' });
  assert.equal(pinned.functionGeneration, 'GEN_2');
  assert.equal(assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restoredSnapshot()), true);
  for (const field of ['functionGeneration', ...CONFIG_FIELDS, 'functionRuntime', 'invoker', 'serviceAccount']) {
    for (const fn of SEVEN) {
      const restored = restoredSnapshot(); restored[fn][field] = CONFIG_WRONG[field];
      expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), `${fn}.${field} wrong`);
    }
  }
});

test('FULL rollback fails closed when any required configuration or serving field is missing or not normalized (nothing is inferred)', () => {
  for (const field of [...FIELDS, 'sourceTreeDigest']) {
    for (const fn of SEVEN) {
      const restored = restoredSnapshot(); delete restored[fn][field];
      expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), `${fn}.${field} missing`);
    }
  }
  for (const [field, values] of Object.entries(NOT_NORMALIZED)) {
    for (const value of values) {
      const restored = restoredSnapshot(); restored.createDashboardWeek[field] = value;
      expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), `restored ${field}=${String(value)}`);
    }
  }
  const noConfig = restoredSnapshot();
  for (const field of CONFIG_FIELDS) delete noConfig.setDashboardWeekRelease[field];
  expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), noConfig), 'absent configuration is never read as the default');
  for (const digest of ['', 'e4e0', 'F'.repeat(64), null]) {
    const restored = restoredSnapshot(); restored.saveDashboardProject.sourceTreeDigest = digest;
    expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), `digest ${digest}`);
  }
});

test('FULL rollback requires the newly redeployed revision to serve 100% of traffic', () => {
  for (const fn of SEVEN) {
    for (const [label, edit] of [
      ['split traffic', r => { r.trafficPercent = 50; }],
      ['zero traffic', r => { r.trafficPercent = 0; }],
      ['traffic on the baseline revision', r => { r.trafficRevision = release.baseline.priorRevisions[fn]; }],
      ['traffic on an unrelated revision', r => { r.trafficRevision = `${fn.toLowerCase()}-00009-zzz`; }],
      ['no traffic record', r => { delete r.trafficRevision; delete r.trafficPercent; }],
    ]) {
      const restored = restoredSnapshot(); edit(restored[fn]);
      expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), `${fn} ${label}`);
    }
  }
});

test('the Stage 0 baseline must itself read back as the pinned rollback baseline, otherwise no rollback can verify', () => {
  assert.equal(assertBaselineMatchesPinned(manifest, ID, beforeSnapshot()), true);
  for (const fn of SEVEN) {
    for (const field of ['functionGeneration', 'functionRuntime', 'invoker', 'serviceAccount', ...CONFIG_FIELDS]) {
      const baseline = beforeSnapshot(); baseline[fn][field] = CONFIG_WRONG[field];
      expectFail(() => assertBaselineMatchesPinned(manifest, ID, baseline), `${fn}.${field} drifted from the pinned baseline`);
      expectFail(() => assertFullRollbackVerified(manifest, ID, baseline, restoredSnapshot()), `${fn}.${field} baseline drift blocks rollback verification`);
    }
    const moved = beforeSnapshot(); moved[fn].revision = moved[fn].trafficRevision = `${fn.toLowerCase()}-00099-zzz`;
    expectFail(() => assertBaselineMatchesPinned(manifest, ID, moved), `${fn} baseline revision is not the pinned revision`);
  }
});

test('snapshots reject any Function whose latest ready revision is not serving 100% of traffic', () => {
  for (const fn of ['setDashboardProjectAttention', 'setExecutiveRagOverride', 'saveDashboardProject']) {
    for (const edit of [r => { r.trafficPercent = 60; }, r => { r.trafficRevision = 'older-00001-aaa'; }, r => { r.trafficPercent = 0; }]) {
      const before = beforeSnapshot(); edit(before[fn]);
      expectFail(() => assertSnapshotComplete(manifest, ID, before, 'before'), `${fn} before`);
      const after = afterSnapshot(); edit(after[fn]);
      expectFail(() => assertSnapshotComplete(manifest, ID, after, 'after'), `${fn} after`);
    }
  }
});

test('non-selected and preserved Functions: a changed configuration, ingress or traffic is a failure', () => {
  for (const fn of [...EXECUTIVE, 'setDashboardProjectAttention', 'aggregatePresenceSessions']) {
    for (const field of [...CONFIG_FIELDS, 'functionGeneration', 'trafficRevision', 'trafficPercent']) {
      const after = afterSnapshot();
      after[fn][field] = typeof after[fn][field] === 'number' ? after[fn][field] + 1 : `${after[fn][field]}x`;
      expectFail(() => assertNonSelectedUnchanged(manifest, ID, beforeSnapshot(), after), `${fn}.${field}`);
    }
  }
});

test('forward deployment proves the intended configuration, not only runtime, identity and revision', () => {
  const target = release.targetConfiguration;
  assert.deepEqual(target.config, pinned.config, 'no source option changes the configuration; the intended values equal the baseline values');
  assert.equal(target.invoker, 'allUsers');
  assert.equal(target.functionGeneration, 'GEN_2');
  assert.equal(target.functionRuntime, 'nodejs22');
  for (const fn of EIGHT) {
    for (const field of ['functionGeneration', 'invoker', ...CONFIG_FIELDS]) {
      const after = afterSnapshot(); after[fn][field] = CONFIG_WRONG[field];
      expectFail(() => assertSelectedFunctionsDeployed(manifest, ID, beforeSnapshot(), after), `${fn}.${field}`);
      const missing = afterSnapshot(); delete missing[fn][field];
      expectFail(() => assertSelectedFunctionsDeployed(manifest, ID, beforeSnapshot(), missing), `${fn}.${field} missing`);
    }
    for (const edit of [r => { r.trafficPercent = 50; }, r => { r.trafficRevision = `${fn.toLowerCase()}-00001-aaa`; }]) {
      const after = afterSnapshot(); edit(after[fn]);
      expectFail(() => assertSelectedFunctionsDeployed(manifest, ID, beforeSnapshot(), after), `${fn} not serving 100% on the new revision`);
    }
  }
  assert.equal(assertSelectedFunctionsDeployed(manifest, ID, beforeSnapshot(), afterSnapshot()), true);
});

test('release plan validation requires explicit normalized pinned and intended configuration', () => {
  const mutate = edit => { const m = clone(); edit(m.releases[ID]); return m; };
  for (const [label, edit] of [
    ['baseline memory missing', r => { delete r.rollbackBaseline.config.memory; }],
    ['baseline ingress not an enum value', r => { r.rollbackBaseline.config.ingress = 'allow_all'; }],
    ['baseline timeout as a string', r => { r.rollbackBaseline.config.timeoutSeconds = '60'; }],
    ['baseline config removed', r => { delete r.rollbackBaseline.config; }],
    ['baseline generation missing', r => { delete r.rollbackBaseline.functionGeneration; }],
    ['baseline invoker missing', r => { delete r.rollbackBaseline.invoker; }],
    ['target configuration removed', r => { delete r.targetConfiguration; }],
    ['target invoker missing', r => { delete r.targetConfiguration.invoker; }],
    ['target max instances missing', r => { delete r.targetConfiguration.config.maxInstanceCount; }],
    ['target runtime differs from the target runtime', r => { r.targetConfiguration.functionRuntime = 'nodejs20'; }],
  ]) assert.throws(() => assertReleasePlan(mutate(edit), ID), DeploymentManifestError, label);
});

test('the runbook lists every configuration field in the rollback read-back and documents the snapshot capture sources', () => {
  const readBack = runbook.slice(runbook.indexOf('**Read-back verification'), runbook.indexOf('### Full-rollback executability'));
  for (const item of ['nodejs20', 'GEN_2', 'default compute account', 'allUsers', '`256Mi`', 'CPU = `1`', 'timeout = `60`', 'concurrency = `80`', 'max instances = `20`', 'ALLOW_ALL', 'new** live revision', '100% of traffic', 'sourceTreeDigest', 'nothing is inferred from absence']) {
    assert.ok(readBack.includes(item), `rollback read-back lists ${item}`);
  }
  const capture = runbook.slice(runbook.indexOf('## Snapshot capture'), runbook.indexOf('## Invoker strategy'));
  for (const field of [...SNAPSHOT_FIELDS, 'sourceTreeDigest']) assert.ok(capture.includes(`\`${field}\``), `capture documents ${field}`);
  for (const source of ['gcloud functions describe', 'run.googleapis.com/v2', 'trafficStatuses', 'maxInstanceRequestConcurrency', 'currently observed ingress', 'scaling.maxInstanceCount']) {
    assert.ok(capture.includes(source), `capture source ${source}`);
  }
  assert.match(capture, /orthogonal/);
  assert.match(capture, /EXECUTION_ENVIRONMENT_UNSPECIFIED/);
  assert.match(capture, /must not infer the actual sandbox/);
  assert.match(runbook, /assertBaselineMatchesPinned/);
});

// ── Final safety remediation, blocker 2: the reviewed release plan is pinned separately from the runtime source ───
async function mutatedPlan(file, edit) {
  const root = await planCopy();
  const path = join(root, file);
  await writeFile(path, edit(await readFile(path, 'utf8')));
  return root;
}
const passesGate = async (root, over = {}) => assertExecutionFreeze(manifest, ID, { ...(await freezeInputs(root, over)) });

test('SECONDARY digest checks pass for identical reviewed content after an external trusted bootstrap', async () => {
  assert.equal(await computeReleasePlanDigest(repoRoot), await computeReleasePlanDigest(repoRoot));
  assert.match(await computeReleasePlanDigest(repoRoot), /^[0-9a-f]{64}$/);
  const root = await planCopy();
  try {
    assert.equal(await computeReleasePlanDigest(root), await computeReleasePlanDigest(repoRoot), 'a byte-identical copy has the same digest');
    assert.equal(await passesGate(root), true);
  } finally { await rm(root, { recursive: true, force: true }); }
  assert.deepEqual(SAFETY_CRITICAL_PLAN_FILES, release.executionFreeze.reviewedReleasePlan.safetyCriticalFiles);
});

test('SECONDARY digest rejects changed safety-critical bytes after an external Git bootstrap', async () => {
  const reviewedDigest = await computeReleasePlanDigest(repoRoot);
  const cases = [
    // The edit must be valid enough to pass assertReleasePlan, proving the DIGEST (not the validator) refuses it.
    ['altered Function selector (reordered)', 'config/deployment-manifest.json', text => { const m = JSON.parse(text); m.releases[ID].functions.reverse(); return JSON.stringify(m, null, 2); }],
    ['altered Function identities (swapped, still unique pmdash-*)', 'config/deployment-manifest.json', text => { const m = JSON.parse(text); const a = m.releases[ID].runtimeServiceAccounts; [a.createDashboardWeek, a.saveDashboardWeekFields] = [a.saveDashboardWeekFields, a.createDashboardWeek]; return JSON.stringify(m, null, 2); }],
    ['altered Function selector (a managed Function removed from untouched)', 'config/deployment-manifest.json', text => { const m = JSON.parse(text); m.releases[ID].untouchedManagedFunctions.pop(); return JSON.stringify(m, null, 2); }],
    ['weakened snapshot assertion (new-revision check removed)', 'scripts/deployment-manifest.mjs', text => { assert.match(text, /no new revision was created/); return text.replace(/\n.*no new revision was created.*\n/, '\n'); }],
    ['weakened snapshot assertion (traffic invariant removed)', 'scripts/deployment-manifest.mjs', text => text.replace("record.trafficPercent !== 100", 'false')],
    ['weakened rollback assertion (digest comparison removed)', 'scripts/deployment-manifest.mjs', text => text.replace('record.sourceTreeDigest !== pinned.sourceTreeDigest', 'false')],
    ['modified rollback method (manifest)', 'config/deployment-manifest.json', text => text.replace('PINNED_BASELINE_SOURCE_PLUS_CONFIG_REDEPLOYMENT', 'CLOUD_RUN_TRAFFIC_SHIFT')],
    ['modified rollback method (runbook)', 'docs/production-user-permissions-v2-promotion.md', text => text.replace('FULL rollback = `PINNED BASELINE SOURCE + CONFIG REDEPLOYMENT`', 'FULL rollback = traffic shift')],
    ['modified runbook selector', 'docs/production-user-permissions-v2-promotion.md', text => text.replace('functions:setDashboardWeekRelease\n```', 'functions:setDashboardWeekRelease,functions:setDashboardProjectAttention\n```')],
    ['weakened pin test', 'tests/production-promotion-v2.test.mjs', text => text.replace("assert.equal(flag.split(',').length, 8);", '')],
    ['weakened manifest test', 'tests/deployment-manifest.test.mjs', text => `${text}\n`],
    ['whitespace-only change', 'docs/production-user-permissions-v2-promotion.md', text => `${text} `],
  ];
  for (const [label, file, edit] of cases) {
    const root = await mutatedPlan(file, edit);
    try {
      assert.notEqual(await computeReleasePlanDigest(root), reviewedDigest, `${label}: digest must change`);
      const inputs = { runtimeTargetSha: release.runtimeTargetSourceSha, reviewedReleasePlanSha: REVIEWED_SHA, reviewedReleasePlanDigest: reviewedDigest, freezeSha: REVIEWED_SHA, planRoot: root, changedPaths: PLAN_ONLY_PATHS };
      // The manifest handed to the gate is the one from the (edited) frozen checkout, exactly as at execution time.
      let editedManifest = manifest;
      try { editedManifest = await freezeManifest(root); } catch { /* an unparseable manifest is rejected by the digest first */ }
      await assert.rejects(assertExecutionFreeze(editedManifest, ID, inputs), error => error instanceof DeploymentManifestError && /release plan digest/.test(error.message), label);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('a safety-critical plan file that is deleted after review fails closed', async () => {
  for (const file of SAFETY_CRITICAL_PLAN_FILES) {
    const root = await planCopy();
    try {
      const inputs = await freezeInputs(root);
      await rm(join(root, file));
      await assert.rejects(assertExecutionFreeze(manifest, ID, inputs), DeploymentManifestError, file);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('every safety-critical file is individually covered by the pin', async () => {
  const reviewedDigest = await computeReleasePlanDigest(repoRoot);
  for (const file of SAFETY_CRITICAL_PLAN_FILES) {
    const root = await mutatedPlan(file, text => `${text}\n// changed after review\n`);
    try {
      assert.notEqual(await computeReleasePlanDigest(root), reviewedDigest, file);
      await assert.rejects(assertExecutionFreeze(manifest, ID, { runtimeTargetSha: release.runtimeTargetSourceSha, reviewedReleasePlanSha: REVIEWED_SHA, reviewedReleasePlanDigest: reviewedDigest, freezeSha: REVIEWED_SHA, planRoot: root, changedPaths: [] }), /release plan digest/, file);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('the freeze SHA must equal the independently reviewed release-plan SHA, and both pins must be well formed', async () => {
  const root = await planCopy();
  try {
    await assert.rejects(passesGate(root, { freezeSha: 'd'.repeat(40) }), /does not equal the independently reviewed release-plan SHA/);
    for (const bad of [undefined, '', 'c'.repeat(39), 'main', 'C'.repeat(40), null]) {
      await assert.rejects(passesGate(root, { reviewedReleasePlanSha: bad, freezeSha: bad }), DeploymentManifestError, `reviewed SHA ${String(bad)}`);
    }
    for (const bad of [undefined, '', 'a'.repeat(63), 'A'.repeat(64), null]) {
      await assert.rejects(passesGate(root, { reviewedReleasePlanDigest: bad }), DeploymentManifestError, `reviewed digest ${String(bad)}`);
    }
    await assert.rejects(passesGate(root, { planRoot: undefined }), DeploymentManifestError, 'no checkout root');
    await assert.rejects(passesGate(root, { reviewedReleasePlanSha: release.runtimeTargetSourceSha, freezeSha: release.runtimeTargetSourceSha }), /cannot be the runtime target source/);
    await assert.rejects(passesGate(root, { reviewedReleasePlanDigest: '0'.repeat(64) }), /release plan digest/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the manifest handed to the gate must be the manifest of the frozen checkout', async () => {
  const root = await planCopy();
  try {
    const other = clone(); other.releases[ID].functions.reverse();
    await assert.rejects(assertExecutionFreeze(other, ID, await freezeInputs(root)), /not the manifest of the frozen checkout/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a new independent review can re-pin a changed plan: the new SHA and digest pass, the old pin never carries over', async () => {
  const oldDigest = await computeReleasePlanDigest(repoRoot);
  const root = await mutatedPlan('docs/production-user-permissions-v2-promotion.md', text => `${text}\nReviewed addendum.\n`);
  try {
    const newDigest = await computeReleasePlanDigest(root);
    assert.notEqual(newDigest, oldDigest);
    const newSha = 'e'.repeat(40);
    assert.equal(await passesGate(root, { reviewedReleasePlanSha: newSha, reviewedReleasePlanDigest: newDigest, freezeSha: newSha }), true);
    await assert.rejects(passesGate(root, { reviewedReleasePlanDigest: oldDigest }), /release plan digest/);
    await assert.rejects(passesGate(root, { reviewedReleasePlanSha: newSha, reviewedReleasePlanDigest: newDigest, freezeSha: REVIEWED_SHA }), /does not equal the independently reviewed release-plan SHA/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runtime integrity is still enforced independently of the plan pin', async () => {
  const root = await planCopy();
  try {
    await assert.rejects(passesGate(root, { changedPaths: [...PLAN_ONLY_PATHS, 'functions/project-dashboard-writes.js'] }), /Runtime-relevant source changed/);
    await assert.rejects(passesGate(root, { runtimeTargetSha: 'f'.repeat(40) }), /runtime target source/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release plan validation requires the external reviewed-plan contract over the exact safety-critical files', () => {
  const mutate = edit => { const m = clone(); edit(m.releases[ID]); return m; };
  for (const [label, edit] of [
    ['contract removed', r => { delete r.executionFreeze.reviewedReleasePlan; }],
    ['not recorded outside the repository', r => { r.executionFreeze.reviewedReleasePlan.recordedOutsideRepository = false; }],
    ['freeze need not equal the reviewed SHA', r => { r.executionFreeze.reviewedReleasePlan.freezeMustEqualReviewedSha = false; }],
    ['manifest dropped from the safety-critical files', r => { r.executionFreeze.reviewedReleasePlan.safetyCriticalFiles.shift(); }],
    ['runbook dropped from the safety-critical files', r => { r.executionFreeze.reviewedReleasePlan.safetyCriticalFiles = r.executionFreeze.reviewedReleasePlan.safetyCriticalFiles.filter(f => !f.startsWith('docs/')); }],
    ['an extra file', r => { r.executionFreeze.reviewedReleasePlan.safetyCriticalFiles.push('README.md'); }],
  ]) assert.throws(() => assertReleasePlan(mutate(edit), ID), DeploymentManifestError, label);
});

test('the four pins are separate: the digest and reviewed SHA are never stored in the repository, and the runbook distinguishes all four', async () => {
  const digest = await computeReleasePlanDigest(repoRoot);
  assert.ok(!JSON.stringify(manifest).includes(digest));
  assert.ok(!runbook.includes(digest));
  assert.equal(release.executionFreeze.reviewedReleasePlan.reviewedReleasePlanSha, undefined);
  assert.notEqual(release.runtimeTargetSourceSha, release.rollbackBaseline.sourceCommit);
  const pin = runbook.slice(runbook.indexOf('## Reviewed release-plan pin'), runbook.indexOf('## Runtime target includes PR #42'));
  for (const text of ['runtime target source', 'reviewed release plan', 'execution freeze', 'live Production rollback baseline', 'recorded outside this repository', 'must equal the reviewed release-plan SHA', 'new independent review', 'computeReleasePlanDigest', 'assertExecutionFreeze', '`config/deployment-manifest.json`', '`scripts/deployment-manifest.mjs`', '`docs/production-user-permissions-v2-promotion.md`', '`tests/production-promotion-v2.test.mjs`', 'weakened snapshot assertion', 'rollback method', 'Function selector']) {
    assert.ok(pin.includes(text) || runbook.includes(text), `runbook states: ${text}`);
  }
  assert.match(runbook, /\| Reviewed release-plan SHA and digest \|/);
  assert.match(runbook, /\| Live Production rollback baseline \|/);
});

test('this remediation does not widen the release: still exactly eight Functions, eight identities, Executive preserved, UAT sync forbidden', () => {
  assert.deepEqual(release.functions, EIGHT);
  assert.deepEqual(release.runtimeServiceAccounts, IDENTITIES);
  assert.deepEqual(functionsPreservedFor(manifest, 'prod'), [...EXECUTIVE].sort());
  assert.deepEqual(manifest.environments.prod.functionsNeverDeploy.productionWeekSync, UAT_ONLY);
  assert.equal(release.rulesDeployRequired, true);
  assert.equal(release.hostingDeployRequired, true);
  assert.equal(release.productionPages.pullRequest, 40);
  assert.equal(release.runtimeTargetSourceSha, '57ef1caad37c186adfe8536b6cb22d6302fdfc21');
});

test('every snapshot field must be an explicit normalized value (no "256M", numeric CPU, string numbers or lower-case enums)', () => {
  for (const [field, values] of Object.entries(NOT_NORMALIZED)) {
    for (const value of values) {
      const before = beforeSnapshot(); before.setDashboardProjectAttention[field] = value;
      expectFail(() => assertSnapshotComplete(manifest, ID, before, 'before'), `before ${field}=${String(value)}`);
      const after = afterSnapshot(); after.setExecutiveRagOverride[field] = value;
      expectFail(() => assertSnapshotComplete(manifest, ID, after, 'after'), `after ${field}=${String(value)}`);
    }
  }
  for (const value of ['256Mi', '1Gi']) {
    const before = beforeSnapshot(); before.setDashboardProjectAttention.memory = value;
    assert.equal(assertSnapshotComplete(manifest, ID, before, 'before'), true, value);
  }
});

test('forward deployment fails when an existing Function configuration changed during the redeploy, even if the new value looks valid', () => {
  for (const [field, drifted] of [['memory', '512Mi'], ['cpu', '2'], ['timeoutSeconds', 120], ['maxInstanceRequestConcurrency', 40], ['maxInstanceCount', 50], ['ingress', 'ALLOW_INTERNAL_ONLY'], ['invoker', 'none']]) {
    for (const fn of SEVEN) {
      // before drifted from the intended value, after back at the intended value: the redeploy changed the configuration.
      const before = beforeSnapshot(); before[fn][field] = drifted;
      expectFail(() => assertSelectedFunctionsDeployed(manifest, ID, before, afterSnapshot()), `${fn}.${field} changed by the redeploy`);
    }
  }
});


// ── Final validator gaps: exact runtime role and complete baseline arithmetic ───────────────────────────────
test('assertReleasePlan accepts exactly the approved runtime role and rejects every other role or type', () => {
  const withRole = role => { const m = clone(); m.releases[ID].serviceAccountProjectRole = role; return m; };
  assert.doesNotThrow(() => assertReleasePlan(withRole('roles/datastore.user'), ID));
  for (const role of [
    'roles/pubsub.publisher', 'roles/logging.viewer', 'roles/datastore.viewer', 'roles/datastore.owner', 'roles/editor', 'roles/owner',
    'roles/iam.serviceAccountUser', 'roles/datastore', 'roles/datastore.user ', ' roles/datastore.user', 'ROLES/DATASTORE.USER',
    'roles/datastore.user,roles/logging.viewer', 'datastore.user', '', 'x', null, undefined, 7, ['roles/datastore.user'], { role: 'roles/datastore.user' },
  ]) {
    assert.throws(() => assertReleasePlan(withRole(role), ID), DeploymentManifestError, `role ${JSON.stringify(role)}`);
  }
});

test('validateManifestAgainstSource fails an otherwise valid manifest that uses a different project role', async () => {
  await assert.doesNotReject(validateManifestAgainstSource(repoRoot, manifest));
  for (const role of ['roles/pubsub.publisher', 'roles/logging.viewer', 'roles/datastore.viewer', 'roles/editor']) {
    const wrong = clone();
    wrong.releases[ID].serviceAccountProjectRole = role;
    await assert.rejects(validateManifestAgainstSource(repoRoot, wrong), DeploymentManifestError, role);
  }
});

test('the role validator keeps the sync-boundary policy intact: the script holds no datastore role literal', async () => {
  const source = await readFile(join(repoRoot, 'scripts', 'deployment-manifest.mjs'), 'utf8');
  assert.doesNotMatch(source, /roles\s*\/\s*datastore/i);
  const boundary = await readFile(join(repoRoot, 'scripts', 'verify-production-sync-boundary.mjs'), 'utf8');
  assert.match(boundary, /datastore-role-outside-policy/);
});

test('baseline inventory arithmetic is enforced: live 17 = 9 managed + 8 preserved, derived from policy, strict integers only', () => {
  assert.deepEqual([release.baseline.liveFunctionCount, release.baseline.liveManaged, release.baseline.livePreserved], [17, 9, 8]);
  assert.equal(release.baseline.livePreserved, functionsPreservedFor(manifest, 'prod').length);
  assert.equal(release.baseline.liveManaged, functionsAllowlistFor(manifest, 'prod').length - release.newFunctions.length);
  const mutate = (key, value) => { const m = clone(); m.releases[ID].baseline[key] = value; return m; };
  const cases = {
    livePreserved: [7, 0, 9, '8', -8, 8.5, null, undefined, NaN, [8]],
    liveManaged: [8, 10, 0, '9', -9, 9.5, null, undefined, NaN],
    liveFunctionCount: [16, 18, 0, '17', -17, 17.5, null, undefined, NaN],
  };
  for (const [key, values] of Object.entries(cases)) {
    for (const value of values) assert.throws(() => assertReleasePlan(mutate(key, value), ID), DeploymentManifestError, `${key}=${String(value)}`);
  }
  // Post-release counts must also be strict integers (no string concatenation surprises).
  for (const key of ['liveFunctionCount', 'managed', 'preserved']) {
    for (const value of ['18', 18.5, -1, null]) {
      const m = clone(); m.releases[ID].postRelease[key] = value;
      assert.throws(() => assertReleasePlan(m, ID), DeploymentManifestError, `postRelease.${key}=${String(value)}`);
    }
  }
  assert.doesNotThrow(() => assertReleasePlan(manifest, ID));
});

// Trust boundary 1: construction reads API GET output, never requested template state.
function observedResources(fn, normalizedRecord) {
  const serviceName = `projects/${PROJECT}/locations/us-central1/services/${fn.toLowerCase()}`;
  const name = `${serviceName}/revisions/${normalizedRecord.revision}`;
  const service = {
    name: serviceName, etag: 'observed-etag', generation: '7', observedGeneration: '7', reconciling: false,
    terminalCondition: { state: 'CONDITION_SUCCEEDED' }, latestReadyRevision: name, latestCreatedRevision: name,
    ingress: 'INGRESS_TRAFFIC_ALL', trafficStatuses: [{ revision: name, percent: 100 }], invokerIamDisabled: false,
    // Deliberately different requested state. It must never supply Revision config or serving traffic.
    template: { serviceAccount: 'wrong@example.com', timeout: '999s' }, traffic: [{ revision: 'unready', percent: 100 }],
  };
  return {
    functionResource: { state: 'ACTIVE', buildConfig: { runtime: normalizedRecord.functionRuntime }, environment: 'GEN_2',
      updateTime: normalizedRecord.updateTime, serviceConfig: { service: serviceName, revision: normalizedRecord.revision } },
    service, serviceAfter: structuredClone(service),
    revision: { name, service: serviceName, serviceAccount: normalizedRecord.serviceAccount, timeout: '60.0s',
      maxInstanceRequestConcurrency: 80, scaling: { maxInstanceCount: 20 },
      containers: [{ resources: { limits: { cpu: '1000m', memory: '256Mi' } } }] },
    iamPolicy: { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] },
    ...(normalizedRecord.sourceTreeDigest ? { sourceTreeDigest: normalizedRecord.sourceTreeDigest } : {}),
  };
}
function coherentMutation(resources, edit) {
  edit(resources); resources.serviceAfter = structuredClone(resources.service); return resources;
}

test('observed evidence uses reconciled Service GET and exact immutable Revision GET, with explicit normalization', () => {
  const fn = 'saveDashboardProject';
  assert.deepEqual(buildObservedFunctionRecord(observedResources(fn, baselineRecord(fn))), baselineRecord(fn));
  const resources = observedResources(fn, baselineRecord(fn));
  resources.revision.containers[0].resources.limits.memory = '1Gi';
  assert.equal(buildObservedFunctionRecord(resources).memory, '1024Mi');
});

test('requested ingress all / observed ingress internal fails BOTH rollback and forward deployment', () => {
  const fn = 'saveDashboardProject';
  for (const [snapshot, check] of [
    [restoredSnapshot(), snap => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), snap)],
    [afterSnapshot(), snap => assertSelectedFunctionsDeployed(manifest, ID, beforeSnapshot(), snap)],
  ]) {
    const resources = coherentMutation(observedResources(fn, snapshot[fn]), r => {
      r.service.template.ingress = 'INGRESS_TRAFFIC_ALL';
      r.service.ingress = 'INGRESS_TRAFFIC_INTERNAL_ONLY';
    });
    snapshot[fn] = buildObservedFunctionRecord(resources);
    assert.equal(snapshot[fn].ingress, 'ALLOW_INTERNAL_ONLY', 'observed ingress wins over requested configuration');
    assert.throws(() => check(snapshot), /ingress/);
  }
});

test('reconciling, generation lag, failed terminal condition, unready creation and traffic splits fail before evidence is accepted', () => {
  for (const edit of [
    r => { r.service.reconciling = true; },
    r => { r.service.observedGeneration = '6'; },
    r => { r.service.terminalCondition.state = 'CONDITION_FAILED'; },
    r => { r.service.latestCreatedRevision = `${r.service.name}/revisions/unready`; },
    r => { r.service.trafficStatuses[0].percent = 99; },
    r => { r.service.trafficStatuses.push({ revision: 'other', percent: 1 }); },
    r => { r.revision.name = `${r.service.name}/revisions/wrong`; },
    r => { r.functionResource.serviceConfig.revision = 'other'; },
    r => { delete r.revision.timeout; },
    r => { r.service.ingress = 'INGRESS_TRAFFIC_UNSPECIFIED'; },
    r => { r.service.invokerIamDisabled = true; },
    r => { r.iamPolicy.bindings[0].condition = { expression: 'true' }; },
  ]) expectFail(() => buildObservedFunctionRecord(coherentMutation(observedResources('saveDashboardProject', baselineRecord('saveDashboardProject')), edit)));
  const resources = observedResources('saveDashboardProject', baselineRecord('saveDashboardProject'));
  resources.serviceAfter.etag = 'concurrent-update';
  expectFail(() => buildObservedFunctionRecord(resources));
});

test('flattened snapshots cannot bypass reconciliation checks in forward deployment or full rollback', () => {
  for (const [field, value] of [['reconciling', true], ['observedGeneration', '6'], ['terminalConditionState', 'CONDITION_FAILED'], ['latestCreatedRevision', 'unready'], ['cloudRunExecutionEnvironmentPolicy', 'EXECUTION_ENVIRONMENT_GEN1']]) {
    for (const fn of SEVEN) {
      const restored = restoredSnapshot(); restored[fn][field] = value;
      expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), `${fn}.${field}`);
      const after = afterSnapshot(); after[fn][field] = value;
      expectFail(() => assertSelectedFunctionsDeployed(manifest, ID, beforeSnapshot(), after), `${fn}.${field}`);
    }
  }
});

// Trust boundary 2: execute the operator's shell block OUTSIDE the checkout. No repository validator is imported
// by this harness before HEAD and tracked cleanliness are proved. The throwaway validator only writes a sentinel.
const externalBootstrap = runbook.match(/# BEGIN EXTERNAL CONTROL PLANE BOOTSTRAP\n([\s\S]*?)# END EXTERNAL CONTROL PLANE BOOTSTRAP/)?.[1];
async function bootstrapFixture() {
  const holder = await mkdtemp(join(tmpdir(), 'external-release-bootstrap-'));
  const root = join(holder, 'checkout'); await mkdir(join(root, 'scripts'), { recursive: true });
  const marker = join(holder, 'validator-imported');
  await writeFile(join(root, 'scripts/deployment-manifest.mjs'), `${await readFile(join(repoRoot, 'scripts/deployment-manifest.mjs'), 'utf8')}\nimport { writeFileSync } from 'node:fs'; writeFileSync(process.env.EXTERNAL_TEST_MARKER, 'IMPORTED');\n`);
  for (const path of [...SAFETY_CRITICAL_PLAN_FILES.filter(p => p !== 'scripts/deployment-manifest.mjs'), 'README.md']) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), 'reviewed fixture\n');
  }
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Bootstrap Test'); git('config', 'user.email', 'bootstrap@example.invalid');
  git('add', '.'); git('commit', '-m', 'reviewed tree'); const reviewed = git('rev-parse', 'HEAD'); git('checkout', '--detach', reviewed);
  const run = (pin = reviewed) => spawnSync('bash', ['-c', externalBootstrap], { cwd: holder, encoding: 'utf8',
    env: { ...process.env, RELEASE_CHECKOUT: root, REVIEWED_RELEASE_PLAN_SHA: pin, EXTERNAL_TEST_MARKER: marker } });
  const imported = async () => readFile(marker, 'utf8').then(() => true, () => false);
  return { holder, root, marker, reviewed, git, run, imported };
}

test('external bootstrap exact reviewed detached SHA passes before first repository import', async () => {
  assert.ok(externalBootstrap);
  const fixture = await bootstrapFixture();
  try { assert.equal(fixture.run().status, 0); assert.equal(await fixture.imported(), true); }
  finally { await rm(fixture.holder, { recursive: true, force: true }); }
});

test('different freeze SHA and dirty tracked checkout fail BEFORE repository code is imported', async () => {
  const fixture = await bootstrapFixture();
  try {
    assert.notEqual(fixture.run('d'.repeat(40)).status, 0); assert.equal(await fixture.imported(), false);
    await writeFile(join(fixture.root, 'README.md'), 'dirty tracked content');
    assert.notEqual(fixture.run().status, 0); assert.equal(await fixture.imported(), false);
  } finally { await rm(fixture.holder, { recursive: true, force: true }); }
});

test('circular trust attack: self-modified validator drops all SHA/digest enforcement; external bootstrap still refuses before import', async () => {
  const fixture = await bootstrapFixture();
  try {
    const validatorPath = join(fixture.root, 'scripts/deployment-manifest.mjs');
    const original = await readFile(validatorPath, 'utf8');
    assert.match(original, /freezeSha !== reviewedReleasePlanSha/);
    assert.match(original, /digest !== reviewedReleasePlanDigest/);
    const start = original.indexOf('export async function assertExecutionFreeze(');
    const end = original.indexOf('// Dedicated runtime identities', start);
    assert.ok(start >= 0 && end > start);
    await writeFile(validatorPath, original.slice(0, start) + 'export async function assertExecutionFreeze() { return true; }\n\n' + original.slice(end));
    // Prove the actual modified validator would accept a bogus freeze if imported directly (the former circular design).
    const bypass = spawnSync(process.execPath, ['--input-type=module', '-e', "const m = await import('./scripts/deployment-manifest.mjs'); if (await m.assertExecutionFreeze({}, 'userPermissionsV2', { freezeSha: 'different' }) !== true) process.exit(1);"],
      { cwd: fixture.root, encoding: 'utf8', env: { ...process.env, EXTERNAL_TEST_MARKER: fixture.marker } });
    assert.equal(bypass.status, 0); assert.equal(await fixture.imported(), true);
    await rm(fixture.marker);
    // Both dirty and committed attacks are refused by Git, regardless of the validator's return value.
    assert.notEqual(fixture.run().status, 0); assert.equal(await fixture.imported(), false);
    fixture.git('add', '.'); fixture.git('commit', '-m', 'remove all enforcement');
    assert.notEqual(fixture.git('rev-parse', 'HEAD'), fixture.reviewed);
    assert.notEqual(fixture.run().status, 0); assert.equal(await fixture.imported(), false);
  } finally { await rm(fixture.holder, { recursive: true, force: true }); }
});

test('every tracked post-review edit needs a new external approval: manifest, validator, runbook, pin tests and unrelated file', async () => {
  for (const path of [...SAFETY_CRITICAL_PLAN_FILES, 'README.md']) {
    const fixture = await bootstrapFixture();
    try {
      await writeFile(join(fixture.root, path), 'post-review edit'); fixture.git('add', '.'); fixture.git('commit', '-m', 'post-review edit');
      assert.notEqual(fixture.git('rev-parse', 'HEAD'), fixture.reviewed, path);
      assert.notEqual(fixture.run().status, 0, path); assert.equal(await fixture.imported(), false, path);
    } finally { await rm(fixture.holder, { recursive: true, force: true }); }
  }
});

test('requested template settings cannot substitute for wrong or missing immutable Revision settings', () => {
  const fn = 'saveDashboardProject';
  for (const edit of [
    r => { r.revision.serviceAccount = 'wrong@example.com'; },
    r => { r.revision.timeout = '120s'; },
    r => { r.revision.maxInstanceRequestConcurrency = 40; },
    r => { r.revision.scaling.maxInstanceCount = 10; },
    r => { r.revision.containers[0].resources.limits.cpu = '2'; },
    r => { r.revision.containers[0].resources.limits.memory = '512Mi'; },
    r => { r.revision.executionEnvironment = 'EXECUTION_ENVIRONMENT_GEN1'; },
    r => { delete r.revision.serviceAccount; },
    r => { delete r.revision.scaling; },
  ]) {
    const restored = restoredSnapshot();
    const resources = observedResources(fn, restored[fn]);
    resources.service.template = structuredClone(resources.revision); // correct requested template never rescues wrong Revision
    edit(resources);
    assert.throws(() => {
      restored[fn] = buildObservedFunctionRecord(resources);
      assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored);
    }, DeploymentManifestError);
  }
});

test('external bootstrap Git read failure also prevents repository import', async () => {
  const fixture = await bootstrapFixture();
  try {
    const bin = join(fixture.holder, 'trusted-git-test'); await mkdir(bin);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    await writeFile(join(bin, 'git'), `#!/bin/bash\nfor arg in "$@"; do if [[ "$arg" == status ]]; then exit 42; fi; done\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
    const result = spawnSync('bash', ['-c', externalBootstrap], { cwd: fixture.holder, encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RELEASE_CHECKOUT: fixture.root, REVIEWED_RELEASE_PLAN_SHA: fixture.reviewed, EXTERNAL_TEST_MARKER: fixture.marker } });
    assert.notEqual(result.status, 0); assert.equal(await fixture.imported(), false);
  } finally { await rm(fixture.holder, { recursive: true, force: true }); }
});

// Final generation correction: product generation, language runtime and sandbox policy have distinct authorities.
test('Function GEN_1, missing and unreadable generation all fail, even with an explicit Cloud Run GEN2 sandbox', () => {
  for (const value of ['GEN_1', undefined, null, 'UNREADABLE']) {
    const resources = observedResources('saveDashboardProject', baselineRecord('saveDashboardProject'));
    if (value === undefined) delete resources.functionResource.environment;
    else resources.functionResource.environment = value;
    resources.revision.executionEnvironment = 'EXECUTION_ENVIRONMENT_GEN2';
    assert.throws(() => buildObservedFunctionRecord(resources), /functionGeneration/);
  }
});

test('runtime comes from Function buildConfig: rollback rejects non-nodejs20 and forward rejects non-nodejs22', () => {
  const fn = 'saveDashboardProject';
  const restored = restoredSnapshot();
  const old = observedResources(fn, restored[fn]); old.functionResource.buildConfig.runtime = 'nodejs22';
  restored[fn] = buildObservedFunctionRecord(old);
  assert.throws(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), /functionRuntime/);
  const after = afterSnapshot();
  const target = observedResources(fn, after[fn]); target.functionResource.buildConfig.runtime = 'nodejs20';
  after[fn] = buildObservedFunctionRecord(target);
  assert.throws(() => assertSelectedFunctionsDeployed(manifest, ID, beforeSnapshot(), after), /runtime/);
});

test('omitted, zero-value and explicit UNSPECIFIED Revision policy pass rollback without inferring Function generation or selected sandbox', () => {
  assert.equal(pinned.functionGeneration, 'GEN_2'); assert.equal(pinned.functionRuntime, 'nodejs20');
  assert.equal(pinned.cloudRunExecutionEnvironmentPolicy, 'EXECUTION_ENVIRONMENT_UNSPECIFIED');
  assert.equal(release.targetConfiguration.cloudRunExecutionEnvironmentPolicy, 'EXECUTION_ENVIRONMENT_UNSPECIFIED');
  for (const value of [undefined, 0, 'EXECUTION_ENVIRONMENT_UNSPECIFIED']) {
    const restored = restoredSnapshot();
    for (const fn of SEVEN) {
      const resources = observedResources(fn, restored[fn]);
      if (value === undefined) delete resources.revision.executionEnvironment;
      else resources.revision.executionEnvironment = value;
      restored[fn] = buildObservedFunctionRecord(resources);
      assert.equal(restored[fn].functionGeneration, 'GEN_2', 'only Function.environment provides product generation');
      assert.equal(restored[fn].cloudRunExecutionEnvironmentPolicy, 'EXECUTION_ENVIRONMENT_UNSPECIFIED');
      assert.notEqual(restored[fn].cloudRunExecutionEnvironmentPolicy, 'EXECUTION_ENVIRONMENT_GEN2');
    }
    assert.equal(assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), true);
  }
  for (const value of [null, '', 'unknown', 3]) {
    const resources = observedResources('saveDashboardProject', baselineRecord('saveDashboardProject'));
    resources.revision.executionEnvironment = value;
    expectFail(() => buildObservedFunctionRecord(resources));
  }
});

test('UNSPECIFIED rollback and target policies reject an explicit GEN1 or GEN2 sandbox while preserving Function GEN_2', () => {
  const fn = 'saveDashboardProject';
  for (const value of ['EXECUTION_ENVIRONMENT_GEN1', 'EXECUTION_ENVIRONMENT_GEN2']) {
    const restored = restoredSnapshot();
    const old = observedResources(fn, restored[fn]); old.revision.executionEnvironment = value;
    restored[fn] = buildObservedFunctionRecord(old);
    assert.equal(restored[fn].functionGeneration, 'GEN_2'); assert.equal(restored[fn].cloudRunExecutionEnvironmentPolicy, value);
    assert.throws(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), /cloudRunExecutionEnvironmentPolicy/);
    const after = afterSnapshot();
    const target = observedResources(fn, after[fn]); target.revision.executionEnvironment = value;
    after[fn] = buildObservedFunctionRecord(target);
    assert.throws(() => assertSelectedFunctionsDeployed(manifest, ID, beforeSnapshot(), after), /cloudRunExecutionEnvironmentPolicy/);
  }
});

test('omitted Revision policy passes observed forward deployment for all eight Functions', () => {
  const after = afterSnapshot();
  for (const fn of EIGHT) {
    const resources = observedResources(fn, after[fn]);
    assert.equal(Object.hasOwn(resources.revision, 'executionEnvironment'), false);
    after[fn] = buildObservedFunctionRecord(resources);
    assert.equal(after[fn].functionRuntime, 'nodejs22'); assert.equal(after[fn].functionGeneration, 'GEN_2');
  }
  assert.equal(assertSelectedFunctionsDeployed(manifest, ID, beforeSnapshot(), after), true);
});
