const { applicationDefault, getApp, initializeApp } = require('firebase-admin/app');
const { DocumentReference, GeoPoint, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const core = require('./production-week-sync-core');

const SYNC_SERVICE_ACCOUNT =
  'uat-production-sync@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com';
const SYNC_FUNCTION_OPTIONS = Object.freeze({
  region: 'us-central1', timeoutSeconds: 540, memory: '512MiB', serviceAccount: SYNC_SERVICE_ACCOUNT,
});
const PRODUCTION_APP_NAME = 'production-week-sync-read-only';
const CONTROL_COLLECTION = 'uatProductionWeekSync';
const CONTROL_DOCUMENT = 'control';
const RUNS_COLLECTION = 'uatProductionWeekSyncRuns';
const BATCH_SIZE = 200;

function callableError(code, message, reason) {
  return new HttpsError(code, message, { reason });
}

function assertPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertEmptyRequest(data) {
  if (!assertPlainObject(data) || Object.keys(data).length !== 0) {
    throw callableError('invalid-argument', 'This operation does not accept request fields.', 'invalid-request-schema');
  }
}

function assertRestoreRequest(data) {
  if (!assertPlainObject(data) || Object.keys(data).length !== 1
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
  const displayName = String(auth.token?.name || auth.token?.displayName || '').trim();
  if (!displayName) {
    throw callableError('unauthenticated', 'The signed-in account must have a display name.', 'authenticated-display-name-required');
  }
  const userSnapshot = await uatDb.collection('users').doc(email).get();
  if (!userSnapshot.exists) {
    throw callableError('permission-denied', 'The dashboard account was not found.', 'dashboard-user-not-found');
  }
  if (String(userSnapshot.data()?.role || '').trim().toLowerCase() !== 'admin') {
    throw callableError('permission-denied', 'Only UAT administrators can run this operation.', 'admin-role-required');
  }
  return { uid: String(auth.uid), email, displayName, role: 'admin' };
}

function createProductionReadStore(productionDb) {
  return Object.freeze({
    async listWeeks() {
      const snapshot = await productionDb.collection(core.SYNC_COLLECTION).get();
      return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
    },
  });
}

function reconstructUatValue(value, uatDb) {
  core.canonicalizeValue(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof Timestamp) return new Timestamp(value.seconds, value.nanoseconds);
  if (value instanceof GeoPoint) return new GeoPoint(value.latitude, value.longitude);
  if (value instanceof DocumentReference) return uatDb.doc(value.path);
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (Array.isArray(value)) return value.map(entry => reconstructUatValue(entry, uatDb));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).map(key => [key, reconstructUatValue(value[key], uatDb)]));
  }
  return value;
}

async function commitBoundedOperations(db, operations) {
  for (let start = 0; start < operations.length; start += BATCH_SIZE) {
    const batch = db.batch();
    for (const operation of operations.slice(start, start + BATCH_SIZE)) {
      if (operation.type === 'set') batch.set(operation.ref, operation.data, operation.options);
      else batch.delete(operation.ref);
    }
    await batch.commit();
  }
}

function snapshotMetadata({ snapshotId, digest, weekCount, createdAt, operation }) {
  return { snapshotId, digest, weekCount, createdAt, operation, complete: true };
}

