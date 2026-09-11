const assert = require('node:assert/strict');
const test = require('node:test');
const { Firestore } = require('firebase-admin/firestore');

const sync = require('../production-week-sync');

function createBatchDb() {
  const batches = [];
  const existingWeeks = new Map([['OLD', { projects: [] }]]);
  const db = {
    batches,
    lease: { activeRunId: 'run-1', expiresAt: '2999-01-01T00:00:00.000Z' },
    renewalCount: 0,
    collection(name) {
      if (name === 'weeks') {
        return {
          doc: id => ({ path: `weeks/${id}`, id }),
          get: async () => ({ docs: [...existingWeeks].map(([id, data]) => ({ id, data: () => data })) }),
        };
      }
      return {
        doc: id => ({
          path: `${name}/${id}`,
          id,
          collection: child => ({ doc: key => ({ path: `${name}/${id}/${child}/${key}`, id: key }) }),
          get: async () => name === 'uatProductionWeekSync'
            ? { exists: Boolean(db.lease), data: () => db.lease }
            : { exists: true, data: () => db.runs?.find(run => run.runId === id || run.snapshotId === id) || {} },
        }),
        get: async () => ({ docs: (db.runs || []).map(data => ({ data: () => data })) }),
      };
    },
    doc(path) { return { path, id: path.split('/').at(-1) }; },
    async runTransaction(work) {
      return work({
        get: async () => ({ exists: Boolean(db.lease), data: () => db.lease }),
        set: (_ref, data) => {
          db.renewalCount += 1;
          db.lease = { ...db.lease, ...data };
        },
      });
    },
    batch() {
      const operations = [];
      batches.push(operations);
      return {
        set(ref, data, options) { operations.push({ type: 'set', path: ref.path, data, options }); },
        delete(ref) { operations.push({ type: 'delete', path: ref.path }); },
        commit: async () => undefined,
      };
    },
  };
  return db;
}

test('Production adapter reads exactly weeks and exposes only listWeeks', async () => {
  const requested = [];
  const store = sync.createProductionReadStore({
    collection(name) {
      requested.push(name);
      return { get: async () => ({ docs: [{ id: 'W36-2026', data: () => ({ projects: [] }) }] }) };
    },
  });
  assert.deepEqual(Object.keys(store), ['listWeeks']);
  assert.deepEqual(await store.listWeeks(), [{ id: 'W36-2026', data: { projects: [] } }]);
  assert.deepEqual(requested, ['weeks']);
});

test('Production adapter preserves its Firestore read time without adding a write capability', async () => {
  const store = sync.createProductionReadStore({
    collection: () => ({ get: async () => ({
      readTime: { toDate: () => new Date('2026-09-12T01:02:03.000Z') },
      docs: [{ id: 'W36-2026', data: () => ({ projects: [] }) }],
    }) }),
  });
  const result = await store.listWeeks();
  assert.equal(result.sourceReadTime, '2026-09-12T01:02:03.000Z');
  assert.deepEqual(Object.keys(store), ['listWeeks']);
});

test('UAT adapter commits no more than 200 operations and remaps Production document references by path', async () => {
  const db = createBatchDb();
  const sourceDb = new Firestore({ projectId: 'production-fixture' });
  const sourceReference = sourceDb.doc('projects/P-1');
  const store = sync.createUatSyncStore(db);
  const weeks = Array.from({ length: 400 }, (_, index) => ({
    id: `W${index}`,
    data: { projects: [], ownerRef: sourceReference },
  }));

  await store.applyMirror({ weeks, runId: 'run-1', batchSize: 200 });

  assert.deepEqual(db.batches.map(batch => batch.length), [200, 200, 1]);
  const write = db.batches[0][0];
  assert.equal(write.path, 'weeks/W0');
  assert.equal(write.data.ownerRef.path, 'projects/P-1');
  assert.notEqual(write.data.ownerRef, sourceReference);
  assert.equal(db.batches.at(-1)[0].type, 'delete');
  assert.equal(db.batches.at(-1)[0].path, 'weeks/OLD');
  assert.equal(db.renewalCount, 3);
});

