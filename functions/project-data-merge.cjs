// Port of the browser's stable-row merge; parity is covered by tests.
class ProjectMutationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProjectMutationError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function arrayEntryIdentity(value) {
  if (!isPlainObject(value)) return '';
  for (const key of ['id', 'planId']) {
    const candidate = String(value[key] ?? '').trim();
    if (candidate) return `${key}:${candidate}`;
  }
  return '';
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function ensureStableEditorRowId(source, kind, index) {
  const existing = String(source?.id || source?.planId || '').trim();
  if (existing) return existing;
  return `${kind}-legacy-${index + 1}-${stableHash(projectRevisionFingerprint(source))}`;
}

function identifyRows(rows, kind, idField = 'id') {
  if (!Array.isArray(rows)) return rows;
  return rows.map((source, index) => ({
    ...source,
    [idField]: ensureStableEditorRowId(source, kind, index),
  }));
}

function withProjectEditorRowIds(project = {}) {
  const identified = { ...project };
  const rowFields = [
    ['riskActions', 'risk-action', 'id'],
    ['riskPairs', 'risk-pair', 'id'],
    ['teamMembers', 'team', 'id'],
    ['milestones', 'milestone', 'planId'],
  ];
  for (const [field, kind, idField] of rowFields) {
    if (Array.isArray(project[field])) {
      identified[field] = identifyRows(project[field], kind, idField);
    }
  }
  if (Array.isArray(project.ganttWorkstreams)) {
    identified.ganttWorkstreams = project.ganttWorkstreams.map((source, index) => ({
      ...source,
      id: String(source?.id || '').trim() || `workstream-${index + 1}`,
    }));
  }
  if (!Array.isArray(project.riskActions) && Array.isArray(identified.riskPairs)) {
    identified.riskActions = identified.riskPairs.map(item => ({ ...item }));
  }
  if (Array.isArray(project.quarterlyMilestones)) {
    identified.quarterlyMilestones = project.quarterlyMilestones.map((source, index) => {
      const item = Array.isArray(source)
        ? { quarter: source[0], goal: source[1], window: source[2], status: source[3] }
        : source;
      return { ...item, id: ensureStableEditorRowId(item, 'qms', index) };
    });
  }
  if (isPlainObject(project.budget)) {
    identified.budget = { ...project.budget };
    if (Array.isArray(project.budget.monthlyPlans)) {
      identified.budget.monthlyPlans = identifyRows(project.budget.monthlyPlans, 'budget-plan');
    }
    if (Array.isArray(project.budget.actuals)) {
      identified.budget.actuals = identifyRows(project.budget.actuals, 'budget-actual');
    }
  }
  return identified;
}

function mergePreservingUnknown(liveValue, draftValue) {
  if (Array.isArray(draftValue)) {
    if (!Array.isArray(liveValue)) {
      return draftValue.map(item => mergePreservingUnknown(undefined, item));
    }
    const usedLiveIndexes = new Set();
    return draftValue.map((draftItem, draftIndex) => {
      const identity = arrayEntryIdentity(draftItem);
      let liveIndex = -1;
      if (identity) {
        liveIndex = liveValue.findIndex((liveItem, index) => (
          !usedLiveIndexes.has(index) && arrayEntryIdentity(liveItem) === identity
        ));
      } else if (!isPlainObject(draftItem)
        && draftIndex < liveValue.length
        && !usedLiveIndexes.has(draftIndex)) {
        liveIndex = draftIndex;
      }
      if (liveIndex >= 0) usedLiveIndexes.add(liveIndex);
      return mergePreservingUnknown(
        liveIndex >= 0 ? liveValue[liveIndex] : undefined,
        draftItem,
      );
    });
  }
  if (isPlainObject(draftValue)) {
    const liveObject = isPlainObject(liveValue) ? liveValue : {};
    const merged = { ...liveObject };
    for (const [key, value] of Object.entries(draftValue)) {
      merged[key] = mergePreservingUnknown(liveObject[key], value);
    }
    return merged;
  }
  return draftValue;
}

function canonicalValue(value) {
  if (value === undefined) return { $type: 'undefined' };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : { $type: 'number', value: String(value) };
  }
  if (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() };
  if (value instanceof Date) return { $type: 'date', value: value.toISOString() };
  if (value && typeof value.toMillis === 'function') {
    return { $type: 'timestamp', value: value.toMillis() };
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]),
    );
  }
  return { $type: typeof value, value: String(value) };
}


function projectRevisionFingerprint(project) { return JSON.stringify(canonicalValue(project)); }
module.exports = { withProjectEditorRowIds, mergePreservingUnknown };
