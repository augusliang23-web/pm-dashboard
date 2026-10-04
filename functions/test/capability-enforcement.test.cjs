// week.release / gantt.manage / project.manage server enforcement: runs the real callables against an in-memory
// Firestore. The actor's role comes from users/{email} and overrides from userPermissions/{email}; request data and
// token claims never grant anything. Every capability is proven allowed with it, denied without it, and denied
// again once the override is removed or switched off.
const assert = require('node:assert/strict');
const test = require('node:test');

const firestorePath = require.resolve('firebase-admin/firestore');
const realFirestore = require(firestorePath);
const SERVER_TIMESTAMP = Object.freeze({ __serverTimestamp: true });
let store;

const clone = value => JSON.parse(JSON.stringify(value));
function snapshot(path) {
  const value = store.get(path);
  return { exists: value !== undefined, data: () => (value === undefined ? undefined : clone(value)) };
}
const fakeDb = {
  collection(name) {
    return { doc: id => ({ path: `${name}/${id}`, id }) };
  },
  async runTransaction(work) {
    const writes = [];
    const transaction = {
      get: async ref => snapshot(ref.path),
      create(ref, data) {
        if (store.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
        writes.push(() => store.set(ref.path, clone(data)));
      },
      update(ref, patch) {
        writes.push(() => store.set(ref.path, { ...store.get(ref.path), ...clone(patch) }));
      },
      set(ref, data, options) {
        writes.push(() => store.set(ref.path, options?.merge ? { ...store.get(ref.path), ...clone(data) } : clone(data)));
      },
    };
    const result = await work(transaction);
    writes.forEach(apply => apply());
    return result;
  },
};
require.cache[firestorePath] = {
  id: firestorePath, filename: firestorePath, loaded: true,
  exports: { ...realFirestore, getFirestore: () => fakeDb, FieldValue: { serverTimestamp: () => SERVER_TIMESTAMP } },
};
const writes = require('../project-dashboard-writes');

const USERS = {
  admin: { role: 'admin', displayName: 'Admin' },
  pm: { role: 'pm', displayName: 'Bonnie' },
  engineering: { role: 'engineering', displayName: 'Eng' },
  business: { role: 'business', displayName: 'Biz' },
  vip: { role: 'vip', displayName: 'VIP' },
  executive: { role: 'executive', displayName: 'Exec' },
};
const email = key => `${key}@example.test`;

function reset(overridesByUser = {}) {
  store = new Map();
  for (const [key, user] of Object.entries(USERS)) store.set(`users/${email(key)}`, user);
  for (const [key, overrides] of Object.entries(overridesByUser)) {
    store.set(`userPermissions/${email(key)}`, { schemaVersion: 1, overrides, revision: 1 });
  }
  store.set('executiveMilestoneState/live', { timeline: { rows: [] }, version: 1 });
  store.set('weeks/W40-2026', {
    weekLabel: 'W40 2026', weekDate: 'Sep 28 - Oct 2', isReleased: false, summary: '', version: 1,
    projects: [{ code: 'ALPHA', name: 'Alpha', owner: 'Bonnie', visibility: 'active' }, { code: 'OTHER', name: 'Other', owner: 'Someone Else', visibility: 'active' }],
  });
  store.set('weeks/W39-2026', {
    weekLabel: 'W39 2026', weekDate: 'Sep 21 - Sep 25', isReleased: true, summary: '', version: 1, projects: [],
    strategyLayer: { executiveMilestoneTimelineSnapshot: { timeline: { rows: [] } } },
  });
}
const request = (key, data, token = {}) => ({ auth: { uid: `${key}-uid`, token: { email: email(key), ...token } }, data });
async function reasonOf(promise) {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return `${error.code}/${error.details?.reason}`;
  }
}

// One entry per delegated operation. `run(key)` performs the real callable as that user.
const GANTT_TEMPLATE = { expectedRevision: 0, config: { system: ['Plan'], 'hardware-module': ['Design'] } };
const GANTT_WINDOW = { expectedRevision: 0, defaultMonths: 9, overrides: {} };
const OPERATIONS = {
  'week.release': {
    revert: (key, claims) => writes.setDashboardWeekRelease.run(request(key, { weekId: 'W39-2026', isReleased: false }, claims)),
    release: (key, claims) => writes.setDashboardWeekRelease.run(request(key, { weekId: 'W40-2026', isReleased: true }, claims)),
  },
  'gantt.manage': {
    template: (key, claims) => writes.saveDashboardGanttTemplateSettings.run(request(key, GANTT_TEMPLATE, claims)),
    window: (key, claims) => writes.saveDashboardGanttWindowSettings.run(request(key, GANTT_WINDOW, claims)),
  },
  'project.manage': {
    create: (key, claims) => writes.saveDashboardProject.run(request(key, {
      weekId: 'W40-2026', projectCode: 'BETA', isNew: true,
      project: { code: 'BETA', name: 'Beta', owner: 'Bonnie', visibility: 'active' },
    }, claims)),
    delete: (key, claims) => writes.deleteDashboardProject.run(request(key, { weekId: 'W40-2026', originalCode: 'OTHER' }, claims)),
  },
};
const DENIED = 'permission-denied/role-forbidden';

