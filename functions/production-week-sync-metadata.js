const OPERATIONAL_COUNT_FIELDS = Object.freeze([
  'weekCount', 'sourceWeekCount', 'destinationWeekCount', 'resultWeekCount',
  'restoredWeekCount', 'createdCount', 'updatedCount', 'deletedCount',
]);

function normalizeOperationalCount(value, field) {
  const normalized = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`Invalid operational count: ${field}`);
  }
  return normalized;
}

function normalizeRunMetadata(data) {
  const normalized = { ...data };
  for (const field of OPERATIONAL_COUNT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      normalized[field] = normalizeOperationalCount(data[field], field);
    }
  }
  return normalized;
}

function normalizeSnapshotMetadata(data, snapshotId) {
  return { ...normalizeRunMetadata(data), snapshotId };
}

module.exports = {
  OPERATIONAL_COUNT_FIELDS,
  normalizeOperationalCount,
  normalizeRunMetadata,
  normalizeSnapshotMetadata,
};
