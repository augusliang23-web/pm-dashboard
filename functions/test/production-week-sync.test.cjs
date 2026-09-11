const assert = require('node:assert/strict');
const test = require('node:test');

const sync = require('../production-week-sync');

function fakeUatDb({ user = null, projectId = 'pm-dashboard-uat-20260820-a7f3' } = {}) {
  const requestedUsers = [];
  return {
    projectId,
    requestedUsers,
    collection(name) {
      assert.equal(name, 'users');
      return {
        doc(id) {
          requestedUsers.push(id);
          return {
            get: async () => ({ exists: user !== null, data: () => user }),
          };
        },
      };
    },
  };
}

async function reasonOf(operation) {
  try {
    await operation();
    assert.fail('expected callable authorization to reject');
  } catch (error) {
    return { code: error.code, reason: error.details?.reason };
  }
}

test('authenticatedSyncAdmin rejects every incomplete or non-Admin identity with stable reasons', async () => {
  const uatDb = fakeUatDb({ user: { role: 'admin' } });
  assert.deepEqual(await reasonOf(() => sync.authenticatedSyncAdmin({ auth: null }, uatDb)), {
    code: 'unauthenticated', reason: 'authentication-required',
  });
  assert.deepEqual(await reasonOf(() => sync.authenticatedSyncAdmin({
    auth: { token: { email: 'admin@example.com', name: 'Admin' } },
  }, uatDb)), {
    code: 'unauthenticated', reason: 'authenticated-uid-required',
  });
  assert.deepEqual(await reasonOf(() => sync.authenticatedSyncAdmin({ auth: { uid: 'a' } }, uatDb)), {
    code: 'unauthenticated', reason: 'authenticated-email-required',
  });
  assert.deepEqual(await reasonOf(() => sync.authenticatedSyncAdmin({
    auth: { uid: 'a', token: { email: 'admin@example.com' } },
  }, uatDb)), {
    code: 'unauthenticated', reason: 'authenticated-display-name-required',
  });
  assert.deepEqual(await reasonOf(() => sync.authenticatedSyncAdmin({
    auth: { uid: 'a', token: { email: 'admin@example.com', name: 'Admin' } },
  }, fakeUatDb())), {
    code: 'permission-denied', reason: 'dashboard-user-not-found',
  });
  assert.deepEqual(await reasonOf(() => sync.authenticatedSyncAdmin({
    auth: { uid: 'a', token: { email: 'admin@example.com', name: 'Admin' } },
  }, fakeUatDb({ user: { role: 'pm' } }))), {
    code: 'permission-denied', reason: 'admin-role-required',
  });
});

test('authenticatedSyncAdmin loads the normalized UAT email and returns the authenticated Admin', async () => {
  const uatDb = fakeUatDb({ user: { role: ' ADMIN ' } });
  const actor = await sync.authenticatedSyncAdmin({
    auth: { uid: 'admin-1', token: { email: ' Admin@Example.COM ', name: ' UAT Admin ' } },
  }, uatDb);

  assert.deepEqual(actor, {
    uid: 'admin-1', email: 'admin@example.com', displayName: 'UAT Admin', role: 'admin',
  });
  assert.deepEqual(uatDb.requestedUsers, ['admin@example.com']);
});

test('closed callable request schemas reject caller-selected source, destination, and collection', () => {
  assert.doesNotThrow(() => sync.assertEmptyRequest({}));
  for (const data of [
    { sourceProjectId: 'project-manager-dashboar-a067f' },
    { destinationProjectId: 'pm-dashboard-uat-20260820-a7f3' },
    { collection: 'users' },
    null,
  ]) {
    assert.throws(() => sync.assertEmptyRequest(data), error => error.details?.reason === 'invalid-request-schema');
  }
  assert.doesNotThrow(() => sync.assertRestoreRequest({ snapshotId: 'run-1' }));
  for (const data of [{}, { snapshotId: '' }, { snapshotId: 'run-1', sourceProjectId: 'x' }]) {
    assert.throws(() => sync.assertRestoreRequest(data), error => error.details?.reason === 'invalid-request-schema');
  }
});

test('closed request schemas reject hidden, symbol, and accessor keys without reading them', () => {
  for (const build of [
    () => Object.defineProperty({}, 'sourceProjectId', { value: 'x' }),
    () => ({ [Symbol('destination')]: 'x' }),
    () => Object.defineProperty({}, 'collection', { enumerable: true, get() { throw new Error('must not read accessor'); } }),
  ]) {
    assert.throws(() => sync.assertEmptyRequest(build()), error => error.details?.reason === 'invalid-request-schema');
  }
  for (const build of [
    () => Object.defineProperty({ snapshotId: 'run-1' }, 'sourceProjectId', { value: 'x' }),
    () => ({ snapshotId: 'run-1', [Symbol('destination')]: 'x' }),
    () => Object.defineProperty({}, 'snapshotId', { enumerable: true, get() { throw new Error('must not read accessor'); } }),
  ]) {
    assert.throws(() => sync.assertRestoreRequest(build()), error => error.details?.reason === 'invalid-request-schema');
  }
});

test('runtime guard rejects any non-UAT Cloud project before service construction', () => {
  assert.doesNotThrow(() => sync.assertUatRuntimeProject({ GCLOUD_PROJECT: 'pm-dashboard-uat-20260820-a7f3' }));
  assert.throws(
    () => sync.assertUatRuntimeProject({ GCLOUD_PROJECT: 'project-manager-dashboar-a067f' }),
    error => error.details?.reason === 'uat-runtime-project-required',
  );
});

test('callable handlers use fixed empty and restore request contracts', async () => {
  const calls = [];
  const handlers = sync.createCallableHandlers({
    onCall: (_options, handler) => handler,
    environment: { GCLOUD_PROJECT: 'pm-dashboard-uat-20260820-a7f3' },
    getUatDb: () => fakeUatDb({ user: { role: 'admin' } }),
    getProductionDb: () => ({}),
    createService: () => ({
      sync: async ({ actor }) => { calls.push(['sync', actor.email]); return { phase: 'succeeded' }; },
      status: async ({ actor }) => { calls.push(['status', actor.email]); return { running: false }; },
      restore: async ({ actor, snapshotId }) => { calls.push(['restore', actor.email, snapshotId]); return { phase: 'restored' }; },
    }),
  });
  const request = { auth: { uid: 'admin-1', token: { email: 'ADMIN@example.com', name: 'Admin' } } };

  assert.deepEqual(await handlers.syncProductionWeeksToUat({ ...request, data: {} }), { phase: 'succeeded' });
  assert.deepEqual(await handlers.getProductionWeekSyncStatus({ ...request, data: {} }), { running: false });
  assert.deepEqual(await handlers.restoreUatWeeksSnapshot({ ...request, data: { snapshotId: 'run-1' } }), { phase: 'restored' });
  assert.deepEqual(calls, [
    ['sync', 'admin@example.com'], ['status', 'admin@example.com'], ['restore', 'admin@example.com', 'run-1'],
  ]);
  await assert.rejects(
    () => handlers.syncProductionWeeksToUat({ ...request, data: { collection: 'weeks' } }),
    error => error.details?.reason === 'invalid-request-schema',
  );
});
