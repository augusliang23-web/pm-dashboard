// Production Pages is a Production-only surface. These checks fail if any UAT binding, UAT-only control or UAT
// profile machinery arrives with a port from main, and verify the module asset closure of index.html.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tests/production-pages-bindings.test.mjs';
const PRODUCTION_PROJECT = 'project-manager-dashboar-a067f';
const FORBIDDEN = [
  'pm-dashboard-uat-20260820-a7f3', 'pm-dashboard-uat-pdf', 'b266ahac7q',
  'syncProductionWeeksToUat', 'getProductionWeekSyncStatus', 'restoreUatWeeksSnapshot',
  'IS_UAT_PROFILE', '@profile-', '@uat-only', 'dashboardProfile: "uat"', 'uat-production-sync',
];

const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
// Source that runs in the browser or is published with the page. Tests, docs and lock files are not a binding surface.
const surface = tracked.filter(file => /^(index\.html|[^/]+\.(?:js|mjs)|js\/[^/]+\.mjs|firebase[^/]*\.json|firestore\.rules)$/.test(file) && file !== SELF);

test('no UAT binding, UAT-only control or UAT profile marker exists on the Production Pages surface', () => {
  assert.ok(surface.includes('index.html') && surface.includes('js/permission-registry.mjs'));
  for (const file of surface) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const marker of FORBIDDEN) assert.ok(!text.includes(marker), `${file} must not contain ${marker}`);
  }
});

test('index.html is bound to the Production Firebase project only', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.ok(html.includes(`projectId: "${PRODUCTION_PROJECT}"`));
  const projectIds = new Set([...html.matchAll(/projectId:\s*"([^"]+)"/g)].map(match => match[1]));
  assert.deepEqual([...projectIds], [PRODUCTION_PROJECT]);
  assert.ok(!/pm-dashboard-uat/.test(html));
});

test('the permissions modules are the pinned PR #39 files and import nothing outside the Production surface', () => {
  for (const file of ['js/permission-registry.mjs', 'js/user-permissions-admin.mjs']) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const specifier of [...text.matchAll(/^import\s[^;]*from\s+['"]([^'"]+)['"]/gm)].map(match => match[1])) {
      assert.match(specifier, /^\.\/permission-registry\.mjs$/, `${file} may only import the registry`);
    }
  }
});

test('module asset closure: every local module imported by index.html and by those modules exists', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const queue = [...html.matchAll(/from\s+["'](\.[^"']+?)(?:\?[^"']*)?["']/g)].map(match => match[1]);
  const seen = new Set();
  while (queue.length) {
    const relative = queue.pop();
    const target = relative.replace(/^\.\//, '');
    if (seen.has(target)) continue;
    seen.add(target);
    assert.ok(existsSync(join(root, target)), `index.html closure is missing ${target}`);
    if (/\.m?js$/.test(target)) {
      const text = readFileSync(join(root, target), 'utf8');
      for (const match of text.matchAll(/(?:from|import)\s*["'](\.[^"']+?)(?:\?[^"']*)?["']/g)) {
        queue.push(join(dirname(target), match[1]).replace(/^\.\//, ''));
      }
    }
  }
  for (const required of ['js/permission-registry.mjs', 'js/user-permissions-admin.mjs', 'sync-core.js']) assert.ok(seen.has(required), `${required} must be part of the closure`);
});

test('Production Pages carries no backend port: no Functions permission source, rules, or deployment manifest changes', () => {
  assert.ok(!tracked.includes('functions/user-permissions.js'));
  assert.ok(!tracked.includes('functions/permission-registry.js'));
  assert.ok(!tracked.includes('config/deployment-manifest.json'));
  assert.ok(!tracked.some(file => /^firestore\.(?:uat|shared-backend)\.rules$/.test(file)));
  assert.ok(!/userPermissions/.test(readFileSync(join(root, 'firestore.rules'), 'utf8')), 'Pages firestore.rules is the pre-existing Production file; rules ship from main, not this branch');
});
