const { DocumentReference, Firestore, GeoPoint, Timestamp, v1 } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const core = require('./production-week-sync-core');
const metadata = require('./production-week-sync-metadata');
const productionRead = require('./production-week-sync-production-read');

const SYNC_SERVICE_ACCOUNT =
  'uat-production-sync@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com';
const SYNC_FUNCTION_OPTIONS = Object.freeze({
  region: 'us-central1', timeoutSeconds: 540, memory: '512MiB', serviceAccount: SYNC_SERVICE_ACCOUNT,
});
const CONTROL_COLLECTION = 'uatProductionWeekSync';
const CONTROL_DOCUMENT = 'control';
const RUNS_COLLECTION = 'uatProductionWeekSyncRuns';
const BATCH_SIZE = 200;
const UAT_DATABASE_NAME = `projects/${core.UAT_PROJECT_ID}/databases/(default)`;
let exactUatDb;
let rawUatClient;

function callableError(code, message, reason) {
  return new HttpsError(code, message, { reason });
}

function assertPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactSafeOwnKeys(value, expectedKeys) {
  if (!assertPlainObject(value)) return false;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch (_error) {
    return false;
  }
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.prototype.hasOwnProperty.call(descriptor, 'value');
  });
}

function assertEmptyRequest(data) {
  if (!hasExactSafeOwnKeys(data, [])) {
    throw callableError('invalid-argument', 'This operation does not accept request fields.', 'invalid-request-schema');
  }
}

function assertRestoreRequest(data) {
  if (!hasExactSafeOwnKeys(data, ['snapshotId'])
    || typeof data.snapshotId !== 'string' || !data.snapshotId.trim() || data.snapshotId.includes('/')) {
    throw callableError('invalid-argument', 'A valid snapshotId is required.', 'invalid-request-schema');
  }
}

function assertUatRuntimeProject(environment = process.env) {
  const projectId = environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT;
  if (projectId !== core.UAT_PROJECT_ID) {
    throw callableError('failed-precondition', 'This callable is restricted to the fixed UAT project.', 'uat-runtime-project-required');
  }
}

async function authenticatedSyncAdmin(request, uatDb) {
  const auth = request?.auth;
  if (!auth) {
    throw callableError('unauthenticated', 'A signed-in account is required.', 'authentication-required');
  }
  if (!String(auth.uid || '').trim()) {
    throw callableError('unauthenticated', 'The signed-in account must have a UID.', 'authenticated-uid-required');
  }
  const email = String(auth.token?.email || '').trim().toLowerCase();
  if (!email) {
    throw callableError('unauthenticated', 'The signed-in account must have an email.', 'authenticated-email-required');
  }
  const userSnapshot = await uatDb.collection('users').doc(email).get();
  if (!userSnapshot.exists) {
    throw callableError('permission-denied', 'The dashboard account was not found.', 'dashboard-user-not-found');
  }
  const user = userSnapshot.data() || {};
  if (String(user.role || '').trim().toLowerCase() !== 'admin') {
    throw callableError('permission-denied', 'Only UAT administrators can run this operation.', 'admin-role-required');
  }
  const displayName = String(user.displayName || '').trim();
  if (!displayName) {
    throw callableError('unauthenticated', 'The dashboard account must have a display name.', 'authenticated-display-name-required');
  }
  return { uid: String(auth.uid), email, displayName, role: 'admin' };
}

function getExactUatFirestore() {
  if (!exactUatDb) exactUatDb = new Firestore({ projectId: core.UAT_PROJECT_ID, useBigInt: true });
  return exactUatDb;
}

function encodeExactFirestoreValue(value, databaseName = UAT_DATABASE_NAME) {
  core.canonicalizeValue(value);
  function encode(candidate) {
    if (candidate === null) return { nullValue: 'NULL_VALUE' };
    if (typeof candidate === 'string') return { stringValue: candidate };
    if (typeof candidate === 'boolean') return { booleanValue: candidate };
    if (typeof candidate === 'bigint') return { integerValue: candidate.toString() };
    if (typeof candidate === 'number') return { doubleValue: candidate };
    if (Buffer.isBuffer(candidate) || candidate instanceof Uint8Array) {
      return { bytesValue: Buffer.from(candidate) };
    }
    if (candidate instanceof Date) return encode(Timestamp.fromDate(candidate));
    if (candidate instanceof Timestamp) {
      return { timestampValue: { seconds: String(candidate.seconds), nanos: candidate.nanoseconds } };
    }
    if (candidate instanceof GeoPoint) {
      return { geoPointValue: { latitude: candidate.latitude, longitude: candidate.longitude } };
    }
    if (candidate instanceof DocumentReference) {
      return { referenceValue: `${databaseName}/documents/${candidate.path}` };
    }
    if (Array.isArray(candidate)) return { arrayValue: { values: candidate.map(encode) } };
    return { mapValue: { fields: Object.fromEntries(Object.keys(candidate).map(key => [key, encode(candidate[key])])) } };
  }
  return encode(value);
}

