const { createHash } = require('node:crypto');
const { DocumentReference, GeoPoint, Timestamp } = require('firebase-admin/firestore');

const PRODUCTION_PROJECT_ID = 'project-manager-dashboar-a067f';
const UAT_PROJECT_ID = 'pm-dashboard-uat-20260820-a7f3';
const SYNC_COLLECTION = 'weeks';
const SNAPSHOT_RETENTION_COUNT = 5;
const MAX_WEEK_DOCUMENT_BYTES = 1_000_000;
const MAX_DOCUMENT_ID_BYTES = 1_500;

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertSyncEnvironment({ sourceProjectId, destinationProjectId }) {
  if (sourceProjectId !== PRODUCTION_PROJECT_ID || destinationProjectId !== UAT_PROJECT_ID) {
    throw new Error('Sync is restricted to the fixed Production-to-UAT direction.');
  }
}

function isSpoofedFirestoreType(value) {
  const constructorName = value.constructor?.name;
  return Object.prototype.hasOwnProperty.call(value, 'constructor')
    && ['Timestamp', 'GeoPoint', 'DocumentReference'].includes(constructorName);
}

function assertSafeMapProperties(value) {
  const hasSymbols = Object.getOwnPropertySymbols(value).length > 0;
  const hasNonEnumerableStringKey = Object.getOwnPropertyNames(value)
    .some(key => !Object.getOwnPropertyDescriptor(value, key).enumerable);
  if (hasSymbols || hasNonEnumerableStringKey) {
    throw new TypeError('Week maps must satisfy the own-enumerable string-key map contract.');
  }
}

function canonicalizeValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Unsupported non-finite number in week data.');
    return value;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError(`Unsupported ${typeof value} value in week data.`);
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __firestoreType: 'bytes', base64: Buffer.from(value).toString('base64') };
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError('Unsupported invalid date in week data.');
    return { __firestoreType: 'timestamp', milliseconds: value.getTime() };
  }

  if (!value || typeof value !== 'object') throw new TypeError('Unsupported value in week data.');
  if (seen.has(value)) throw new TypeError('Unsupported cyclic value in week data.');
  seen.add(value);
  try {
    if (isSpoofedFirestoreType(value)) throw new TypeError('Unsupported Firestore type spoof in week data.');
    if (value instanceof Timestamp) {
      const { seconds, nanoseconds } = value;
      if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(nanoseconds)
        || seconds < -62_135_596_800 || seconds > 253_402_300_799
        || nanoseconds < 0 || nanoseconds > 999_999_999) {
        throw new TypeError('Invalid Timestamp value in week data.');
      }
      return {
        __firestoreType: 'timestamp',
        nanoseconds,
        seconds,
      };
    }
    if (value instanceof GeoPoint) {
      if (!Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) {
        throw new TypeError('Unsupported GeoPoint coordinates in week data.');
      }
      if (value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180) {
        throw new TypeError('Invalid GeoPoint value in week data.');
      }
      return {
        __firestoreType: 'geoPoint',
        latitude: value.latitude,
        longitude: value.longitude,
      };
    }
    if (value instanceof DocumentReference) {
      if (!value.path || value.path.startsWith('/') || value.path.endsWith('/')
        || value.path.split('/').some(segment => segment === '') || value.path.split('/').length % 2 !== 0) {
        throw new TypeError('Unsupported DocumentReference path in week data.');
      }
      return { __firestoreType: 'documentReference', path: value.path };
    }
    if (Array.isArray(value)) return value.map(item => canonicalizeValue(item, seen));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError(`Unsupported ${value.constructor?.name || 'object'} value in week data.`);
    }
    assertSafeMapProperties(value);
    return {
      __firestoreType: 'map',
      fields: Object.fromEntries(Object.keys(value).sort(compareCodeUnits)
        .map(key => [key, canonicalizeValue(value[key], seen)])),
    };
  } finally {
    seen.delete(value);
  }
}

function requireWeekId(id) {
  if (typeof id !== 'string' || !id.trim() || id.includes('/') || Buffer.byteLength(id, 'utf8') > MAX_DOCUMENT_ID_BYTES) {
    throw new TypeError('Week document identifier must be a non-empty, unslashed Firestore document ID.');
  }
  return id;
}

