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
          async set(data, options = {}) {
            const runs = db.runs || [];
            const prior = runs.find(run => run.runId === id || run.snapshotId === id);
            const next = options.merge ? { ...prior, ...data } : data;
            db.runs = [...runs.filter(run => run !== prior), next];
          },
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

function createSerializerBackedDb({ serializer, runs, snapshotWeeks, currentWeeks, failRunSet }) {
  const state = {
    lease: null,
    runs: new Map(runs.map(({ id, data }) => [id, data])),
    snapshotWeeks: new Map([...snapshotWeeks].map(([snapshotId, weeks]) => [snapshotId, new Map(weeks)])),
    currentWeeks: new Map(currentWeeks),
    rawWrites: [],
  };

  const runDocument = id => ({
    id,
    path: `uatProductionWeekSyncRuns/${id}`,
    async get() {
      const data = state.runs.get(id);
      return { exists: data !== undefined, data: () => data };
    },
    async create(data) { state.runs.set(id, data); },
    async set(data, options = {}) {
      if (failRunSet?.(data)) throw new Error('transient run audit write failure');
      state.runs.set(id, options.merge ? { ...state.runs.get(id), ...data } : data);
    },
    collection(child) {
      if (child !== 'weeks') throw new Error(`Unexpected snapshot child collection: ${child}`);
      return {
        doc: weekId => ({ path: `uatProductionWeekSyncRuns/${id}/weeks/${weekId}`, id: weekId }),
        get: async () => ({ docs: [...(state.snapshotWeeks.get(id) || new Map())]
          .map(([weekId, data]) => ({ id: weekId, data: () => data, ref: { path: `uatProductionWeekSyncRuns/${id}/weeks/${weekId}` } })) }),
      };
    },
  });
  const controlDocument = () => ({
    path: 'uatProductionWeekSync/control',
    async get() { return { exists: state.lease !== null, data: () => state.lease || {} }; },
  });
  const weeksCollection = () => ({
    doc: id => ({ path: `weeks/${id}`, id }),
    get: async () => ({ docs: [...state.currentWeeks]
      .map(([id, data]) => ({ id, data: () => data, ref: { path: `weeks/${id}` } })) }),
  });
  const runsCollection = () => ({
    doc: runDocument,
    get: async () => ({ docs: [...state.runs].map(([id, data]) => ({ id, data: () => data })) }),
    where(field, operator, value) {
      assert.deepEqual([field, operator, value], ['complete', '==', true]);
      return { get: async () => ({ docs: [...state.runs]
        .filter(([, data]) => data.complete === true)
        .map(([id, data]) => ({ id, data: () => data })) }) };
    },
  });

  return {
    state,
    collection(name) {
      if (name === 'weeks') return weeksCollection();
      if (name === 'uatProductionWeekSync') return { doc: controlDocument };
      if (name === 'uatProductionWeekSyncRuns') return runsCollection();
      throw new Error(`Unexpected collection: ${name}`);
    },
    async runTransaction(work) {
      return work({
        get: ref => ref.get(),
        set(ref, data) {
          if (ref.path !== 'uatProductionWeekSync/control') throw new Error(`Unexpected transaction write: ${ref.path}`);
          state.lease = {
            ...state.lease,
            ...data,
            ...(data.expiresAt ? { expiresAt: '2999-01-01T00:00:00.000Z' } : {}),
          };
        },
      });
    },
    batch() {
      const operations = [];
      return {
        set(ref, data, options) { operations.push(() => ref.set(data, options)); },
        delete() { throw new Error('Snapshot pruning is outside this fixture.'); },
        async commit() { await Promise.all(operations.map(operation => operation())); },
      };
    },
    async commitRawWrites(writes) {
      state.rawWrites.push(...writes);
      for (const write of writes) {
        if (write.update) {
          const path = write.update.name.split('/documents/')[1];
          const decoded = serializer.decodeValue({ mapValue: { fields: write.update.fields } });
          const snapshotMatch = /^uatProductionWeekSyncRuns\/([^/]+)\/weeks\/([^/]+)$/.exec(path);
          const weekMatch = /^weeks\/([^/]+)$/.exec(path);
          if (snapshotMatch) {
            const [, snapshotId, weekId] = snapshotMatch;
            if (!state.snapshotWeeks.has(snapshotId)) state.snapshotWeeks.set(snapshotId, new Map());
            state.snapshotWeeks.get(snapshotId).set(weekId, decoded);
          } else if (weekMatch) {
            state.currentWeeks.set(weekMatch[1], decoded);
          } else {
            throw new Error(`Unexpected raw update: ${path}`);
          }
        } else if (write.delete) {
          const weekMatch = /^.*\/documents\/weeks\/([^/]+)$/.exec(write.delete);
          if (!weekMatch) throw new Error(`Unexpected raw delete: ${write.delete}`);
          state.currentWeeks.delete(weekMatch[1]);
        }
      }
    },
  };
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

test('Firestore-decoded operational metadata is normalized at status and restore boundaries without changing week numeric tags', async () => {
  const serializerDb = new Firestore({ projectId: 'metadata-round-trip-fixture', useBigInt: true });
  const serializer = serializerDb._serializer;
  const countFields = [
    'weekCount', 'sourceWeekCount', 'destinationWeekCount', 'resultWeekCount',
    'restoredWeekCount', 'createdCount', 'updatedCount', 'deletedCount',
  ];
  const retainedWeek = serializer.decodeValue({ mapValue: { fields: {
    projects: { arrayValue: { values: [] } },
    exactInteger: { integerValue: '9007199254740993' },
    doubleOne: { doubleValue: 1 },
    negativeZero: { doubleValue: -0 },
  } } });
  const decodedSnapshot = serializer.decodeValue({ mapValue: { fields: {
    snapshotId: { stringValue: 'untrusted-payload-id' },
    complete: { booleanValue: true },
    digest: { stringValue: core.digestWeekEntries([{ id: 'W36-2026', data: retainedWeek }]) },
    createdAt: { stringValue: '2026-09-12T00:00:00.000Z' },
    ...Object.fromEntries(countFields.map(field => [field, { integerValue: '1' }])),
  } } });
  const decodedCompletedRun = serializer.decodeValue({ mapValue: { fields: {
    runId: { stringValue: 'completed-run' },
    phase: { stringValue: 'succeeded' },
    completedAt: { stringValue: '2026-09-12T01:00:00.000Z' },
    ...Object.fromEntries(countFields.map(field => [field, { integerValue: '1' }])),
  } } });
  assert.equal(typeof decodedSnapshot.weekCount, 'bigint');
  assert.equal(typeof decodedCompletedRun.resultWeekCount, 'bigint');

  const db = createSerializerBackedDb({
    serializer,
    runs: [{ id: 'before-sync', data: decodedSnapshot }, { id: 'completed-run', data: decodedCompletedRun }],
    snapshotWeeks: [['before-sync', [['W36-2026', { data: retainedWeek }]]]],
    currentWeeks: [['W36-2026', retainedWeek]],
  });
  const store = sync.createUatSyncStore(db);
  const status = await store.readStatus();
  assert.equal(status.latestCompletedRun.resultWeekCount, 1);
  assert.equal(typeof status.latestCompletedRun.resultWeekCount, 'number');

  const snapshot = await store.readSnapshot({ snapshotId: 'before-sync' });
  assert.equal(snapshot.snapshotId, 'before-sync');
  assert.equal(snapshot.weekCount, 1);
  assert.equal(typeof snapshot.weeks[0].data.exactInteger, 'bigint');

  const service = core.createWeekSyncService({
    sourceStore: { listWeeks: async () => { throw new Error('Restore must not read Production.'); } },
    destinationStore: store,
    clock: () => new Date('2026-09-12T02:00:00.000Z'),
    idFactory: () => 'restore-run',
  });
  assert.equal((await service.restore({ actor: { uid: 'admin', email: 'admin@example.com' }, snapshotId: 'before-sync' })).phase, 'restored');

  const snapshotWrite = db.state.rawWrites.find(write => write.update?.name.endsWith('/uatProductionWeekSyncRuns/restore-run/weeks/W36-2026'));
  const applyWrite = db.state.rawWrites.find(write => write.update?.name.endsWith('/weeks/W36-2026'));
  for (const write of [snapshotWrite, applyWrite]) {
    const fields = write.update.fields.data?.mapValue?.fields || write.update.fields;
    assert.deepEqual(fields.exactInteger, { integerValue: '9007199254740993' });
    assert.deepEqual(fields.doubleOne, { doubleValue: 1 });
    assert.equal(Object.is(fields.negativeZero.doubleValue, -0), true);
  }
});

test('adapter status reload keeps complete successful audit fields after a one-time terminal audit failure', async () => {
  const serializer = new Firestore({ projectId: 'terminal-audit-reload-fixture', useBigInt: true })._serializer;
  let failSucceededAudit = true;
  const oldWeeks = [{ id: 'W35-2026', data: { projects: [], status: 'OLD' } }];
  const sourceWeeks = [{ id: 'W36-2026', data: { projects: [], status: 'NEW' } }];
  const db = createSerializerBackedDb({
    serializer,
    runs: [{ id: 'old-failed', data: {
      runId: 'old-failed', phase: 'rollback_failed', result: 'failed', completedAt: '2026-09-12T01:00:00.000Z',
    } }],
    snapshotWeeks: [],
    currentWeeks: oldWeeks.map(week => [week.id, week.data]),
    failRunSet: data => {
      if (data.phase === 'succeeded' && failSucceededAudit) {
        failSucceededAudit = false;
        return true;
      }
      return false;
    },
  });
  const service = core.createWeekSyncService({
    sourceStore: { listWeeks: async () => {
      const result = structuredClone(sourceWeeks);
      Object.defineProperty(result, 'sourceReadTime', { value: '2026-09-13T01:00:00.000Z' });
      return result;
    } },
    destinationStore: sync.createUatSyncStore(db),
    clock: () => new Date('2026-09-13T02:00:00.000Z'),
    idFactory: () => 'completed-run',
  });

  assert.equal((await service.sync({ actor: { uid: 'admin', email: 'admin@example.com' } })).phase, 'succeeded');
  const status = await service.status({ actor: { uid: 'admin', email: 'admin@example.com' } });

  assert.equal(status.latestRun.runId, 'completed-run');
  assert.equal(status.latestRun.phase, 'succeeded');
  const expectedCompleted = {
    runId: 'completed-run', phase: 'succeeded', operation: 'sync',
    sourceProjectId: 'project-manager-dashboar-a067f', destinationProjectId: 'pm-dashboard-uat-20260820-a7f3',
    productionProjectId: 'project-manager-dashboar-a067f', uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
    snapshotId: 'completed-run', sourceReadTime: '2026-09-13T01:00:00.000Z',
    sourceWeekCount: 1, destinationWeekCount: 1, createdCount: 1, updatedCount: 0, deletedCount: 1,
    sourceDigest: core.digestWeekEntries(sourceWeeks), resultDigest: core.digestWeekEntries(sourceWeeks), resultWeekCount: 1,
    completedAt: '2026-09-13T02:00:00.000Z',
  };
  for (const [field, value] of Object.entries(expectedCompleted)) {
    assert.deepEqual(status.latestCompletedRun[field], value, field);
  }
  assert.equal(status.latestCompletedRun.cleanupWarning, 'success-recording-failed');
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
      productionProjectId: 'project-manager-dashboar-a067f', uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
      restoredFromSnapshotId: 'snapshot-1', restoredDigest: 'b'.repeat(64), restoredWeekCount: 2,
    },
    { snapshotId: 'snapshot-1', complete: true, createdAt: '2026-09-12T02:00:00.000Z', weeks: ['secret'] },
    { snapshotId: 'snapshot-2', complete: true, createdAt: '2026-09-12T06:00:00.000Z', weeks: ['secret'] },
  ];
  assert.deepEqual(await sync.createUatSyncStore(db).readStatus(), {
    running: true,
    phase: 'applying',
    recoveryRequired: false,
    latestRun: { runId: 'failed', phase: 'rollback_failed', completedAt: '2026-09-12T05:00:00.000Z' },
    latestCompletedRun: {
      runId: 'complete-new', phase: 'restored', completedAt: '2026-09-12T04:00:00.000Z', snapshotId: 'snapshot-2',
      productionProjectId: 'project-manager-dashboar-a067f', uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
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
    recoveryRequired: false,
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
    recoveryRequired: false,
    latestRun: {
      runId: 'failed-run', phase: 'rollback_failed', result: 'failed', completedAt: '2026-09-12T05:00:00.000Z',
    },
    latestCompletedRun: {
      runId: 'older-success', phase: 'succeeded', result: 'succeeded', completedAt: '2026-09-12T03:00:00.000Z',
    },
  });
});

