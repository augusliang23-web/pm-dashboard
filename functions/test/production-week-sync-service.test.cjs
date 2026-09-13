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
    recovery: { recoveryRequired: false, rollbackFailedRunId: null, rollbackFailedAt: null },
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
      return status || {
        running: false,
        ...clone(state.recovery),
        latestRun: { phase: 'succeeded', sourceWeekCount: 2 },
      };
    },
    async setRecoveryRequired({ runId, failedAt }) {
      order.push('setRecoveryRequired');
      state.recovery = {
        recoveryRequired: true,
        rollbackFailedRunId: runId,
        rollbackFailedAt: failedAt,
      };
    },
    async clearRecoveryRequired({ runId }) {
      order.push('clearRecoveryRequired');
      if (state.recovery.recoveryRequired) {
        state.recovery = {
          recoveryRequired: false,
          rollbackFailedRunId: null,
          rollbackFailedAt: null,
        };
      }
    },
    async listWeeks() {
      order.push('listWeeks');
      return clone(state.weeks);
    },
    async writeSnapshot({ snapshotId, weeks: snapshotWeeks, digest, ...metadata }) {
      order.push('writeSnapshot');
      state.snapshots.push({ snapshotId, weeks: clone(snapshotWeeks), digest, complete: false, ...clone(metadata) });
    },
    async completeSnapshot({ snapshotId }) {
      order.push('completeSnapshot');
      const snapshot = state.snapshots.find(candidate => candidate.snapshotId === snapshotId);
      if (!snapshot) throw new Error('snapshot is missing');
      snapshot.complete = true;
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
  const sourceStore = { listWeeks: async () => {
    const result = clone(sourceWeeks);
    Object.defineProperty(result, 'sourceReadTime', { value: '2026-09-11T00:00:00.000Z' });
    return result;
  } };
  return core.createWeekSyncService({
    sourceStore,
    destinationStore: destination,
    clock: () => new Date('2026-09-11T00:00:00.000Z'),
    idFactory: () => ids[idIndex++] || `run-${idIndex}`,
  });
}

test('sync records and returns fixed environment IDs, preserved source read time, and completion time', async () => {
  const sourceWeeks = [week('W36-2026', 'NEW')];
  Object.defineProperty(sourceWeeks, 'sourceReadTime', { value: '2026-09-12T01:02:03.000Z' });
  const destination = createMemoryDestination();
  const service = core.createWeekSyncService({
    sourceStore: { listWeeks: async () => sourceWeeks },
    destinationStore: destination,
    clock: () => new Date('2026-09-12T02:03:04.000Z'),
    idFactory: () => 'run-1',
  });

  const result = await service.sync({ actor: admin() });

  assert.equal(result.sourceProjectId, 'project-manager-dashboar-a067f');
  assert.equal(result.destinationProjectId, 'pm-dashboard-uat-20260820-a7f3');
  assert.equal(result.sourceReadTime, '2026-09-12T01:02:03.000Z');
  assert.equal(result.completedAt, '2026-09-12T02:03:04.000Z');
  assert.equal(result.sourceDigest, core.digestWeekEntries(sourceWeeks));
  assert.equal(result.resultDigest, core.digestWeekEntries(sourceWeeks));
  assert.equal(result.resultWeekCount, 1);
  assertRunContains(destination.state.runs.at(-1), {
    productionProjectId: 'project-manager-dashboar-a067f',
    uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
    sourceProjectId: 'project-manager-dashboar-a067f',
    destinationProjectId: 'pm-dashboard-uat-20260820-a7f3',
    sourceReadTime: '2026-09-12T01:02:03.000Z',
    sourceDigest: core.digestWeekEntries(sourceWeeks),
    resultDigest: core.digestWeekEntries(sourceWeeks),
    resultWeekCount: 1,
    completedAt: '2026-09-12T02:03:04.000Z',
  });
});

function assertRunContains(actual, expected) {
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, key);
}

