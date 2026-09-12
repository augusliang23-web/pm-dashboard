const { createHash } = require('node:crypto');
const { DocumentReference, GeoPoint, Timestamp } = require('firebase-admin/firestore');

const PRODUCTION_PROJECT_ID = 'project-manager-dashboar-a067f';
const UAT_PROJECT_ID = 'pm-dashboard-uat-20260820-a7f3';
const SYNC_COLLECTION = 'weeks';
const SNAPSHOT_RETENTION_COUNT = 5;
const MAX_WEEK_DOCUMENT_BYTES = 1_000_000;
const MAX_DOCUMENT_ID_BYTES = 1_500;
const MIN_SIGNED_INT64 = -9_223_372_036_854_775_808n;
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const SYNC_DOMAIN_ERROR_MESSAGES = Object.freeze({
  'operation-in-progress': 'A UAT week data operation is already running.',
  'production-source-empty': 'Production source has no reporting weeks.',
  'production-source-invalid': 'Production source contains a value that cannot be copied safely.',
  'production-source-incomplete': 'Production source read could not be verified as complete.',
  'snapshot-integrity-failed': 'Snapshot digest verification failed.',
  'snapshot-not-retained': 'Requested snapshot is not retained.',
  'lease-lost': 'The UAT week operation lease is no longer valid.',
});

class SyncDomainError extends Error {
  constructor(code, message = SYNC_DOMAIN_ERROR_MESSAGES[code]) {
    if (!Object.hasOwn(SYNC_DOMAIN_ERROR_MESSAGES, code)) {
      throw new TypeError('Sync failures must use a closed safe domain error code.');
    }
    super(message);
    this.name = 'SyncDomainError';
    this.code = code;
  }
}

function domainError(code, message) {
  return new SyncDomainError(code, message);
}

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
    return { __firestoreType: 'double', value: Object.is(value, -0) ? '-0' : value };
  }
  if (typeof value === 'bigint') {
    if (value < MIN_SIGNED_INT64 || value > MAX_SIGNED_INT64) {
      throw new RangeError('Firestore integer values must remain within the signed 64-bit range.');
    }
    return { __firestoreType: 'integer', value: value.toString() };
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
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
  const environment = operation === 'sync'
    ? { sourceProjectId: PRODUCTION_PROJECT_ID, destinationProjectId: UAT_PROJECT_ID }
    : { sourceProjectId: UAT_PROJECT_ID, destinationProjectId: UAT_PROJECT_ID };
  return {
    runId,
    actor: sanitizeActor(actor),
    phase,
    operation,
    ...extra,
    ...environment,
    productionProjectId: PRODUCTION_PROJECT_ID,
    uatProjectId: UAT_PROJECT_ID,
  };
}

function assertMatchingWeeks(expectedWeeks, actualWeeks, message) {
  if (expectedWeeks.length !== actualWeeks.length
    || digestWeekEntries(expectedWeeks) !== digestWeekEntries(actualWeeks)) {
    throw new Error(message);
  }
}

function assertVerifiedSnapshot(snapshot, expectedWeeks, expectedDigest, { requireComplete = true } = {}) {
  if (!snapshot || (requireComplete && snapshot.complete !== true)) {
    throw domainError('snapshot-integrity-failed');
  }
  if (!Array.isArray(snapshot.weeks)) throw domainError('snapshot-integrity-failed', 'Snapshot payload must be an array.');
  const payloadDigest = digestWeekEntries(snapshot.weeks);
  if (snapshot.digest !== payloadDigest || (expectedDigest && expectedDigest !== payloadDigest)
    || (Number.isSafeInteger(snapshot.weekCount) && snapshot.weekCount !== snapshot.weeks.length)) {
    throw domainError('snapshot-integrity-failed');
  }
  if (expectedWeeks) {
    try {
      assertMatchingWeeks(expectedWeeks, snapshot.weeks, 'Snapshot digest verification failed.');
    } catch (_mismatch) {
      throw domainError('snapshot-integrity-failed');
    }
  }
}

function sanitizedFailure(error) {
  if (error instanceof SyncDomainError) return { errorCode: error.code, errorMessage: error.message };
  return { errorCode: 'operation-failed', errorMessage: 'The operation could not be completed safely.' };
}

function copyStatusFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const allowed = {};
  for (const field of fields) {
    const candidate = value[field];
    if (candidate === null || ['string', 'number', 'boolean'].includes(typeof candidate)) {
      allowed[field] = candidate;
    }
  }
  return allowed;
}

function sanitizeStatus(value) {
  const status = copyStatusFields(value, [
    'running', 'phase', 'recoveryRequired', 'rollbackFailedRunId', 'rollbackFailedAt',
  ]);
  const runFields = [
    'runId', 'phase', 'operation', 'result', 'productionProjectId', 'uatProjectId', 'sourceProjectId', 'destinationProjectId',
    'sourceReadTime', 'sourceWeekCount', 'destinationWeekCount', 'createdCount', 'updatedCount',
    'deletedCount', 'snapshotId', 'snapshotDigest', 'startedAt', 'completedAt', 'errorCode',
    'errorMessage', 'cleanupWarning', 'leaseReleaseWarning', 'sourceDigest', 'resultDigest',
    'resultWeekCount', 'restoredFromSnapshotId', 'restoredDigest', 'restoredWeekCount',
  ];
  const snapshotFields = ['snapshotId', 'createdAt', 'completedAt'];
  for (const key of ['latestRun', 'latestCompletedRun']) {
    if (value?.[key]) status[key] = copyStatusFields(value[key], runFields);
  }
  if (value?.latestSnapshot) status.latestSnapshot = copyStatusFields(value.latestSnapshot, snapshotFields);
  return status;
}

function syncTerminalAudit({
  sourceReadTime = null,
  sourceDigest = null,
  resultDigest = null,
  resultWeekCount = 0,
  createdCount = 0,
  updatedCount = 0,
  deletedCount = 0,
} = {}) {
  return {
    sourceReadTime,
    sourceDigest,
    resultDigest,
    resultWeekCount,
    createdCount,
    updatedCount,
    deletedCount,
  };
}

function restoreTerminalAudit({ restoredFromSnapshotId, restoredDigest = null, restoredWeekCount = 0 }) {
  return { restoredFromSnapshotId, restoredDigest, restoredWeekCount };
}

async function pruneSnapshots(destinationStore, runId) {
  const snapshots = await destinationStore.listCompleteSnapshots();
  const newestFirst = [...snapshots].sort((left, right) => {
    const leftTime = String(left.completedAt || left.createdAt || '');
    const rightTime = String(right.completedAt || right.createdAt || '');
    return compareCodeUnits(rightTime, leftTime) || compareCodeUnits(
      String(right.snapshotId || ''), String(left.snapshotId || ''),
    );
  });
  for (const snapshot of newestFirst.slice(SNAPSHOT_RETENTION_COUNT)) {
    await destinationStore.deleteSnapshot({ snapshotId: snapshot.snapshotId, runId, batchSize: MIRROR_BATCH_SIZE });
  }
}

async function finishFailedBeforeApply({ destinationStore, runId, actor, operation, phase, leaseOwned, clock, error, terminalAudit }) {
  try {
    await destinationStore.updateRun(runMetadata({
      runId, actor, operation, phase,
      extra: { ...terminalAudit, result: 'failed', completedAt: nowIso(clock), ...sanitizedFailure(error) },
    }));
  } catch (_recordError) {
    // Preserve the original operation error even when an audit write also fails.
  }
  if (leaseOwned) {
    try {
      await destinationStore.releaseLease({ runId });
    } catch (_releaseError) {
      // The bounded lease expires if ownership cannot be released safely.
    }
  }
}

async function finalizeVerifiedResult({ destinationStore, runId, actor, operation, phase, result, warning }) {
  let finalWarning = warning;
  try {
    await pruneSnapshots(destinationStore, runId);
  } catch (_cleanupError) {
    finalWarning = finalWarning || 'snapshot-retention-cleanup-failed';
  }
  try {
    await destinationStore.releaseLease({ runId });
  } catch (_releaseError) {
    finalWarning = finalWarning || 'lease-release-failed';
  }
  if (finalWarning) {
    try {
      await destinationStore.updateRun(runMetadata({
        runId, actor, operation, phase,
        extra: finalWarning === 'lease-release-failed'
          ? { leaseReleaseWarning: finalWarning }
          : { cleanupWarning: finalWarning },
      }));
    } catch (_warningRecordError) {
      // A verified business result remains final even when its warning cannot be recorded.
    }
  }
  return result;
}

