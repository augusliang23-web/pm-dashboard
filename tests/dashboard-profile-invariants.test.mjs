import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dashboardSource, environmentFor, functionInventory, rawDashboardSource } from './helpers/dashboard-source.mjs';
import { renderEnvConfig } from '../scripts/env-config.mjs';

const baselines = JSON.parse(readFileSync(new URL('./fixtures/dashboard-baselines.json', import.meta.url), 'utf8'));

function assertModuleParses(profile) {
  const source = dashboardSource(profile);
  const module = source.match(/<script type="module">\n([\s\S]*)\n<\/script>/)?.[1];
  assert.ok(module, `${profile} view has a module script`);
  const dir = mkdtempSync(join(tmpdir(), 'profile-view-'));
  try {
    const file = join(dir, `${profile}.mjs`);
    writeFileSync(file, module);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the Production profile runs every Production e1f0e5c function byte-for-byte', () => {
  const view = functionInventory(dashboardSource('production'));
  const changed = Object.entries(baselines.productionFunctions)
    .filter(([name, hash]) => view[name] !== hash)
    .map(([name]) => name);
  assert.deepEqual(changed, [], 'Production functions must be identical to the e1f0e5c baseline');
  assert.equal(Object.keys(baselines.productionFunctions).length, 389);
});

test('the UAT profile still exposes every UAT a04c0c1 function name', () => {
  const view = functionInventory(dashboardSource('uat'));
  const missing = baselines.uatFunctionNames.filter(name => !(name in view));
  assert.deepEqual(missing, []);
});

test('both profile views are valid modules with no unresolved variant or marker text', () => {
  for (const profile of ['production', 'uat']) {
    const view = dashboardSource(profile);
    assert.deepEqual([...new Set(view.match(/\b\w+__(?:prod|uat)\b/g) || [])], [], `${profile}: leftover variant names`);
    assert.doesNotMatch(view, /@profile-|@uat-only|@prod-only/, `${profile}: leftover markers`);
    assertModuleParses(profile);
  }
});

test('the committed env-config.js is exactly the Production rendering of env/prod.json', () => {
  const committed = readFileSync(new URL('../env-config.js', import.meta.url), 'utf8');
  assert.equal(committed, renderEnvConfig(environmentFor('production')));
  assert.equal(environmentFor('production').dashboardProfile, 'production');
  assert.equal(environmentFor('uat').dashboardProfile, 'uat');
});

test('index.html fails closed when the environment configuration is missing or unknown', () => {
  const raw = rawDashboardSource();
  assert.match(raw, /<script src="\.\/env-config\.js"><\/script>/);
  assert.match(raw, /\['production', 'uat'\]\.includes\(PM_ENV\.dashboardProfile\)/);
  assert.match(raw, /throw new Error\('Dashboard environment configuration is missing or invalid; refusing to start\.'\)/);
  assert.doesNotMatch(raw, /const FIREBASE_CONFIG = \{/, 'Firebase configuration must come from the environment file');
});

test('the environments name different Firebase projects and neither leaks into the other view', () => {
  const production = dashboardSource('production');
  const uat = dashboardSource('uat');
  assert.match(production, /projectId: "project-manager-dashboar-a067f"/);
  assert.doesNotMatch(production, /pm-dashboard-uat-20260820-a7f3/);
  assert.match(uat, /projectId: "pm-dashboard-uat-20260820-a7f3"/);
  assert.doesNotMatch(uat, /project-manager-dashboar-a067f/);
});

test('UAT-only capabilities are unreachable from the Production profile', () => {
  const production = dashboardSource('production');
  for (const forbidden of [/executiveApi\.\w+\(/, /uatProductionSyncController\.(open|run|start)\(/, /startProjectManagerSubscription\(isCurrentAuthInitialization\)/]) {
    assert.doesNotMatch(production.replace(/\/\/ @uat-only[\s\S]*?\/\/ @uat-only end[^\n]*\n/g, ''), forbidden, `${forbidden} must not run in Production`);
  }
});