for (const [capability, operations] of Object.entries(OPERATIONS)) {
  for (const [name, run] of Object.entries(operations)) {
    test(`${capability}/${name}: Admin holds it by role default, even with stale false data`, async () => {
      reset();
      assert.equal(await reasonOf(run('admin')), 'ok');
      reset({ admin: { [capability]: false } });
      assert.equal(await reasonOf(run('admin')), 'ok');
    });

    test(`${capability}/${name}: a manual backend call is denied without the capability and forged token claims never grant it`, async () => {
      // `run` is this capability's own backend operation; the forged token claims go through that same handler.
      const forged = { role: 'admin', permissionOverrides: { [capability]: true }, admin: true };
      const denied = capability === 'week.release' || capability === 'project.manage'
        ? ['engineering', 'business', 'vip', 'executive'] : ['pm', 'engineering', 'business', 'vip', 'executive'];
      if (capability === 'project.manage') denied.push('pm');
      for (const key of denied) {
        reset();
        assert.equal(await reasonOf(run(key)), DENIED, key);
        reset();
        assert.equal(await reasonOf(run(key, forged)), DENIED, `${key} with forged claims`);
      }
    });
  }
}

test('week.release: PM keeps Release/Revert by role default with no permission document', async () => {
  reset();
  assert.equal(await reasonOf(OPERATIONS['week.release'].revert('pm')), 'ok');
  assert.equal(await reasonOf(OPERATIONS['week.release'].release('pm')), 'ok');
  assert.equal(store.get('weeks/W40-2026').isReleased, true);
});

test('week.release: an explicit OFF denies a PM, and removing it restores the role default', async () => {
  reset({ pm: { 'week.release': false } });
  assert.equal(await reasonOf(OPERATIONS['week.release'].revert('pm')), DENIED);
  assert.equal(await reasonOf(OPERATIONS['week.release'].release('pm')), DENIED);
  assert.equal(store.get('weeks/W39-2026').isReleased, true, 'the denied revert changed nothing');
  store.set('userPermissions/pm@example.test', { schemaVersion: 1, overrides: {}, revision: 2 });
  assert.equal(await reasonOf(OPERATIONS['week.release'].revert('pm')), 'ok');
});

test('week.release: only PM is grantable; a stale or forged true override never lets another role release', async () => {
  for (const key of ['engineering', 'business', 'vip', 'executive']) {
    reset({ [key]: { 'week.release': true } });
    assert.equal(await reasonOf(OPERATIONS['week.release'].revert(key)), DENIED, key);
    assert.equal(await reasonOf(OPERATIONS['week.release'].release(key)), DENIED, key);
  }
  for (const key of ['sales', 'bd', 'product']) {
    USERS[key] = { role: key, displayName: key };
    reset({ [key]: { 'week.release': true } });
    assert.equal(await reasonOf(OPERATIONS['week.release'].revert(key)), DENIED, key);
    delete USERS[key];
  }
  // PM: default ON, false -> OFF, reset (no key) -> ON again.
  reset();
  assert.equal(await reasonOf(OPERATIONS['week.release'].revert('pm')), 'ok');
  reset({ pm: { 'week.release': false } });
  assert.equal(await reasonOf(OPERATIONS['week.release'].revert('pm')), DENIED);
  reset({ pm: {} });
  assert.equal(await reasonOf(OPERATIONS['week.release'].revert('pm')), 'ok');
});

test('week.release: unrelated release validation is unchanged', async () => {
  reset();
  store.delete('executiveMilestoneState/live');
  assert.equal(await reasonOf(OPERATIONS['week.release'].release('admin')), 'failed-precondition/invalid-payload', 'the live timeline precondition still applies');
  reset();
  assert.equal(await reasonOf(writes.setDashboardWeekRelease.run(request('admin', { weekId: 'W40-2026', isReleased: 'yes' }))), 'invalid-argument/invalid-payload');
  assert.equal(await reasonOf(writes.setDashboardWeekRelease.run(request('admin', { weekId: 'W40-2026', isReleased: true, extra: 1 }))), 'invalid-argument/invalid-payload');
});