test('durable recovery status survives lease replacement and newer failed runs until explicitly cleared', async () => {
  const db = createBatchDb();
  db.lease = {
    activeRunId: 'failed-run',
    expiresAt: '2000-01-01T00:00:00.000Z',
    recoveryRequired: true,
    rollbackFailedRunId: 'failed-run',
    rollbackFailedAt: '2026-09-12T05:00:00.000Z',
  };
  const store = sync.createUatSyncStore(db);

  assert.deepEqual(await store.acquireLease({ runId: 'new-run', actor: {}, expiresAt: '2999-01-01T00:00:00.000Z' }), { acquired: true });
  await store.renewLease({ runId: 'new-run', expiresAt: '2999-01-01T00:15:00.000Z' });
  await store.updateRun({ runId: 'new-run', phase: 'restoring', result: 'failed', completedAt: '2026-09-12T06:10:00.000Z' });

  assert.deepEqual(await store.readStatus(), {
    running: true,
    phase: 'restoring',
    recoveryRequired: true,
    rollbackFailedRunId: 'failed-run',
    rollbackFailedAt: '2026-09-12T05:00:00.000Z',
    latestRun: { runId: 'new-run', phase: 'restoring', result: 'failed', completedAt: '2026-09-12T06:10:00.000Z' },
  });

  await store.clearRecoveryRequired({ runId: 'verified-restore' });
  assert.deepEqual(await store.readStatus(), {
    running: true,
    phase: 'restoring',
    recoveryRequired: false,
    latestRun: { runId: 'new-run', phase: 'restoring', result: 'failed', completedAt: '2026-09-12T06:10:00.000Z' },
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
