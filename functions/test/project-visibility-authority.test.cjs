// Project visibility (Active / Hidden / Archived) is Admin-only. The browser hides the control, but a callable payload can
// still carry the field, so the server must refuse a forged value from every non-Admin: on create (project.manage) and on
// edit (owner PM). Every non-Admin role only ever sees Active projects, so a forged value would conceal the project.
// Runs the real saveDashboardProject callable against an in-memory Firestore.
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
};
const email = key => `${key}@example.test`;
const WEEK = 'weeks/W40-2026';

function reset({ overrides = {}, projects } = {}) {
  store = new Map();
  for (const [key, user] of Object.entries(USERS)) store.set(`users/${email(key)}`, user);
  for (const [key, value] of Object.entries(overrides)) {
    store.set(`userPermissions/${email(key)}`, { schemaVersion: 1, overrides: value, revision: 1 });
  }
  store.set(WEEK, {
    weekLabel: 'W40 2026', weekDate: 'Sep 28 - Oct 2', isReleased: false, summary: '', version: 1,
    projects: projects || [
      { code: 'ALPHA', name: 'Alpha', owner: 'Bonnie', visibility: 'active' },
      { code: 'GHOST', name: 'Ghost', owner: 'Bonnie', visibility: 'hidden' },
      { code: 'LEGACY', name: 'Legacy', owner: 'Bonnie' },
    ],
  });
}
const request = (key, data, token = {}) => ({ auth: { uid: `${key}-uid`, token: { email: email(key), ...token } }, data });
const project = code => store.get(WEEK).projects.find(entry => entry.code === code);
const codes = () => store.get(WEEK).projects.map(entry => entry.code);
async function reasonOf(promise) {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return `${error.code}/${error.details?.reason}`;
  }
}

const create = (key, visibility, extra = {}, claims) => writes.saveDashboardProject.run(request(key, {
  weekId: 'W40-2026', projectCode: 'BETA', isNew: true,
  project: { code: 'BETA', name: 'Beta', owner: 'Bonnie', ...(visibility === undefined ? {} : { visibility }), ...extra },
}, claims));
const edit = (key, code, visibility, claims) => writes.saveDashboardProject.run(request(key, {
  weekId: 'W40-2026', originalCode: code, projectCode: code, expectedRevision: writes.projectRevisionFingerprint(project(code)),
  project: { code, name: `${code} renamed`, owner: 'Bonnie', ...(visibility === undefined ? {} : { visibility }) },
}, claims));
const FORBIDDEN = 'permission-denied/visibility-admin-only';
const FORGED_VALUES = ['hidden', 'archived', 'Hidden', 'ARCHIVED', 'anything-else', ' hidden', true, 1, { value: 'hidden' }, ['hidden']];

test('create: a project.manage PM cannot create a project that is Hidden, Archived or any non-Active value', async () => {
  for (const value of FORGED_VALUES) {
    reset({ overrides: { pm: { 'project.manage': true } } });
    assert.equal(await reasonOf(create('pm', value)), FORBIDDEN, JSON.stringify(value));
    assert.deepEqual(codes(), ['ALPHA', 'GHOST', 'LEGACY'], `${JSON.stringify(value)}: nothing was created`);
  }
});

test('create: forged token claims and request fields never grant the visibility authority', async () => {
  reset({ overrides: { pm: { 'project.manage': true } } });
  const claims = { role: 'admin', admin: true, permissionOverrides: { 'project.manage': true } };
  assert.equal(await reasonOf(create('pm', 'hidden', {}, claims)), FORBIDDEN);
  assert.deepEqual(codes(), ['ALPHA', 'GHOST', 'LEGACY']);
});

test('create: project.manage still creates normal Active projects, however Active is expressed', async () => {
  for (const [value, label] of [['active', 'active'], [undefined, 'omitted'], ['', 'empty'], [null, 'null']]) {
    reset({ overrides: { pm: { 'project.manage': true } } });
    assert.equal(await reasonOf(create('pm', value)), 'ok', label);
    assert.deepEqual(codes(), ['ALPHA', 'GHOST', 'LEGACY', 'BETA'], label);
    assert.ok(['active', '', null, undefined].includes(project('BETA').visibility), `${label}: stored as Active`);
  }
});

test('create: the capability check still comes first, so a PM without project.manage is refused for the capability', async () => {
  reset();
  assert.equal(await reasonOf(create('pm', 'hidden')), 'permission-denied/role-forbidden');
  assert.equal(await reasonOf(create('pm', 'active')), 'permission-denied/role-forbidden');
  reset({ overrides: { pm: { 'project.manage': false } } });
  assert.equal(await reasonOf(create('pm', 'hidden')), 'permission-denied/role-forbidden');
  assert.deepEqual(codes(), ['ALPHA', 'GHOST', 'LEGACY']);
});

