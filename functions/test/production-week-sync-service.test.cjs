const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../production-week-sync-core');

const week = (id, code) => ({ id, data: { weekLabel: id, projects: [{ code }] } });
const admin = () => ({ uid: 'admin-1', email: 'admin@example.com', role: 'admin', displayName: 'Admin' });
const clone = value => JSON.parse(JSON.stringify(value));

function createMemoryDestination({ weeks = [], snapshots = [], status, failApply = 0, snapshotDigest } = {}) {
  const order = [];
  const state = {
    weeks: clone(weeks), snapshots: clone(snapshots), runs: [], lease: null, applyCount: 0,
  };
  const now = () => new Date('2026-09-11T00:00:00.000Z');
  const store = {
    order,
    state,
    async acquireLease(input) {
      order.push('acquireLease');
      if (state.lease && new Date(state.lease.expiresAt) > now()) return { acquired: false };
      state.lease = { ...input };
      return { acquired: true };
    },
    async renewLease(input) {
      order.push('renewLease');
      if (!state.lease || state.lease.runId !== input.runId) throw new Error('lease is not owned');
      state.lease = { ...state.lease, ...input };
    },
    async releaseLease({ runId }) {
      order.push('releaseLease');
      if (state.lease?.runId === runId) state.lease = null;
    },
    async createRun(metadata) {
      order.push(`createRun:${metadata.phase}`);
      state.runs.push(clone(metadata));
    },
    async updateRun(metadata) {
      order.push(`updateRun:${metadata.phase}`);
      state.runs.push(clone(metadata));
    },
    async readStatus() {
      order.push('readStatus');
      return status || { running: false, latestRun: { phase: 'succeeded', sourceWeekCount: 2 } };
    },
    async listWeeks() {
      order.push('listWeeks');
      return clone(state.weeks);
    },
    async writeSnapshot({ snapshotId, weeks: snapshotWeeks, digest, ...metadata }) {
      order.push('writeSnapshot');
      state.snapshots.push({ snapshotId, weeks: clone(snapshotWeeks), digest, complete: true, ...clone(metadata) });
    },
    async readSnapshot({ snapshotId }) {
      order.push('readSnapshot');
      const snapshot = state.snapshots.find(candidate => candidate.snapshotId === snapshotId);
      if (!snapshot) return null;
      return { ...clone(snapshot), digest: snapshotDigest || snapshot.digest };
    },
    async applyMirror({ weeks: nextWeeks }) {
      order.push('applyMirror');
      state.applyCount += 1;
      state.weeks = clone(nextWeeks);
      if (state.applyCount <= failApply) throw new Error(`apply failure ${state.applyCount}`);
    },
    async listCompleteSnapshots() {
      order.push('listCompleteSnapshots');
      return clone(state.snapshots.filter(snapshot => snapshot.complete));
    },
    async deleteSnapshot({ snapshotId }) {
      order.push('deleteSnapshot');
      state.snapshots = state.snapshots.filter(snapshot => snapshot.snapshotId !== snapshotId);
    },
  };
  return store;
}

function createService({ sourceWeeks = [week('W36-2026', 'NEW')], destination, ids = ['run-1'] } = {}) {
  let idIndex = 0;
  const sourceStore = { listWeeks: async () => clone(sourceWeeks) };
  return core.createWeekSyncService({
    sourceStore,
    destinationStore: destination,
    clock: () => new Date('2026-09-11T00:00:00.000Z'),
    idFactory: () => ids[idIndex++] || `run-${idIndex}`,
  });
}

test('sync snapshots before applying and exactly mirrors Production weeks', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD'), week('W36-2026', 'STALE')] });
  const service = createService({
    sourceWeeks: [week('W36-2026', 'NEW'), week('W37-2026', 'ADDED')],
    destination,
  });

  const result = await service.sync({ actor: admin() });

  assert.equal(result.ok, true);
  assert.equal(result.phase, 'succeeded');
  assert.deepEqual(destination.state.weeks, [week('W36-2026', 'NEW'), week('W37-2026', 'ADDED')]);
  assert.ok(destination.order.indexOf('writeSnapshot') < destination.order.indexOf('applyMirror'));
  assert.deepEqual(result, {
    ok: true, phase: 'succeeded', runId: 'run-1', snapshotId: 'run-1',
    sourceWeekCount: 2, createdCount: 1, updatedCount: 1, deletedCount: 1,
  });
});

test('sync rejects an invalid Production source before snapshot or UAT-week mutation', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')] });
  const service = createService({ sourceWeeks: [], destination });

  await assert.rejects(() => service.sync({ actor: admin() }), /no reporting weeks/);

  assert.deepEqual(destination.state.weeks, [week('W35-2026', 'OLD')]);
  assert.equal(destination.order.includes('writeSnapshot'), false);
  assert.equal(destination.order.includes('applyMirror'), false);
  assert.equal(destination.state.lease, null);
});

test('sync rejects a mismatched snapshot digest before UAT-week mutation', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')], snapshotDigest: 'not-the-snapshot-digest' });
  const service = createService({ destination });

  await assert.rejects(() => service.sync({ actor: admin() }), /snapshot digest/i);

  assert.equal(destination.order.includes('writeSnapshot'), true);
  assert.equal(destination.order.includes('applyMirror'), false);
  assert.deepEqual(destination.state.weeks, [week('W35-2026', 'OLD')]);
});