test('sync rejects a missing source read time before reading or mutating UAT weeks', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')] });
  const service = core.createWeekSyncService({
    sourceStore: { listWeeks: async () => [week('W36-2026', 'NEW')] },
    destinationStore: destination,
    clock: () => new Date('2026-09-12T02:03:04.000Z'),
    idFactory: () => 'run-1',
  });

  await assert.rejects(() => service.sync({ actor: admin() }), error => (
    error.code === 'production-source-incomplete' && /read/i.test(error.message)
  ));
  assert.equal(destination.order.includes('listWeeks'), false);
  assert.equal(destination.order.includes('writeSnapshot'), false);
  assert.equal(destination.order.includes('applyMirror'), false);
  assertRunContains(destination.state.runs.at(-1), {
    productionProjectId: 'project-manager-dashboar-a067f',
    uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
    sourceReadTime: null,
    sourceDigest: null,
    resultDigest: null,
    resultWeekCount: 0,
    createdCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    completedAt: '2026-09-12T02:03:04.000Z',
  });
});

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
    sourceProjectId: 'project-manager-dashboar-a067f', destinationProjectId: 'pm-dashboard-uat-20260820-a7f3',
    sourceReadTime: '2026-09-11T00:00:00.000Z', sourceDigest: core.digestWeekEntries(resultWeeks()),
    resultDigest: core.digestWeekEntries(resultWeeks()), resultWeekCount: 2, completedAt: '2026-09-11T00:00:00.000Z',
  });
});

function resultWeeks() {
  return [week('W36-2026', 'NEW'), week('W37-2026', 'ADDED')];
}

test('sync rejects an invalid Production source before snapshot or UAT-week mutation', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')] });
  const service = createService({ sourceWeeks: [], destination });

  await assert.rejects(() => service.sync({ actor: admin() }), error => (
    error.code === 'production-source-empty' && /no reporting weeks/i.test(error.message)
  ));

  assert.deepEqual(destination.state.weeks, [week('W35-2026', 'OLD')]);
  assert.equal(destination.order.includes('writeSnapshot'), false);
  assert.equal(destination.order.includes('applyMirror'), false);
  assert.equal(destination.state.lease, null);
});

test('sync rejects a mismatched snapshot digest before UAT-week mutation', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')], snapshotDigest: 'not-the-snapshot-digest' });
  const service = createService({ destination });

  await assert.rejects(() => service.sync({ actor: admin() }), error => (
    error.code === 'snapshot-integrity-failed' && /snapshot digest/i.test(error.message)
  ));

  assert.equal(destination.order.includes('writeSnapshot'), true);
  assert.equal(destination.order.includes('applyMirror'), false);
  assert.deepEqual(destination.state.weeks, [week('W35-2026', 'OLD')]);
  assert.equal(destination.state.runs.at(-1).phase, 'snapshotting');
});

test('sync classifies a self-consistent but wrong snapshot payload as an integrity failure', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')] });
  const originalRead = destination.readSnapshot;
  destination.readSnapshot = async input => {
    const snapshot = await originalRead(input);
    const wrongWeeks = [week('W99-2026', 'WRONG')];
    return { ...snapshot, weeks: wrongWeeks, digest: core.digestWeekEntries(wrongWeeks) };
  };

  await assert.rejects(() => createService({ destination }).sync({ actor: admin() }), error => (
    error.code === 'snapshot-integrity-failed'
  ));
  assert.equal(destination.order.includes('applyMirror'), false);
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
  assertRunContains(destination.state.runs.at(-1), {
    productionProjectId: 'project-manager-dashboar-a067f',
    uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
    sourceReadTime: '2026-09-11T00:00:00.000Z',
    sourceDigest: core.digestWeekEntries([week('W36-2026', 'NEW')]),
    resultDigest: core.digestWeekEntries(original),
    resultWeekCount: 1,
    createdCount: 1,
    updatedCount: 0,
    deletedCount: 1,
    completedAt: '2026-09-11T00:00:00.000Z',
  });
});