function validateWeekEntries(entries, { requireNonEmpty }) {
  if (!Array.isArray(entries)) throw new TypeError('Week entries must be an array.');
  if (requireNonEmpty && entries.length === 0) throw new TypeError('Production source has no reporting weeks.');

  const ids = new Set();
  const validated = entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError('Week entry must be an object.');
    }
    const id = requireWeekId(entry.id);
    if (ids.has(id)) throw new TypeError(`Production source contains duplicate week ID: ${id}`);
    ids.add(id);
    if (!entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) {
      throw new TypeError(`Week document ${id} data must be an object.`);
    }
    const canonicalData = canonicalizeValue(entry.data);
    if (Buffer.byteLength(JSON.stringify(canonicalData), 'utf8') > MAX_WEEK_DOCUMENT_BYTES) {
      throw new RangeError(`Week document ${id} exceeds the 1,000,000-byte ceiling.`);
    }
    return { id, data: entry.data };
  });

  return validated.sort((left, right) => compareCodeUnits(left.id, right.id));
}

function validateSourceWeeks(entries) {
  return validateWeekEntries(entries, { requireNonEmpty: true });
}

function canonicalizeWeekEntries(entries) {
  return validateWeekEntries(entries, { requireNonEmpty: false }).map(({ id, data }) => ({
    id,
    data: canonicalizeValue(data),
  }));
}

function digestWeekEntries(entries) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeWeekEntries(entries)))
    .digest('hex');
}

function planWeekMirror({ sourceWeeks, destinationWeeks }) {
  const validatedSourceWeeks = validateSourceWeeks(sourceWeeks);
  const validatedDestinationWeeks = validateWeekEntries(destinationWeeks, { requireNonEmpty: false });
  const sourceById = new Map(validatedSourceWeeks.map(week => [week.id, week]));
  const destinationById = new Map(validatedDestinationWeeks.map(week => [week.id, week]));
  const createdIds = [];
  const updatedIds = [];
  const unchangedIds = [];
  const deletedIds = [];

  for (const [id, sourceWeek] of sourceById) {
    const destinationWeek = destinationById.get(id);
    if (!destinationWeek) {
      createdIds.push(id);
    } else if (JSON.stringify(canonicalizeValue(sourceWeek.data)) === JSON.stringify(canonicalizeValue(destinationWeek.data))) {
      unchangedIds.push(id);
    } else {
      updatedIds.push(id);
    }
  }
  for (const id of destinationById.keys()) {
    if (!sourceById.has(id)) deletedIds.push(id);
  }

  return {
    createdIds,
    updatedIds,
    unchangedIds,
    deletedIds,
    sourceIds: validatedSourceWeeks.map(week => week.id),
    destinationIds: validatedDestinationWeeks.map(week => week.id),
    sourceDigest: digestWeekEntries(validatedSourceWeeks),
    destinationDigest: digestWeekEntries(validatedDestinationWeeks),
    sourceWeeks: validatedSourceWeeks,
    destinationWeeks: validatedDestinationWeeks,
  };
}

const LEASE_DURATION_MS = 15 * 60 * 1000;
const MIRROR_BATCH_SIZE = 200;

function nowIso(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Sync clock must return a valid date.');
  return date.toISOString();
}

function leaseExpiryIso(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Sync clock must return a valid date.');
  return new Date(date.getTime() + LEASE_DURATION_MS).toISOString();
}

function sanitizeActor(actor) {
  return {
    uid: String(actor?.uid || ''),
    email: String(actor?.email || ''),
    role: String(actor?.role || ''),
    displayName: String(actor?.displayName || ''),
  };
}

function runMetadata({ runId, actor, phase, operation, extra = {} }) {
  return { runId, actor: sanitizeActor(actor), phase, operation, ...extra };
}

function assertMatchingWeeks(expectedWeeks, actualWeeks, message) {
  if (expectedWeeks.length !== actualWeeks.length
    || digestWeekEntries(expectedWeeks) !== digestWeekEntries(actualWeeks)) {
    throw new Error(message);
  }
}

function assertVerifiedSnapshot(snapshot, expectedWeeks) {
  if (!snapshot || snapshot.complete === false
    || snapshot.digest !== digestWeekEntries(expectedWeeks)) {
    throw new Error('Snapshot digest verification failed.');
  }
  assertMatchingWeeks(expectedWeeks, snapshot.weeks || [], 'Snapshot digest verification failed.');
}

function sanitizedFailure() {
  return { errorCode: 'operation-failed', errorMessage: 'The operation could not be completed safely.' };
}

function sanitizeStatus(value) {
  if (Array.isArray(value)) return value.map(sanitizeStatus);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(credential|token|secret|password|weeks|data)/i.test(key))
    .map(([key, child]) => [key, sanitizeStatus(child)]));
}

