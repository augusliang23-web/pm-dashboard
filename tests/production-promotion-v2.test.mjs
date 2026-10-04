// Pins the User Permissions V2 Production promotion plan (config/deployment-manifest.json `releases.userPermissionsV2`
// and docs/production-user-permissions-v2-promotion.md). Pure checks: nothing here talks to Firebase or deploys.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DeploymentManifestError, assertExecutionFreeze, assertFullRollbackVerified, assertLiveFunctionInventory, assertNonSelectedUnchanged,
  assertPostReleaseInventory, assertPreservedFunctionsUnchanged, assertReleasePlan, assertSelectedFunctionsDeployed,
  assertSnapshotComplete, buildFunctionsOnlyFlag, buildReleaseFunctionsOnlyFlag, expectedAfterNames, expectedBeforeNames,
  functionsAllowlistFor, functionsPreservedFor, loadDeploymentManifest, readSourceServiceAccounts, releaseFor,
  runtimeRelevantChanges, validateManifestAgainstSource
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
  assert.equal(release.featureSourceMainSha, '1c2ec79a4b92b3dbcc7670d95ec31b3bba021e32');
  for (const value of [release.rollback.rulesetId, release.rollback.hostingVersion, release.rollback.hostingRelease, release.baseline.productionPagesSha, release.featureSourceMainSha]) {
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
const FIELDS = ['runtime', 'revision', 'serviceAccount', 'invoker', 'updateTime'];
const beforeNames = expectedBeforeNames(manifest, ID);
const afterNames = expectedAfterNames(manifest, ID);
const record = (fn, over = {}) => ({
  runtime: 'nodejs20', revision: `${fn.toLowerCase()}-00001-aaa`, serviceAccount: '842441149281-compute@developer.gserviceaccount.com',
  invoker: 'allUsers', updateTime: '2026-09-19T14:59:45Z', ...over,
});
const beforeSnapshot = () => Object.fromEntries(beforeNames.map(fn => [fn, record(fn)]));
function afterSnapshot() {
  const snap = Object.fromEntries(afterNames.map(fn => [fn, record(fn)]));
  for (const fn of EIGHT) {
    snap[fn] = record(fn, { runtime: 'nodejs22', revision: `${fn.toLowerCase()}-00002-bbb`, serviceAccount: `${IDENTITIES[fn]}@${PROJECT}.iam.gserviceaccount.com`, updateTime: '2026-10-10T01:00:00Z' });
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
  const bad = { runtime: ['', null, 22, 'node20', 'nodejs'], revision: ['', null, 'Bad Revision!'], serviceAccount: ['', null, 'has space'], invoker: ['', null, undefined, 'all users'], updateTime: ['', 'yesterday', null, 5] };
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
      after[fn][field] = field === 'runtime' ? 'nodejs22' : field === 'updateTime' ? '2026-12-01T00:00:00Z' : `${after[fn][field]}-changed`;
      expectFail(() => assertNonSelectedUnchanged(manifest, ID, before, after), `${fn}.${field}`);
      if (EXECUTIVE.includes(fn)) expectFail(() => assertPreservedFunctionsUnchanged(manifest, ID, before, after), `${fn}.${field}`);
    }
  }
});

test('selected Functions must end on nodejs22, their dedicated identity and a new revision', () => {
  for (const [edit, label] of [
    [(after) => { after.createDashboardWeek.runtime = 'nodejs20'; }, 'runtime'],
    [(after) => { after.saveDashboardProject.serviceAccount = '842441149281-compute@developer.gserviceaccount.com'; }, 'identity'],
    [(after) => { after.setDashboardWeekRelease.revision = 'setdashboardweekrelease-00001-aaa'; }, 'no new revision'],
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
  for (const fn of SEVEN) restored[fn] = { ...base[fn], revision: `${fn.toLowerCase()}-00003-ccc`, updateTime: '2026-10-12T00:00:00Z', sourceTreeDigest: pinned.sourceTreeDigest };
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
    restored[fn].revision = beforeSnapshot()[fn].revision;
    expectFail(() => assertFullRollbackVerified(manifest, ID, beforeSnapshot(), restored), `${fn} traffic only`);
  }
});

test('full rollback verification fails on any wrong runtime, identity, invoker, source identity or incomplete evidence', () => {
  for (const fn of SEVEN) {
    for (const [field, value] of [['runtime', 'nodejs22'], ['serviceAccount', `pmdash-save-project@${PROJECT}.iam.gserviceaccount.com`], ['invoker', 'none'], ['sourceTreeDigest', 'f'.repeat(64)]]) {
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
    ['short feature SHA', r => { r.featureSourceMainSha = '1c2ec79'; }],
    ['non-hex feature SHA', r => { r.featureSourceMainSha = 'z'.repeat(40); }],
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

test('exact approved pins are asserted for this release (least-privilege role, keys, feature source)', () => {
  assert.equal(release.serviceAccountProjectRole, 'roles/datastore.user');
  assert.equal(release.serviceAccountMaxUserManagedKeys, 0);
  assert.equal(release.environment, 'prod');
  assert.equal(release.featureSourceMainSha, '1c2ec79a4b92b3dbcc7670d95ec31b3bba021e32');
});

test('execution freeze: only plan paths may differ from the approved feature source; anything else forces a re-baseline', () => {
  const freezeSha = 'a'.repeat(40);
  const ok = ['docs/production-user-permissions-v2-promotion.md', 'tests/production-promotion-v2.test.mjs', 'config/deployment-manifest.json', 'scripts/deployment-manifest.mjs'];
  assert.equal(assertExecutionFreeze(manifest, ID, { featureSourceSha: release.featureSourceMainSha, freezeSha, changedPaths: ok }), true);
  assert.equal(assertExecutionFreeze(manifest, ID, { featureSourceSha: release.featureSourceMainSha, freezeSha, changedPaths: [] }), true);
  for (const path of ['functions/project-dashboard-writes.js', 'firestore.rules', 'index.html', 'js/permission-registry.mjs', 'package.json', 'firebase.json',
    'scripts/build-hosting.mjs', '.github/workflows/ci.yml', 'docs/../index.html', 'config/other.json', 'unknown-new-file']) {
    assert.deepEqual(runtimeRelevantChanges([path]), [path], path);
    assert.throws(() => assertExecutionFreeze(manifest, ID, { featureSourceSha: release.featureSourceMainSha, freezeSha, changedPaths: [...ok, path] }), DeploymentManifestError, path);
  }
  assert.throws(() => assertExecutionFreeze(manifest, ID, { featureSourceSha: '2'.repeat(40), freezeSha, changedPaths: [] }), DeploymentManifestError);
  assert.throws(() => assertExecutionFreeze(manifest, ID, { featureSourceSha: release.featureSourceMainSha, freezeSha: 'main', changedPaths: [] }), DeploymentManifestError);
  assert.throws(() => runtimeRelevantChanges(['']), DeploymentManifestError);
  assert.throws(() => runtimeRelevantChanges('docs/x.md'), DeploymentManifestError);
});

test('the runbook separates the approved feature source, the PR #41 candidate head and the future execution freeze', () => {
  assert.match(runbook, /Approved feature source baseline/);
  assert.match(runbook, /PR #41 release-plan candidate head/);
  assert.match(runbook, /Execution freeze SHA/);
  assert.doesNotMatch(runbook, /Verify `main` is still `1c2ec79/);
  assert.match(runbook, /git diff --name-only 1c2ec79a4b92b3dbcc7670d95ec31b3bba021e32/);
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
