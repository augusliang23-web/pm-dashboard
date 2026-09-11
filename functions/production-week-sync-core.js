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
};
