const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OPERATIONAL_COUNT_FIELDS,
  normalizeOperationalCount,
  normalizeRunMetadata,
  normalizeSnapshotMetadata,
} = require('../production-week-sync-metadata');

test('normalizes only allowlisted operational bigint counts without changing nested business values', () => {
  const input = {
    weekCount: 2n,
    createdCount: 1n,
    resultWeekCount: 2n,
    businessPayload: { exactInteger: 9007199254740993n },
  };

  const output = normalizeRunMetadata(input);

  assert.equal(output.weekCount, 2);
  assert.equal(output.createdCount, 1);
  assert.equal(output.resultWeekCount, 2);
  assert.equal(output.businessPayload.exactInteger, 9007199254740993n);
});

test('normalizes every allowlisted operational count at zero, safe bigint maximum, and safe number', () => {
  assert.deepEqual(OPERATIONAL_COUNT_FIELDS, [
    'weekCount', 'sourceWeekCount', 'destinationWeekCount', 'resultWeekCount',
    'restoredWeekCount', 'createdCount', 'updatedCount', 'deletedCount',
  ]);

  for (const field of OPERATIONAL_COUNT_FIELDS) {
    assert.equal(normalizeOperationalCount(0n, field), 0, `${field} accepts zero bigint`);
    assert.equal(normalizeOperationalCount(BigInt(Number.MAX_SAFE_INTEGER), field), Number.MAX_SAFE_INTEGER,
      `${field} accepts maximum safe bigint`);
    assert.equal(normalizeOperationalCount(7, field), 7, `${field} accepts safe number`);
  }
});

test('rejects invalid operational counts with their field name', () => {
  for (const field of OPERATIONAL_COUNT_FIELDS) {
    for (const value of [-1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1.5, NaN, Infinity, '1', {}]) {
      assert.throws(() => normalizeOperationalCount(value, field), {
        name: 'TypeError', message: `Invalid operational count: ${field}`,
      });
    }
  }
});

test('leaves unknown numeric-looking metadata keys unchanged', () => {
  const output = normalizeRunMetadata({
    externalCount: 3n,
    nested: { possibleCount: 4n },
    createdCount: 5n,
  });

  assert.equal(output.createdCount, 5);
  assert.equal(output.externalCount, 3n);
  assert.equal(output.nested.possibleCount, 4n);
});

test('derives snapshot identity from the immutable document ID while normalizing metadata counts', () => {
  const output = normalizeSnapshotMetadata({
    snapshotId: 'untrusted-payload-id',
    complete: true,
    weekCount: 1n,
    businessPayload: { exactInteger: 9007199254740993n },
  }, 'before-sync');

  assert.equal(output.snapshotId, 'before-sync');
  assert.equal(output.weekCount, 1);
  assert.equal(output.businessPayload.exactInteger, 9007199254740993n);
});