test('edit: an owner PM cannot hide or archive their own project through a direct payload', async () => {
  for (const value of FORGED_VALUES) {
    reset();
    assert.equal(await reasonOf(edit('pm', 'ALPHA', value)), FORBIDDEN, JSON.stringify(value));
    assert.equal(project('ALPHA').visibility, 'active', `${JSON.stringify(value)}: visibility unchanged`);
    assert.equal(project('ALPHA').name, 'Alpha', `${JSON.stringify(value)}: nothing else was saved`);
  }
});

test('edit: a non-Admin cannot un-hide or re-activate a project an Admin hid, and cannot change it to another hidden state', async () => {
  for (const value of ['active', '', null, 'archived', 'anything-else']) {
    reset();
    assert.equal(await reasonOf(edit('pm', 'GHOST', value)), FORBIDDEN, JSON.stringify(value));
    assert.equal(project('GHOST').visibility, 'hidden', `${JSON.stringify(value)}: still hidden`);
    assert.equal(project('GHOST').name, 'Ghost');
  }
});

test('edit: normal owner editing is unchanged when visibility is echoed, empty-equivalent or omitted', async () => {
  reset();
  // The editor always sends the current visibility (the hidden control is pre-filled), so echoing must keep working.
  assert.equal(await reasonOf(edit('pm', 'ALPHA', 'active')), 'ok');
  assert.equal(project('ALPHA').name, 'ALPHA renamed');
  assert.equal(await reasonOf(edit('pm', 'GHOST', 'hidden')), 'ok', 'echoing an Admin-set Hidden value is not a change');
  assert.equal(project('GHOST').visibility, 'hidden');
  assert.equal(await reasonOf(edit('pm', 'ALPHA')), 'ok', 'an omitted visibility leaves the stored value alone');
  assert.equal(project('ALPHA').visibility, 'active');
  // A legacy project with no stored visibility is Active; sending 'active' or empty is not a change.
  assert.equal(await reasonOf(edit('pm', 'LEGACY', 'active')), 'ok');
  assert.equal(await reasonOf(edit('pm', 'LEGACY', '')), 'ok');
  assert.equal(await reasonOf(edit('pm', 'LEGACY', 'hidden')), FORBIDDEN, 'but a legacy Active project cannot be hidden');
});

test('edit: a project.manage holder who does not own the project is still refused for ownership, not visibility', async () => {
  reset({ overrides: { pm: { 'project.manage': true } }, projects: [{ code: 'OTHER', name: 'Other', owner: 'Someone Else', visibility: 'active' }] });
  assert.equal(await reasonOf(edit('pm', 'OTHER', 'hidden')), 'permission-denied/ownership-forbidden');
  assert.equal(await reasonOf(edit('pm', 'OTHER', 'active')), 'permission-denied/ownership-forbidden');
  assert.equal(project('OTHER').name, 'Other');
});

test('Admin behavior is unchanged: an Admin can create and change projects to any visibility, including back to Active', async () => {
  for (const value of ['hidden', 'archived', 'active', undefined]) {
    reset();
    assert.equal(await reasonOf(create('admin', value)), 'ok', `create ${String(value)}`);
    if (value !== undefined) assert.equal(project('BETA').visibility, value);
  }
  reset();
  assert.equal(await reasonOf(edit('admin', 'ALPHA', 'archived')), 'ok');
  assert.equal(project('ALPHA').visibility, 'archived');
  assert.equal(await reasonOf(edit('admin', 'ALPHA', 'hidden')), 'ok');
  assert.equal(project('ALPHA').visibility, 'hidden');
  assert.equal(await reasonOf(edit('admin', 'GHOST', 'active')), 'ok', 'an Admin can un-hide');
  assert.equal(project('GHOST').visibility, 'active');
});

test('project.manage grants create/delete only: it never confers visibility authority, and delete still works', async () => {
  reset({ overrides: { pm: { 'project.manage': true } } });
  assert.equal(await reasonOf(create('pm', 'archived')), FORBIDDEN);
  assert.equal(await reasonOf(create('pm', 'active')), 'ok');
  assert.equal(await reasonOf(writes.deleteDashboardProject.run(request('pm', { weekId: 'W40-2026', originalCode: 'BETA' }))), 'ok');
  assert.deepEqual(codes(), ['ALPHA', 'GHOST', 'LEGACY']);
});

test('other roles stay refused whatever visibility they send (no new path for them)', async () => {
  for (const key of ['engineering', 'business']) {
    reset();
    assert.equal(await reasonOf(create(key, 'hidden')), 'permission-denied/role-forbidden', `${key} create`);
    assert.equal(await reasonOf(edit(key, 'ALPHA', 'hidden')), 'permission-denied/ownership-forbidden', `${key} edit`);
  }
});
