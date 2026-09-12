import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { verifyProductionSyncBoundary } from '../scripts/verify-production-sync-boundary.mjs';

const safeSources = {
  runtime: `
    const PRODUCTION_PROJECT_ID = 'project-manager-dashboar-a067f';
    const UAT_PROJECT_ID = 'pm-dashboard-uat-20260820-a7f3';
    const sourceDb = initializeApp({ credential: applicationDefault(), projectId: PRODUCTION_PROJECT_ID });
    async function listWeeks() { return sourceDb.collection('weeks').get(); }
    async function applyMirror() { return uatDb.collection('weeks').doc('W33').set({}); }
    const serviceAccount = 'uat-production-sync@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com';
    const options = { serviceAccount };
  `,
  deployment: `
    firebase deploy --project pm-dashboard-uat-20260820-a7f3 --only functions
    Production access is read-only with roles/datastore.viewer.
    UAT access uses roles/datastore.user.
  `,
  imports: `import { createWeekSyncService } from './production-week-sync-core.js';`,
};

test('the fixed read-only Production-to-UAT boundary has no violations', () => {
  assert.deepEqual(verifyProductionSyncBoundary(safeSources), []);
});

for (const [name, code, mutation] of [
  ['Production write role', 'production-write-role', sources => ({
    ...sources,
    deployment: `${sources.deployment}\nProduction service account: roles/datastore.user`,
  })],
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
]) {
  test(`the verifier rejects ${name}`, () => {
    const violations = verifyProductionSyncBoundary(mutation(safeSources));
    assert.ok(violations.length > 0, `${name} must produce a violation`);
    assert.ok(violations.some(item => item.code === code), `${name} must identify its failed guard`);
  });
}

test('the actual checkout passes the executable boundary verifier', async () => {
  const result = spawnSync(process.execPath, ['scripts/verify-production-sync-boundary.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Production sync boundary verified/);
});
