// setUserPermissionOverrides: runs the real callable against an in-memory Firestore. The actor must be a
// server-read raw-role Admin; userPermissions and userPermissionAudit are written in one transaction.
const assert = require('node:assert/strict');
const test = require('node:test');

const firestorePath = require.resolve('firebase-admin/firestore');
const realFirestore = require(firestorePath);
const SERVER_TIMESTAMP = Object.freeze({ __serverTimestamp: true });
let store;
let failNextCreateFor = '';
let autoId = 0;

const clone = value => JSON.parse(JSON.stringify(value));
const fakeDb = {
  collection(name) {
    return { doc: id => ({ path: `${name}/${id ?? `auto-${++autoId}`}`, id: id ?? `auto-${autoId}` }) };
  },
  async runTransaction(work) {
    const writes = [];
    const transaction = {
      get: async ref => {
        const value = store.get(ref.path);
        return { exists: value !== undefined, data: () => (value === undefined ? undefined : clone(value)) };
      },
      set(ref, data) {
        writes.push(() => store.set(ref.path, clone(data)));
      },
      create(ref, data) {
        if (failNextCreateFor && ref.path.startsWith(failNextCreateFor)) {
          failNextCreateFor = '';
          throw new Error('simulated audit write failure');
        }
        if (store.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
        writes.push(() => store.set(ref.path, clone(data)));
      },
      update() {
        throw new Error('setUserPermissionOverrides must not use update()');
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
const { setUserPermissionOverrides } = require('../user-permissions');
const functionsIndex = require('../index');

const USERS = {
  'admin@example.test': { role: 'admin', displayName: 'Admin' },
  'other-admin@example.test': { role: ' Admin ', displayName: 'Other Admin' },
  'bonnie@example.test': { role: 'pm', displayName: 'Bonnie', secret: 'not returned' },
  'eng@example.test': { role: 'engineering', displayName: 'Eng' },
  'biz@example.test': { role: 'business', displayName: 'Biz' },
  'vip@example.test': { role: 'vip', displayName: 'VIP' },
  'exec@example.test': { role: 'executive', displayName: 'Exec' },
  'nobody@example.test': { role: 'contractor', displayName: 'Nobody' },
};

function reset(permissions = {}) {
  store = new Map();
  autoId = 0;
  failNextCreateFor = '';
  for (const [email, user] of Object.entries(USERS)) store.set(`users/${email}`, user);
  for (const [email, data] of Object.entries(permissions)) store.set(`userPermissions/${email}`, data);
}

const call = (data, { email = 'admin@example.test', uid = 'admin-uid', token = {} } = {}) => setUserPermissionOverrides.run({
  auth: email ? { uid, token: { email, ...token } } : undefined,
  data,
});
const change = (targetEmail, changes, expectedRevision = 0) => ({ targetEmail, expectedRevision, changes });
const audits = () => [...store.entries()].filter(([path]) => path.startsWith('userPermissionAudit/')).map(([, value]) => value);

async function reasonOf(promise) {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return `${error.code}/${error.details?.reason}`;
  }
}

test('the callable is exported with its dedicated runtime identity', () => {
  assert.equal(functionsIndex.setUserPermissionOverrides.__endpoint.serviceAccountEmail, 'pmdash-user-perms@');
});

test('unauthenticated and non-Admin callers are denied before anything is read or written', async () => {
  reset();
  assert.equal(await reasonOf(call(change('bonnie@example.test', { 'week.manage': true }), { email: '' })), 'unauthenticated/unauthenticated');
  for (const email of ['bonnie@example.test', 'eng@example.test', 'vip@example.test', 'exec@example.test', 'nobody@example.test', 'stranger@example.test']) {
    assert.equal(await reasonOf(call(change('bonnie@example.test', { 'week.manage': true }), { email })), 'permission-denied/admin-role-required', email);
  }
  assert.equal(store.has('userPermissions/bonnie@example.test'), false);
  assert.deepEqual(audits(), []);
});

test('permission overrides and token claims never authorize the callable', async () => {
  reset({
    'bonnie@example.test': { overrides: { 'permissions.manage': true, 'week.manage': true }, revision: 1 },
  });
  const claims = { role: 'admin', admin: true, permissions: { 'permissions.manage': true } };
  assert.equal(await reasonOf(call(change('eng@example.test', { 'week.manage': true }), { email: 'bonnie@example.test', token: claims })),
    'permission-denied/admin-role-required');
});

test('a raw-role Admin grants week.manage to every recognized non-Admin role', async () => {
  for (const target of ['bonnie@example.test', 'eng@example.test', 'biz@example.test', 'vip@example.test', 'exec@example.test']) {
    reset();
    const result = await call(change(target, { 'week.manage': true }));
    assert.deepEqual(
      { ...result, auditId: undefined },
      { targetEmail: target, role: USERS[target].role, revision: 1, overrides: { 'week.manage': true }, changed: true, auditId: undefined },
      target,
    );
    assert.deepEqual(store.get(`userPermissions/${target}`), {
      schemaVersion: 1, overrides: { 'week.manage': true }, revision: 1, updatedAt: SERVER_TIMESTAMP, updatedBy: 'admin@example.test',
    });
  }
  reset();
  assert.equal((await call(change('bonnie@example.test', { 'week.manage': true }), { email: 'other-admin@example.test' })).changed, true,
    'Admin role is normalized like the rest of the contract');
});

test('false stores an explicit disable and null removes the override key', async () => {
  reset();
  assert.deepEqual((await call(change('bonnie@example.test', { 'week.manage': false }))).overrides, { 'week.manage': false });
  assert.deepEqual(store.get('userPermissions/bonnie@example.test').overrides, { 'week.manage': false });
  const cleared = await call(change('bonnie@example.test', { 'week.manage': null }, 1));
  assert.deepEqual(cleared.overrides, {});
  assert.equal(cleared.revision, 2);
  assert.deepEqual(store.get('userPermissions/bonnie@example.test').overrides, {});
});

test('each real change increments the revision and writes one matching audit record', async () => {
  reset();
  await call(change('bonnie@example.test', { 'week.manage': true }));
  await call(change('bonnie@example.test', { 'week.manage': false }, 1));
  await call(change('bonnie@example.test', { 'week.manage': null }, 2));
  assert.equal(store.get('userPermissions/bonnie@example.test').revision, 3);
  assert.deepEqual(audits(), [
    { targetEmail: 'bonnie@example.test', actorEmail: 'admin@example.test', actorUid: 'admin-uid', at: SERVER_TIMESTAMP,
      revisionBefore: 0, revisionAfter: 1, roleAtChange: 'pm', changes: [{ capability: 'week.manage', before: null, after: true }] },
    { targetEmail: 'bonnie@example.test', actorEmail: 'admin@example.test', actorUid: 'admin-uid', at: SERVER_TIMESTAMP,
      revisionBefore: 1, revisionAfter: 2, roleAtChange: 'pm', changes: [{ capability: 'week.manage', before: true, after: false }] },
    { targetEmail: 'bonnie@example.test', actorEmail: 'admin@example.test', actorUid: 'admin-uid', at: SERVER_TIMESTAMP,
      revisionBefore: 2, revisionAfter: 3, roleAtChange: 'pm', changes: [{ capability: 'week.manage', before: false, after: null }] },
  ]);
});

test('a no-op returns the current state without a new revision or audit record', async () => {
  reset({ 'bonnie@example.test': { schemaVersion: 1, overrides: { 'week.manage': true }, revision: 4, updatedBy: 'admin@example.test' } });
  const before = clone(store.get('userPermissions/bonnie@example.test'));
  assert.deepEqual(await call(change('bonnie@example.test', { 'week.manage': true }, 4)), {
    targetEmail: 'bonnie@example.test', role: 'pm', revision: 4, overrides: { 'week.manage': true }, changed: false,
  });
  reset();
  assert.equal((await call(change('eng@example.test', { 'week.manage': null }))).changed, false, 'reset of a missing key');
  assert.equal(store.has('userPermissions/eng@example.test'), false, 'no document is created for a no-op');
  assert.deepEqual(audits(), []);
  reset({ 'bonnie@example.test': before });
  await call(change('bonnie@example.test', { 'week.manage': true }, 4));
  assert.deepEqual(store.get('userPermissions/bonnie@example.test'), before);
});

test('a stale expectedRevision is rejected as a conflict and never overwrites newer changes', async () => {
  reset({ 'bonnie@example.test': { overrides: { 'week.manage': true }, revision: 2 } });
  for (const expectedRevision of [0, 1, 3]) {
    assert.equal(await reasonOf(call(change('bonnie@example.test', { 'week.manage': false }, expectedRevision))), 'aborted/permission-revision-conflict');
  }
  assert.deepEqual(store.get('userPermissions/bonnie@example.test'), { overrides: { 'week.manage': true }, revision: 2 });
  assert.deepEqual(audits(), []);
  reset();
  assert.equal(await reasonOf(call(change('bonnie@example.test', { 'week.manage': true }, 1))), 'aborted/permission-revision-conflict',
    'a missing document is revision 0');
});

test('Admin targets cannot lose week.manage', async () => {
  reset();
  for (const value of [true, false, null]) {
    for (const target of ['admin@example.test', 'other-admin@example.test']) {
      assert.equal(await reasonOf(call(change(target, { 'week.manage': value }))), 'failed-precondition/admin-capability-locked', `${target} ${value}`);
    }
  }
  assert.deepEqual(audits(), []);
});

test('unknown targets, unrecognized target roles, unknown and non-delegable capabilities are rejected', async () => {
  reset();
  assert.equal(await reasonOf(call(change('ghost@example.test', { 'week.manage': true }))), 'not-found/target-not-found');
  assert.equal(await reasonOf(call(change('nobody@example.test', { 'week.manage': true }))), 'failed-precondition/target-role-unrecognized');
  assert.equal(await reasonOf(call(change('bonnie@example.test', { 'week.legacy': true }))), 'invalid-argument/unknown-capability');
  assert.equal(await reasonOf(call(change('bonnie@example.test', { __proto__: null, constructor: true }))), 'invalid-argument/unknown-capability');
  assert.equal(await reasonOf(call(change('bonnie@example.test', { 'permissions.manage': true }))), 'permission-denied/capability-not-delegable');
  assert.equal(await reasonOf(call(change('bonnie@example.test', { 'permissions.manage': null }))), 'permission-denied/capability-not-delegable');
  assert.deepEqual(audits(), []);
  assert.equal(store.has('userPermissions/bonnie@example.test'), false);
});

test('malformed requests are rejected', async () => {
  reset();
  const invalid = [
    null, [], 'x',
    { targetEmail: 'bonnie@example.test', expectedRevision: 0 },
    { targetEmail: 'bonnie@example.test', expectedRevision: 0, changes: {} },
    { targetEmail: 'bonnie@example.test', expectedRevision: 0, changes: [] },
    { targetEmail: 'bonnie@example.test', expectedRevision: 0, changes: { 'week.manage': 'true' } },
    { targetEmail: 'bonnie@example.test', expectedRevision: 0, changes: { 'week.manage': 1 } },
    { targetEmail: 'bonnie@example.test', expectedRevision: 0, changes: { 'week.manage': undefined } },
    { targetEmail: 'bonnie@example.test', expectedRevision: -1, changes: { 'week.manage': true } },
    { targetEmail: 'bonnie@example.test', expectedRevision: 1.5, changes: { 'week.manage': true } },
    { targetEmail: 'bonnie@example.test', expectedRevision: '0', changes: { 'week.manage': true } },
    { targetEmail: 'bonnie@example.test', changes: { 'week.manage': true } },
    { targetEmail: 'not-an-email', expectedRevision: 0, changes: { 'week.manage': true } },
    { targetEmail: 'a/b@example.test', expectedRevision: 0, changes: { 'week.manage': true } },
    { targetEmail: 42, expectedRevision: 0, changes: { 'week.manage': true } },
    { targetEmail: 'bonnie@example.test', expectedRevision: 0, changes: { 'week.manage': true }, role: 'admin' },
  ];
  for (const data of invalid) {
    assert.match(await reasonOf(call(data)), /^invalid-argument\//, JSON.stringify(data));
  }
  assert.deepEqual(audits(), []);
});

test('target emails are normalized consistently', async () => {
  reset();
  const result = await call(change('  Bonnie@Example.TEST ', { 'week.manage': true }));
  assert.equal(result.targetEmail, 'bonnie@example.test');
  assert.ok(store.has('userPermissions/bonnie@example.test'));
});

test('the permission document and its audit record are written atomically', async () => {
  reset({ 'bonnie@example.test': { overrides: { 'week.manage': false }, revision: 1 } });
  failNextCreateFor = 'userPermissionAudit/';
  await assert.rejects(call(change('bonnie@example.test', { 'week.manage': true }, 1)), /simulated audit write failure/);
  assert.deepEqual(store.get('userPermissions/bonnie@example.test'), { overrides: { 'week.manage': false }, revision: 1 });
  assert.deepEqual(audits(), []);
});

test('unrelated stored metadata and stale override keys are preserved; reset-all removes only delegable keys', async () => {
  reset({
    'bonnie@example.test': {
      schemaVersion: 1, revision: 3, futureField: { keep: true },
      overrides: { 'week.manage': true, 'legacy.capability': true },
    },
  });
  const result = await call(change('bonnie@example.test', { 'week.manage': null }, 3));
  assert.deepEqual(result.overrides, {}, 'stale keys are never reported as effective');
  const stored = store.get('userPermissions/bonnie@example.test');
  assert.deepEqual(stored.overrides, { 'legacy.capability': true });
  assert.deepEqual(stored.futureField, { keep: true });
  assert.equal(stored.revision, 4);
});

test('a grant to a role that is not grantable is rejected by the registry, not just delegable=true', async () => {
  const { planPermissionChange } = require('../user-permissions');
  assert.throws(() => planPermissionChange({ targetRole: 'contractor', current: {}, changes: { 'week.manage': true } }),
    error => error.details?.reason === 'role-not-grantable');
  assert.deepEqual(planPermissionChange({ targetRole: 'pm', current: {}, changes: { 'week.manage': true } }).entries,
    [{ capability: 'week.manage', before: null, after: true }]);
});

const DELEGABLE = ['week.manage', 'week.release', 'gantt.manage', 'project.manage'];

test('every reviewed delegable capability can be granted and reset to an eligible role with an audited, atomic change', async () => {
  for (const capability of DELEGABLE) {
    reset();
    const target = 'eng@example.test';
    const granted = await call(change(target, { [capability]: true }));
    assert.deepEqual({ changed: granted.changed, revision: granted.revision, overrides: granted.overrides }, { changed: true, revision: 1, overrides: { [capability]: true } }, capability);
    const cleared = await call(change(target, { [capability]: null }, 1));
    assert.deepEqual({ changed: cleared.changed, revision: cleared.revision, overrides: cleared.overrides }, { changed: true, revision: 2, overrides: {} }, capability);
    const [grantAudit, resetAudit] = audits();
    assert.deepEqual(grantAudit.changes, [{ capability, before: null, after: true }], capability);
    assert.deepEqual(resetAudit.changes, [{ capability, before: true, after: null }], capability);
    assert.equal(grantAudit.roleAtChange, 'engineering');
  }
});

test('role eligibility comes from the registry: working-team-only capabilities reject VIP and Executive', async () => {
  for (const capability of ['week.release', 'project.manage']) {
    for (const target of ['vip@example.test', 'exec@example.test']) {
      reset();
      assert.equal(await reasonOf(call(change(target, { [capability]: true }))), 'failed-precondition/role-not-grantable', `${capability} ${target}`);
      assert.deepEqual(audits(), []);
      assert.equal(store.has(`userPermissions/${target}`), false);
    }
  }
  for (const target of ['vip@example.test', 'exec@example.test', 'bonnie@example.test', 'biz@example.test']) {
    reset();
    assert.equal((await call(change(target, { 'gantt.manage': true }))).changed, true, `gantt.manage ${target}`);
  }
});

test('a PM release switch: OFF stores false, and turning it back ON (the role default) removes the key', async () => {
  reset();
  const off = await call(change('bonnie@example.test', { 'week.release': false }));
  assert.deepEqual(off.overrides, { 'week.release': false });
  const on = await call(change('bonnie@example.test', { 'week.release': null }, 1));
  assert.deepEqual(on.overrides, {});
  assert.deepEqual(audits().map(entry => entry.changes[0]), [
    { capability: 'week.release', before: null, after: false },
    { capability: 'week.release', before: false, after: null },
  ], 'both directions are auditable, including the return to the role default');
  assert.equal((await call(change('bonnie@example.test', { 'week.release': null }, 2))).changed, false, 'resetting an absent key is a no-op');
  assert.equal(audits().length, 2);
});

test('Admin targets cannot lose any foundational capability, whatever the requested value', async () => {
  reset();
  for (const capability of DELEGABLE) {
    for (const value of [true, false, null]) {
      assert.equal(await reasonOf(call(change('admin@example.test', { [capability]: value }))), 'failed-precondition/admin-capability-locked', `${capability} ${value}`);
      assert.equal(await reasonOf(call(change('other-admin@example.test', { [capability]: value }))), 'failed-precondition/admin-capability-locked', `${capability} ${value} (padded role)`);
    }
  }
  assert.equal(await reasonOf(call(change('admin@example.test', { 'week.manage': null, 'gantt.manage': null }))), 'failed-precondition/admin-capability-locked', 'a mixed request is rejected as a whole');
  assert.deepEqual(audits(), []);
  assert.equal(store.has('userPermissions/admin@example.test'), false);
});

test('several switches in one request change atomically with one audit entry per real change', async () => {
  reset();
  const result = await call(change('eng@example.test', { 'week.manage': true, 'gantt.manage': true, 'project.manage': false, 'week.release': null }));
  assert.equal(result.changed, true);
  assert.equal(result.revision, 1);
  assert.deepEqual(result.overrides, { 'week.manage': true, 'gantt.manage': true, 'project.manage': false });
  assert.deepEqual(audits()[0].changes.map(entry => entry.capability).sort(), ['gantt.manage', 'project.manage', 'week.manage']);
  assert.equal(audits().length, 1);
});

test('permissions.manage can never be changed and the registry rejects stale or invented capability names', async () => {
  reset();
  for (const value of [true, false, null]) {
    assert.equal(await reasonOf(call(change('bonnie@example.test', { 'permissions.manage': value }))), 'permission-denied/capability-not-delegable');
  }
  for (const name of ['week.legacy', 'project.edit', 'gantt', 'admin', '', 'WEEK.MANAGE']) {
    assert.equal(await reasonOf(call(change('bonnie@example.test', { [name]: true }))), 'invalid-argument/unknown-capability', name);
  }
  assert.deepEqual(audits(), []);
});