async function recordRunBestEffort(destinationStore, metadata) {
  try {
    await destinationStore.updateRun(metadata);
  } catch (_recordError) {
    // Recovery and its truthful terminal result must not depend on audit availability.
  }
}

async function recordRecoveryBestEffort(destinationStore, { runId, failedAt }) {
  try {
    await destinationStore.setRecoveryRequired({ runId, failedAt });
  } catch (_recordError) {
    // A failed durable-record write must never turn an unsafe rollback into success.
  }
}

async function releaseLeaseBestEffort(destinationStore, runId) {
  try {
    await destinationStore.releaseLease({ runId });
  } catch (_releaseError) {
    // The owned bounded lease expires if release cannot be recorded.
  }
}

async function recoverOrFail({ destinationStore, runId, actor, operation, snapshotId, snapshotWeeks, clock, terminalAudit }) {
  try {
    await recordRunBestEffort(destinationStore, runMetadata({
      runId, actor, operation, phase: 'rolling_back', extra: { snapshotId, ...sanitizedFailure() },
    }));
    await destinationStore.applyMirror({ weeks: snapshotWeeks, runId, batchSize: MIRROR_BATCH_SIZE, rollback: true });
    const restoredWeeks = await destinationStore.listWeeks();
    assertMatchingWeeks(snapshotWeeks, restoredWeeks, 'Rollback verification failed.');
    const completedAudit = operation === 'sync'
      ? { ...terminalAudit, resultDigest: digestWeekEntries(restoredWeeks), resultWeekCount: restoredWeeks.length }
      : terminalAudit;
    await recordRunBestEffort(destinationStore, runMetadata({
      runId, actor, operation, phase: 'rolled_back',
      extra: { snapshotId, ...completedAudit, result: 'failed', completedAt: nowIso(clock), ...sanitizedFailure() },
    }));
    await releaseLeaseBestEffort(destinationStore, runId);
    return { ok: false, phase: 'rolled_back', runId, snapshotId };
  } catch (_rollbackError) {
    const failedAt = nowIso(clock);
    await recordRecoveryBestEffort(destinationStore, { runId, failedAt });
    await recordRunBestEffort(destinationStore, runMetadata({
      runId, actor, operation, phase: 'rollback_failed',
      extra: { snapshotId, ...terminalAudit, result: 'failed', completedAt: failedAt, ...sanitizedFailure() },
    }));
    return { ok: false, phase: 'rollback_failed', runId, snapshotId };
  }
}

function assertRetainedSnapshotMetadata(snapshot, snapshotId) {
  const canonicalDigest = typeof snapshot?.digest === 'string' && /^[a-f0-9]{64}$/.test(snapshot.digest);
  if (!snapshot || snapshot.complete !== true || typeof snapshotId !== 'string' || !snapshotId
    || snapshot.snapshotId !== snapshotId || !canonicalDigest
    || !Number.isSafeInteger(snapshot.weekCount) || snapshot.weekCount < 0) {
    throw domainError('snapshot-integrity-failed', 'Snapshot metadata integrity is invalid.');
  }
}

