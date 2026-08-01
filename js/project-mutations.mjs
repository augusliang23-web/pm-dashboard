export class ProjectMutationError extends Error {
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

export function ensureStableEditorRowId(source, kind, index) {
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

export function withProjectEditorRowIds(project = {}) {
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

export function mergePreservingUnknown(liveValue, draftValue) {
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

const SECTION_METADATA_PATHS = {
  status: ['projectLevel', 'lifecycle', 'status', 'progress', 'attention', 'attentionManual'],
  highlights: ['highlight'],
  weeklyActions: ['weeklyActions'],
  riskActions: ['riskActions', 'risk', 'next'],
  milestones: ['milestones', 'quarterlyMilestones'],
  schedule: ['ganttWorkstreams'],
  teamAllocation: ['teamMembers', 'dataStatus.team'],
  budgetPlan: ['budget.mode', 'budget.currency', 'budget.totalEstimated', 'budget.monthlyPlans', 'dataStatus.budgetPlan'],
  actualSpend: ['budget.actuals', 'dataStatus.budgetActual'],
  disciplineHours: ['resources'],
};

function valueAtPath(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function sectionValues(project, paths) {
  return paths.map(path => canonicalValue(valueAtPath(project, path)));
}

function sectionChanged(before, after, paths) {
  return JSON.stringify(sectionValues(before, paths)) !== JSON.stringify(sectionValues(after, paths));
}

function updateSectionMetadata(before, after, { editorName, savedAt } = {}) {
  const name = String(editorName || '').trim();
  const timestamp = String(savedAt || '').trim();
  if (!name || !timestamp) return before?.sectionUpdatedAt;
  const metadata = { ...(before?.sectionUpdatedAt || {}) };
  for (const [section, paths] of Object.entries(SECTION_METADATA_PATHS)) {
    if (sectionChanged(before, after, paths)) {
      metadata[section] = { savedAt: timestamp, editorName: name };
    }
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

export function projectRevisionFingerprint(project) {
  return JSON.stringify(canonicalValue(project));
}

function assertRevisionUnchanged(project, options) {
  if (options.expectedFingerprint === undefined) return;
  const fingerprintProject = typeof options.fingerprintProject === 'function'
    ? options.fingerprintProject
    : projectRevisionFingerprint;
  if (fingerprintProject(project) !== options.expectedFingerprint) {
    throw new ProjectMutationError(
      'revision-conflict',
      'This project changed since the editor was opened. Close and reopen the editor before trying again.',
    );
  }
}

function liveProjects(week) {
  if (!week || typeof week !== 'object' || !Array.isArray(week.projects)) {
    throw new ProjectMutationError(
      'invalid-week',
      'The selected week has invalid project data. Refresh the dashboard and try again.',
    );
  }
  return week.projects;
}

function trimmedIdentity(draft) {
  const name = String(draft?.name ?? '').trim();
  const code = String(draft?.code ?? '').trim();
  if (!name) {
    throw new ProjectMutationError('blank-name', 'Project name is required.');
  }
  if (!code) {
    throw new ProjectMutationError('blank-code', 'Project code is required.');
  }
  return { name, code };
}

function assertUniqueCode(projects, code, excludedIndex = -1) {
  const normalizedCode = code.toLocaleLowerCase();
  const duplicate = projects.some((project, index) => (
    index !== excludedIndex
    && String(project?.code ?? '').trim().toLocaleLowerCase() === normalizedCode
  ));
  if (duplicate) {
    throw new ProjectMutationError(
      'duplicate-code',
      `A project with code "${code}" already exists. Choose a unique code.`,
    );
  }
}

const ATTENTION_VALUES = new Set(['action', 'strategy', 'monitor', 'watch']);

export function applyProjectAttentionUpdate(week, options = {}) {
  const projects = liveProjects(week);
  const { projectCode, attention, role, canEdit, lastModifiedBy } = options;
  if (week.isReleased === true) {
    throw new ProjectMutationError(
      'released-week',
      'This reporting week has been released and can no longer be changed.',
    );
  }
  if (!ATTENTION_VALUES.has(attention)) {
    throw new ProjectMutationError('invalid-attention', 'Select a valid attention category.');
  }
  const targetIndex = projects.findIndex(project => project?.code === projectCode);
  if (targetIndex < 0) {
    throw new ProjectMutationError('missing-target', 'This project no longer exists.');
  }
  const targetProject = projects[targetIndex];
  const authorized = role === 'admin'
    || (role === 'pm' && typeof canEdit === 'function' && canEdit(targetProject));
  if (!authorized) {
    throw new ProjectMutationError(
      'edit-forbidden',
      'You no longer have permission to edit this project.',
    );
  }
  const project = { ...targetProject, attention, attentionManual: true };
  const nextProjects = [...projects];
  nextProjects[targetIndex] = project;
  return {
    project,
    week: {
      ...week,
      projects: nextProjects,
      lastModifiedBy,
    },
  };
}

export function applyProjectSave(week, options = {}) {
  const projects = liveProjects(week);
  const {
    draft,
    originalCode,
    isNew,
    role,
    canEdit,
    lastModifiedBy,
    editorName,
    savedAt,
  } = options;

  if (isNew) {
    if (role !== 'admin') {
      throw new ProjectMutationError(
        'create-forbidden',
        'Only administrators can create projects. Refresh to update your permissions.',
      );
    }
    const identity = trimmedIdentity(draft);
    assertUniqueCode(projects, identity.code);
    const draftProject = { ...draft, ...identity };
    const sectionUpdatedAt = updateSectionMetadata({}, draftProject, { editorName, savedAt });
    const project = sectionUpdatedAt ? { ...draftProject, sectionUpdatedAt } : draftProject;
    return {
      project,
      week: {
        ...week,
        projects: [...projects, project],
        lastModifiedBy,
      },
    };
  }

  const targetIndex = projects.findIndex(project => project?.code === originalCode);
  if (targetIndex < 0) {
    throw new ProjectMutationError(
      'missing-target',
      'This project no longer exists in the selected week. Close and reopen the editor.',
    );
  }
  const targetProject = projects[targetIndex];
  const authorized = role === 'admin'
    || (role === 'pm' && typeof canEdit === 'function' && canEdit(targetProject));
  if (!authorized) {
    throw new ProjectMutationError(
      'edit-forbidden',
      'Your permission to edit this project changed. Refresh the dashboard and try again.',
    );
  }
  assertRevisionUnchanged(targetProject, options);
  const identity = trimmedIdentity(draft);
  assertUniqueCode(projects, identity.code, targetIndex);

  const baselineProject = withProjectEditorRowIds(targetProject);
  const savedProject = {
    ...mergePreservingUnknown(baselineProject, draft),
    ...identity,
  };
  const sectionUpdatedAt = updateSectionMetadata(baselineProject, savedProject, { editorName, savedAt });
  const project = sectionUpdatedAt ? { ...savedProject, sectionUpdatedAt } : savedProject;
  const nextProjects = [...projects];
  nextProjects[targetIndex] = project;
  return {
    project,
    week: {
      ...week,
      projects: nextProjects,
      lastModifiedBy,
    },
  };
}

export function applyProjectDelete(week, options = {}) {
  const projects = liveProjects(week);
  const { originalCode, role, lastModifiedBy } = options;
  if (role !== 'admin') {
    throw new ProjectMutationError(
      'delete-forbidden',
      'Only administrators can delete projects. Refresh to update your permissions.',
    );
  }

  const targetIndex = projects.findIndex(project => project?.code === originalCode);
  if (targetIndex < 0) {
    throw new ProjectMutationError(
      'missing-target',
      'This project no longer exists in the selected week. Close and reopen the editor.',
    );
  }
  const deletedProject = projects[targetIndex];
  assertRevisionUnchanged(deletedProject, options);
  return {
    deletedProject,
    week: {
      ...week,
      projects: projects.filter((_, index) => index !== targetIndex),
      lastModifiedBy,
    },
  };
}
