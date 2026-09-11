const assert = require('node:assert/strict');
const test = require('node:test');
const { Firestore } = require('firebase-admin/firestore');

const sync = require('../production-week-sync');

function createBatchDb() {
  const batches = [];
  const existingWeeks = new Map([['OLD', { projects: [] }]]);
  const db = {
    batches,
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
        }),
      };
    },
    doc(path) { return { path, id: path.split('/').at(-1) }; },
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
});

test('snapshot writes and deletes also use 200-operation bounded batches', async () => {
  const db = createBatchDb();
  const store = sync.createUatSyncStore(db);
  const weeks = Array.from({ length: 400 }, (_, index) => ({ id: `W${index}`, data: { projects: [] } }));

  await store.writeSnapshot({ snapshotId: 'run-1', weeks, digest: 'a'.repeat(64), weekCount: 400, createdAt: '2026-09-12T00:00:00.000Z' });
  assert.deepEqual(db.batches.map(batch => batch.length), [200, 200, 1]);
  assert.equal(db.batches[0][0].path, 'uatProductionWeekSyncRuns/run-1');
  assert.equal(db.batches[0][0].type, 'set');

  db.batches.length = 0;
  const runRef = {
    collection: () => ({ get: async () => ({ docs: weeks.map(week => ({ ref: { path: `uatProductionWeekSyncRuns/run-1/weeks/${week.id}` } })) }) }),
  };
  db.collection = name => ({ doc: () => name === 'uatProductionWeekSyncRuns' ? runRef : { path: `${name}/control` } });
  await store.deleteSnapshot({ snapshotId: 'run-1' });
  assert.deepEqual(db.batches.map(batch => batch.length), [200, 200, 1]);
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
