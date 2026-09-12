import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseProductionWeekSync,
  createUatProductionSyncApi,
  createUatProductionSyncController,
  formatProductionSyncResult,
  formatProductionSyncStatus,
  PRODUCTION_SYNC_CONFIRMATION,
  ROLLED_BACK_MESSAGE,
  ROLLBACK_FAILED_MESSAGE,
  submitUatProductionSyncConfirmation,
  submitUatProductionRestoreConfirmation,
} from '../js/uat-production-sync.mjs';

const SYNC_WARNING = 'This will replace every UAT reporting week and its projects with the current Production data. UAT-only weeks will be deleted. UAT users, permissions, settings, Executive workflow, and usage records will not be changed. A restorable UAT snapshot will be created first. Production is read-only.';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function createView() {
  const renders = [];
  const confirmations = [];
  return {
    renders,
    confirmations,
    render(state) { renders.push(structuredClone(state)); },
    confirm(details) { confirmations.push(details); },
  };
}

test('browser API calls only the three closed callable contracts', async () => {
  const calls = [];
  const api = createUatProductionSyncApi({
    functions: {},
    httpsCallable: (_functions, name) => async data => {
      calls.push({ name, data });
      return { data: { ok: true } };
    },
  });

  await api.sync();
  await api.status();
  await api.restore('run-1');

  assert.deepEqual(calls, [
    { name: 'syncProductionWeeksToUat', data: {} },
    { name: 'getProductionWeekSyncStatus', data: {} },
    { name: 'restoreUatWeeksSnapshot', data: { snapshotId: 'run-1' } },
  ]);
});

test('Admin eligibility and server result labels are understandable', () => {
  assert.equal(canUseProductionWeekSync(' Admin '), true);
  assert.equal(canUseProductionWeekSync('pm'), false);
  assert.equal(canUseProductionWeekSync(), false);
  assert.equal(formatProductionSyncResult({ createdCount: 2, updatedCount: 3, deletedCount: 1 }), 'Production sync completed: 2 created, 3 updated, 1 deleted.');
  assert.equal(formatProductionSyncStatus({ running: true, phase: 'applying' }), 'Sync in progress: applying.');
  assert.equal(formatProductionSyncStatus({ running: false, latestRun: { phase: 'succeeded' } }), 'Last operation: succeeded.');
  assert.equal(formatProductionSyncStatus({ running: false, latestCompletedRun: { phase: 'restored' } }), 'Last operation: restored.');
});

test('opening Week Management refreshes status and disables both actions while the request runs', async () => {
  const status = deferred();
  const view = createView();
  const controller = createUatProductionSyncController({
    api: { status: () => status.promise, sync: async () => ({}), restore: async () => ({}) },
    getRole: () => 'admin',
    view,
  });

  const opening = controller.open();
  assert.equal(view.renders.at(-1).busy, true);
  assert.equal(view.renders.at(-1).syncDisabled, true);
  assert.equal(view.renders.at(-1).restoreDisabled, true);

  status.resolve({ running: false, latestSnapshot: { snapshotId: 'latest-retained' } });
  await opening;

  assert.equal(view.renders.at(-1).busy, false);
  assert.equal(view.renders.at(-1).restoreDisabled, false);
  assert.equal(view.renders.at(-1).status.latestSnapshot.snapshotId, 'latest-retained');
});

test('a server-reported running operation keeps both actions disabled after status refresh', async () => {
  const view = createView();
  const controller = createUatProductionSyncController({
    api: {
      status: async () => ({ running: true, phase: 'applying', latestSnapshot: { snapshotId: 'retained' } }),
      sync: async () => ({}),
      restore: async () => ({}),
    },
    getRole: () => 'admin',
    view,
  });

  await controller.open();
  assert.equal(view.renders.at(-1).busy, false);
  assert.equal(view.renders.at(-1).syncDisabled, true);
  assert.equal(view.renders.at(-1).restoreDisabled, true);
  assert.equal(view.renders.at(-1).statusText, 'Sync in progress: applying.');
});

test('sync requires the exact destructive-data warning and rechecks Admin at confirmation time', async () => {
  let role = 'admin';
  const view = createView();
  const calls = [];
  const controller = createUatProductionSyncController({
    api: {
      status: async () => ({ running: false }),
      sync: async () => { calls.push('sync'); return { phase: 'succeeded' }; },
      restore: async () => { calls.push('restore'); return {}; },
    },
    getRole: () => role,
    view,
  });

  controller.requestSync();
  assert.equal(view.confirmations.length, 1);
  assert.equal(view.confirmations[0].message, SYNC_WARNING);
  assert.equal(PRODUCTION_SYNC_CONFIRMATION, SYNC_WARNING);

  role = 'pm';
  await controller.confirmSync();
  assert.deepEqual(calls, []);
  assert.equal(view.renders.at(-1).isAdmin, false);
});

test('sync does not call a visible-week mutation callback', async () => {
  const view = createView();
  let mutated = false;
  view.refreshWeeks = () => { mutated = true; };
  const controller = createUatProductionSyncController({
    api: {
      status: async () => ({ running: false }),
      sync: async () => ({ phase: 'succeeded' }),
      restore: async () => ({ phase: 'restored' }),
    },
    getRole: () => 'admin',
    view,
  });

  controller.requestSync();
  await controller.confirmSync();
  assert.equal(mutated, false);
});

