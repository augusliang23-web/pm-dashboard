import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import * as boundary from '../scripts/verify-production-sync-boundary.mjs';

const { verifyProductionSyncBoundary } = boundary;

const safePolicy = JSON.stringify({
  productionProjectId: 'project-manager-dashboar-a067f',
  productionRoles: ['roles/datastore.viewer'],
  uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
  uatRoles: ['roles/datastore.user'],
  sourceCollections: ['weeks'],
});

function parsePolicy(text) {
  assert.equal(typeof boundary.parseProductionSyncBoundaryPolicy, 'function',
    'the structured policy parser must be exported');
  return boundary.parseProductionSyncBoundaryPolicy(text);
}

const safeSources = {
  policy: safePolicy,
  runtime: `
    const PRODUCTION_PROJECT_ID = 'project-manager-dashboar-a067f';
    const UAT_PROJECT_ID = 'pm-dashboard-uat-20260820-a7f3';
    const sourceDb = initializeApp({ credential: applicationDefault(), projectId: PRODUCTION_PROJECT_ID });
    async function listWeeks() { return sourceDb.collection('weeks').get(); }
    async function applyMirror() { return uatDb.collection('weeks').doc('W33').set({}); }
    const serviceAccount = 'uat-production-sync@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com';
    const options = { serviceAccount };
  `,
  deployment: 'firebase deploy --project pm-dashboard-uat-20260820-a7f3 --only functions',
  firebaseRc: JSON.stringify({ projects: { default: 'pm-dashboard-uat-20260820-a7f3' } }),
  imports: `import { createWeekSyncService } from './production-week-sync-core.js';`,
  productionRead: `
    const PRODUCTION_PROJECT_ID = 'project-manager-dashboar-a067f';
    function createProductionReadStore(productionDb) {
      return { listWeeks: async () => productionDb.collection('weeks').get() };
    }
  `,
};

function policyViolation(text, code) {
  const violations = verifyProductionSyncBoundary({ ...safeSources, policy: text });
  assert.ok(violations.some(item => item.code === code),
    `policy must report ${code}; received ${JSON.stringify(violations)}`);
}

test('the policy parser returns an immutable normalized allowlist', () => {
  const policy = parsePolicy(safePolicy);
  assert.deepEqual(policy, {
    productionProjectId: 'project-manager-dashboar-a067f',
    productionRoles: ['roles/datastore.viewer'],
    uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
    uatRoles: ['roles/datastore.user'],
    sourceCollections: ['weeks'],
  });
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy.productionRoles));
  assert.throws(() => { policy.productionRoles.push('roles/datastore.user'); }, TypeError);
});

for (const [name, text, code] of [
  ['missing a top-level key', JSON.stringify({
    productionProjectId: 'project-manager-dashboar-a067f', productionRoles: ['roles/datastore.viewer'],
    uatProjectId: 'pm-dashboard-uat-20260820-a7f3', uatRoles: ['roles/datastore.user'],
  }), 'policy-top-level-keys'],
  ['adding a top-level key', JSON.stringify({ ...JSON.parse(safePolicy), unexpected: true }), 'policy-top-level-keys'],
  ['changing Production project ID', JSON.stringify({ ...JSON.parse(safePolicy), productionProjectId: 'another-production' }), 'policy-production-project-id'],
  ['changing UAT project ID', JSON.stringify({ ...JSON.parse(safePolicy), uatProjectId: 'another-uat' }), 'policy-uat-project-id'],
  ['emptying Production roles', JSON.stringify({ ...JSON.parse(safePolicy), productionRoles: [] }), 'policy-production-roles'],
  ['duplicating Production roles', JSON.stringify({ ...JSON.parse(safePolicy), productionRoles: ['roles/datastore.viewer', 'roles/datastore.viewer'] }), 'policy-production-roles'],
  ['adding a Production write role', JSON.stringify({ ...JSON.parse(safePolicy), productionRoles: ['roles/datastore.viewer', 'roles/datastore.user'] }), 'policy-production-roles'],
  ['emptying UAT roles', JSON.stringify({ ...JSON.parse(safePolicy), uatRoles: [] }), 'policy-uat-roles'],
  ['duplicating UAT roles', JSON.stringify({ ...JSON.parse(safePolicy), uatRoles: ['roles/datastore.user', 'roles/datastore.user'] }), 'policy-uat-roles'],
  ['adding a UAT role', JSON.stringify({ ...JSON.parse(safePolicy), uatRoles: ['roles/datastore.user', 'roles/datastore.viewer'] }), 'policy-uat-roles'],
  ['omitting weeks source collection', JSON.stringify({ ...JSON.parse(safePolicy), sourceCollections: [] }), 'policy-source-collections'],
  ['duplicating weeks source collection', JSON.stringify({ ...JSON.parse(safePolicy), sourceCollections: ['weeks', 'weeks'] }), 'policy-source-collections'],
  ['adding a second source collection', JSON.stringify({ ...JSON.parse(safePolicy), sourceCollections: ['weeks', 'users'] }), 'policy-source-collections'],
  ['invalid JSON', '{', 'invalid-policy-json'],
  ['a non-object root', '[]', 'invalid-policy-shape'],
  ['a non-string array member', JSON.stringify({ ...JSON.parse(safePolicy), uatRoles: [1] }), 'policy-array-member'],
]) {
  test(`the verifier returns a structured violation when policy ${name}`, () => {
    policyViolation(text, code);
  });
}

