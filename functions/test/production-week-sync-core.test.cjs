const assert = require('node:assert/strict');
const test = require('node:test');
const { DocumentReference, Firestore, GeoPoint, Timestamp } = require('firebase-admin/firestore');
const core = require('../production-week-sync-core');

const firestore = new Firestore({ projectId: 'canonicalization-test-project' });

test('environment guard allows only the fixed Production-to-UAT direction', () => {
  assert.doesNotThrow(() => core.assertSyncEnvironment({
    sourceProjectId: 'project-manager-dashboar-a067f',
    destinationProjectId: 'pm-dashboard-uat-20260820-a7f3',
  }));
  assert.throws(() => core.assertSyncEnvironment({
    sourceProjectId: 'pm-dashboard-uat-20260820-a7f3',
    destinationProjectId: 'project-manager-dashboar-a067f',
  }), /fixed Production-to-UAT direction/);
});

test('empty or duplicate Production weeks are rejected', () => {
  assert.throws(() => core.validateSourceWeeks([]), /no reporting weeks/);
  assert.throws(() => core.validateSourceWeeks([
    { id: 'W36-2026', data: {} },
    { id: 'W36-2026', data: {} },
  ]), /duplicate/);
});

test('mirror planning classifies every document ID', () => {
  const plan = core.planWeekMirror({
    sourceWeeks: [
      { id: 'W35-2026', data: { projects: [{ code: 'NEW' }] } },
      { id: 'W36-2026', data: { projects: [{ code: 'SAME' }] } },
      { id: 'W37-2026', data: { projects: [] } },
    ],
    destinationWeeks: [
      { id: 'W34-2026', data: { projects: [] } },
      { id: 'W35-2026', data: { projects: [{ code: 'OLD' }] } },
      { id: 'W36-2026', data: { projects: [{ code: 'SAME' }] } },
    ],
  });
  assert.deepEqual(plan.createdIds, ['W37-2026']);
  assert.deepEqual(plan.updatedIds, ['W35-2026']);
  assert.deepEqual(plan.unchangedIds, ['W36-2026']);
  assert.deepEqual(plan.deletedIds, ['W34-2026']);
});

test('canonicalization sorts map keys and preserves Firestore values', () => {
  const canonical = core.canonicalizeValue({
    z: 'last',
    array: [null, 2, { b: true, a: false }],
    timestamp: new Timestamp(1_725_000_000, 123_000_000),
    geo: new GeoPoint(25.033, 121.565),
    bytes: Buffer.from([0, 1]),
    uint8Array: new Uint8Array([2, 3]),
    reference: firestore.doc('users/admin-1'),
  });
  assert.deepEqual(canonical, {
    __firestoreType: 'map',
    fields: {
      array: [null, { __firestoreType: 'double', value: 2 }, { __firestoreType: 'map', fields: { a: false, b: true } }],
      bytes: { __firestoreType: 'bytes', base64: 'AAE=' },
      geo: { __firestoreType: 'geoPoint', latitude: 25.033, longitude: 121.565 },
      reference: { __firestoreType: 'documentReference', path: 'users/admin-1' },
      timestamp: { __firestoreType: 'timestamp', nanoseconds: 123_000_000, seconds: 1_725_000_000 },
      uint8Array: { __firestoreType: 'bytes', base64: 'AgM=' },
      z: 'last',
    },
  });
});

test('canonicalization preserves Firestore integer and double identity across signed int64 bounds', () => {
  assert.deepEqual(core.canonicalizeValue(-9_223_372_036_854_775_808n), {
    __firestoreType: 'integer', value: '-9223372036854775808',
  });
  assert.deepEqual(core.canonicalizeValue(9_223_372_036_854_775_807n), {
    __firestoreType: 'integer', value: '9223372036854775807',
  });
  assert.deepEqual(core.canonicalizeValue(1), { __firestoreType: 'double', value: 1 });
  assert.notDeepEqual(core.canonicalizeValue(1n), core.canonicalizeValue(1));
  assert.throws(() => core.canonicalizeValue(-9_223_372_036_854_775_809n), /signed 64-bit/i);
  assert.throws(() => core.canonicalizeValue(9_223_372_036_854_775_808n), /signed 64-bit/i);
});

test('canonical digests ignore input and map key ordering', () => {
  const first = [
    { id: 'W37-2026', data: { b: 2, a: { y: true, x: false } } },
    { id: 'W36-2026', data: { projects: [] } },
  ];
  const second = [
    { id: 'W36-2026', data: { projects: [] } },
    { id: 'W37-2026', data: { a: { x: false, y: true }, b: 2 } },
  ];
  assert.deepEqual(core.canonicalizeWeekEntries(first), core.canonicalizeWeekEntries(second));
  assert.equal(core.digestWeekEntries(first), core.digestWeekEntries(second));
});

