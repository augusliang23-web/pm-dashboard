// CONSOLIDATION NOTE: 'deployment instructions name only the exact UAT Firebase target' is skipped: the consolidated repository
// deploys to two environments. tests/deployment-manifest.test.mjs replaces it with explicit per-environment allowlists.
import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const expectedUatProject = 'pm-dashboard-uat-20260820-a7f3';
const localEmulatorProject = 'demo-pm-dashboard-v22t';

async function exists(relativePath) {
  try {
    await access(path.join(repositoryRoot, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

async function testFiles() {
  const directory = path.join(repositoryRoot, 'tests');
  return (await readdir(directory))
    .filter(file => /\.test\.(?:mjs|cjs)$/.test(file))
    .filter(file => file !== 'team2-retirement-isolation.test.mjs')
    .sort();
}

function explicitDeploymentTargets(source) {
  return [
    ...source.matchAll(/\bfirebase\s+use\s+([^\s`]+)/g),
    ...source.matchAll(/--project(?:=|\s+)([^\s`]+)/g),
  ].map(match => match[1]);
}

test('repository exposes no retired team-2 deployment entrypoint', async () => {
  assert.equal(await exists('team-2'), false, 'retired team-2 deployment entrypoint still exists');
});

test('canonical root runtime has no team-2 path dependency', async () => {
  const runtimePaths = [
    'index.html',
    'executive-timeline-core.js',
    'functions/index.js',
    'functions/project-dashboard-writes.js',
    ...((await readdir(path.join(repositoryRoot, 'js'))).map(file => `js/${file}`)),
  ];
  const sources = await Promise.all(runtimePaths.map(readRepositoryFile));

  assert.equal(
    sources.some(source => /(?:from|import|src|href)\s*=?\s*["'][^"']*team-2\//.test(source)),
    false,
    'canonical root runtime depends on retired team-2 path',
  );
});

test('root Firebase runtime is exact UAT for the UAT dashboard profile', async () => {
  const dashboard = await dashboardSourceAsync('uat');
  const rootProject = dashboard.match(/projectId\s*:\s*['"]([^'"]+)['"]/)?.[1];

  assert.equal(rootProject === expectedUatProject, true, 'root Firebase runtime is not the exact UAT target');
});

// CONSOLIDATION NOTE: the original "deployment wiring has no non-UAT target" half of this test asserted that
// .firebaserc names no project besides UAT and the local emulator. That is no longer the intended architecture:
// the consolidated repository deploys to two environments, and .firebaserc deliberately also names the Production
// project (see .firebaserc, tests/hosting-deploy-guard.test.mjs "keeps the safe demo default and adds exactly the
// uat and prod aliases"). Replaced by explicit per-environment allowlists (tests/hosting-deploy-guard.test.mjs,
// scripts/hosting-env.mjs HOSTING_TARGETS) rather than a single "must be UAT-only" assertion.
const expectedProdProject = 'project-manager-dashboar-a067f';
test('.firebaserc names only the UAT target, the Production target, and the local emulator project', async () => {
  const firebaserc = await readRepositoryFile('.firebaserc');
  const configuredProjects = Object.values(JSON.parse(firebaserc).projects || {});
  const allowed = new Set([expectedUatProject, expectedProdProject, localEmulatorProject]);

  assert.equal(
    configuredProjects.every(project => allowed.has(project)),
    true,
    `.firebaserc names a project outside the allowlist: ${JSON.stringify(configuredProjects)}`,
  );
});

test.skip('deployment instructions name only the exact UAT Firebase target', async () => {
  const sources = await Promise.all([
    readRepositoryFile('README.md'),
    readRepositoryFile('functions/README.md'),
  ]);
  const targets = sources.flatMap(explicitDeploymentTargets);

  assert.notEqual(targets.length, 0, 'deployment instructions expose no explicit Firebase target');
  assert.equal(
    targets.every(target => target === expectedUatProject),
    true,
    'deployment instructions contain a non-UAT Firebase target',
  );
});

test('canonical root tests do not read retired team-2 fixtures or HTML', async () => {
  const sources = await Promise.all((await testFiles()).map(async file => ({
    file,
    source: await readRepositoryFile(`tests/${file}`),
  })));
  const dependentTests = sources.filter(({ file, source }) => file !== 'production-business-write-boundary.test.mjs' && source.includes('team-2/'));

  assert.equal(dependentTests.length, 0, 'canonical root tests still read retired team-2 fixtures or HTML');
});

test('Phase 1 Rules and callable project-write contracts remain present', async () => {
  const [rules, dashboard, writes] = await Promise.all([
    readRepositoryFile('firestore.uat.rules'),
    dashboardSourceAsync('uat'),
    readRepositoryFile('functions/project-dashboard-writes.js'),
  ]);

  assert.match(rules, /match\s+\/weeks\/\{weekId\}[\s\S]*?allow write:\s*if false/);
  assert.match(rules, /function canReadDraftWeeks\(\)/);
  assert.match(dashboard, /projectDashboardApi\.saveProject\(\{/);
  assert.doesNotMatch(dashboard, /updateDoc\(doc\(db, ['"]weeks['"]/);
  assert.equal(writes.includes('onCall') && writes.includes('expectedRevision'), true);
});