async function pruneSnapshots(destinationStore) {
  const snapshots = await destinationStore.listCompleteSnapshots();
  const newestFirst = [...snapshots].sort((left, right) => {
    const leftTime = String(left.completedAt || left.createdAt || '');
    const rightTime = String(right.completedAt || right.createdAt || '');
    return compareCodeUnits(rightTime, leftTime);
  });
  for (const snapshot of newestFirst.slice(SNAPSHOT_RETENTION_COUNT)) {
    await destinationStore.deleteSnapshot({ snapshotId: snapshot.snapshotId });
  }
}

async function finishFailedBeforeApply({ destinationStore, runId, actor, operation, leaseOwned }) {
  await destinationStore.updateRun(runMetadata({
    runId, actor, operation, phase: 'reading_source', extra: { result: 'failed', ...sanitizedFailure() },
  }));
  if (leaseOwned) await destinationStore.releaseLease({ runId });
}

async function recoverOrFail({ destinationStore, runId, actor, operation, snapshotId, snapshotWeeks }) {
  try {
    await destinationStore.updateRun(runMetadata({
      runId, actor, operation, phase: 'rolling_back', extra: { snapshotId, ...sanitizedFailure() },
    }));
    await destinationStore.applyMirror({ weeks: snapshotWeeks, runId, batchSize: MIRROR_BATCH_SIZE, rollback: true });
    const restoredWeeks = await destinationStore.listWeeks();
    assertMatchingWeeks(snapshotWeeks, restoredWeeks, 'Rollback verification failed.');
    await destinationStore.updateRun(runMetadata({
      runId, actor, operation, phase: 'rolled_back', extra: { snapshotId, result: 'failed', ...sanitizedFailure() },
    }));
    await destinationStore.releaseLease({ runId });
    return { ok: false, phase: 'rolled_back', runId, snapshotId };
  } catch (_rollbackError) {
    await destinationStore.updateRun(runMetadata({
      runId, actor, operation, phase: 'rollback_failed', extra: { snapshotId, result: 'failed', ...sanitizedFailure() },
    }));
    return { ok: false, phase: 'rollback_failed', runId, snapshotId };
  }
}

async function runSync({ sourceStore, destinationStore, clock, idFactory, actor }) {
  const runId = idFactory();
  const operation = 'sync';
  const acquired = await destinationStore.acquireLease({
    runId, actor: sanitizeActor(actor), expiresAt: leaseExpiryIso(clock),
  });
  if (!acquired?.acquired) throw new Error('A Production week sync is already running.');

  let snapshotId = runId;
  let snapshotWeeks;
  let applyStarted = false;
  await destinationStore.createRun(runMetadata({
    runId, actor, operation, phase: 'reading_source', extra: { startedAt: nowIso(clock) },
  }));
  try {
    const sourceWeeks = validateSourceWeeks(await sourceStore.listWeeks());
    await destinationStore.updateRun(runMetadata({ runId, actor, operation, phase: 'validating_source' }));
    const destinationWeeks = await destinationStore.listWeeks();
    const plan = planWeekMirror({ sourceWeeks, destinationWeeks });
    snapshotWeeks = plan.destinationWeeks;

    await destinationStore.updateRun(runMetadata({
      runId, actor, operation, phase: 'snapshotting',
      extra: { snapshotId, sourceWeekCount: plan.sourceWeeks.length, destinationWeekCount: snapshotWeeks.length, snapshotDigest: plan.destinationDigest },
    }));
    await destinationStore.writeSnapshot({
      snapshotId, weeks: snapshotWeeks, digest: plan.destinationDigest, createdAt: nowIso(clock), operation,
    });
    assertVerifiedSnapshot(await destinationStore.readSnapshot({ snapshotId }), snapshotWeeks);

    await destinationStore.updateRun(runMetadata({ runId, actor, operation, phase: 'applying', extra: { snapshotId } }));
    await destinationStore.renewLease({ runId, expiresAt: leaseExpiryIso(clock) });
    applyStarted = true;
    await destinationStore.applyMirror({ weeks: plan.sourceWeeks, runId, batchSize: MIRROR_BATCH_SIZE });

    await destinationStore.updateRun(runMetadata({ runId, actor, operation, phase: 'verifying', extra: { snapshotId } }));
    assertMatchingWeeks(plan.sourceWeeks, await destinationStore.listWeeks(), 'UAT mirror verification failed.');
    const result = {
      ok: true, phase: 'succeeded', runId, snapshotId, sourceWeekCount: plan.sourceWeeks.length,
      createdCount: plan.createdIds.length, updatedCount: plan.updatedIds.length, deletedCount: plan.deletedIds.length,
    };
    await destinationStore.updateRun(runMetadata({ runId, actor, operation, phase: 'succeeded', extra: result }));
    await destinationStore.releaseLease({ runId });
    try {
      await pruneSnapshots(destinationStore);
    } catch (_cleanupError) {
      await destinationStore.updateRun(runMetadata({
        runId, actor, operation, phase: 'succeeded', extra: { cleanupWarning: 'snapshot-retention-cleanup-failed' },
      }));
    }
    return result;
  } catch (error) {
    if (applyStarted) {
      return recoverOrFail({ destinationStore, runId, actor, operation, snapshotId, snapshotWeeks });
    }
    await finishFailedBeforeApply({ destinationStore, runId, actor, operation, leaseOwned: true });
    throw error;
  }
}