test('the fixed read-only Production-to-UAT boundary and valid policy have no violations', () => {
  assert.deepEqual(verifyProductionSyncBoundary(safeSources), []);
});

for (const [name, code, mutation] of [
  ['caller-selected project ID', 'caller-selected-project-id', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst sourceProjectId = request.data.projectId; initializeApp({ projectId: sourceProjectId });`,
  })],
  ['second source collection', 'source-collection-not-allowlisted', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nsourceDb.collection('users').get();`,
  })],
  ['old local-sync runtime import', 'local-sync-runtime-import', sources => ({
    ...sources,
    imports: `${sources.imports}\nimport './sync-v2.2t-local-data.mjs';`,
  })],
  ['Production Firebase deploy target', 'production-deploy-target', sources => ({
    ...sources,
    deployment: `${sources.deployment}\nfirebase deploy --project project-manager-dashboar-a067f --only functions`,
  })],
  ['aliased dynamic source collection', 'source-collection-not-allowlisted', sources => ({
    ...sources,
    productionRead: `${sources.productionRead}\nconst c = request.data.collection; sourceDb.collection(c).get();`,
  })],
  ['aliased Production write API', 'production-write-capability', sources => ({
    ...sources,
    productionRead: `${sources.productionRead}\nconst p = sourceDb; p.collection('weeks').set({});`,
  })],
  ['destructured caller-selected project', 'caller-selected-project-id', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst { projectId } = request.data; initializeApp({ projectId });`,
  })],
  ['Production alias selected before deploy', 'production-deploy-target', sources => ({
    ...sources,
    deployment: `${sources.deployment}\nfirebase use production\nfirebase deploy`,
  })],
  ['safe literal source masked by environment-derived collection', 'source-collection-not-allowlisted', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nproductionDb.collection(process.env.PRODUCTION_COLLECTION).get();`,
  })],
  ['arbitrary Production handle alias with dynamic collection', 'source-collection-not-allowlisted', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst replica = productionDb; replica.collection(process.env.PRODUCTION_COLLECTION).get();`,
  })],
  ['arbitrary Production handle alias with write', 'production-write-capability', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst replica = productionDb; replica.collection('weeks').doc('W33').set({});`,
  })],
  ['Production collection reference alias with write', 'production-write-capability', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst weeksRef = productionDb.collection('weeks'); weeksRef.doc('W33').set({});`,
  })],
  ['Production document reference alias with write', 'production-write-capability', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst weeksRef = productionDb.collection('weeks'); const weekRef = weeksRef.doc('W33'); weekRef.update({ status: 'unsafe' });`,
  })],
  ['Production query reference alias with write', 'production-write-capability', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst weeksRef = productionDb.collection('weeks'); const queryRef = weeksRef.where('isReleased', '==', false); queryRef.delete();`,
  })],
  ['transitive Production reference alias with write', 'production-write-capability', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst weeksRef = productionDb.collection('weeks'); const replicaRef = weeksRef; replicaRef.doc('W33').delete();`,
  })],
  ['parenthesized Production collection reference alias with write', 'production-write-capability', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst weeksRef = (productionDb.collection('weeks')); weeksRef.doc('W33').set({});`,
  })],
  ['parenthesized Production document reference alias with write', 'production-write-capability', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst weeksRef = (productionDb.collection('weeks')); const weekRef = (weeksRef.doc('W33')); weekRef.update({ status: 'unsafe' });`,
  })],
  ['parenthesized Production query reference alias with write', 'production-write-capability', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst weeksRef = (productionDb.collection('weeks')); const queryRef = (weeksRef.where('isReleased', '==', false)); queryRef.delete();`,
  })],
  ['parenthesized transitive Production reference alias with write', 'production-write-capability', sources => ({
    ...sources,
    runtime: `${sources.runtime}\nconst weeksRef = (productionDb.collection('weeks')); const replicaRef = (weeksRef); replicaRef.doc('W33').delete();`,
  })],
]) {
  test(`the verifier rejects ${name}`, () => {
    const violations = verifyProductionSyncBoundary(mutation(safeSources));
    assert.ok(violations.length > 0, `${name} must produce a violation`);
    assert.ok(violations.some(item => item.code === code), `${name} must identify its failed guard`);
  });
}

for (const [name, source, text] of [
  ['same-line role', 'deployment', "const role = 'roles/datastore.viewer';"],
  ['multiline role', 'deployment', "const role =\n  'roles/datastore.user';"],
  ['variable alias role', 'runtime', "const datastoreRole = 'roles/datastore.viewer';"],
  ['object config role', 'deployment', "const config = { role: 'roles/datastore.user' };"],
  ['grant call role', 'deployment', "grant('Production', 'roles/datastore.viewer');"],
  ['dedicated Production read module role', 'productionRead', "const datastoreRole = 'roles/datastore.viewer';"],
]) {
  test(`the verifier rejects every datastore role outside policy: ${name}`, () => {
    const violations = verifyProductionSyncBoundary({ ...safeSources, [source]: text });
    assert.ok(violations.some(item => item.code === 'datastore-role-outside-policy' && item.source === source), name);
  });
}

for (const [name, deployment] of [
  ['equals-form project flag', 'firebase deploy --project=project-manager-dashboar-a067f --only functions'],
  ['shell continuation project flag', 'firebase deploy \\\n  --project project-manager-dashboar-a067f --only functions'],
  ['PowerShell continuation project flag', 'firebase deploy `\n  --project project-manager-dashboar-a067f --only functions'],
  ['JavaScript Production project alias', "const targetProject = 'project-manager-dashboar-a067f';\nfirebase deploy --project $targetProject --only functions"],
  ['PowerShell Production project alias', "$targetProject = 'project-manager-dashboar-a067f'\nfirebase deploy --project $targetProject --only functions"],
  ['shell Production project alias', "SYNC_TARGET='project-manager-dashboar-a067f'\nfirebase deploy --project \"$SYNC_TARGET\" --only functions"],
  ['unresolved shell project target', 'firebase deploy --project "$SYNC_TARGET" --only functions'],
]) {
  test(`the verifier rejects Production Firebase deploy target using ${name}`, () => {
    const violations = verifyProductionSyncBoundary({ ...safeSources, deployment });
    assert.ok(violations.some(item => item.code === 'production-deploy-target'), name);
  });
}