async function runSync({ sourceStore, destinationStore, clock, idFactory, actor }) {
  const runId = idFactory();
  const operation = 'sync';
  const acquired = await destinationStore.acquireLease({
    runId, actor: sanitizeActor(actor), expiresAt: leaseExpiryIso(clock),
  });
  if (!acquired?.acquired) throw domainError('operation-in-progress', 'A Production week sync is already running.');

  let snapshotId = runId;
  let snapshotWeeks;
  let applyStarted = false;
  let phase = 'reading_source';
  let verifiedResult;
  let terminalAudit = syncTerminalAudit();
  try {
    await destinationStore.createRun(runMetadata({
      runId, actor, operation, phase, extra: { startedAt: nowIso(clock) },
    }));
    let sourceResult;
    try {
      sourceResult = await sourceStore.listWeeks();
    } catch (_sourceError) {
      throw domainError('production-source-incomplete');
    }
    let sourceWeeks;
    try {
      sourceWeeks = validateSourceWeeks(sourceResult);
    } catch (error) {
      throw Array.isArray(sourceResult) && sourceResult.length === 0
        ? domainError('production-source-empty')
        : domainError('production-source-invalid');
    }
    const sourceReadTime = typeof sourceResult?.sourceReadTime === 'string' ? sourceResult.sourceReadTime : '';
    const parsedSourceReadTime = Date.parse(sourceReadTime);
    if (!Number.isFinite(parsedSourceReadTime) || new Date(parsedSourceReadTime).toISOString() !== sourceReadTime) {
      throw domainError('production-source-incomplete');
    }
    phase = 'validating_source';
    await destinationStore.updateRun(runMetadata({ runId, actor, operation, phase }));
    const destinationWeeks = await destinationStore.listWeeks();
    const plan = planWeekMirror({ sourceWeeks, destinationWeeks });
    snapshotWeeks = plan.destinationWeeks;
    terminalAudit = syncTerminalAudit({
      sourceReadTime,
      sourceDigest: plan.sourceDigest,
      createdCount: plan.createdIds.length,
      updatedCount: plan.updatedIds.length,
      deletedCount: plan.deletedIds.length,
    });

    phase = 'snapshotting';
    await destinationStore.updateRun(runMetadata({
      runId, actor, operation, phase,
      extra: { snapshotId, sourceWeekCount: plan.sourceWeeks.length, destinationWeekCount: snapshotWeeks.length, snapshotDigest: plan.destinationDigest },
    }));
    await destinationStore.writeSnapshot({
      snapshotId, runId, weeks: snapshotWeeks, digest: plan.destinationDigest, weekCount: snapshotWeeks.length, createdAt: nowIso(clock), operation,
    });
    assertVerifiedSnapshot(await destinationStore.readSnapshot({ snapshotId }), snapshotWeeks, undefined, { requireComplete: false });
    await destinationStore.completeSnapshot({ snapshotId, runId });
    assertVerifiedSnapshot(await destinationStore.readSnapshot({ snapshotId }), snapshotWeeks);

    phase = 'applying';
    await destinationStore.updateRun(runMetadata({ runId, actor, operation, phase, extra: { snapshotId } }));
    await destinationStore.renewLease({ runId, expiresAt: leaseExpiryIso(clock) });
    applyStarted = true;
    await destinationStore.applyMirror({ weeks: plan.sourceWeeks, runId, batchSize: MIRROR_BATCH_SIZE });

    phase = 'verifying';
    await destinationStore.updateRun(runMetadata({ runId, actor, operation, phase, extra: { snapshotId } }));
    const resultWeeks = await destinationStore.listWeeks();
    assertMatchingWeeks(plan.sourceWeeks, resultWeeks, 'UAT mirror verification failed.');
    verifiedResult = {
      ok: true, phase: 'succeeded', runId, snapshotId, sourceWeekCount: plan.sourceWeeks.length,
      createdCount: plan.createdIds.length, updatedCount: plan.updatedIds.length, deletedCount: plan.deletedIds.length,
      sourceProjectId: PRODUCTION_PROJECT_ID,
      destinationProjectId: UAT_PROJECT_ID,
      ...terminalAudit,
      resultDigest: digestWeekEntries(resultWeeks),
      resultWeekCount: resultWeeks.length,
      completedAt: nowIso(clock),
    };
    phase = 'succeeded';
    await destinationStore.updateRun(runMetadata({ runId, actor, operation, phase, extra: verifiedResult }));
    return finalizeVerifiedResult({ destinationStore, runId, actor, operation, phase, result: verifiedResult });
  } catch (error) {
    if (verifiedResult) {
      return finalizeVerifiedResult({
        destinationStore, runId, actor, operation, phase: 'succeeded', result: verifiedResult,
        warning: 'success-recording-failed',
      });
    }
    if (applyStarted) {
      return recoverOrFail({ destinationStore, runId, actor, operation, snapshotId, snapshotWeeks, clock, terminalAudit });
    }
    await finishFailedBeforeApply({ destinationStore, runId, actor, operation, phase, leaseOwned: true, clock, error, terminalAudit });
    throw error;
  }
}

