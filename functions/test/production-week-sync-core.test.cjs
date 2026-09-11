const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../production-week-sync-core');

class Timestamp {
  constructor(seconds, nanoseconds) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000);
  }
}

class GeoPoint {
  constructor(latitude, longitude) {
    this.latitude = latitude;
    this.longitude = longitude;
  }
}

class Bytes {
  constructor(base64) {
    this.base64 = base64;
  }

  toBase64() {
    return this.base64;
  }
}

class DocumentReference {
  constructor(path) {
    this.path = path;
    this.firestore = {};
  }
}

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
    bytes: new Bytes('AAE='),
    reference: new DocumentReference('users/admin-1'),
  });
  assert.deepEqual(canonical, {
    array: [null, 2, { a: false, b: true }],
    bytes: { __firestoreType: 'bytes', base64: 'AAE=' },
    geo: { __firestoreType: 'geoPoint', latitude: 25.033, longitude: 121.565 },
    reference: { __firestoreType: 'documentReference', path: 'users/admin-1' },
    timestamp: { __firestoreType: 'timestamp', nanoseconds: 123_000_000, seconds: 1_725_000_000 },
    z: 'last',
  });
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