function createUatSyncStore(uatDb) {
  const controlRef = () => uatDb.collection(CONTROL_COLLECTION).doc(CONTROL_DOCUMENT);
  const runRef = runId => uatDb.collection(RUNS_COLLECTION).doc(runId);
  const weeks = () => uatDb.collection(core.SYNC_COLLECTION);

  return {
    async acquireLease({ runId, actor, expiresAt }) {
      return uatDb.runTransaction(async transaction => {
        const current = await transaction.get(controlRef());
        const lease = current.exists ? current.data() : {};
        if (lease.activeRunId && new Date(lease.expiresAt || 0).getTime() > Date.now()) return { acquired: false };
        transaction.set(controlRef(), { activeRunId: runId, actor, expiresAt }, { merge: true });
        return { acquired: true };
      });
    },
    async renewLease({ runId, expiresAt }) {
      await uatDb.runTransaction(async transaction => {
        const current = await transaction.get(controlRef());
        if (!current.exists || current.data().activeRunId !== runId) throw new Error('Sync lease is not owned by this run.');
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
    async createRun(metadata) {
      await runRef(metadata.runId).create(metadata);
    },
    async updateRun(metadata) {
      await runRef(metadata.runId).set(metadata, { merge: true });
    },
    async readStatus() {
      const [control, latestRuns] = await Promise.all([
        controlRef().get(), runRefQuery(uatDb).get(),
      ]);
      const latestRun = latestRuns.docs[0]?.data();
      const running = Boolean(control.exists && control.data().activeRunId
        && new Date(control.data().expiresAt || 0).getTime() > Date.now());
      return { running, phase: latestRun?.phase, latestRun };
    },
    async listWeeks() {
      const snapshot = await weeks().get();
      return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
    },
    async writeSnapshot({ snapshotId, weeks: snapshotWeeks, digest, weekCount, createdAt, operation }) {
      const target = runRef(snapshotId);
      const operations = [
        { type: 'set', ref: target, data: snapshotMetadata({ snapshotId, digest, weekCount, createdAt, operation }), options: { merge: true } },
        ...snapshotWeeks.map(week => ({
          type: 'set', ref: target.collection('weeks').doc(week.id),
          data: { data: reconstructUatValue(week.data, uatDb) },
        })),
      ];
      await commitBoundedOperations(uatDb, operations);
    },
    async readSnapshot({ snapshotId }) {
      const target = runRef(snapshotId);
      const [metadata, entries] = await Promise.all([target.get(), target.collection('weeks').get()]);
      if (!metadata.exists) return null;
      return {
        ...metadata.data(), snapshotId,
        weeks: entries.docs.map(document => ({ id: document.id, data: document.data().data })),
      };
    },
    async applyMirror({ weeks: sourceWeeks, batchSize }) {
      if (batchSize !== BATCH_SIZE) throw new Error('UAT mirror batch size must be 200.');
      const current = await weeks().get();
      const sourceIds = new Set(sourceWeeks.map(week => week.id));
      const operations = [
        ...sourceWeeks.map(week => ({
          type: 'set', ref: weeks().doc(week.id), data: reconstructUatValue(week.data, uatDb), options: { merge: false },
        })),
        ...current.docs.filter(document => !sourceIds.has(document.id)).map(document => ({ type: 'delete', ref: document.ref || weeks().doc(document.id) })),
      ];
      await commitBoundedOperations(uatDb, operations);
    },
    async listCompleteSnapshots() {
      const snapshot = await uatDb.collection(RUNS_COLLECTION).where('complete', '==', true).get();
      return snapshot.docs.map(document => {
        const data = document.data();
        const metadata = {
          snapshotId: data.snapshotId,
          complete: data.complete,
          digest: data.digest,
          weekCount: data.weekCount,
          createdAt: data.createdAt,
        };
        if (data.completedAt !== undefined) metadata.completedAt = data.completedAt;
        return metadata;
      });
    },
    async deleteSnapshot({ snapshotId }) {
      const target = runRef(snapshotId);
      const entries = await target.collection('weeks').get();
      await commitBoundedOperations(uatDb, [
        ...entries.docs.map(document => ({ type: 'delete', ref: document.ref })),
        { type: 'delete', ref: target },
      ]);
    },
  };
}

function runRefQuery(uatDb) {
  return uatDb.collection(RUNS_COLLECTION).orderBy('startedAt', 'desc').limit(1);
}

function getProductionFirestore() {
  let app;
  try {
    app = getApp(PRODUCTION_APP_NAME);
  } catch (_notInitialized) {
    app = initializeApp({ credential: applicationDefault(), projectId: core.PRODUCTION_PROJECT_ID }, PRODUCTION_APP_NAME);
  }
  return getFirestore(app);
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
  return callableError('internal', 'The UAT week operation could not be completed safely.', 'uat-week-sync-failed');
}

function createCallableHandlers({
  onCall: register = onCall,
  environment = process.env,
  getUatDb = () => getFirestore(),
  getProductionDb = getProductionFirestore,
  createService = defaultService,
} = {}) {
  async function invoke(request, operation) {
    assertUatRuntimeProject(environment);
    const uatDb = getUatDb();
    const actor = await authenticatedSyncAdmin(request, uatDb);
    const destinationStore = createUatSyncStore(uatDb);
    const sourceStore = operation === 'sync'
      ? createProductionReadStore(getProductionDb())
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
  createProductionReadStore,
  createUatSyncStore,
  assertEmptyRequest,
  assertRestoreRequest,
  assertUatRuntimeProject,
  createCallableHandlers,
};