test('sync reports rollback_failed and retains its lease when rollback cannot be applied', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')], failApply: 2 });
  const service = createService({ destination });

  const result = await service.sync({ actor: admin() });

  assert.deepEqual(result, { ok: false, phase: 'rollback_failed', runId: 'run-1', snapshotId: 'run-1' });
  assert.equal(destination.state.lease.runId, 'run-1');
  assert.equal(destination.order.includes('setRecoveryRequired'), true);
  assert.equal(destination.order.includes('releaseLease'), false);
  assertRunContains(destination.state.runs.at(-1), {
    productionProjectId: 'project-manager-dashboar-a067f',
    uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
    sourceReadTime: '2026-09-11T00:00:00.000Z',
    sourceDigest: core.digestWeekEntries([week('W36-2026', 'NEW')]),
    resultDigest: null,
    resultWeekCount: 0,
    createdCount: 1,
    updatedCount: 0,
    deletedCount: 1,
    completedAt: '2026-09-11T00:00:00.000Z',
  });
});

test('recovery-required survives an expired lease, failed restore, and successful sync until a verified restore clears it', async () => {
  const original = [week('W35-2026', 'OLD')];
  const destination = createMemoryDestination({ weeks: original, failApply: 2 });
  const originalUpdate = destination.updateRun;
  destination.updateRun = async metadata => {
    if (metadata.phase === 'rollback_failed') throw new Error('rollback audit unavailable');
    return originalUpdate(metadata);
  };
  const service = createService({
    destination,
    ids: ['failed-sync', 'failed-restore', 'later-sync', 'verified-restore'],
  });

  assert.deepEqual(await service.sync({ actor: admin() }), {
    ok: false, phase: 'rollback_failed', runId: 'failed-sync', snapshotId: 'failed-sync',
  });
  assert.deepEqual(destination.state.recovery, {
    recoveryRequired: true,
    rollbackFailedRunId: 'failed-sync',
    rollbackFailedAt: '2026-09-11T00:00:00.000Z',
  });
  assert.equal(destination.state.lease.runId, 'failed-sync');

  destination.state.lease.expiresAt = '2000-01-01T00:00:00.000Z';
  const originalSnapshots = destination.listCompleteSnapshots;
  destination.listCompleteSnapshots = async () => { throw new Error('retained snapshot lookup failed'); };
  await assert.rejects(() => service.restore({ actor: admin(), snapshotId: 'failed-sync' }));
  destination.listCompleteSnapshots = originalSnapshots;
  assert.equal(destination.state.recovery.recoveryRequired, true);

  assert.equal((await service.sync({ actor: admin() })).phase, 'succeeded');
  assert.equal(destination.state.recovery.recoveryRequired, true);

  assert.equal((await service.restore({ actor: admin(), snapshotId: 'failed-sync' })).phase, 'restored');
  assert.deepEqual(destination.state.recovery, {
    recoveryRequired: false,
    rollbackFailedRunId: null,
    rollbackFailedAt: null,
  });
  assert.equal(destination.order.includes('clearRecoveryRequired'), true);
});

test('rollback failure remains truthful and retains its lease when recording recovery-required also fails', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')], failApply: 2 });
  destination.setRecoveryRequired = async () => {
    destination.order.push('setRecoveryRequired');
    throw new Error('recovery control write unavailable');
  };

  const result = await createService({ destination }).sync({ actor: admin() });

  assert.deepEqual(result, { ok: false, phase: 'rollback_failed', runId: 'run-1', snapshotId: 'run-1' });
  assert.equal(destination.state.lease.runId, 'run-1');
  assert.equal(destination.order.includes('releaseLease'), false);
});

test('rollback restores UAT even when rolling-back and rollback-failed audit writes fail', async () => {
  const original = [week('W35-2026', 'OLD')];
  const destination = createMemoryDestination({ weeks: original, failApply: 1 });
  const originalUpdate = destination.updateRun;
  destination.updateRun = async metadata => {
    if (metadata.phase === 'rolling_back' || metadata.phase === 'rollback_failed') {
      throw new Error(`audit failed for ${metadata.phase}`);
    }
    return originalUpdate(metadata);
  };

  const result = await createService({ destination }).sync({ actor: admin() });

  assert.deepEqual(result, { ok: false, phase: 'rolled_back', runId: 'run-1', snapshotId: 'run-1' });
  assert.deepEqual(destination.state.weeks, original);
  assert.equal(destination.state.applyCount, 2);
  assert.equal(destination.state.lease, null);
});

