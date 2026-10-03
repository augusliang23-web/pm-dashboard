// week.manage server authorization: runs the real createDashboardWeek / saveDashboardWeekFields callables
// (and neighbouring callables that must stay unchanged) against an in-memory Firestore. The actor's role
// comes from users/{email} and overrides from userPermissions/{email}; request data and token claims never
// grant permissions.
const assert = require('node:assert/strict');
const test = require('node:test');

const firestorePath = require.resolve('firebase-admin/firestore');
const realFirestore = require(firestorePath);
let store;

function snapshot(path) {
  const value = store.get(path);
  return { exists: value !== undefined, data: () => (value === undefined ? undefined : structuredClone(value)) };
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
        writes.push(() => store.set(ref.path, structuredClone(data)));
      },
      update(ref, patch) {
        writes.push(() => {
          const next = { ...store.get(ref.path) };
          for (const [key, value] of Object.entries(patch)) next[key] = structuredClone(value);
          store.set(ref.path, next);
        });
      },
      set(ref, data) {
        writes.push(() => store.set(ref.path, structuredClone(data)));
      },
    };
    const result = await work(transaction);
    writes.forEach(apply => apply());
    return result;
  },
};

require.cache[firestorePath] = {
  id: firestorePath, filename: firestorePath, loaded: true,
  exports: { ...realFirestore, getFirestore: () => fakeDb },
};
const writes = require('../project-dashboard-writes');

const USERS = {
  admin: { role: 'admin', displayName: 'Admin' },
  pm: { role: 'pm', displayName: 'Bonnie' },
  engineering: { role: 'engineering', displayName: 'Eng' },
  business: { role: 'business', displayName: 'Business' },
  bd: { role: 'bd', displayName: 'BD' },
  sales: { role: 'sales', displayName: 'Sales' },
  product: { role: 'product', displayName: 'Product' },
  vip: { role: 'vip', displayName: 'VIP' },
  executive: { role: 'executive', displayName: 'Executive Owner' },
};

function reset(permissions = {}) {
  store = new Map();
  for (const [key, user] of Object.entries(USERS)) store.set(`users/${key}@example.test`, user);
  for (const [key, overrides] of Object.entries(permissions)) {
    store.set(`userPermissions/${key}@example.test`, { schemaVersion: 1, overrides, revision: 1 });
  }
  store.set('weeks/W40-2026', {
    weekLabel: 'W40 2026', weekDate: 'Sep 28 - Oct 2', isReleased: false, summary: '', version: 1,
    projects: [{ code: 'ALPHA', owner: 'Bonnie', visibility: 'active' }],
    strategyLayer: { projectMap: {} },
  });
}

const request = (key, data, token = {}) => ({
  auth: { uid: `${key}-uid`, token: { email: `${key}@example.test`, ...token } },
  data,
});
const createData = (extra = {}) => ({ weekId: 'W41-2026', weekLabel: 'W41 2026', weekDate: 'Oct 5 - Oct 9', sourceWeekId: 'W40-2026', ...extra });
const summaryData = (fields = { summary: 'Updated summary' }) => ({ weekId: 'W40-2026', fields });

async function reasonOf(promise) {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return `${error.code}/${error.details?.reason}`;
  }
}

test('Admin creates a week and saves the Weekly Summary by role default', async () => {
  reset();
  assert.equal(await reasonOf(writes.createDashboardWeek.run(request('admin', createData()))), 'ok');
  assert.equal(store.get('weeks/W41-2026').isReleased, false);
  assert.deepEqual(store.get('weeks/W41-2026').projects.map(project => project.code), ['ALPHA']);
  assert.equal(await reasonOf(writes.saveDashboardWeekFields.run(request('admin', summaryData()))), 'ok');
  assert.equal(store.get('weeks/W40-2026').summary, 'Updated summary');
});

test('Admin keeps week.manage when its permission document says false', async () => {
  reset({ admin: { 'week.manage': false } });
  assert.equal(await reasonOf(writes.createDashboardWeek.run(request('admin', createData()))), 'ok');
  assert.equal(await reasonOf(writes.saveDashboardWeekFields.run(request('admin', summaryData()))), 'ok');
});

test('non-Admin roles without an override are denied week creation and summary saves', async () => {
  for (const key of ['pm', 'engineering', 'business', 'sales', 'bd', 'product', 'vip', 'executive']) {
    reset();
    assert.equal(await reasonOf(writes.createDashboardWeek.run(request(key, createData()))), 'permission-denied/role-forbidden', key);
    assert.equal(await reasonOf(writes.saveDashboardWeekFields.run(request(key, summaryData()))), 'permission-denied/role-forbidden', key);
    assert.equal(store.has('weeks/W41-2026'), false, `${key} must not create a week`);
    assert.equal(store.get('weeks/W40-2026').summary, '', `${key} must not change the summary`);
  }
});

test('an explicit week.manage override lets PM, Engineering, Sales, Product, VIP and Executive create weeks and save summaries', async () => {
  for (const key of ['pm', 'engineering', 'business', 'sales', 'bd', 'product', 'vip', 'executive']) {
    reset({ [key]: { 'week.manage': true } });
    assert.equal(await reasonOf(writes.createDashboardWeek.run(request(key, createData()))), 'ok', key);
    assert.equal(store.get('weeks/W41-2026').lastModifiedBy, `${key}@example.test`);
    assert.equal(await reasonOf(writes.saveDashboardWeekFields.run(request(key, summaryData()))), 'ok', key);
  }
});