test('sync blocks duplicate clicks, reports counts, and only asks the API boundary to refresh status', async () => {
  const sync = deferred();
  const view = createView();
  const calls = [];
  const controller = createUatProductionSyncController({
    api: {
      status: async () => { calls.push('status'); return { running: false, latestSnapshot: { snapshotId: 'newest' } }; },
      sync: () => { calls.push('sync'); return sync.promise; },
      restore: async () => { calls.push('restore'); return {}; },
    },
    getRole: () => 'admin',
    view,
  });

  controller.requestSync();
  const first = controller.confirmSync();
  const second = controller.confirmSync();
  assert.equal(view.renders.at(-1).busy, true);
  assert.equal(view.renders.at(-1).syncDisabled, true);
  assert.equal(view.renders.at(-1).restoreDisabled, true);
  assert.deepEqual(calls, ['sync']);

  sync.resolve({ phase: 'succeeded', createdCount: 2, updatedCount: 1, deletedCount: 3 });
  await Promise.all([first, second]);

  assert.deepEqual(calls, ['sync', 'status']);
  assert.equal(view.renders.at(-1).result, 'Production sync completed: 2 created, 1 updated, 3 deleted.');
  assert.equal(view.renders.at(-1).busy, false);
});

test('rolled-back and rollback-failed responses expose the specified safe recovery messages', async () => {
  for (const [result, expected] of [
    [{ phase: 'rolled_back' }, 'UAT sync failed safely; the original UAT weeks were restored.'],
    [{ phase: 'rollback_failed' }, 'Critical: automatic rollback failed. Do not edit UAT weeks until the restore callable succeeds.'],
  ]) {
    const view = createView();
    const controller = createUatProductionSyncController({
      api: { status: async () => ({ running: false }), sync: async () => result, restore: async () => ({}) },
      getRole: () => 'admin',
      view,
    });
    controller.requestSync();
    await controller.confirmSync();
    assert.equal(view.renders.at(-1).result, expected);
  }
  assert.equal(ROLLED_BACK_MESSAGE, 'UAT sync failed safely; the original UAT weeks were restored.');
  assert.equal(ROLLBACK_FAILED_MESSAGE, 'Critical: automatic rollback failed. Do not edit UAT weeks until the restore callable succeeds.');
});

test('restore is confirmed and can restore only the latest backend-retained snapshot', async () => {
  const view = createView();
  const calls = [];
  const controller = createUatProductionSyncController({
    api: {
      status: async () => ({ running: false, latestSnapshot: { snapshotId: 'latest-retained' } }),
      sync: async () => ({}),
      restore: async snapshotId => { calls.push(snapshotId); return { phase: 'restored' }; },
    },
    getRole: () => 'admin',
    view,
  });

  await controller.open();
  controller.requestRestore();
  assert.equal(view.confirmations[0].kind, 'restore');
  assert.match(view.confirmations[0].message, /latest retained UAT snapshot/i);
  await controller.confirmRestore();

  assert.deepEqual(calls, ['latest-retained']);
  assert.equal(view.renders.at(-1).result, 'UAT weeks were restored from the latest retained snapshot.');
});

test('sync submit starts the real controller before the modal close cancellation path', async () => {
  let role = 'admin';
  const events = [];
  const view = createView();
  const controller = createUatProductionSyncController({
    api: {
      status: async () => ({ running: false }),
      sync: async () => { events.push('sync'); return { phase: 'succeeded' }; },
      restore: async () => ({ phase: 'restored' }),
    },
    getRole: () => role,
    view,
  });

  controller.requestSync();
  const operation = submitUatProductionSyncConfirmation({
    controller,
    close: () => { events.push('close'); controller.cancelConfirmation(); },
  });

  assert.equal(view.renders.at(-1).busy, true);
  assert.deepEqual(events, ['sync', 'close']);
  assert.equal(await operation, true);
  role = 'pm';
});

test('restore submit starts the real controller before close and rejects a role changed to non-Admin', async () => {
  let role = 'admin';
  const events = [];
  const view = createView();
  const controller = createUatProductionSyncController({
    api: {
      status: async () => ({ running: false, latestSnapshot: { snapshotId: 'retained' } }),
      sync: async () => ({ phase: 'succeeded' }),
      restore: async snapshotId => { events.push(`restore:${snapshotId}`); return { phase: 'restored' }; },
    },
    getRole: () => role,
    view,
  });

  await controller.open();
  controller.requestRestore();
  const operation = submitUatProductionRestoreConfirmation({
    controller,
    close: () => { events.push('close'); controller.cancelConfirmation(); },
  });
  assert.deepEqual(events, ['restore:retained', 'close']);
  assert.equal(await operation, true);

  controller.requestRestore();
  role = 'pm';
  const rejected = submitUatProductionRestoreConfirmation({
    controller,
    close: () => { events.push('rejected-close'); controller.cancelConfirmation(); },
  });
  assert.equal(await rejected, false);
  assert.deepEqual(events, ['restore:retained', 'close', 'rejected-close']);
});