test('the verifier evaluates Firebase project variables at each deploy command', () => {
  const violations = verifyProductionSyncBoundary({
    ...safeSources,
    deployment: [
      "SYNC_TARGET='project-manager-dashboar-a067f'",
      'firebase deploy --project "$SYNC_TARGET" --only functions',
      "SYNC_TARGET='pm-dashboard-uat-20260820-a7f3'",
    ].join('\n'),
  });

  assert.ok(violations.some(item => item.code === 'production-deploy-target'));
});

test('the verifier evaluates firebase use aliases at each deploy command', () => {
  const violations = verifyProductionSyncBoundary({
    ...safeSources,
    firebaseRc: JSON.stringify({
      projects: {
        default: 'pm-dashboard-uat-20260820-a7f3',
        prod: 'project-manager-dashboar-a067f',
        uat: 'pm-dashboard-uat-20260820-a7f3',
      },
    }),
    deployment: [
      'firebase use uat',
      'firebase deploy --only functions',
      'firebase use prod',
      'firebase deploy --only functions',
    ].join('\n'),
  });

  assert.ok(violations.some(item => item.code === 'production-deploy-target'));
});

test('the verifier accepts a UAT deploy before a later reassignment with no later deploy', () => {
  assert.deepEqual(verifyProductionSyncBoundary({
    ...safeSources,
    firebaseRc: JSON.stringify({
      projects: {
        default: 'pm-dashboard-uat-20260820-a7f3',
        prod: 'project-manager-dashboar-a067f',
        uat: 'pm-dashboard-uat-20260820-a7f3',
      },
    }),
    deployment: [
      "SYNC_TARGET='pm-dashboard-uat-20260820-a7f3'",
      'firebase use uat',
      'firebase deploy --project "$SYNC_TARGET" --only functions',
      "SYNC_TARGET='project-manager-dashboar-a067f'",
      'firebase use prod',
    ].join('\n'),
  }), []);
});