test('snapshot writes and deletes also use 200-operation bounded batches', async () => {
  const db = createBatchDb();
  const store = sync.createUatSyncStore(db);
  const weeks = Array.from({ length: 400 }, (_, index) => ({ id: `W${index}`, data: { projects: [] } }));

  await store.writeSnapshot({ snapshotId: 'run-1', runId: 'run-1', weeks, digest: 'a'.repeat(64), weekCount: 400, createdAt: '2026-09-12T00:00:00.000Z' });
  assert.deepEqual(db.batches.map(batch => batch.length), [200, 200, 1]);
  assert.equal(db.batches[0][0].path, 'uatProductionWeekSyncRuns/run-1');
  assert.equal(db.batches[0][0].type, 'set');
  assert.equal(db.batches[0][0].data.complete, false);
  assert.equal(db.renewalCount, 3);

  db.batches.length = 0;
  const runRef = {
    collection: () => ({ get: async () => ({ docs: weeks.map(week => ({ ref: { path: `uatProductionWeekSyncRuns/run-1/weeks/${week.id}` } })) }) }),
  };
  db.collection = name => ({ doc: () => name === 'uatProductionWeekSyncRuns' ? runRef : { path: `${name}/control` } });
  await store.deleteSnapshot({ snapshotId: 'run-1', runId: 'run-1' });
  assert.deepEqual(db.batches.map(batch => batch.length), [200, 200, 1]);
});

test('active leases with missing or malformed expiry are never reclaimed', async () => {
  for (const expiresAt of [undefined, 'not-a-date']) {
    const db = createBatchDb();
    db.lease = { activeRunId: 'other-run', expiresAt };
    const acquired = await sync.createUatSyncStore(db).acquireLease({ runId: 'run-1', actor: {}, expiresAt: '2026-09-12T00:15:00.000Z' });
    assert.deepEqual(acquired, { acquired: false });
  }
});

test('an expired owned lease stops the next mirror batch before it writes', async () => {
  const db = createBatchDb();
  db.lease = { activeRunId: 'run-1', expiresAt: '2000-01-01T00:00:00.000Z' };
  await assert.rejects(
    () => sync.createUatSyncStore(db).applyMirror({ weeks: [{ id: 'W36-2026', data: { projects: [] } }], runId: 'run-1', batchSize: 200 }),
    /expired/i,
  );
  assert.equal(db.batches.length, 0);
});

test('status returns only current lease state, latest completed summary, and newest complete snapshot metadata', async () => {
  const db = createBatchDb();
  db.lease = { activeRunId: 'active', expiresAt: '2999-01-01T00:00:00.000Z' };
  db.runs = [
    { runId: 'active', phase: 'applying', projects: ['secret'] },
    { runId: 'failed', phase: 'rollback_failed', completedAt: '2026-09-12T05:00:00.000Z' },
    { runId: 'complete-old', phase: 'succeeded', completedAt: '2026-09-12T03:00:00.000Z', sourceWeekCount: 1 },
    { runId: 'complete-new', phase: 'restored', completedAt: '2026-09-12T04:00:00.000Z', snapshotId: 'snapshot-2' },
    { snapshotId: 'snapshot-1', complete: true, createdAt: '2026-09-12T02:00:00.000Z', weeks: ['secret'] },
    { snapshotId: 'snapshot-2', complete: true, createdAt: '2026-09-12T06:00:00.000Z', weeks: ['secret'] },
  ];
  assert.deepEqual(await sync.createUatSyncStore(db).readStatus(), {
    running: true,
    phase: 'applying',
    latestCompletedRun: { runId: 'complete-new', phase: 'restored', completedAt: '2026-09-12T04:00:00.000Z', snapshotId: 'snapshot-2' },
    latestSnapshot: { snapshotId: 'snapshot-2', createdAt: '2026-09-12T06:00:00.000Z' },
  });
});

test('complete snapshot listings expose metadata only so restore reads the payload separately', async () => {
  const db = createBatchDb();
  const run = { snapshotId: 'run-1', complete: true, digest: 'a'.repeat(64), weekCount: 1, createdAt: '2026-09-12T00:00:00.000Z', weeks: [{ secret: true }] };
  db.collection = name => ({
    where(field, operator, value) {
      assert.deepEqual([name, field, operator, value], ['uatProductionWeekSyncRuns', 'complete', '==', true]);
      return { get: async () => ({ docs: [{ data: () => run }] }) };
    },
  });

  assert.deepEqual(await sync.createUatSyncStore(db).listCompleteSnapshots(), [{
    snapshotId: 'run-1', complete: true, digest: 'a'.repeat(64), weekCount: 1, createdAt: '2026-09-12T00:00:00.000Z',
  }]);
});

test('functions index exposes the three UAT callable functions', () => {
  const index = require('../index');
  assert.equal(typeof index.syncProductionWeeksToUat, 'function');
  assert.equal(typeof index.getProductionWeekSyncStatus, 'function');
  assert.equal(typeof index.restoreUatWeeksSnapshot, 'function');
});