test('explicit false, malformed values, or another user\'s grant do not authorize week management', async () => {
  reset({
    pm: { 'week.manage': false },
    vip: { 'week.manage': 'true' },
    executive: { 'week.manage': 1 },
    product: { 'permissions.manage': true, 'week.release': true },
    engineering: { 'week.manage': true },
  });
  for (const key of ['pm', 'vip', 'executive', 'product', 'sales']) {
    assert.equal(await reasonOf(writes.createDashboardWeek.run(request(key, createData()))), 'permission-denied/role-forbidden', key);
    assert.equal(await reasonOf(writes.saveDashboardWeekFields.run(request(key, summaryData()))), 'permission-denied/role-forbidden', key);
  }
  store.set('userPermissions/vip@example.test', { overrides: 'week.manage' });
  assert.equal(await reasonOf(writes.createDashboardWeek.run(request('vip', createData()))), 'permission-denied/role-forbidden');
});

test('client-supplied role, permission fields or token claims never grant week.manage', async () => {
  reset();
  const claims = { role: 'admin', permissionOverrides: { 'week.manage': true } };
  assert.equal(await reasonOf(writes.createDashboardWeek.run(request('pm', createData(), claims))), 'permission-denied/role-forbidden');
  assert.equal(
    await reasonOf(writes.createDashboardWeek.run(request('pm', createData({ permissionOverrides: { 'week.manage': true } })))),
    'invalid-argument/invalid-payload',
  );
  assert.equal(
    await reasonOf(writes.saveDashboardWeekFields.run(request('pm', { ...summaryData(), role: 'admin' }))),
    'permission-denied/role-forbidden',
  );
});

test('week.manage does not open the Admin-only strategy layer', async () => {
  reset({ pm: { 'week.manage': true } });
  for (const fields of [{ strategyLayer: { projectMap: { ALPHA: {} } } }, { summary: 'S', strategyLayer: { projectMap: {} } }]) {
    assert.equal(await reasonOf(writes.saveDashboardWeekFields.run(request('pm', summaryData(fields)))), 'permission-denied/role-forbidden');
  }
  assert.deepEqual(store.get('weeks/W40-2026').strategyLayer, { projectMap: {} });
  assert.equal(store.get('weeks/W40-2026').summary, '');
  reset();
  assert.equal(await reasonOf(writes.saveDashboardWeekFields.run(request('admin', summaryData({ strategyLayer: { projectMap: {} } })))), 'ok');
});

test('week creation still does not require the source week to be released', async () => {
  for (const isReleased of [false, true]) {
    reset({ pm: { 'week.manage': true } });
    store.set('weeks/W40-2026', { ...store.get('weeks/W40-2026'), isReleased });
    assert.equal(await reasonOf(writes.createDashboardWeek.run(request('pm', createData()))), 'ok', `isReleased=${isReleased}`);
  }
});

test('week.manage does not change project, delete or release authorization', async () => {
  reset({ pm: { 'week.manage': true }, engineering: { 'week.manage': true }, vip: { 'week.manage': true } });
  assert.equal(await reasonOf(writes.setDashboardWeekRelease.run(request('vip', { weekId: 'W40-2026', isReleased: true }))), 'permission-denied/role-forbidden');
  assert.equal(await reasonOf(writes.saveDashboardGanttTemplateSettings.run(request('vip', { system: ['Plan'], 'hardware-module': ['EVT'] }))), 'permission-denied/role-forbidden');
  assert.equal(await reasonOf(writes.deleteDashboardProject.run(request('vip', { weekId: 'W40-2026', originalCode: 'ALPHA' }))), 'permission-denied/role-forbidden');
  assert.equal(await reasonOf(writes.deleteDashboardProject.run(request('pm', { weekId: 'W40-2026', originalCode: 'ALPHA' }))), 'permission-denied/role-forbidden');
  assert.equal(await reasonOf(writes.saveDashboardProject.run(request('pm', {
    weekId: 'W40-2026', projectCode: 'BETA', isNew: true,
    project: { code: 'BETA', name: 'Beta', owner: 'Bonnie', visibility: 'active' },
  }))), 'permission-denied/role-forbidden');
  assert.equal(await reasonOf(writes.setDashboardWeekRelease.run(request('engineering', { weekId: 'W40-2026', isReleased: true }))), 'permission-denied/role-forbidden');
  assert.equal(await reasonOf(writes.setDashboardProjectAttention.run(request('engineering', {
    weekId: 'W40-2026', projectCode: 'ALPHA', attention: 'action',
  }))), 'permission-denied/ownership-forbidden');
});


test('business recognition and week.manage delegation grant no neighbouring mutation privileges', async () => {
  for (const overrides of [{}, { 'week.manage': true }]) {
    reset({ business: overrides });
    const actor = writes.buildAuthenticatedActor({ uid: 'business-uid', email: 'business@example.test' }, USERS.business, { overrides });
    assert.equal(writes.canSetWeekRelease(actor.role), false);
    assert.equal(writes.canCreateProject(actor.role), false);
    assert.equal(writes.canDeleteProject(actor.role), false);
    assert.equal(writes.canManageWeekFields(actor.role), false);
    assert.equal(writes.canMutateProject({ actor, project: { owner: 'Business' } }), false);
    const denied = 'permission-denied/role-forbidden';
    assert.equal(await reasonOf(writes.saveDashboardWeekFields.run(request('business', summaryData({ strategyLayer: {} })))), denied);
    assert.equal(await reasonOf(writes.setDashboardWeekRelease.run(request('business', { weekId: 'W40-2026', isReleased: true }))), denied);
    assert.equal(await reasonOf(writes.deleteDashboardProject.run(request('business', { weekId: 'W40-2026', originalCode: 'ALPHA' }))), denied);
    assert.equal(await reasonOf(writes.saveDashboardGanttTemplateSettings.run(request('business', {}))), denied);
    assert.equal(await reasonOf(writes.saveDashboardGanttWindowSettings.run(request('business', {}))), denied);
  }
});
