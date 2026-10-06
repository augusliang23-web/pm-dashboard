import assert from 'node:assert/strict';
import test from 'node:test';

import { CAPABILITIES, can, roleDefault } from '../js/permission-registry.mjs';
import {
  buildSwitchRows,
  configurableCapabilities,
  createUserPermissionsApi,
  describeAuditEntries,
  effectiveState,
  isPermissionConflict,
  overrideForDesiredState,
  permissionUserOptions,
  roleLabel,
  storedPermissionRevision,
  storedPermissionState,
  switchAvailability,
  switchChange,
} from '../js/user-permissions-admin.mjs';

const ROLES = ['admin', 'pm', 'engineering', 'business', 'sales', 'bd', 'product', 'vip', 'executive'];
const KEYS = ['week.manage', 'week.release', 'gantt.manage', 'project.manage'];
const rowOf = (role, stored, key) => buildSwitchRows({ role, stored }).find(row => row.key === key);

test('exactly the four reviewed delegable capabilities get a switch, in registry order, never permissions.manage', () => {
  assert.deepEqual(configurableCapabilities().map(entry => entry.key), KEYS);
  assert.deepEqual(configurableCapabilities().map(entry => entry.label), ['Manage Weeks', 'Release Week', 'Manage Gantt', 'Add / Delete Projects']);
  for (const entry of configurableCapabilities()) assert.ok(entry.description.length > 10, entry.key);
  assert.equal(configurableCapabilities().some(entry => entry.key === 'permissions.manage'), false);
});

test('the desired ON/OFF state is translated to the stored override: null when it equals the role default', () => {
  // Role default OFF: OFF -> ON stores true; ON -> OFF removes the key.
  assert.equal(overrideForDesiredState('week.manage', 'pm', true), true);
  assert.equal(overrideForDesiredState('week.manage', 'pm', false), null);
  // Role default ON (PM release): ON -> OFF stores false; OFF -> ON removes the key.
  assert.equal(overrideForDesiredState('week.release', 'pm', false), false);
  assert.equal(overrideForDesiredState('week.release', 'pm', true), null);
  assert.deepEqual(switchChange('week.release', 'pm', false), { 'week.release': false });
  assert.deepEqual(switchChange('gantt.manage', 'engineering', true), { 'gantt.manage': true });
  assert.deepEqual(switchChange('gantt.manage', 'engineering', false), { 'gantt.manage': null });
});

test('round trip for every role, capability and desired state: the stored override yields exactly the desired effective state', () => {
  for (const key of KEYS) {
    for (const role of ROLES) {
      for (const desired of [true, false]) {
        const override = overrideForDesiredState(key, role, desired);
        const { available } = switchAvailability(key, role);
        if (!available) {
          assert.equal(override, undefined, `${key}/${role}/${desired} unavailable switch sends nothing`);
          continue;
        }
        const stored = { [key]: override };
        // The stored value is what the server would persist: null removes the key, so inherit.
        const serverOverrides = override === null ? {} : { [key]: override };
        assert.equal(can(key, { role, overrides: serverOverrides }), desired, `${key}/${role}/${desired}`);
        assert.equal(effectiveState(key, role, stored), desired, `${key}/${role}/${desired} page state`);
      }
    }
  }
});

test('Admin switches are locked ON; roles that cannot receive a capability show it unavailable', () => {
  for (const key of KEYS) {
    const row = rowOf('admin', { [key]: false }, key);
    assert.deepEqual({ on: row.on, locked: row.locked, available: row.available }, { on: true, locked: true, available: false }, key);
    assert.equal(overrideForDesiredState(key, 'admin', false), undefined);
    assert.equal(switchChange(key, 'admin', false), null);
  }
  for (const role of ['vip', 'executive']) {
    for (const key of ['week.release', 'project.manage']) {
      const row = rowOf(role, {}, key);
      assert.deepEqual({ on: row.on, locked: row.locked, available: row.available }, { on: false, locked: false, available: false }, `${role}/${key}`);
      assert.match(row.note, /Not available for this role/);
    }
    for (const key of ['week.manage', 'gantt.manage']) assert.equal(rowOf(role, {}, key).available, true, `${role}/${key}`);
  }
  assert.equal(switchAvailability('week.manage', 'contractor').available, false, 'unrecognized roles can be changed in nothing');
  assert.equal(rowOf('contractor', { 'week.manage': true }, 'week.manage').on, false);
});

test('rows show the effective ON/OFF state, including a PM whose release was switched off', () => {
  assert.equal(rowOf('pm', {}, 'week.release').on, true, 'PM release is ON by role default');
  assert.equal(rowOf('pm', { 'week.release': false }, 'week.release').on, false);
  assert.equal(rowOf('pm', {}, 'week.manage').on, false);
  assert.equal(rowOf('pm', { 'week.manage': true }, 'week.manage').on, true);
  assert.equal(rowOf('engineering', { 'gantt.manage': true }, 'gantt.manage').on, true);
  assert.equal(rowOf('engineering', { 'gantt.manage': true }, 'week.manage').on, false, 'switches are independent');
  assert.equal(buildSwitchRows({ role: 'pm', stored: {}, saving: 'week.manage' }).find(row => row.key === 'week.manage').saving, true);
});