test('canonicalization rejects spoofed Firestore types and malformed native ranges', () => {
  for (const spoofedValue of [
    { constructor: { name: 'Timestamp' }, seconds: 1, nanoseconds: 2 },
    { constructor: { name: 'GeoPoint' }, latitude: 25.033, longitude: 121.565 },
    { constructor: { name: 'DocumentReference' }, path: 'users/admin-1' },
  ]) {
    assert.throws(() => core.canonicalizeValue(spoofedValue), /unsupported Firestore type/i);
  }

  const malformedTimestamp = new Timestamp(1, 2);
  malformedTimestamp._nanoseconds = 1_000_000_000;
  assert.throws(() => core.canonicalizeValue(malformedTimestamp), /invalid Timestamp/i);

  const malformedGeoPoint = new GeoPoint(25.033, 121.565);
  malformedGeoPoint._latitude = 91;
  assert.throws(() => core.canonicalizeValue(malformedGeoPoint), /invalid GeoPoint/i);
});

test('ordinary maps cannot collide with any tagged Firestore canonical value', () => {
  const reference = firestore.doc('users/admin-1');
  const pairs = [
    [{ __firestoreType: 'timestamp', seconds: 1, nanoseconds: 2 }, new Timestamp(1, 2)],
    [{ __firestoreType: 'geoPoint', latitude: 25.033, longitude: 121.565 }, new GeoPoint(25.033, 121.565)],
    [{ __firestoreType: 'bytes', base64: 'AAE=' }, Buffer.from([0, 1])],
    [{ __firestoreType: 'documentReference', path: 'users/admin-1' }, reference],
  ];
  for (const [plainMap, firestoreValue] of pairs) {
    assert.notDeepEqual(core.canonicalizeValue(plainMap), core.canonicalizeValue(firestoreValue));
  }
});

test('canonicalization rejects native DocumentReference paths with empty segments', () => {
  const malformedReference = firestore.doc('users/admin-1');
  malformedReference._path = { relativeName: 'users//admin-1/profile' };
  assert.throws(() => core.canonicalizeValue(malformedReference), /DocumentReference path/i);
});

test('mirror plans sort document IDs by locale-independent code units', () => {
  const plan = core.planWeekMirror({
    sourceWeeks: ['ä', 'A', 'Z', 'a'].map(id => ({ id, data: { projects: [] } })),
    destinationWeeks: [],
  });
  assert.deepEqual(plan.sourceIds, ['A', 'Z', 'a', 'ä']);
  assert.deepEqual(plan.createdIds, ['A', 'Z', 'a', 'ä']);
});

test('canonicalization rejects maps with symbol-keyed or non-enumerable properties', () => {
  const symbolKeyed = { visible: true };
  symbolKeyed[Symbol('hidden')] = 'must-not-be-ignored';
  const nonEnumerable = { visible: true };
  Object.defineProperty(nonEnumerable, 'hidden', { enumerable: false, value: 'must-not-be-ignored' });

  for (const value of [symbolKeyed, nonEnumerable]) {
    assert.throws(() => core.canonicalizeValue(value), /own-enumerable string-key map contract/i);
  }
});

test('source validation rejects unsafe values before a mirror can be planned', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  for (const data of [
    { value: undefined },
    { value: () => {} },
    { toBase64: () => 'not-a-firestore-bytes-value' },
    { value: Symbol('unsafe') },
    { value: Infinity },
    cyclic,
  ]) {
    assert.throws(() => core.validateSourceWeeks([{ id: 'W36-2026', data }]), /unsupported|finite|cyclic/i);
  }
});

test('source validation rejects invalid IDs and non-object week documents', () => {
  for (const entry of [
    { id: '', data: {} },
    { id: 'weeks/W36-2026', data: {} },
    { id: 'W36-2026', data: null },
    { id: 'W36-2026', data: [] },
  ]) {
    assert.throws(() => core.validateSourceWeeks([entry]), /identifier|object/i);
  }
});

test('source validation rejects a document over the 1,000,000-byte ceiling', () => {
  assert.throws(() => core.validateSourceWeeks([
    { id: 'W36-2026', data: { payload: 'x'.repeat(1_000_001) } },
  ]), /1,000,000-byte/i);
});

test('mirror plans expose sorted IDs and deterministic source and destination digests', () => {
  const plan = core.planWeekMirror({
    sourceWeeks: [
      { id: 'W37-2026', data: { projects: [] } },
      { id: 'W36-2026', data: { projects: [] } },
    ],
    destinationWeeks: [{ id: 'W36-2026', data: { projects: [] } }],
  });
  assert.deepEqual(plan.sourceIds, ['W36-2026', 'W37-2026']);
  assert.deepEqual(plan.destinationIds, ['W36-2026']);
  assert.equal(plan.sourceDigest, core.digestWeekEntries(plan.sourceWeeks));
  assert.equal(plan.destinationDigest, core.digestWeekEntries(plan.destinationWeeks));
});