test('gantt.manage: ON allows both Gantt settings paths for any non-Admin role, and OFF or reset denies again', async () => {
  for (const key of ['pm', 'engineering', 'business', 'vip', 'executive']) {
    reset({ [key]: { 'gantt.manage': true } });
    assert.equal(await reasonOf(OPERATIONS['gantt.manage'].template(key)), 'ok', `${key} template`);
    assert.equal(await reasonOf(OPERATIONS['gantt.manage'].window(key)), 'ok', `${key} window`);
    store.set(`userPermissions/${email(key)}`, { schemaVersion: 1, overrides: { 'gantt.manage': false }, revision: 2 });
    assert.equal(await reasonOf(writes.saveDashboardGanttTemplateSettings.run(request(key, { ...GANTT_TEMPLATE, expectedRevision: 1 }))), DENIED, `${key} off`);
    store.set(`userPermissions/${email(key)}`, { schemaVersion: 1, overrides: {}, revision: 3 });
    assert.equal(await reasonOf(writes.saveDashboardGanttWindowSettings.run(request(key, { ...GANTT_WINDOW, expectedRevision: 1 }))), DENIED, `${key} reset`);
  }
});

test('gantt.manage: delegation is scoped; it grants nothing else and keeps Gantt validation and revision checks', async () => {
  reset({ engineering: { 'gantt.manage': true } });
  assert.equal(await reasonOf(OPERATIONS['project.manage'].create('engineering')), DENIED);
  assert.equal(await reasonOf(OPERATIONS['project.manage'].delete('engineering')), DENIED);
  assert.equal(await reasonOf(OPERATIONS['week.release'].revert('engineering')), DENIED);
  assert.equal(await reasonOf(writes.createDashboardWeek.run(request('engineering', { weekId: 'W41', weekLabel: 'W41', weekDate: 'x' }))), DENIED);
  assert.equal(await reasonOf(writes.saveDashboardGanttTemplateSettings.run(request('engineering', { expectedRevision: 0, config: { system: [], 'hardware-module': ['D'] } }))), 'invalid-argument/invalid-payload');
  assert.equal(await reasonOf(writes.saveDashboardGanttTemplateSettings.run(request('engineering', { ...GANTT_TEMPLATE, expectedRevision: 3 }))), 'failed-precondition/conflict');
});

test('project.manage: PM-only; ON allows create and delete on a draft week, and OFF or reset denies again', async () => {
  reset();
  assert.equal(await reasonOf(OPERATIONS['project.manage'].create('pm')), DENIED, 'PM default is OFF');
  reset({ pm: { 'project.manage': true } });
  assert.equal(await reasonOf(OPERATIONS['project.manage'].create('pm')), 'ok', 'create');
  assert.ok(store.get('weeks/W40-2026').projects.some(project => project.code === 'BETA'));
  assert.equal(await reasonOf(OPERATIONS['project.manage'].delete('pm')), 'ok', 'delete');
  assert.ok(!store.get('weeks/W40-2026').projects.some(project => project.code === 'OTHER'));
  store.set('userPermissions/pm@example.test', { schemaVersion: 1, overrides: { 'project.manage': false }, revision: 2 });
  assert.equal(await reasonOf(writes.deleteDashboardProject.run(request('pm', { weekId: 'W40-2026', originalCode: 'ALPHA' }))), DENIED, 'off');
  store.set('userPermissions/pm@example.test', { schemaVersion: 1, overrides: {}, revision: 3 });
  assert.equal(await reasonOf(OPERATIONS['project.manage'].create('pm')), DENIED, 'reset');
});

test('project.manage: no other role can be granted it, even with a stale or forged true override', async () => {
  for (const key of ['engineering', 'business', 'vip', 'executive']) {
    reset({ [key]: { 'project.manage': true } });
    assert.equal(await reasonOf(OPERATIONS['project.manage'].create(key)), DENIED, key);
    assert.equal(await reasonOf(OPERATIONS['project.manage'].delete(key)), DENIED, key);
  }
  for (const key of ['sales', 'bd', 'product']) {
    USERS[key] = { role: key, displayName: key };
    reset({ [key]: { 'project.manage': true } });
    assert.equal(await reasonOf(OPERATIONS['project.manage'].create(key)), DENIED, key);
    assert.equal(await reasonOf(OPERATIONS['project.manage'].delete(key)), DENIED, key);
    delete USERS[key];
  }
});