function exactSetWrite(ref, data) {
  const map = encodeExactFirestoreValue(data);
  return { update: { name: `${UAT_DATABASE_NAME}/documents/${ref.path}`, fields: map.mapValue.fields } };
}

async function commitRawUatWrites(writes) {
  if (!rawUatClient) rawUatClient = new v1.FirestoreClient();
  await rawUatClient.commit({ database: UAT_DATABASE_NAME, writes });
}

async function commitBoundedOperations(db, operations, beforeBatch) {
  for (let start = 0; start < operations.length; start += BATCH_SIZE) {
    await beforeBatch();
    const batch = db.batch();
    for (const operation of operations.slice(start, start + BATCH_SIZE)) {
      if (operation.type === 'set') batch.set(operation.ref, operation.data, operation.options);
      else batch.delete(operation.ref);
    }
    await batch.commit();
  }
}

function snapshotMetadata({ snapshotId, digest, weekCount, createdAt, operation }) {
  return { snapshotId, digest, weekCount, createdAt, operation, complete: false };
}

async function commitBoundedRawOperations(operations, beforeBatch, commitRawWrites) {
  for (let start = 0; start < operations.length; start += BATCH_SIZE) {
    await beforeBatch();
    await commitRawWrites(operations.slice(start, start + BATCH_SIZE));
  }
}

