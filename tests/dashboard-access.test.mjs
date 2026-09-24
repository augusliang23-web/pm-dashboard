import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectManagerList,
  canReadDraftWeeks,
  isProjectManagerAccount,
  normalizeDashboardRole,
  reconcileProjectManagerFilter,
} from '../js/dashboard-access.mjs';

test('VIP remains a recognized read-only dashboard role', () => {
  assert.equal(normalizeDashboardRole(' VIP '), 'vip');
  assert.equal(canReadDraftWeeks('vip'), false);
});

test('only Admin and PM can read Draft weeks', () => {
  assert.equal(canReadDraftWeeks('admin'), true);
  assert.equal(canReadDraftWeeks('pm'), true);
  for (const role of ['sales', 'bd', 'engineering', 'product', 'executive', 'unknown']) {
    assert.equal(canReadDraftWeeks(role), false);
  }
});

test('PM list includes PM and explicitly PM-enabled Admin only', () => {
  const records = [
    { id: 'pm@example.com', role: 'pm' },
    { id: 'admin-pm@example.com', role: 'admin', isProjectManager: true },
    { id: 'admin@example.com', role: 'admin' },
    { id: 'former@example.com', role: 'bd', isProjectManager: true },
  ];

  assert.deepEqual(buildProjectManagerList(records, value => value.split('@')[0]), ['admin-pm', 'pm']);
  assert.equal(isProjectManagerAccount(records[3]), false);
  assert.equal(reconcileProjectManagerFilter('former', ['admin-pm', 'pm']), 'all');
});