async function runRestore({ destinationStore, clock, idFactory, actor, snapshotId }) {
  const runId = idFactory();
  const operation = 'restore';
  const acquired = await destinationStore.acquireLease({
    runId, actor: sanitizeActor(actor), expiresAt: leaseExpiryIso(clock),
  });
  if (!acquired?.acquired) throw domainError('operation-in-progress', 'A UAT week restore is already running.');

  let currentSnapshotWeeks;
  let applyStarted = false;
  let phase = 'restoring';
  let verifiedResult;
  const terminalAudit = restoreTerminalAudit({ restoredFromSnapshotId: snapshotId });
  try {
    await destinationStore.createRun(runMetadata({
      runId, actor, operation, phase,
      extra: { startedAt: nowIso(clock), snapshotId: runId, restoredFromSnapshotId: snapshotId },
    }));
    const retained = await destinationStore.listCompleteSnapshots();
    const selected = retained.find(snapshot => snapshot.snapshotId === snapshotId && snapshot.complete === true);
    if (!selected) throw domainError('snapshot-not-retained');
    assertRetainedSnapshotMetadata(selected, snapshotId);
    const selectedSnapshot = await destinationStore.readSnapshot({ snapshotId });
    if (selectedSnapshot?.snapshotId !== snapshotId) {
      throw domainError('snapshot-integrity-failed', 'Snapshot ID does not match retained metadata.');
    }
    assertVerifiedSnapshot(selectedSnapshot, undefined, selected.digest);
    if (selected.weekCount !== selectedSnapshot.weeks.length) {
      throw domainError('snapshot-integrity-failed');
    }
    currentSnapshotWeeks = await destinationStore.listWeeks();
    const currentDigest = digestWeekEntries(currentSnapshotWeeks);
    await destinationStore.writeSnapshot({
      snapshotId: runId, runId, weeks: currentSnapshotWeeks, digest: currentDigest, weekCount: currentSnapshotWeeks.length, createdAt: nowIso(clock), operation,
    });
    assertVerifiedSnapshot(await destinationStore.readSnapshot({ snapshotId: runId }), currentSnapshotWeeks, undefined, { requireComplete: false });
    await destinationStore.completeSnapshot({ snapshotId: runId, runId });
    assertVerifiedSnapshot(await destinationStore.readSnapshot({ snapshotId: runId }), currentSnapshotWeeks);
    await destinationStore.renewLease({ runId, expiresAt: leaseExpiryIso(clock) });
    applyStarted = true;
    await destinationStore.applyMirror({ weeks: selectedSnapshot.weeks, runId, batchSize: MIRROR_BATCH_SIZE });
    const restoredWeeks = await destinationStore.listWeeks();
    assertMatchingWeeks(selectedSnapshot.weeks, restoredWeeks, 'UAT restore verification failed.');
    verifiedResult = {
      ok: true, phase: 'restored', runId, snapshotId: runId, restoredFromSnapshotId: snapshotId,
      restoredDigest: digestWeekEntries(restoredWeeks),
      restoredWeekCount: restoredWeeks.length,
      sourceProjectId: UAT_PROJECT_ID,
      destinationProjectId: UAT_PROJECT_ID,
      completedAt: nowIso(clock),
    };
    phase = 'restored';
    try {
      await destinationStore.clearRecoveryRequired({ runId });
    } catch (_clearError) {
      // The verified restore is still true, but the durable warning remains until it can be cleared.
    }
    await destinationStore.updateRun(runMetadata({ runId, actor, operation, phase, extra: verifiedResult }));
    return finalizeVerifiedResult({ destinationStore, runId, actor, operation, phase, result: verifiedResult });
  } catch (error) {
    if (verifiedResult) {
      return finalizeVerifiedResult({
        destinationStore, runId, actor, operation, phase: 'restored', result: verifiedResult,
        warning: 'success-recording-failed',
      });
    }
    if (applyStarted) {
      return recoverOrFail({
        destinationStore, runId, actor, operation, snapshotId: runId, snapshotWeeks: currentSnapshotWeeks, clock, terminalAudit,
      });
    }
    await finishFailedBeforeApply({ destinationStore, runId, actor, operation, phase, leaseOwned: true, clock, error, terminalAudit });
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
  SyncDomainError,
};
