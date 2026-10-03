import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PERMISSION_STATE_LABELS,
  buildPermissionRows,
  configurableCapabilities,
  createUserPermissionsApi,
  describeAuditEntries,
  draftAfterReset,
  draftAfterResetAll,
  draftAfterToggle,
  isPermissionConflict,
  permissionChanges,
  permissionUserOptions,
  roleLabel,
  storedPermissionRevision,
  storedPermissionState,
} from '../js/user-permissions-admin.mjs';

const row = (role, stored, draft = stored) => buildPermissionRows({ role, stored, draft })[0];

test('only reviewed delegable capabilities are configurable (week.manage, never permissions.manage)', () => {
  assert.deepEqual(configurableCapabilities().map(entry => entry.key), ['week.manage']);
  assert.equal(configurableCapabilities()[0].label, 'Manage Weeks');
  assert.ok(configurableCapabilities()[0].description);
});

test('stored overrides read as tri-state: true, false or null (inherit), ignoring malformed and stale keys', () => {
  assert.deepEqual(storedPermissionState(undefined), { 'week.manage': null });
  assert.deepEqual(storedPermissionState({ 'week.manage': true, 'permissions.manage': true, stale: true }), { 'week.manage': true });
  assert.deepEqual(storedPermissionState({ 'week.manage': false }), { 'week.manage': false });
  assert.deepEqual(storedPermissionState({ 'week.manage': 'true' }), { 'week.manage': null });
  assert.deepEqual(storedPermissionState(['week.manage']), { 'week.manage': null });
  assert.equal(storedPermissionRevision({ revision: 3 }), 3);
  for (const data of [undefined, {}, { revision: -1 }, { revision: '2' }, { revision: 1.5 }]) assert.equal(storedPermissionRevision(data), 0);
});

test('rows separate effective access, override state and role default', () => {
  assert.deepEqual(
    (({ effective, state, stateLabel, roleDefault, locked, canReset, dirty }) => ({ effective, state, stateLabel, roleDefault, locked, canReset, dirty }))(row('pm', { 'week.manage': null })),
    { effective: false, state: 'role-default', stateLabel: 'Role default', roleDefault: false, locked: false, canReset: false, dirty: false },
  );
  const enabled = row('pm', { 'week.manage': true });
  assert.equal(enabled.effective, true);
  assert.equal(enabled.stateLabel, 'Custom enabled');
  assert.equal(enabled.canReset, true);
  const disabled = row('engineering', { 'week.manage': false });
  assert.equal(disabled.effective, false);
  assert.equal(disabled.stateLabel, 'Custom disabled');
  assert.equal(disabled.canReset, true);
  for (const role of ['vip', 'executive', 'business', 'sales', 'bd', 'product']) {
    assert.equal(row(role, { 'week.manage': true }).effective, true, role);
  }
  assert.deepEqual(Object.values(PERMISSION_STATE_LABELS), ['Role default', 'Custom enabled', 'Custom disabled']);
});

test('Admin targets show effective access but are locked, even with stale false data', () => {
  for (const stored of [{ 'week.manage': null }, { 'week.manage': false }]) {
    const admin = row('admin', stored);
    assert.equal(admin.effective, true);
    assert.equal(admin.roleDefault, true);
    assert.equal(admin.locked, true);
    assert.equal(admin.lockReason, 'Locked for Admin');
    assert.equal(admin.canReset, false);
  }
  const unknown = row('contractor', { 'week.manage': true });
  assert.equal(unknown.locked, true);
  assert.equal(unknown.effective, false);
});

test('toggle records explicit overrides, Reset returns to inherit, and only real differences are sent', () => {
  const stored = { 'week.manage': null };
  let draft = draftAfterToggle(stored, 'week.manage', true);
  assert.deepEqual(draft, { 'week.manage': true });
  assert.equal(row('pm', stored, draft).dirty, true);
  assert.equal(row('pm', stored, draft).stateLabel, 'Custom enabled');
  assert.deepEqual(permissionChanges(stored, draft), { 'week.manage': true });
  draft = draftAfterToggle(draft, 'week.manage', false);
  assert.deepEqual(permissionChanges(stored, draft), { 'week.manage': false });
  draft = draftAfterReset(draft, 'week.manage');
  assert.deepEqual(permissionChanges(stored, draft), {});
  assert.deepEqual(permissionChanges({ 'week.manage': true }, draftAfterReset({ 'week.manage': true }, 'week.manage')), { 'week.manage': null });
  assert.deepEqual(permissionChanges({ 'week.manage': false }, draftAfterResetAll({ 'week.manage': false })), { 'week.manage': null });
  assert.deepEqual(permissionChanges({ 'week.manage': true }, { 'week.manage': true, 'permissions.manage': true }), {},
    'non-configurable draft keys are never sent');
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

test('audit history is newest first, limited, and readable', () => {
  const entries = [1, 2, 3].map(minute => ({
    at: { toMillis: () => Date.UTC(2026, 9, 3, 12, minute) },
    actorEmail: `admin${minute}@example.test`,
    changes: [{ capability: 'week.manage', before: minute === 1 ? null : true, after: minute === 3 ? null : true }],
  }));
  const described = describeAuditEntries(entries, 2);
  assert.deepEqual(described.map(entry => entry.actorEmail), ['admin3@example.test', 'admin2@example.test']);
  assert.deepEqual(described[0].changes, ['Manage Weeks: Enabled → Role default']);
  assert.deepEqual(describeAuditEntries([entries[0]])[0].changes, ['Manage Weeks: Role default → Enabled']);
  assert.deepEqual(describeAuditEntries([{ changes: [{ capability: 'week.manage', before: true, after: false }] }])[0],
    { at: 0, actorEmail: '', changes: ['Manage Weeks: Enabled → Disabled'] });
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