test('rollback failure returns rollback_failed and retains its lease despite audit failures', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')], failApply: 2 });
  const originalUpdate = destination.updateRun;
  destination.updateRun = async metadata => {
    if (metadata.phase === 'rolling_back' || metadata.phase === 'rollback_failed') {
      throw new Error(`audit failed for ${metadata.phase}`);
    }
    return originalUpdate(metadata);
  };

  const result = await createService({ destination }).sync({ actor: admin() });

  assert.deepEqual(result, { ok: false, phase: 'rollback_failed', runId: 'run-1', snapshotId: 'run-1' });
  assert.equal(destination.state.applyCount, 2);
  assert.equal(destination.state.lease.runId, 'run-1');
});

test('sync rejects an active lease and reclaims an expired lease', async () => {
  const active = createMemoryDestination();
  active.state.lease = { runId: 'other-run', expiresAt: '2026-09-11T00:15:00.000Z' };
  const activeService = createService({ destination: active });
  await assert.rejects(() => activeService.sync({ actor: admin() }), error => (
    error.code === 'operation-in-progress' && /already running/i.test(error.message)
  ));
  assert.equal(active.order.includes('createRun:reading_source'), false);

  const expired = createMemoryDestination();
  expired.state.lease = { runId: 'old-run', expiresAt: '2026-09-10T23:59:59.999Z' };
  const expiredResult = await createService({ destination: expired }).sync({ actor: admin() });
  assert.equal(expiredResult.phase, 'succeeded');
});

