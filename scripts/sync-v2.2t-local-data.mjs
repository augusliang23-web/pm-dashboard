// Production-only snapshot export/import utility. Never call from UAT verification.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { GeoPoint, Timestamp, getFirestore } = require('firebase-admin/firestore');

const SOURCE_PROJECT_ID = 'project-manager-dashboar-a067f';
const LOCAL_PROJECT_ID = SOURCE_PROJECT_ID;
const LOCAL_FIRESTORE_HOST = '127.0.0.1:8080';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cachePath = resolve(repoRoot, 'tmp', 'v2.2t-production-snapshot.json');
if (!process.argv.includes('--allow-production-snapshot-read')) {
  throw new Error('Refusing Production snapshot read without --allow-production-snapshot-read.');
}
const collectionNames = [
  'users',
  'weeks',
  'dashboardSettings',
  'executiveMilestoneConfig',
  'executiveMilestoneState',
  'executiveMilestoneUpdates',
  'executiveMilestoneChangeRequests',
  'executiveMilestoneAudit',
];

function encodeFirestoreValue(value) {
  if (value instanceof Timestamp) {
    return { __firestoreType: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof GeoPoint) {
    return { __firestoreType: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __firestoreType: 'bytes', base64: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(encodeFirestoreValue);
  if (value && typeof value === 'object') {
    if (typeof value.path === 'string' && value.firestore) {
      return { __firestoreType: 'reference', path: value.path };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeFirestoreValue(item)]));
  }
  return value;
}

function decodeFirestoreValue(value, localDb) {
  if (Array.isArray(value)) return value.map(item => decodeFirestoreValue(item, localDb));
  if (!value || typeof value !== 'object') return value;
  if (value.__firestoreType === 'timestamp') {
    return new Timestamp(value.seconds, value.nanoseconds);
  }
  if (value.__firestoreType === 'geopoint') {
    return new GeoPoint(value.latitude, value.longitude);
  }
  if (value.__firestoreType === 'bytes') {
    return Buffer.from(value.base64, 'base64');
  }
  if (value.__firestoreType === 'reference') {
    return localDb.doc(value.path);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeFirestoreValue(item, localDb)]));
}

async function exportProductionSnapshot() {
  const priorEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  const sourceApp = initializeApp({
    credential: applicationDefault(),
    projectId: SOURCE_PROJECT_ID,
  }, `v22t-source-${Date.now()}`);
  const sourceDb = getFirestore(sourceApp);
  const collections = {};

  try {
    for (const collectionName of collectionNames) {
      const snapshot = await sourceDb.collection(collectionName).get();
      collections[collectionName] = snapshot.docs.map(document => ({
        id: document.id,
        data: encodeFirestoreValue(document.data()),
      }));
    }
  } finally {
    if (priorEmulatorHost) process.env.FIRESTORE_EMULATOR_HOST = priorEmulatorHost;
  }

  const payload = {
    sourceProjectId: SOURCE_PROJECT_ID,
    exportedAt: new Date().toISOString(),
    collections,
  };
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

async function loadSnapshot() {
  try {
    return await exportProductionSnapshot();
  } catch (error) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'));
      console.warn(`Production read unavailable; using cached local snapshot from ${cached.exportedAt}.`);
      return cached;
    } catch {
      throw new Error(`Unable to read production data or the local cache: ${error.message}`);
    }
  }
}

async function importLocalSnapshot(payload) {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || LOCAL_FIRESTORE_HOST;
  if (process.env.FIRESTORE_EMULATOR_HOST !== LOCAL_FIRESTORE_HOST) {
    throw new Error(`Refusing to import outside the local Firestore emulator at ${LOCAL_FIRESTORE_HOST}.`);
  }

  const localApp = initializeApp({ projectId: LOCAL_PROJECT_ID }, `v22t-local-${Date.now()}`);
  const localDb = getFirestore(localApp);
  let writeCount = 0;
  let batch = localDb.batch();

  for (const collectionName of collectionNames) {
    for (const document of payload.collections?.[collectionName] || []) {
      batch.set(
        localDb.collection(collectionName).doc(document.id),
        decodeFirestoreValue(document.data, localDb),
      );
      writeCount += 1;
      if (writeCount % 400 === 0) {
        await batch.commit();
        batch = localDb.batch();
      }
    }
  }
  if (writeCount % 400 !== 0) await batch.commit();
  return writeCount;
}

const snapshot = await loadSnapshot();
const writeCount = await importLocalSnapshot(snapshot);
console.log(`Restored ${writeCount} documents to local v2.2T from ${snapshot.exportedAt}.`);