test('the verifier resolves a .firebaserc Production alias used by Firebase deploy', () => {
  const violations = verifyProductionSyncBoundary({
    ...safeSources,
    firebaseRc: JSON.stringify({
      projects: {
        default: 'pm-dashboard-uat-20260820-a7f3',
        prod: 'project-manager-dashboar-a067f',
      },
    }),
    deployment: 'firebase deploy --project prod --only functions',
  });

  assert.ok(violations.some(item => item.code === 'production-deploy-target' && item.source === 'firebaseRc'));
});

test('an unrelated Production deploy target does not mask sync IAM, import, or write violations', () => {
  const unrelatedProductionDeploy = 'gcloud run deploy pm-dashboard-pdf --project project-manager-dashboar-a067f';
  assert.deepEqual(verifyProductionSyncBoundary({
    ...safeSources,
    deployment: unrelatedProductionDeploy,
  }), []);

  for (const [name, sources, code] of [
    ['IAM role', { deployment: `${unrelatedProductionDeploy}\ngrant('Production', 'roles/datastore.viewer');` }, 'datastore-role-outside-policy'],
    ['old local import', { deployment: `${unrelatedProductionDeploy}\nnode scripts/sync-v2.2t-local-data.mjs` }, 'local-sync-runtime-import'],
    ['caller-selected boundary', { deployment: `${unrelatedProductionDeploy}\nconst sourceProjectId = request.data.projectId; initializeApp({ projectId: sourceProjectId });` }, 'caller-selected-project-id'],
    ['Production write', { deployment: `${unrelatedProductionDeploy}\nproductionDb.collection('weeks').doc('W33').set({});` }, 'production-write-capability'],
  ]) {
    const violations = verifyProductionSyncBoundary({
      ...safeSources,
      deployment: unrelatedProductionDeploy,
      ...sources,
    });
    assert.ok(violations.some(item => item.code === code), name);
  }
});

test('README IAM prose is not executable scanner input', () => {
  assert.deepEqual(verifyProductionSyncBoundary(safeSources), []);
});

test('the boundary permits only the explicitly confirmed local PowerShell snapshot helper', () => {
  const approvedLocalHelper = {
    source: 'scripts/start-v2.2t-emulator.ps1',
    text: [
      'param(',
      '  [switch]$SyncProductionSnapshot',
      ')',
      'if ($SyncProductionSnapshot) {',
      "  node (Join-Path $repoRoot 'scripts\\sync-v2.2t-local-data.mjs') --allow-production-snapshot-read",
      '}',
    ].join('\n'),
  };

  assert.deepEqual(verifyProductionSyncBoundary({
    ...safeSources,
    deployment: [approvedLocalHelper],
  }), []);

  for (const deployment of [
    { ...approvedLocalHelper, text: approvedLocalHelper.text.replace(' --allow-production-snapshot-read', '') },
    { ...approvedLocalHelper, text: approvedLocalHelper.text.replace('if ($SyncProductionSnapshot) {\n', '') },
    { ...approvedLocalHelper, source: 'scripts/deploy-sync.ps1' },
  ]) {
    const violations = verifyProductionSyncBoundary({ ...safeSources, deployment: [deployment] });
    assert.ok(violations.some(item => item.code === 'local-sync-runtime-import'));
  }
});

test('the actual checkout passes the executable boundary verifier despite README IAM prose', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-production-sync-boundary.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Production sync boundary verified/);
});