async function runRestore({ destinationStore, clock, idFactory, actor, snapshotId }) {
  const runId = idFactory();
  const operation = 'restore';
  const acquired = await destinationStore.acquireLease({
    runId, actor: sanitizeActor(actor), expiresAt: leaseExpiryIso(clock),
  });
  if (!acquired?.acquired) throw new Error('A UAT week restore is already running.');

  let currentSnapshotWeeks;
  let applyStarted = false;
  try {
    const retained = await destinationStore.listCompleteSnapshots();
    const selected = retained.find(snapshot => snapshot.snapshotId === snapshotId && snapshot.complete !== false);
    if (!selected) throw new Error('Requested snapshot is not retained.');
    assertVerifiedSnapshot(selected, selected.weeks || []);

    await destinationStore.createRun(runMetadata({
      runId, actor, operation, phase: 'restoring', extra: { startedAt: nowIso(clock), snapshotId },
    }));
    currentSnapshotWeeks = await destinationStore.listWeeks();
    const currentDigest = digestWeekEntries(currentSnapshotWeeks);
    await destinationStore.writeSnapshot({
      snapshotId: runId, weeks: currentSnapshotWeeks, digest: currentDigest, createdAt: nowIso(clock), operation,
    });
    assertVerifiedSnapshot(await destinationStore.readSnapshot({ snapshotId: runId }), currentSnapshotWeeks);
    await destinationStore.renewLease({ runId, expiresAt: leaseExpiryIso(clock) });
    applyStarted = true;
    await destinationStore.applyMirror({ weeks: selected.weeks, runId, batchSize: MIRROR_BATCH_SIZE });
    assertMatchingWeeks(selected.weeks, await destinationStore.listWeeks(), 'UAT restore verification failed.');
    const result = { ok: true, phase: 'restored', runId, snapshotId };
    await destinationStore.updateRun(runMetadata({ runId, actor, operation, phase: 'restored', extra: result }));
    await destinationStore.releaseLease({ runId });
    try {
      await pruneSnapshots(destinationStore);
    } catch (_cleanupError) {
      await destinationStore.updateRun(runMetadata({
        runId, actor, operation, phase: 'restored', extra: { cleanupWarning: 'snapshot-retention-cleanup-failed' },
      }));
    }
    return result;
  } catch (error) {
    if (applyStarted) {
      return recoverOrFail({
        destinationStore, runId, actor, operation, snapshotId: runId, snapshotWeeks: currentSnapshotWeeks,
      });
    }
    await finishFailedBeforeApply({ destinationStore, runId, actor, operation, leaseOwned: true });
    throw error;
  }
}

function createWeekSyncService({ sourceStore, destinationStore, clock, idFactory }) {
  async function sync({ actor }) {
    return runSync({ sourceStore, destinationStore, clock, idFactory, actor });
  }
  async function status({ actor }) {
    return sanitizeStatus(await destinationStore.readStatus({ actor: sanitizeActor(actor) }));
  }
  async function restore({ actor, snapshotId }) {
    return runRestore({ destinationStore, clock, idFactory, actor, snapshotId });
  }
  return { sync, status, restore };
}

module.exports = {
  PRODUCTION_PROJECT_ID,
  UAT_PROJECT_ID,
  SYNC_COLLECTION,
  SNAPSHOT_RETENTION_COUNT,
  assertSyncEnvironment,
  canonicalizeValue,
  canonicalizeWeekEntries,
  digestWeekEntries,
  validateSourceWeeks,
  planWeekMirror,
  createWeekSyncService,
};