test('restore snapshots current UAT weeks then mirrors a retained snapshot without reading Production', async () => {
  const retained = {
    snapshotId: 'before-sync', complete: true, createdAt: '2026-09-10T00:00:00.000Z',
    digest: core.digestWeekEntries([week('W34-2026', 'RESTORE')]), weekCount: 1, weeks: [week('W34-2026', 'RESTORE')],
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

  assert.deepEqual(result, {
    ok: true,
    phase: 'restored',
    runId: 'restore-run',
    snapshotId: 'restore-run',
    restoredFromSnapshotId: 'before-sync',
    restoredDigest: retained.digest,
    restoredWeekCount: 1,
    sourceProjectId: 'pm-dashboard-uat-20260820-a7f3',
    destinationProjectId: 'pm-dashboard-uat-20260820-a7f3',
    completedAt: '2026-09-11T00:00:00.000Z',
  });
  assert.equal(sourceReads, 0);
  assert.deepEqual(destination.state.weeks, [week('W34-2026', 'RESTORE')]);
  assert.ok(destination.order.indexOf('writeSnapshot') < destination.order.indexOf('applyMirror'));
  assert.deepEqual(destination.state.snapshots.map(snapshot => snapshot.snapshotId).sort(), ['before-sync', 'restore-run']);
  const terminalRun = destination.state.runs.at(-1);
  assert.equal(terminalRun.snapshotId, 'restore-run');
  assert.equal(terminalRun.restoredFromSnapshotId, 'before-sync');
  assert.equal(terminalRun.productionProjectId, 'project-manager-dashboar-a067f');
  assert.equal(terminalRun.uatProjectId, 'pm-dashboard-uat-20260820-a7f3');
});

test('restore rejects a snapshot that is not among the retained complete snapshots', async () => {
  const destination = createMemoryDestination({ snapshots: [{
    snapshotId: 'incomplete', complete: false, digest: core.digestWeekEntries([]), weeks: [],
  }] });

  await assert.rejects(
    () => createService({ destination }).restore({ actor: admin(), snapshotId: 'incomplete' }),
    error => error.code === 'snapshot-not-retained' && /not retained/i.test(error.message),
  );
  assert.equal(destination.order.includes('writeSnapshot'), false);
  assert.equal(destination.order.includes('applyMirror'), false);
  assert.equal(destination.state.runs.at(-1).phase, 'restoring');
  assert.equal(destination.state.runs.some(run => run.phase === 'reading_source'), false);
  assertRunContains(destination.state.runs.at(-1), {
    productionProjectId: 'project-manager-dashboar-a067f',
    uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
    restoredFromSnapshotId: 'incomplete',
    restoredDigest: null,
    restoredWeekCount: 0,
    completedAt: '2026-09-11T00:00:00.000Z',
  });
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

test('status uses a closed summary allowlist and drops unrecognised nested payloads', async () => {
  const destination = createMemoryDestination({ status: {
    running: true, phase: 'applying', arbitraryTopLevel: 'do-not-return',
    latestRun: {
      runId: 'run-1', phase: 'applying', sourceWeekCount: 1, createdCount: 1,
      projects: [{ code: 'SECRET' }], payload: 'secret', nested: { kept: 'no' },
    },
    latestSnapshot: { snapshotId: 'run-1', createdAt: '2026-09-11T00:00:00.000Z', weeks: [week('W36-2026', 'SECRET')] },
  } });

  assert.deepEqual(await createService({ destination }).status({ actor: admin() }), {
    running: true, phase: 'applying',
    latestRun: { runId: 'run-1', phase: 'applying', sourceWeekCount: 1, createdCount: 1 },
    latestSnapshot: { snapshotId: 'run-1', createdAt: '2026-09-11T00:00:00.000Z' },
  });
});

test('verified sync success stays successful when finalization writes, release, or cleanup-warning recording fails', async () => {
  for (const failure of ['success-recording', 'release', 'cleanup-warning']) {
    const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')] });
    const originalRelease = destination.releaseLease;
    if (failure === 'success-recording') {
      const originalUpdate = destination.updateRun;
      let failed = false;
      destination.updateRun = async metadata => {
        if (metadata.phase === 'succeeded' && !failed) {
          failed = true;
          throw new Error('success recording failed');
        }
        return originalUpdate(metadata);
      };
    } else if (failure === 'release') {
      destination.releaseLease = async () => { destination.order.push('releaseLease'); throw new Error('release failed'); };
    } else {
      destination.listCompleteSnapshots = async () => { throw new Error('cleanup failed'); };
      destination.updateRun = async metadata => {
        destination.order.push(`updateRun:${metadata.phase}`);
        if (metadata.cleanupWarning) throw new Error('cleanup warning recording failed');
        destination.state.runs.push(clone(metadata));
      };
    }

    const result = await createService({ destination }).sync({ actor: admin() });

    assert.equal(result.phase, 'succeeded', failure);
    assert.deepEqual(destination.state.weeks, [week('W36-2026', 'NEW')], failure);
    assert.equal(destination.order.includes('updateRun:rolling_back'), false, failure);
    if (failure === 'release') destination.releaseLease = originalRelease;
  }
});

test('a transient verified sync audit failure retries the complete result with its cleanup warning', async () => {
  const destination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')] });
  destination.listCompleteSnapshots = async () => { throw new Error('cleanup failed'); };
  const originalUpdate = destination.updateRun;
  let failed = false;
  destination.updateRun = async metadata => {
    if (metadata.phase === 'succeeded' && !failed) {
      failed = true;
      throw new Error('terminal audit unavailable once');
    }
    return originalUpdate(metadata);
  };

  const result = await createService({ destination }).sync({ actor: admin() });
  const completed = destination.state.runs.at(-1);

  assert.equal(result.phase, 'succeeded');
  assertRunContains(completed, {
    phase: 'succeeded',
    sourceDigest: core.digestWeekEntries([week('W36-2026', 'NEW')]),
    resultDigest: core.digestWeekEntries([week('W36-2026', 'NEW')]),
    resultWeekCount: 1,
    createdCount: 1,
    updatedCount: 0,
    deletedCount: 1,
    completedAt: '2026-09-11T00:00:00.000Z',
    cleanupWarning: 'success-recording-failed',
  });

  const cleanupDestination = createMemoryDestination({ weeks: [week('W35-2026', 'OLD')] });
  cleanupDestination.listCompleteSnapshots = async () => { throw new Error('cleanup failed'); };
  const cleanupUpdate = cleanupDestination.updateRun;
  let cleanupWarningFailed = false;
  cleanupDestination.updateRun = async metadata => {
    if (metadata.cleanupWarning === 'snapshot-retention-cleanup-failed' && !cleanupWarningFailed) {
      cleanupWarningFailed = true;
      throw new Error('cleanup warning audit unavailable once');
    }
    return cleanupUpdate(metadata);
  };

  await createService({ destination: cleanupDestination }).sync({ actor: admin() });
  assertRunContains(cleanupDestination.state.runs.at(-1), {
    phase: 'succeeded',
    sourceDigest: core.digestWeekEntries([week('W36-2026', 'NEW')]),
    resultDigest: core.digestWeekEntries([week('W36-2026', 'NEW')]),
    resultWeekCount: 1,
    cleanupWarning: 'snapshot-retention-cleanup-failed',
  });
});

test('restore apply failure records a complete rolled-back audit while retaining the requested and current snapshots', async () => {
  const requestedWeeks = [week('W34-2026', 'RESTORE')];
  const currentWeeks = [week('W36-2026', 'CURRENT')];
  const destination = createMemoryDestination({
    weeks: currentWeeks,
    snapshots: [{
      snapshotId: 'before-sync', complete: true, createdAt: '2026-09-10T00:00:00.000Z',
      digest: core.digestWeekEntries(requestedWeeks), weekCount: 1, weeks: requestedWeeks,
    }],
    failApply: 1,
  });

  const result = await createService({ destination, ids: ['restore-run'] })
    .restore({ actor: admin(), snapshotId: 'before-sync' });

  assert.deepEqual(result, { ok: false, phase: 'rolled_back', runId: 'restore-run', snapshotId: 'restore-run' });
  assert.deepEqual(destination.state.weeks, currentWeeks);
  assert.deepEqual(destination.state.snapshots.find(snapshot => snapshot.snapshotId === 'before-sync').weeks, requestedWeeks);
  assert.deepEqual(destination.state.snapshots.find(snapshot => snapshot.snapshotId === 'restore-run').weeks, currentWeeks);
  assertRunContains(destination.state.runs.at(-1), {
    phase: 'rolled_back', operation: 'restore', snapshotId: 'restore-run', restoredFromSnapshotId: 'before-sync',
    sourceProjectId: 'pm-dashboard-uat-20260820-a7f3', destinationProjectId: 'pm-dashboard-uat-20260820-a7f3',
    productionProjectId: 'project-manager-dashboar-a067f', uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
    restoredDigest: null, restoredWeekCount: 0, completedAt: '2026-09-11T00:00:00.000Z', result: 'failed',
  });
  assert.equal(destination.state.recovery.recoveryRequired, false);
});

test('restore apply and rollback failure records durable recovery with immutable snapshot identities', async () => {
  const requestedWeeks = [week('W34-2026', 'RESTORE')];
  const currentWeeks = [week('W36-2026', 'CURRENT')];
  const destination = createMemoryDestination({
    weeks: currentWeeks,
    snapshots: [{
      snapshotId: 'before-sync', complete: true, createdAt: '2026-09-10T00:00:00.000Z',
      digest: core.digestWeekEntries(requestedWeeks), weekCount: 1, weeks: requestedWeeks,
    }],
    failApply: 2,
  });

  const result = await createService({ destination, ids: ['restore-run'] })
    .restore({ actor: admin(), snapshotId: 'before-sync' });

  assert.deepEqual(result, { ok: false, phase: 'rollback_failed', runId: 'restore-run', snapshotId: 'restore-run' });
  assert.deepEqual(destination.state.snapshots.find(snapshot => snapshot.snapshotId === 'before-sync').weeks, requestedWeeks);
  assert.deepEqual(destination.state.snapshots.find(snapshot => snapshot.snapshotId === 'restore-run').weeks, currentWeeks);
  assertRunContains(destination.state.runs.at(-1), {
    phase: 'rollback_failed', operation: 'restore', snapshotId: 'restore-run', restoredFromSnapshotId: 'before-sync',
    sourceProjectId: 'pm-dashboard-uat-20260820-a7f3', destinationProjectId: 'pm-dashboard-uat-20260820-a7f3',
    productionProjectId: 'project-manager-dashboar-a067f', uatProjectId: 'pm-dashboard-uat-20260820-a7f3',
    restoredDigest: null, restoredWeekCount: 0, completedAt: '2026-09-11T00:00:00.000Z', result: 'failed',
  });
  assert.deepEqual(destination.state.recovery, {
    recoveryRequired: true, rollbackFailedRunId: 'restore-run', rollbackFailedAt: '2026-09-11T00:00:00.000Z',
  });
});

test('restore leaves durable recovery in place when its verified terminal audit cannot be persisted', async () => {
  const restoredWeeks = [week('W34-2026', 'RESTORE')];
  const destination = createMemoryDestination({
    weeks: [week('W36-2026', 'CURRENT')],
    snapshots: [{
      snapshotId: 'before-sync', complete: true, createdAt: '2026-09-10T00:00:00.000Z',
      digest: core.digestWeekEntries(restoredWeeks), weekCount: 1, weeks: restoredWeeks,
    }],
  });
  destination.state.recovery = {
    recoveryRequired: true, rollbackFailedRunId: 'old-failed', rollbackFailedAt: '2026-09-10T00:00:00.000Z',
  };
  const originalUpdate = destination.updateRun;
  destination.updateRun = async metadata => {
    if (metadata.phase === 'restored') throw new Error('terminal audit unavailable');
    return originalUpdate(metadata);
  };

  const result = await createService({ destination, ids: ['restore-run'] })
    .restore({ actor: admin(), snapshotId: 'before-sync' });

  assert.equal(result.phase, 'restored');
  assert.equal(destination.order.includes('clearRecoveryRequired'), false);
  assert.equal(destination.state.recovery.recoveryRequired, true);
});

test('verified restore stays restored when its lease release fails', async () => {
  const retained = {
    snapshotId: 'before-sync', complete: true, createdAt: '2026-09-10T00:00:00.000Z',
    digest: core.digestWeekEntries([week('W34-2026', 'RESTORE')]), weekCount: 1, weeks: [week('W34-2026', 'RESTORE')],
  };
  const destination = createMemoryDestination({ weeks: [week('W36-2026', 'CURRENT')], snapshots: [retained] });
  destination.releaseLease = async () => { destination.order.push('releaseLease'); throw new Error('release failed'); };

  const result = await createService({ destination, ids: ['restore-run'] })
    .restore({ actor: admin(), snapshotId: 'before-sync' });

  assert.equal(result.phase, 'restored');
  assert.deepEqual(destination.state.weeks, [week('W34-2026', 'RESTORE')]);
  assert.equal(destination.order.includes('updateRun:rolling_back'), false);
});

test('createRun failure releases the acquired lease and preserves the create error', async () => {
  const destination = createMemoryDestination();
  destination.createRun = async () => { throw new Error('cannot create run'); };

  await assert.rejects(() => createService({ destination }).sync({ actor: admin() }), /cannot create run/);

  assert.equal(destination.state.lease, null);
  assert.equal(destination.order.includes('releaseLease'), true);
});

test('restore reads the selected complete snapshot payload instead of list metadata', async () => {
  const retained = {
    snapshotId: 'before-sync', complete: true, createdAt: '2026-09-10T00:00:00.000Z',
    digest: core.digestWeekEntries([week('W34-2026', 'RESTORE')]), weekCount: 1, weeks: [week('W34-2026', 'RESTORE')],
  };
  const destination = createMemoryDestination({ weeks: [week('W36-2026', 'CURRENT')], snapshots: [retained] });
  destination.listCompleteSnapshots = async () => [{
    snapshotId: 'before-sync', complete: true, createdAt: '2026-09-10T00:00:00.000Z',
    digest: retained.digest, weekCount: 1,
  }];

  const result = await createService({ destination, ids: ['restore-run'] })
    .restore({ actor: admin(), snapshotId: 'before-sync' });

  assert.equal(result.phase, 'restored');
  assert.equal(destination.order.includes('readSnapshot'), true);
  assert.deepEqual(destination.state.weeks, [week('W34-2026', 'RESTORE')]);
});

test('restore requires complete metadata and a well-formed snapshot payload', async () => {
  const notMarkedComplete = createMemoryDestination({ snapshots: [{
    snapshotId: 'missing-complete', digest: core.digestWeekEntries([]), weeks: [],
  }] });
  await assert.rejects(
    () => createService({ destination: notMarkedComplete }).restore({ actor: admin(), snapshotId: 'missing-complete' }),
    /not retained/i,
  );

  const malformed = createMemoryDestination({ snapshots: [{
    snapshotId: 'malformed', complete: true, digest: core.digestWeekEntries([]), weekCount: 0, weeks: [],
  }] });
  malformed.readSnapshot = async () => ({ snapshotId: 'malformed', complete: true, digest: core.digestWeekEntries([]), weeks: {} });
  await assert.rejects(
    () => createService({ destination: malformed }).restore({ actor: admin(), snapshotId: 'malformed' }),
    /snapshot payload/i,
  );
  assert.equal(malformed.order.includes('applyMirror'), false);
});

test('restore rejects retained metadata without canonical digest and non-negative weekCount before UAT reads', async () => {
  const destination = createMemoryDestination({ snapshots: [{
    snapshotId: 'weak-metadata', complete: true, digest: core.digestWeekEntries([]), weeks: [],
  }] });

  await assert.rejects(
    () => createService({ destination }).restore({ actor: admin(), snapshotId: 'weak-metadata' }),
    /snapshot metadata/i,
  );
  assert.equal(destination.order.includes('listWeeks'), false);
  assert.equal(destination.order.includes('writeSnapshot'), false);
  assert.equal(destination.order.includes('applyMirror'), false);
});

test('restore binds the read snapshot ID to retained metadata before UAT reads', async () => {
  const retainedWeeks = [week('W34-2026', 'RESTORE')];
  const destination = createMemoryDestination({ snapshots: [{
    snapshotId: 'before-sync', complete: true, digest: core.digestWeekEntries(retainedWeeks), weekCount: 1, weeks: retainedWeeks,
  }] });
  const originalReadSnapshot = destination.readSnapshot;
  destination.readSnapshot = async input => input.snapshotId === 'before-sync'
    ? { snapshotId: 'other-snapshot', complete: true, digest: core.digestWeekEntries(retainedWeeks), weekCount: 1, weeks: retainedWeeks }
    : originalReadSnapshot(input);

  await assert.rejects(
    () => createService({ destination }).restore({ actor: admin(), snapshotId: 'before-sync' }),
    /snapshot ID/i,
  );
  assert.equal(destination.order.includes('listWeeks'), false);
  assert.equal(destination.order.includes('writeSnapshot'), false);
  assert.equal(destination.order.includes('applyMirror'), false);
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

test('snapshot retention deterministically keeps the newest IDs when timestamps tie', async () => {
  const tiedAt = '2026-09-11T00:00:00.000Z';
  const snapshots = Array.from({ length: 6 }, (_, index) => ({
    snapshotId: `run-${index + 1}`, complete: true, createdAt: tiedAt,
    digest: core.digestWeekEntries([]), weeks: [],
  }));
  const destination = createMemoryDestination({ snapshots });

  await createService({ destination, ids: ['run-7'] }).sync({ actor: admin() });

  assert.deepEqual(destination.state.snapshots.map(snapshot => snapshot.snapshotId).sort(),
    ['run-3', 'run-4', 'run-5', 'run-6', 'run-7']);
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