function createUatSyncStore(uatDb, options = {}) {
  const commitRawWrites = options.commitRawWrites
    || (typeof uatDb.commitRawWrites === 'function' ? writes => uatDb.commitRawWrites(writes) : commitRawUatWrites);
  const controlRef = () => uatDb.collection(CONTROL_COLLECTION).doc(CONTROL_DOCUMENT);
  const runRef = runId => uatDb.collection(RUNS_COLLECTION).doc(runId);
  const weeks = () => uatDb.collection(core.SYNC_COLLECTION);
  async function renewOwnedLease(runId) {
    if (typeof runId !== 'string' || !runId) throw new Error('Sync lease owner is required.');
    await uatDb.runTransaction(async transaction => {
      const current = await transaction.get(controlRef());
      const lease = current.exists ? current.data() : {};
      const expiry = Date.parse(lease.expiresAt || '');
      if (!current.exists || lease.activeRunId !== runId) {
        throw new core.SyncDomainError('lease-lost', 'Sync lease is not owned by this run.');
      }
      if (!Number.isFinite(expiry) || expiry <= Date.now()) {
        throw new core.SyncDomainError('lease-lost', 'Sync lease has expired.');
      }
      transaction.set(controlRef(), { expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() }, { merge: true });
    });
  }

  return {
    async acquireLease({ runId, actor, expiresAt }) {
      return uatDb.runTransaction(async transaction => {
        const current = await transaction.get(controlRef());
        const lease = current.exists ? current.data() : {};
        const expiry = Date.parse(lease.expiresAt || '');
        if (lease.activeRunId && (!Number.isFinite(expiry) || expiry > Date.now())) return { acquired: false };
        transaction.set(controlRef(), { activeRunId: runId, actor, expiresAt }, { merge: true });
        return { acquired: true };
      });
    },
    async renewLease({ runId, expiresAt }) {
      await uatDb.runTransaction(async transaction => {
        const current = await transaction.get(controlRef());
        const lease = current.exists ? current.data() : {};
        const expiry = Date.parse(lease.expiresAt || '');
        if (!current.exists || lease.activeRunId !== runId) {
          throw new core.SyncDomainError('lease-lost', 'Sync lease is not owned by this run.');
        }
        if (!Number.isFinite(expiry) || expiry <= Date.now()) {
          throw new core.SyncDomainError('lease-lost', 'Sync lease has expired.');
        }
        transaction.set(controlRef(), { expiresAt }, { merge: true });
      });
    },
    async releaseLease({ runId }) {
      await uatDb.runTransaction(async transaction => {
        const current = await transaction.get(controlRef());
        if (!current.exists || current.data().activeRunId !== runId) throw new Error('Sync lease is not owned by this run.');
        transaction.set(controlRef(), { activeRunId: null, expiresAt: null }, { merge: true });
      });
    },
    async setRecoveryRequired({ runId, failedAt }) {
      await uatDb.runTransaction(async transaction => {
        await transaction.get(controlRef());
        transaction.set(controlRef(), {
          recoveryRequired: true,
          rollbackFailedRunId: runId,
          rollbackFailedAt: failedAt,
        }, { merge: true });
      });
    },
    async clearRecoveryRequired() {
      return uatDb.runTransaction(async transaction => {
        const current = await transaction.get(controlRef());
        if (!current.exists || current.data().recoveryRequired !== true) return false;
        transaction.set(controlRef(), {
          recoveryRequired: false,
          rollbackFailedRunId: null,
          rollbackFailedAt: null,
        }, { merge: true });
        return true;
      });
    },
    async createRun(metadata) {
      await runRef(metadata.runId).create(metadata);
    },
    async updateRun(metadata) {
      await runRef(metadata.runId).set(metadata, { merge: true });
    },
    async readStatus() {
      const [control, runs] = await Promise.all([controlRef().get(), uatDb.collection(RUNS_COLLECTION).get()]);
      const controlData = control.exists ? control.data() : {};
      const activeExpiry = Date.parse(controlData.expiresAt || '');
      const running = Boolean(controlData.activeRunId && Number.isFinite(activeExpiry) && activeExpiry > Date.now());
      const allRuns = runs.docs.map(document => metadata.normalizeRunMetadata(document.data()));
      const byNewest = (left, right) => String(right.completedAt || right.createdAt || '').localeCompare(String(left.completedAt || left.createdAt || ''))
        || String(right.runId || right.snapshotId || '').localeCompare(String(left.runId || left.snapshotId || ''));
      const currentRun = running ? allRuns.find(run => run.runId === controlData.activeRunId) : undefined;
      const completed = allRuns.filter(run => ['succeeded', 'restored'].includes(run.phase)).sort(byNewest)[0];
      const latestRun = allRuns.filter(run => typeof run.completedAt === 'string'
        && (['succeeded', 'restored', 'rolled_back', 'rollback_failed'].includes(run.phase) || run.result === 'failed'))
        .sort(byNewest)[0];
      const latestSnapshot = allRuns.filter(run => run.complete === true).sort(byNewest)[0];
      const summary = run => run && Object.fromEntries([
        'runId', 'phase', 'operation', 'result', 'sourceProjectId', 'destinationProjectId', 'sourceReadTime',
        'sourceWeekCount', 'destinationWeekCount', 'createdCount', 'updatedCount', 'deletedCount', 'snapshotId',
        'snapshotDigest', 'startedAt', 'completedAt', 'errorCode', 'errorMessage', 'cleanupWarning', 'leaseReleaseWarning',
        'sourceDigest', 'resultDigest', 'resultWeekCount', 'restoredFromSnapshotId', 'restoredDigest', 'restoredWeekCount',
      ].filter(key => run[key] === null || ['string', 'number', 'boolean'].includes(typeof run[key])).map(key => [key, run[key]]));
      return {
        running,
        ...(currentRun?.phase ? { phase: currentRun.phase } : {}),
        recoveryRequired: controlData.recoveryRequired === true,
        ...(controlData.recoveryRequired === true && typeof controlData.rollbackFailedRunId === 'string'
          ? { rollbackFailedRunId: controlData.rollbackFailedRunId } : {}),
        ...(controlData.recoveryRequired === true && typeof controlData.rollbackFailedAt === 'string'
          ? { rollbackFailedAt: controlData.rollbackFailedAt } : {}),
        ...(latestRun ? { latestRun: summary(latestRun) } : {}),
        ...(completed ? { latestCompletedRun: summary(completed) } : {}),
        ...(latestSnapshot ? { latestSnapshot: Object.fromEntries(['snapshotId', 'createdAt', 'completedAt']
          .filter(key => latestSnapshot[key] === null || ['string', 'number', 'boolean'].includes(typeof latestSnapshot[key]))
          .map(key => [key, latestSnapshot[key]])) } : {}),
      };
    },
    async listWeeks() {
      const snapshot = await weeks().get();
      return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
    },
    async writeSnapshot({ snapshotId, runId, weeks: snapshotWeeks, digest, weekCount, createdAt, operation }) {
      const target = runRef(snapshotId);
      await commitBoundedOperations(uatDb, [
        { type: 'set', ref: target, data: snapshotMetadata({ snapshotId, digest, weekCount, createdAt, operation }), options: { merge: true } },
      ], () => renewOwnedLease(runId));
      await commitBoundedRawOperations(snapshotWeeks.map(week => exactSetWrite(
        target.collection('weeks').doc(week.id), { data: week.data },
      )), () => renewOwnedLease(runId), commitRawWrites);
    },
    async completeSnapshot({ snapshotId, runId }) {
      await renewOwnedLease(runId);
      await runRef(snapshotId).set({ complete: true }, { merge: true });
    },
    async readSnapshot({ snapshotId }) {
      const target = runRef(snapshotId);
      const [snapshotDocument, entries] = await Promise.all([target.get(), target.collection('weeks').get()]);
      if (!snapshotDocument.exists) return null;
      return {
        ...metadata.normalizeSnapshotMetadata(snapshotDocument.data(), target.id),
        weeks: entries.docs.map(document => ({ id: document.id, data: document.data().data })),
      };
    },
    async applyMirror({ weeks: sourceWeeks, batchSize, runId }) {
      if (batchSize !== BATCH_SIZE) throw new Error('UAT mirror batch size must be 200.');
      const current = await weeks().get();
      const sourceIds = new Set(sourceWeeks.map(week => week.id));
      const operations = [
        ...sourceWeeks.map(week => exactSetWrite(weeks().doc(week.id), week.data)),
        ...current.docs.filter(document => !sourceIds.has(document.id)).map(document => ({
          delete: `${UAT_DATABASE_NAME}/documents/${(document.ref || weeks().doc(document.id)).path}`,
        })),
      ];
      await commitBoundedRawOperations(operations, () => renewOwnedLease(runId), commitRawWrites);
    },
    async listCompleteSnapshots() {
      const snapshot = await uatDb.collection(RUNS_COLLECTION).where('complete', '==', true).get();
      return snapshot.docs.map(document => {
        const data = metadata.normalizeSnapshotMetadata(document.data(), document.id);
        const snapshotMetadata = {
          snapshotId: document.id,
          complete: data.complete,
          digest: data.digest,
          weekCount: data.weekCount,
          createdAt: data.createdAt,
        };
        if (data.completedAt !== undefined) snapshotMetadata.completedAt = data.completedAt;
        return snapshotMetadata;
      });
    },
    async deleteSnapshot({ snapshotId, runId }) {
      const target = runRef(snapshotId);
      const entries = await target.collection('weeks').get();
      await commitBoundedOperations(uatDb, [
        ...entries.docs.map(document => ({ type: 'delete', ref: document.ref })),
        { type: 'delete', ref: target },
      ], () => renewOwnedLease(runId));
    },
  };
}

