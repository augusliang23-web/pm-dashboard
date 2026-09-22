import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeDashboardRole} from '../js/dashboard-access.mjs';
import {normalizeExecutiveRole} from '../js/executive-governance.mjs';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const start = dashboard.indexOf('function getDashboardRole(userDoc) {');
const end = dashboard.indexOf('\nfunction showAuthError(', start);
assert.ok(start >= 0 && end > start, 'root dashboard role resolver must be present');

const getDashboardRole = new Function(
  'normalizeDashboardRole',
  'normalizeExecutiveRole',
  `${dashboard.slice(start, end)}; return getDashboardRole;`,
)(normalizeDashboardRole, normalizeExecutiveRole);

function userDoc(role) {
  return {
    exists: () => true,
    data: () => ({role}),
  };
}

test('root dashboard admits VIP as VIP without granting Executive identity', () => {
  assert.equal(getDashboardRole(userDoc('vip')), 'vip');
  assert.equal(normalizeExecutiveRole('vip'), '');
});

test('root dashboard cache-busts the role module when VIP access changes', () => {
  const moduleUrl = dashboard.match(/from "(\.\/js\/dashboard-access\.mjs[^\"]*)"/)?.[1];
  assert.equal(moduleUrl, './js/dashboard-access.mjs?v=vip-readonly-1');
});

test('root dashboard still rejects unknown and missing roles', () => {
  assert.throws(() => getDashboardRole(userDoc('unknown')), /missing-dashboard-role/);
  assert.throws(() => getDashboardRole({exists: () => false}), /missing-dashboard-role/);
});