test('sync rolls back and verifies the original UAT weeks when apply fails', async () => {
  const original = [week('W35-2026', 'OLD')];
  const destination = createMemoryDestination({ weeks: original, failApply: 1 });
  const service = createService({ destination });

  const result = await service.sync({ actor: admin() });

  assert.deepEqual(result, { ok: false, phase: 'rolled_back', runId: 'run-1', snapshotId: 'run-1' });
  assert.deepEqual(destination.state.weeks, original);
  assert.deepEqual(destination.order.filter(entry => entry === 'applyMirror'), ['applyMirror', 'applyMirror']);
  assert.ok(destination.order.indexOf('updateRun:rolling_back') < destination.order.lastIndexOf('applyMirror'));
  assert.equal(destination.state.lease, null);
});

test('sync reports rollback_failed and retains its lease when rollback cannot be applied', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')], failApply: 2 });
  const service = createService({ destination });

  const result = await service.sync({ actor: admin() });

  assert.deepEqual(result, { ok: false, phase: 'rollback_failed', runId: 'run-1', snapshotId: 'run-1' });
  assert.equal(destination.state.lease.runId, 'run-1');
  assert.equal(destination.order.includes('releaseLease'), false);
});

test('sync rejects an active lease and reclaims an expired lease', async () => {
  const active = createMemoryDestination();
  active.state.lease = { runId: 'other-run', expiresAt: '2026-09-11T00:15:00.000Z' };
  const activeService = createService({ destination: active });
  await assert.rejects(() => activeService.sync({ actor: admin() }), /already running/i);
  assert.equal(active.order.includes('createRun:reading_source'), false);

  const expired = createMemoryDestination();
  expired.state.lease = { runId: 'old-run', expiresAt: '2026-09-10T23:59:59.999Z' };
  const expiredResult = await createService({ destination: expired }).sync({ actor: admin() });
  assert.equal(expiredResult.phase, 'succeeded');
});

test('restore snapshots current UAT weeks then mirrors a retained snapshot without reading Production', async () => {
  const retained = {
    snapshotId: 'before-sync', complete: true, createdAt: '2026-09-10T00:00:00.000Z',
    digest: core.digestWeekEntries([week('W34-2026', 'RESTORE')]), weeks: [week('W34-2026', 'RESTORE')],
  };
  const destination = createMemoryDestination({ weeks: [week('W36-2026', 'CURRENT')], snapshots: [retained] });
  let sourceReads = 0;
  const service = core.createWeekSyncService({
    sourceStore: { listWeeks: async () => { sourceReads += 1; return [week('W99-2026', 'NEVER')]; } },
    destinationStore: destination,
    clock: () => new Date('2026-09-11T00:00:00.000Z'),
    idFactory: () => 'restore-run',
  });

  const result = await service.restore({ actor: admin(), snapshotId: 'before-sync' });

  assert.deepEqual(result, { ok: true, phase: 'restored', runId: 'restore-run', snapshotId: 'before-sync' });
  assert.equal(sourceReads, 0);
  assert.deepEqual(destination.state.weeks, [week('W34-2026', 'RESTORE')]);
  assert.ok(destination.order.indexOf('writeSnapshot') < destination.order.indexOf('applyMirror'));
});

test('restore rejects a snapshot that is not among the retained complete snapshots', async () => {
  const destination = createMemoryDestination({ snapshots: [{
    snapshotId: 'incomplete', complete: false, digest: core.digestWeekEntries([]), weeks: [],
  }] });

  await assert.rejects(
    () => createService({ destination }).restore({ actor: admin(), snapshotId: 'incomplete' }),
    /not retained/i,
  );
  assert.equal(destination.order.includes('writeSnapshot'), false);
  assert.equal(destination.order.includes('applyMirror'), false);
});

test('status removes business payloads and credentials from destination metadata', async () => {
  const destination = createMemoryDestination({ status: {
    running: false,
    latestRun: { phase: 'succeeded', sourceWeekCount: 1, weeks: [week('W36-2026', 'SECRET')], credential: 'secret' },
    token: 'secret', latestSnapshot: { snapshotId: 'run-1', weeks: [week('W35-2026', 'SECRET')] },
  } });

  const result = await createService({ destination }).status({ actor: admin() });

  assert.deepEqual(result, {
    running: false,
    latestRun: { phase: 'succeeded', sourceWeekCount: 1 },
    latestSnapshot: { snapshotId: 'run-1' },
  });
});

test('sync retains only the five newest complete snapshots after verified success', async () => {
  const snapshots = Array.from({ length: 6 }, (_, index) => ({
    snapshotId: `old-${index + 1}`, complete: true, createdAt: `2026-09-0${index + 1}T00:00:00.000Z`,
    digest: core.digestWeekEntries([]), weeks: [],
  }));
  const destination = createMemoryDestination({ snapshots });

  await createService({ destination, ids: ['newest'] }).sync({ actor: admin() });

  assert.deepEqual(destination.state.snapshots.map(snapshot => snapshot.snapshotId).sort(),
    ['newest', 'old-3', 'old-4', 'old-5', 'old-6']);
  assert.deepEqual(destination.order.filter(entry => entry === 'deleteSnapshot'), ['deleteSnapshot', 'deleteSnapshot']);
});

test('run metadata excludes week payloads and credentials', async () => {
  const destination = createMemoryDestination();
  await createService({ destination }).sync({ actor: { ...admin(), credential: 'do-not-store' } });

  for (const metadata of destination.state.runs) {
    assert.equal(JSON.stringify(metadata).includes('weekLabel'), false);
    assert.equal(JSON.stringify(metadata).includes('credential'), false);
    assert.equal(Object.hasOwn(metadata, 'weeks'), false);
  }
});
