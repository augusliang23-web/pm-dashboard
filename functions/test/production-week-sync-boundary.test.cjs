const assert = require('node:assert/strict');
const test = require('node:test');
const { Firestore } = require('firebase-admin/firestore');
const core = require('../production-week-sync-core');

const sync = require('../production-week-sync');

function createBatchDb() {
  const batches = [];
  const rawBatches = [];
  const existingWeeks = new Map([['OLD', { projects: [] }]]);
  const db = {
    batches,
    rawBatches,
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
    async commitRawWrites(writes) {
      rawBatches.push(writes);
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

test('installed Firestore serializer and adapters preserve int64 bounds and integer-versus-double identity', async () => {
  const serializerDb = new Firestore({ projectId: 'numeric-fidelity-fixture', useBigInt: true });
  const serializer = serializerDb._serializer;
  const decoded = {
    int64Min: serializer.decodeValue({ integerValue: '-9223372036854775808' }),
    int64Max: serializer.decodeValue({ integerValue: '9223372036854775807' }),
    integerOne: serializer.decodeValue({ integerValue: '1' }),
    doubleOne: serializer.decodeValue({ doubleValue: 1 }),
  };
  assert.deepEqual(decoded, {
    int64Min: -9_223_372_036_854_775_808n,
    int64Max: 9_223_372_036_854_775_807n,
    integerOne: 1n,
    doubleOne: 1,
  });
  assert.deepEqual(serializer.encodeValue(decoded.doubleOne), { integerValue: 1 },
    'the high-level serializer alone cannot preserve a stored double 1.0');

  const sourceWeeks = await sync.createProductionReadStore({
    collection: () => ({ get: async () => ({
      readTime: { toDate: () => new Date('2026-09-12T01:02:03.000Z') },
      docs: [{ id: 'W36-2026', data: () => ({ projects: [], ...decoded }) }],
    }) }),
  }).listWeeks();
  assert.equal(typeof sourceWeeks[0].data.int64Max, 'bigint');

  const db = createBatchDb();
  const rawBatches = [];
  const store = sync.createUatSyncStore(db, {
    commitRawWrites: async writes => { rawBatches.push(writes); },
  });
  await store.writeSnapshot({
    snapshotId: 'run-1', runId: 'run-1', weeks: sourceWeeks,
    digest: core.digestWeekEntries(sourceWeeks), weekCount: 1,
    createdAt: '2026-09-12T01:03:00.000Z', operation: 'sync',
  });
  await store.applyMirror({ weeks: sourceWeeks, runId: 'run-1', batchSize: 200 });

  assert.equal(rawBatches.length, 2);
  for (const write of [rawBatches[0][0], rawBatches[1][0]]) {
    const numericFields = write.update.fields.data?.mapValue?.fields || write.update.fields;
    assert.deepEqual(numericFields.int64Min, { integerValue: '-9223372036854775808' });
    assert.deepEqual(numericFields.int64Max, { integerValue: '9223372036854775807' });
    assert.deepEqual(numericFields.integerOne, { integerValue: '1' });
    assert.deepEqual(numericFields.doubleOne, { doubleValue: 1 });
    const decodedWrite = serializer.decodeValue({ mapValue: { fields: numericFields } });
    assert.equal(core.digestWeekEntries([{ id: 'W36-2026', data: decodedWrite }]), core.digestWeekEntries(sourceWeeks));
  }
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

  assert.deepEqual(db.rawBatches.map(batch => batch.length), [200, 200, 1]);
  const write = db.rawBatches[0][0];
  assert.equal(write.update.name, 'projects/pm-dashboard-uat-20260820-a7f3/databases/(default)/documents/weeks/W0');
  assert.deepEqual(write.update.fields.ownerRef, {
    referenceValue: 'projects/pm-dashboard-uat-20260820-a7f3/databases/(default)/documents/projects/P-1',
  });
  assert.equal(db.rawBatches.at(-1)[0].delete, 'projects/pm-dashboard-uat-20260820-a7f3/databases/(default)/documents/weeks/OLD');
  assert.equal(db.renewalCount, 3);
});

test('snapshot writes and deletes also use 200-operation bounded batches', async () => {
  const db = createBatchDb();
  const store = sync.createUatSyncStore(db);
  const weeks = Array.from({ length: 400 }, (_, index) => ({ id: `W${index}`, data: { projects: [] } }));

  await store.writeSnapshot({ snapshotId: 'run-1', runId: 'run-1', weeks, digest: 'a'.repeat(64), weekCount: 400, createdAt: '2026-09-12T00:00:00.000Z' });
  assert.deepEqual(db.batches.map(batch => batch.length), [1]);
  assert.deepEqual(db.rawBatches.map(batch => batch.length), [200, 200]);
  assert.equal(db.batches[0][0].path, 'uatProductionWeekSyncRuns/run-1');
  assert.equal(db.batches[0][0].type, 'set');
  assert.equal(db.batches[0][0].data.complete, false);
  assert.equal(db.renewalCount, 3);

  db.batches.length = 0;
  db.rawBatches.length = 0;
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
    error => error.code === 'lease-lost' && /expired/i.test(error.message),
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
    {
      runId: 'complete-new', phase: 'restored', completedAt: '2026-09-12T04:00:00.000Z', snapshotId: 'snapshot-2',
      restoredFromSnapshotId: 'snapshot-1', restoredDigest: 'b'.repeat(64), restoredWeekCount: 2,
    },
    { snapshotId: 'snapshot-1', complete: true, createdAt: '2026-09-12T02:00:00.000Z', weeks: ['secret'] },
    { snapshotId: 'snapshot-2', complete: true, createdAt: '2026-09-12T06:00:00.000Z', weeks: ['secret'] },
  ];
  assert.deepEqual(await sync.createUatSyncStore(db).readStatus(), {
    running: true,
    phase: 'applying',
    latestRun: { runId: 'failed', phase: 'rollback_failed', completedAt: '2026-09-12T05:00:00.000Z' },
    latestCompletedRun: {
      runId: 'complete-new', phase: 'restored', completedAt: '2026-09-12T04:00:00.000Z', snapshotId: 'snapshot-2',
      restoredFromSnapshotId: 'snapshot-1', restoredDigest: 'b'.repeat(64), restoredWeekCount: 2,
    },
    latestSnapshot: { snapshotId: 'snapshot-2', createdAt: '2026-09-12T06:00:00.000Z' },
  });
});

test('rollback_failed remains the latest terminal run before and after lease expiry', async () => {
  const db = createBatchDb();
  db.runs = [
    { runId: 'older-success', phase: 'succeeded', result: 'succeeded', completedAt: '2026-09-12T03:00:00.000Z' },
    { runId: 'failed-run', phase: 'rollback_failed', result: 'failed', completedAt: '2026-09-12T05:00:00.000Z' },
  ];

  db.lease = { activeRunId: 'failed-run', expiresAt: '2999-01-01T00:00:00.000Z' };
  assert.deepEqual(await sync.createUatSyncStore(db).readStatus(), {
    running: true,
    phase: 'rollback_failed',
    latestRun: {
      runId: 'failed-run', phase: 'rollback_failed', result: 'failed', completedAt: '2026-09-12T05:00:00.000Z',
    },
    latestCompletedRun: {
      runId: 'older-success', phase: 'succeeded', result: 'succeeded', completedAt: '2026-09-12T03:00:00.000Z',
    },
  });

  db.lease.expiresAt = '2000-01-01T00:00:00.000Z';
  assert.deepEqual(await sync.createUatSyncStore(db).readStatus(), {
    running: false,
    latestRun: {
      runId: 'failed-run', phase: 'rollback_failed', result: 'failed', completedAt: '2026-09-12T05:00:00.000Z',
    },
    latestCompletedRun: {
      runId: 'older-success', phase: 'succeeded', result: 'succeeded', completedAt: '2026-09-12T03:00:00.000Z',
    },
  });
});

test('complete snapshot listings expose metadata only so restore reads the payload separately', async () => {
  const db = createBatchDb();
  const run = { snapshotId: 'run-1', complete: true, digest: 'a'.repeat(64), weekCount: 1, createdAt: '2026-09-12T00:00:00.000Z', weeks: [{ secret: true }] };
  db.collection = name => ({
    where(field, operator, value) {
      assert.deepEqual([name, field, operator, value], ['uatProductionWeekSyncRuns', 'complete', '==', true]);
      return { get: async () => ({ docs: [{ id: 'run-1', data: () => run }] }) };
    },
  });

  assert.deepEqual(await sync.createUatSyncStore(db).listCompleteSnapshots(), [{
    snapshotId: 'run-1', complete: true, digest: 'a'.repeat(64), weekCount: 1, createdAt: '2026-09-12T00:00:00.000Z',
  }]);
});

test('complete snapshot identity comes from the immutable Firestore document ID', async () => {
  const db = createBatchDb();
  db.collection = name => ({
    where(field, operator, value) {
      assert.deepEqual([name, field, operator, value], ['uatProductionWeekSyncRuns', 'complete', '==', true]);
      return { get: async () => ({ docs: [{
        id: 'restore-run',
        data: () => ({
          snapshotId: 'before-sync',
          complete: true,
          digest: 'a'.repeat(64),
          weekCount: 1,
          createdAt: '2026-09-12T00:00:00.000Z',
        }),
      }] }) };
    },
  });

  assert.deepEqual(await sync.createUatSyncStore(db).listCompleteSnapshots(), [{
    snapshotId: 'restore-run', complete: true, digest: 'a'.repeat(64), weekCount: 1, createdAt: '2026-09-12T00:00:00.000Z',
  }]);
});

test('functions index exposes the three UAT callable functions', () => {
  const index = require('../index');
  assert.equal(typeof index.syncProductionWeeksToUat, 'function');
  assert.equal(typeof index.getProductionWeekSyncStatus, 'function');
  assert.equal(typeof index.restoreUatWeeksSnapshot, 'function');
});
