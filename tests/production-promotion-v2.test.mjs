// Pins the User Permissions V2 Production promotion plan (config/deployment-manifest.json `releases.userPermissionsV2`
// and docs/production-user-permissions-v2-promotion.md). Pure checks: nothing here talks to Firebase or deploys.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DeploymentManifestError, assertLiveFunctionInventory, assertNonSelectedUnchanged, assertPostReleaseInventory,
  assertPreservedFunctionsUnchanged, assertReleasePlan, buildFunctionsOnlyFlag, buildReleaseFunctionsOnlyFlag,
  functionsAllowlistFor, functionsPreservedFor, loadDeploymentManifest, readSourceServiceAccounts, releaseFor,
  validateManifestAgainstSource
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

test('preserved Executive Functions: any change in revision, runtime, identity, invoker or update time fails the runbook check', () => {
  const snapshot = {};
  for (const fn of [...LIVE_BEFORE, ...EIGHT.filter(fn => !LIVE_BEFORE.includes(fn))]) {
    snapshot[fn] = { runtime: 'nodejs20', revision: `${fn.toLowerCase()}-00001-aaa`, serviceAccount: 'default-compute', invoker: 'allUsers', updateTime: '2026-07-23T09:28:57Z' };
  }
  assert.equal(assertPreservedFunctionsUnchanged(manifest, 'prod', snapshot, structuredClone(snapshot)), true);
  for (const field of ['runtime', 'revision', 'serviceAccount', 'invoker', 'updateTime']) {
    for (const fn of EXECUTIVE) {
      const after = structuredClone(snapshot);
      after[fn][field] = 'changed';
      assert.throws(() => assertPreservedFunctionsUnchanged(manifest, 'prod', snapshot, after), error => error instanceof DeploymentManifestError && error.message.includes(fn));
    }
  }
  const missing = structuredClone(snapshot);
  delete missing.addExecutiveMilestoneUpdate;
  assert.throws(() => assertPreservedFunctionsUnchanged(manifest, 'prod', snapshot, missing), DeploymentManifestError);
});

test('non-selected Functions (attention, presence scheduler, Executive) must be unchanged; selected ones may change', () => {
  const before = Object.fromEntries(LIVE_BEFORE.map(fn => [fn, { runtime: 'nodejs20', revision: `${fn}-1`, serviceAccount: 'default-compute', invoker: 'allUsers', updateTime: 't0' }]));
  const after = structuredClone(before);
  for (const fn of EIGHT.filter(name => before[name])) after[fn] = { ...after[fn], runtime: 'nodejs22', revision: `${fn}-2`, serviceAccount: IDENTITIES[fn], updateTime: 't1' };
  after.setUserPermissionOverrides = { runtime: 'nodejs22', revision: 'new-1', serviceAccount: 'pmdash-user-perms', invoker: 'allUsers', updateTime: 't1' };
  assert.equal(assertNonSelectedUnchanged(manifest, ID, before, after), true);
  for (const fn of ['setDashboardProjectAttention', 'aggregatePresenceSessions', 'setExecutiveRagOverride']) {
    const tampered = structuredClone(after);
    tampered[fn].runtime = 'nodejs22';
    assert.throws(() => assertNonSelectedUnchanged(manifest, ID, before, tampered), error => error instanceof DeploymentManifestError && error.message.includes(fn));
  }
  const extra = structuredClone(after);
  extra.syncProductionWeeksToUat = { runtime: 'nodejs22', revision: 'x', serviceAccount: 'x', invoker: 'x', updateTime: 'x' };
  assert.throws(() => assertNonSelectedUnchanged(manifest, ID, before, extra), DeploymentManifestError);
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
  assert.equal(release.sourceMainSha, '1c2ec79a4b92b3dbcc7670d95ec31b3bba021e32');
  for (const value of [release.rollback.rulesetId, release.rollback.hostingVersion, release.rollback.hostingRelease, release.baseline.productionPagesSha, release.sourceMainSha]) {
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