function defaultService({ sourceStore, destinationStore }) {
  return core.createWeekSyncService({
    sourceStore,
    destinationStore,
    clock: () => new Date(),
    idFactory: () => `sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
}

function asCallableFailure(error) {
  if (error instanceof HttpsError) return error;
  if (error instanceof core.SyncDomainError) {
    const callableCode = error.code === 'snapshot-not-retained' ? 'not-found'
      : error.code === 'lease-lost' ? 'aborted' : 'failed-precondition';
    return callableError(callableCode, error.message, error.code);
  }
  return callableError('internal', 'The UAT week operation could not be completed safely.', 'uat-week-sync-failed');
}

function createCallableHandlers({
  onCall: register = onCall,
  environment = process.env,
  getUatDb = getExactUatFirestore,
  getProductionDb = productionRead.getProductionFirestore,
  createService = defaultService,
} = {}) {
  async function invoke(request, operation) {
    assertUatRuntimeProject(environment);
    const uatDb = getUatDb();
    const actor = await authenticatedSyncAdmin(request, uatDb);
    const destinationStore = createUatSyncStore(uatDb);
    const sourceStore = operation === 'sync'
      ? productionRead.createProductionReadStore(getProductionDb())
      : Object.freeze({ listWeeks: async () => { throw new Error('Production reads are unavailable for this operation.'); } });
    const service = createService({ sourceStore, destinationStore });
    if (operation === 'sync') return service.sync({ actor });
    if (operation === 'status') return service.status({ actor });
    return service.restore({ actor, snapshotId: request.data.snapshotId });
  }

  return {
    syncProductionWeeksToUat: register(SYNC_FUNCTION_OPTIONS, async request => {
      try {
        assertEmptyRequest(request.data);
        return await invoke(request, 'sync');
      } catch (error) { throw asCallableFailure(error); }
    }),
    getProductionWeekSyncStatus: register(SYNC_FUNCTION_OPTIONS, async request => {
      try {
        assertEmptyRequest(request.data);
        return await invoke(request, 'status');
      } catch (error) { throw asCallableFailure(error); }
    }),
    restoreUatWeeksSnapshot: register(SYNC_FUNCTION_OPTIONS, async request => {
      try {
        assertRestoreRequest(request.data);
        return await invoke(request, 'restore');
      } catch (error) { throw asCallableFailure(error); }
    }),
  };
}

const callables = createCallableHandlers();

module.exports = {
  ...callables,
  SYNC_FUNCTION_OPTIONS,
  authenticatedSyncAdmin,
  createProductionReadStore: productionRead.createProductionReadStore,
  createUatSyncStore,
  assertEmptyRequest,
  assertRestoreRequest,
  assertUatRuntimeProject,
  createCallableHandlers,
  encodeExactFirestoreValue,
  getExactUatFirestore,
};