test('rows never expose the internal permission-state vocabulary', () => {
  const text = JSON.stringify(buildSwitchRows({ role: 'pm', stored: { 'week.release': false, 'week.manage': true } }));
  assert.doesNotMatch(text, /Role default|Custom|override|revision|Reset|inherit/i);
});

test('stored overrides read as tri-state internally, ignoring malformed, stale and non-configurable keys', () => {
  assert.deepEqual(storedPermissionState(undefined), Object.fromEntries(KEYS.map(key => [key, null])));
  assert.deepEqual(storedPermissionState({ 'week.manage': true, 'week.release': false, 'permissions.manage': true, stale: true }),
    { 'week.manage': true, 'week.release': false, 'gantt.manage': null, 'project.manage': null });
  assert.equal(storedPermissionState({ 'week.manage': 'true' })['week.manage'], null);
  assert.equal(storedPermissionState(['week.manage'])['week.manage'], null);
  assert.equal(storedPermissionRevision({ revision: 3 }), 3);
  for (const data of [undefined, {}, { revision: -1 }, { revision: '2' }, { revision: 1.5 }]) assert.equal(storedPermissionRevision(data), 0);
});

test('the user selector exposes only name, email and normalized role, sorted predictably', () => {
  const options = permissionUserOptions([
    { id: 'zoe@example.test', role: 'pm', displayName: 'Zoe', password: 'secret' },
    { id: 'Bonnie@Example.test', role: ' PM ', displayName: 'Bonnie' },
    { id: 'amy@example.test', role: 'vip' },
    { id: 'bob@example.test', role: 'contractor', displayName: 'bonnie' },
    { id: '' },
  ], email => `Directory ${email}`);
  assert.deepEqual(options, [
    { email: 'bob@example.test', name: 'bonnie', role: '' },
    { email: 'bonnie@example.test', name: 'Bonnie', role: 'pm' },
    { email: 'amy@example.test', name: 'Directory amy@example.test', role: 'vip' },
    { email: 'zoe@example.test', name: 'Zoe', role: 'pm' },
  ]);
  assert.equal(roleLabel('pm'), 'PM');
  assert.equal(roleLabel('executive'), 'Executive Owner');
  assert.equal(roleLabel('contractor'), 'Unrecognized role');
});

test('history is newest first, limited, and described as plain On/Off changes using the role at the time', () => {
  const at = minute => ({ toMillis: () => Date.UTC(2026, 9, 4, 12, minute) });
  const entries = [
    { at: at(1), actorEmail: 'a1@example.test', roleAtChange: 'engineering', changes: [{ capability: 'week.manage', before: null, after: true }] },
    { at: at(2), actorEmail: 'a2@example.test', roleAtChange: 'pm', changes: [{ capability: 'week.release', before: null, after: false }] },
    { at: at(3), actorEmail: 'a3@example.test', roleAtChange: 'pm', changes: [{ capability: 'week.release', before: false, after: null }] },
  ];
  const described = describeAuditEntries(entries, 2);
  assert.deepEqual(described.map(entry => entry.actorEmail), ['a3@example.test', 'a2@example.test']);
  assert.deepEqual(described[0].changes, ['Release Week: Off → On']);
  assert.deepEqual(described[1].changes, ['Release Week: On → Off'], 'a PM release switch-off reads as On → Off');
  assert.deepEqual(describeAuditEntries([entries[0]])[0].changes, ['Manage Weeks: Off → On']);
  assert.match(describeAuditEntries([{ roleAtChange: 'pm', changes: [{ capability: 'week.release', before: null, after: true }] }])[0].changes[0], /On → On/);
  assert.deepEqual(describeAuditEntries([{ changes: [{ capability: 'week.legacy', before: true, after: null }] }])[0],
    { at: 0, actorEmail: '', changes: ['week.legacy: changed'] });
});

test('conflicts are recognized by the callable reason and the API calls only setUserPermissionOverrides', async () => {
  assert.equal(isPermissionConflict({ code: 'functions/aborted', details: { reason: 'permission-revision-conflict' } }), true);
  assert.equal(isPermissionConflict({ code: 'functions/aborted', details: { reason: 'conflict' } }), false);
  const names = [];
  const api = createUserPermissionsApi({
    functions: {},
    httpsCallable: (_functions, name) => { names.push(name); return async data => ({ data: { echoed: data } }); },
  });
  assert.deepEqual(await api.setOverrides({ targetEmail: 'a@example.test' }), { echoed: { targetEmail: 'a@example.test' } });
  assert.deepEqual(names, ['setUserPermissionOverrides']);
});

test('the page model reads capability metadata from the canonical registry only', () => {
  for (const key of KEYS) {
    assert.equal(configurableCapabilities().find(entry => entry.key === key).label, CAPABILITIES[key].label);
    assert.equal(roleDefault(key, 'admin'), true);
  }
});