test('project.manage does not bypass released-week protection: create and delete on a released week fail', async () => {
  for (const [who, setup] of [['pm', { pm: { 'project.manage': true } }], ['admin', {}]]) {
    reset(setup);
    store.set('weeks/W39-2026', { ...store.get('weeks/W39-2026'), projects: [{ code: 'REL', name: 'Rel', owner: 'Bonnie', visibility: 'active' }] });
    const before = JSON.stringify(store.get('weeks/W39-2026'));
    const create = await reasonOf(writes.saveDashboardProject.run(request(who, {
      weekId: 'W39-2026', projectCode: 'NEW', isNew: true, project: { code: 'NEW', name: 'New', owner: 'Bonnie', visibility: 'active' },
    })));
    const del = await reasonOf(writes.deleteDashboardProject.run(request(who, { weekId: 'W39-2026', originalCode: 'REL' })));
    assert.match(create, /^failed-precondition\//, `${who} create`);
    assert.match(del, /^failed-precondition\//, `${who} delete`);
    assert.equal(JSON.stringify(store.get('weeks/W39-2026')), before, `${who}: the released week is unchanged`);
  }
});

test('project.manage: a PM delegate gains no other project or admin power', async () => {
  reset({ pm: { 'project.manage': true } });
  // Editing someone else's project stays ownership-based, and editing any project stays role-only (Admin).
  const other = store.get('weeks/W40-2026').projects.find(project => project.code === 'OTHER');
  const edit = key => writes.saveDashboardProject.run(request(key, {
    weekId: 'W40-2026', originalCode: 'OTHER', projectCode: 'OTHER', expectedRevision: writes.projectRevisionFingerprint(other),
    project: { code: 'OTHER', name: 'Renamed', owner: 'Someone Else', visibility: 'active' },
  }));
  assert.equal(await reasonOf(edit('pm')), 'permission-denied/ownership-forbidden');
  assert.equal(await reasonOf(edit('admin')), 'ok');
  assert.equal(await reasonOf(OPERATIONS['gantt.manage'].template('pm')), DENIED);
  assert.equal(await reasonOf(OPERATIONS['week.release'].revert('pm')), 'ok', 'PM release is its own default, independent of project.manage');
  reset({ pm: { 'project.manage': true, 'week.release': false } });
  assert.equal(await reasonOf(OPERATIONS['week.release'].revert('pm')), DENIED, 'project.manage does not imply week.release');
  assert.equal(await reasonOf(writes.createDashboardWeek.run(request('pm', { weekId: 'W41', weekLabel: 'W41', weekDate: 'x' }))), DENIED, 'nor week.manage');
});

test('project.manage: normal weekly project editing is unaffected, with or without the capability', async () => {
  const own = () => store.get('weeks/W40-2026').projects.find(project => project.code === 'ALPHA');
  const editOwn = () => writes.saveDashboardProject.run(request('pm', {
    weekId: 'W40-2026', originalCode: 'ALPHA', projectCode: 'ALPHA', expectedRevision: writes.projectRevisionFingerprint(own()),
    project: { code: 'ALPHA', name: 'Alpha v2', owner: 'Bonnie', visibility: 'active' },
  }));
  reset();
  assert.equal(await reasonOf(editOwn()), 'ok');
  assert.equal(own().name, 'Alpha v2');
  reset({ pm: { 'project.manage': false } });
  assert.equal(await reasonOf(editOwn()), 'ok', 'switching project.manage off does not remove a PM\'s own-project editing');
  assert.equal(await reasonOf(writes.setDashboardProjectAttention.run(request('pm', { weekId: 'W40-2026', projectCode: 'ALPHA', attention: 'action' }))), 'ok');
});

test('week.manage and the other capabilities are independent of each other', async () => {
  reset({ engineering: { 'week.manage': true } });
  assert.equal(await reasonOf(writes.createDashboardWeek.run(request('engineering', { weekId: 'W41-2026', weekLabel: 'W41 2026', weekDate: 'x', sourceWeekId: 'W40-2026' }))), 'ok');
  assert.equal(await reasonOf(OPERATIONS['week.release'].revert('engineering')), DENIED);
  assert.equal(await reasonOf(OPERATIONS['gantt.manage'].template('engineering')), DENIED);
  assert.equal(await reasonOf(OPERATIONS['project.manage'].create('engineering')), DENIED);
});

test('malformed or non-boolean override values never grant any delegable capability', async () => {
  for (const value of ['true', 1, {}, [], null]) {
    reset({ engineering: { 'week.release': value, 'gantt.manage': value, 'project.manage': value } });
    assert.equal(await reasonOf(OPERATIONS['week.release'].revert('engineering')), DENIED, JSON.stringify(value));
    assert.equal(await reasonOf(OPERATIONS['gantt.manage'].template('engineering')), DENIED, JSON.stringify(value));
    assert.equal(await reasonOf(OPERATIONS['project.manage'].create('engineering')), DENIED, JSON.stringify(value));
  }
});
