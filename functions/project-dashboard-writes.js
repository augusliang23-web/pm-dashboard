const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { liveTimelineRef, normalizeLiveTimelineState, snapshotFromLiveTimeline } = require('./executive-live-timeline');
const { copyPreviousWeekCarryover } = require('./week-carryover');

const KNOWN_ROLES = new Set([
  'admin', 'pm', 'vip', 'executive', 'engineering', 'business', 'sales', 'bd', 'product',
]);
const PROJECT_INPUT_KEYS = [
  'projectLevel', 'lifecycle', 'ganttWorkstreams', 'resources', 'name', 'code', 'owner', 'deputy',
  'customer', 'location', 'visibility', 'milestones', 'quarterlyMilestones', 'status', 'progress',
  'attention', 'attentionManual', 'highlight', 'weeklyActions', 'riskActions', 'riskPairs', 'risk',
  'next', 'riskList', 'riskManual', 'teamMembers', 'budget', 'dataStatus',
];
const SAVE_PROJECT_KEYS = ['weekId', 'originalCode', 'projectCode', 'project', 'isNew', 'expectedRevision'];
const ATTENTION_VALUES = new Set(['action', 'monitor', 'strategy', 'watch']);
const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 256 * 1024,
  maxDepth: 8,
  maxArrayEntries: 2000,
  maxObjectKeys: 2000,
  maxStringLength: 20000,
});
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const LEGACY_DISPLAY_NAME_BY_EMAIL_PREFIX = Object.freeze({
  'augus.liang': 'Augus',
  'josiah.winkler': 'Josiah',
  'qianyun.zhu': 'Bonnie',
  'huichong.kong': 'Huichong',
});

function database() {
  return getFirestore();
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveActorDisplayName(email, storedDisplayName) {
  const explicitName = String(storedDisplayName || '').trim();
  if (explicitName) return explicitName;
  const emailPrefix = normalized(email).split('@')[0];
  if (LEGACY_DISPLAY_NAME_BY_EMAIL_PREFIX[emailPrefix]) {
    return LEGACY_DISPLAY_NAME_BY_EMAIL_PREFIX[emailPrefix];
  }
  return emailPrefix;
}

function securityError(code, reason, message) {
  return new HttpsError(code, message, { reason });
}

function assertActor(actor) {
  if (!actor?.uid || !normalized(actor.email)) {
    throw securityError('unauthenticated', 'unauthenticated', 'Sign in before changing the dashboard.');
  }
  if (!KNOWN_ROLES.has(normalized(actor.role))) {
    throw securityError('permission-denied', 'role-forbidden', 'This account has no supported dashboard role.');
  }
  if (!String(actor.displayName || '').trim()) {
    throw securityError('permission-denied', 'role-forbidden', 'Dashboard display name is missing.');
  }
}

function buildAuthenticatedActor(authIdentity = {}, userData = {}) {
  const actor = {
    uid: String(authIdentity.uid || '').trim(),
    email: normalized(authIdentity.email),
    role: normalized(userData.role),
    displayName: resolveActorDisplayName(authIdentity.email, userData.displayName),
  };
  assertActor(actor);
  return actor;
}

function identityTokens(actor = {}) {
  const email = normalized(actor.email);
  const displayName = normalized(actor.displayName);
  if (!email) return new Set();
  return new Set([displayName, email, email.split('@')[0]].filter(Boolean));
}

function ownershipTokens(value) {
  return String(value || '')
    .split(/[,;|/\r\n]+/)
    .map(normalized)
    .filter(Boolean);
}

function ownerOrDeputyMatches(project = {}, actor = {}) {
  const identity = identityTokens(actor);
  if (!identity.size) return false;
  return [project.owner, project.deputy]
    .flatMap(ownershipTokens)
    .some(value => identity.has(value));
}

function canMutateProject({ actor, project }) {
  if (normalized(actor?.role) === 'admin') return true;
  return normalized(actor?.role) === 'pm' && ownerOrDeputyMatches(project, actor);
}

function assertDraftWeek(week) {
  if (week?.isReleased === true) {
    throw securityError('failed-precondition', 'released-week', 'Released reporting weeks cannot be changed.');
  }
}

function canSetWeekRelease(role) {
  return ['admin', 'pm'].includes(normalized(role));
}

function canDeleteProject(role) {
  return normalized(role) === 'admin';
}

function canCreateProject(role) {
  return normalized(role) === 'admin';
}

function canManageWeekFields(role) {
  return normalized(role) === 'admin';
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertAllowedKeys(value, allowedKeys, label = 'value') {
  if (!isPlainObject(value)) {
    throw securityError('invalid-argument', 'invalid-payload', `${label} must be a plain object.`);
  }
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter(key => !allowed.has(key));
  if (unexpected.length) {
    throw securityError('invalid-argument', 'invalid-payload', `${label} contains unsupported fields: ${unexpected.join(', ')}.`);
  }
}

function assertBoundedJson(value, overrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  let arrayEntries = 0;
  let objectKeys = 0;

  function walk(current, depth) {
    if (depth > limits.maxDepth) {
      throw securityError('invalid-argument', 'invalid-payload', 'Payload nesting is too deep.');
    }
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      if (current.length > limits.maxStringLength) {
        throw securityError('invalid-argument', 'invalid-payload', 'Payload contains an oversized string.');
      }
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw securityError('invalid-argument', 'invalid-payload', 'Payload contains a non-finite number.');
      }
      return;
    }
    if (Array.isArray(current)) {
      arrayEntries += current.length;
      if (arrayEntries > limits.maxArrayEntries) {
        throw securityError('invalid-argument', 'invalid-payload', 'Payload contains too many array entries.');
      }
      current.forEach(item => walk(item, depth + 1));
      return;
    }
    if (!isPlainObject(current)) {
      throw securityError('invalid-argument', 'invalid-payload', 'Payload contains a non-JSON object.');
    }
    const keys = Object.keys(current);
    if (keys.some(key => DANGEROUS_KEYS.has(key))) {
      throw securityError('invalid-argument', 'invalid-payload', 'Payload contains an unsafe object key.');
    }
    objectKeys += keys.length;
    if (objectKeys > limits.maxObjectKeys) {
      throw securityError('invalid-argument', 'invalid-payload', 'Payload contains too many object keys.');
    }
    keys.forEach(key => walk(current[key], depth + 1));
  }

  walk(value, 0);
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw securityError('invalid-argument', 'invalid-payload', 'Payload is not JSON serializable.');
  }
  if (Buffer.byteLength(serialized, 'utf8') > limits.maxBytes) {
    throw securityError('invalid-argument', 'invalid-payload', 'Payload is too large.');
  }
}

function requireId(value, label) {
  const result = String(value || '').trim();
  if (!result || result.length > 128 || result.includes('/')) {
    throw securityError('invalid-argument', 'invalid-payload', `${label} must be a valid identifier.`);
  }
  return result;
}

function requireWeekId(data) {
  return requireId(data?.weekId, 'Week identifier');
}

function nextWeekVersion(week = {}) {
  const current = Number(week.version);
  return Number.isFinite(current) && current >= 0 ? current + 1 : 1;
}

function requestedProjectCode(data, fallback = '') {
  return requireId(data?.projectCode || data?.project?.code || fallback, 'Project code');
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
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  }
  return { $type: typeof value, value: String(value) };
}

function projectRevisionFingerprint(project) {
  return JSON.stringify(canonicalValue(project));
}

const SECTION_METADATA_PATHS = {
  status: ['projectLevel', 'lifecycle', 'status', 'progress', 'attention', 'attentionManual'],
  highlights: ['highlight'], weeklyActions: ['weeklyActions'],
  riskActions: ['riskActions', 'risk', 'next', 'riskList', 'riskManual'],
  milestones: ['milestones', 'quarterlyMilestones'], schedule: ['ganttWorkstreams'],
  teamAllocation: ['teamMembers', 'dataStatus.team'],
  budgetPlan: ['budget.mode', 'budget.currency', 'budget.totalEstimated', 'budget.monthlyPlans', 'dataStatus.budgetPlan'],
  actualSpend: ['budget.actuals', 'dataStatus.budgetActual'], disciplineHours: ['resources'],
};

function valueAtPath(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function updateProjectSectionMetadata(before = {}, after = {}, { editorName, savedAt } = {}) {
  if (!String(editorName || '').trim() || !String(savedAt || '').trim()) return before.sectionUpdatedAt;
  const metadata = { ...(before.sectionUpdatedAt || {}) };
  for (const [section, paths] of Object.entries(SECTION_METADATA_PATHS)) {
    const changed = paths.some(path => JSON.stringify(valueAtPath(before, path)) !== JSON.stringify(valueAtPath(after, path)));
    if (changed) metadata[section] = { savedAt, editorName };
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function validateProjectDraft(project) {
  assertBoundedJson(project);
  assertAllowedKeys(project, PROJECT_INPUT_KEYS, 'Project');
  return { ...project };
}

function assertProjectRevision(liveProject, expectedRevision) {
  if (typeof expectedRevision !== 'string' || projectRevisionFingerprint(liveProject) !== expectedRevision) {
    throw securityError('failed-precondition', 'conflict', 'This project changed since the editor was opened. Reopen it and try again.');
  }
}

function buildProjectPatch(week, data, actor, nowIso) {
  assertActor(actor);
  assertBoundedJson(data);
  assertAllowedKeys(data, SAVE_PROJECT_KEYS, 'Project save request');
  assertDraftWeek(week);
  const projects = Array.isArray(week?.projects) ? week.projects : [];
  const code = requestedProjectCode(data);
  const draft = validateProjectDraft(data.project);
  let committedProject;
  let targetIndex = -1;

  if (data.isNew === true) {
    if (!canCreateProject(actor.role)) {
      throw securityError('permission-denied', 'role-forbidden', 'Only administrators can create projects.');
    }
    if (projects.some(project => String(project?.code || '').trim() === code)) {
      throw securityError('already-exists', 'conflict', 'A project with this code already exists in the reporting week.');
    }
    committedProject = { ...draft, code };
  } else {
    const originalCode = requireId(data.originalCode || code, 'Original project code');
    targetIndex = projects.findIndex(project => String(project?.code || '').trim() === originalCode);
    if (targetIndex < 0) {
      throw securityError('not-found', 'not-found', 'The project no longer exists.');
    }
    const liveProject = projects[targetIndex];
    if (!canMutateProject({ actor, project: liveProject })) {
      throw securityError('permission-denied', 'ownership-forbidden', 'You do not have permission to edit this project.');
    }
    assertProjectRevision(liveProject, data.expectedRevision);
    committedProject = { ...liveProject, ...draft, code };
  }

  const sectionUpdatedAt = updateProjectSectionMetadata(
    targetIndex >= 0 ? projects[targetIndex] : {}, committedProject,
    { editorName: actor.displayName, savedAt: nowIso },
  );
  if (sectionUpdatedAt) committedProject = { ...committedProject, sectionUpdatedAt };
  if (projects.some((project, index) => index !== targetIndex && String(project?.code || '').trim() === code)) {
    throw securityError('already-exists', 'conflict', 'A project with this code already exists in the reporting week.');
  }

  const nextProjects = [...projects];
  if (targetIndex >= 0) nextProjects[targetIndex] = committedProject;
  else nextProjects.push(committedProject);
  return {
    patch: { projects: nextProjects, lastModifiedBy: actor.email, version: nextWeekVersion(week) },
    committedProject,
    revision: projectRevisionFingerprint(committedProject),
  };
}

function buildWeekFieldsPatch(week, data, actor) {
  assertActor(actor);
  if (!canManageWeekFields(actor.role)) {
    throw securityError('permission-denied', 'role-forbidden', 'Only administrators can update week management fields.');
  }
  assertBoundedJson(data);
  assertAllowedKeys(data, ['weekId', 'fields'], 'Week field request');
  assertDraftWeek(week);
  assertAllowedKeys(data.fields, ['summary', 'strategyLayer'], 'Week fields');
  const keys = Object.keys(data.fields);
  if (!keys.length) {
    throw securityError('invalid-argument', 'invalid-payload', 'At least one week field is required.');
  }
  return {
    ...Object.fromEntries(keys.map(key => [key, data.fields[key]])),
    lastModifiedBy: actor.email,
    version: nextWeekVersion(week),
  };
}

function buildCreatedWeek(data, actor, sourceWeek) {
  assertActor(actor);
  if (!canManageWeekFields(actor.role)) {
    throw securityError('permission-denied', 'role-forbidden', 'Only administrators can create reporting weeks.');
  }
  assertBoundedJson(data);
  assertAllowedKeys(data, ['weekId', 'weekLabel', 'weekDate', 'sourceWeekId'], 'Week creation request');
  requireWeekId(data);
  const weekLabel = String(data.weekLabel || '').trim();
  const weekDate = String(data.weekDate || '').trim();
  if (!weekLabel || weekLabel.length > 128 || weekDate.length > 128) {
    throw securityError('invalid-argument', 'invalid-payload', 'Week label or date is invalid.');
  }
  if (data.sourceWeekId) requireId(data.sourceWeekId, 'Source week identifier');
  if (data.sourceWeekId && !sourceWeek) {
    throw securityError('not-found', 'not-found', 'The source reporting week no longer exists.');
  }
  const carryover = sourceWeek ? copyPreviousWeekCarryover(sourceWeek) : { projects: [] };
  return {
    weekLabel, weekDate, summary: '', ...carryover,
    isReleased: false, lastModifiedBy: actor.email, version: 0,
  };
}

function normalizeGanttTemplateNames(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw securityError('invalid-argument', 'invalid-payload', `${label} must contain between 1 and 20 workstreams.`);
  }
  const names = value.map(item => String(item || '').trim());
  if (names.some(name => !name || name.length > 120)) {
    throw securityError('invalid-argument', 'invalid-payload', `${label} contains an invalid workstream name.`);
  }
  const unique = new Set(names.map(normalized));
  if (unique.size !== names.length) {
    throw securityError('invalid-argument', 'invalid-payload', `${label} contains duplicate workstream names.`);
  }
  return names;
}

function buildGanttTemplateSettingsPatch(liveSettings, data, actor) {
  assertActor(actor);
  if (normalized(actor.role) !== 'admin') {
    throw securityError('permission-denied', 'role-forbidden', 'Only administrators can update default Gantt templates.');
  }
  assertBoundedJson(data);
  assertAllowedKeys(data, ['expectedRevision', 'config'], 'Gantt template request');
  assertAllowedKeys(data.config, ['system', 'hardware-module'], 'Gantt template config');
  const liveRevision = Number.isSafeInteger(liveSettings?.revision) && liveSettings.revision >= 0
    ? liveSettings.revision
    : 0;
  if (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0 || data.expectedRevision !== liveRevision) {
    throw securityError('failed-precondition', 'conflict', 'These defaults changed in another Admin session. Reload the dashboard to review the latest version.');
  }
  return {
    system: normalizeGanttTemplateNames(data.config.system, 'System template'),
    'hardware-module': normalizeGanttTemplateNames(data.config['hardware-module'], 'Hardware Module template'),
    revision: liveRevision + 1,
    updatedBy: actor.email,
  };
}

async function authenticatedActor(transaction, request) {
  const uid = String(request.auth?.uid || '').trim();
  const email = normalized(request.auth?.token?.email);
  if (!uid || !email) {
    throw securityError('unauthenticated', 'unauthenticated', 'Sign in before changing the dashboard.');
  }
  const snapshot = await transaction.get(database().collection('users').doc(email));
  if (!snapshot.exists) {
    throw securityError('permission-denied', 'role-forbidden', 'Dashboard identity is missing.');
  }
  return buildAuthenticatedActor({ uid, email }, snapshot.data());
}

const saveDashboardProject = onCall(async request => database().runTransaction(async transaction => {
  const actor = await authenticatedActor(transaction, request);
  const weekRef = database().collection('weeks').doc(requireWeekId(request.data));
  const weekSnapshot = await transaction.get(weekRef);
  if (!weekSnapshot.exists) throw securityError('not-found', 'not-found', 'The reporting week no longer exists.');
  const nowIso = new Date().toISOString();
  const result = buildProjectPatch(weekSnapshot.data(), request.data, actor, nowIso);
  transaction.update(weekRef, result.patch);
  return {
    week: { ...weekSnapshot.data(), ...result.patch }, project: result.committedProject,
    revision: result.revision, committedAt: nowIso,
  };
}));

const deleteDashboardProject = onCall(async request => database().runTransaction(async transaction => {
  const actor = await authenticatedActor(transaction, request);
  assertBoundedJson(request.data);
  assertAllowedKeys(request.data, ['weekId', 'originalCode'], 'Project delete request');
  if (!canDeleteProject(actor.role)) {
    throw securityError('permission-denied', 'role-forbidden', 'Only administrators can delete projects.');
  }
  const weekRef = database().collection('weeks').doc(requireWeekId(request.data));
  const weekSnapshot = await transaction.get(weekRef);
  if (!weekSnapshot.exists) throw securityError('not-found', 'not-found', 'The reporting week no longer exists.');
  const week = weekSnapshot.data();
  assertDraftWeek(week);
  const code = requireId(request.data.originalCode, 'Original project code');
  const projects = Array.isArray(week.projects) ? week.projects : [];
  if (!projects.some(project => String(project?.code || '').trim() === code)) {
    throw securityError('not-found', 'not-found', 'The project no longer exists.');
  }
  const patch = {
    projects: projects.filter(project => String(project?.code || '').trim() !== code),
    lastModifiedBy: actor.email, version: nextWeekVersion(week),
  };
  transaction.update(weekRef, patch);
  return { week: { ...week, ...patch } };
}));

const setDashboardProjectAttention = onCall(async request => database().runTransaction(async transaction => {
  const actor = await authenticatedActor(transaction, request);
  assertBoundedJson(request.data);
  assertAllowedKeys(request.data, ['weekId', 'projectCode', 'attention'], 'Project attention request');
  const weekRef = database().collection('weeks').doc(requireWeekId(request.data));
  const weekSnapshot = await transaction.get(weekRef);
  if (!weekSnapshot.exists) throw securityError('not-found', 'not-found', 'The reporting week no longer exists.');
  const week = weekSnapshot.data();
  assertDraftWeek(week);
  const code = requireId(request.data.projectCode, 'Project code');
  const projects = Array.isArray(week.projects) ? week.projects : [];
  const index = projects.findIndex(project => String(project?.code || '').trim() === code);
  if (index < 0) throw securityError('not-found', 'not-found', 'The project no longer exists.');
  if (!canMutateProject({ actor, project: projects[index] })) {
    throw securityError('permission-denied', 'ownership-forbidden', 'You do not have permission to edit this project.');
  }
  if (!ATTENTION_VALUES.has(request.data.attention)) {
    throw securityError('invalid-argument', 'invalid-payload', 'Select a valid attention category.');
  }
  const nowIso = new Date().toISOString();
  const committedProject = { ...projects[index], attention: request.data.attention, attentionManual: true };
  const sectionUpdatedAt = updateProjectSectionMetadata(projects[index], committedProject, {
    editorName: actor.displayName, savedAt: nowIso,
  });
  if (sectionUpdatedAt) committedProject.sectionUpdatedAt = sectionUpdatedAt;
  const nextProjects = [...projects];
  nextProjects[index] = committedProject;
  const patch = { projects: nextProjects, lastModifiedBy: actor.email, version: nextWeekVersion(week) };
  transaction.update(weekRef, patch);
  return {
    week: { ...week, ...patch }, project: committedProject,
    revision: projectRevisionFingerprint(committedProject), committedAt: nowIso,
  };
}));

const setDashboardWeekRelease = onCall(async request => database().runTransaction(async transaction => {
  const actor = await authenticatedActor(transaction, request);
  assertBoundedJson(request.data);
  assertAllowedKeys(request.data, ['weekId', 'isReleased'], 'Week release request');
  if (!canSetWeekRelease(actor.role)) {
    throw securityError('permission-denied', 'role-forbidden', 'Only PMs and administrators can change release status.');
  }
  if (typeof request.data.isReleased !== 'boolean') {
    throw securityError('invalid-argument', 'invalid-payload', 'Release state must be true or false.');
  }
  const weekRef = database().collection('weeks').doc(requireWeekId(request.data));
  const weekSnapshot = await transaction.get(weekRef);
  if (!weekSnapshot.exists) throw securityError('not-found', 'not-found', 'The reporting week no longer exists.');
  const isReleasing = request.data.isReleased;
  const patch = { isReleased: isReleasing, lastModifiedBy: actor.email, version: nextWeekVersion(weekSnapshot.data()) };
  if (isReleasing) {
    const liveRef = liveTimelineRef(database());
    const liveSnapshot = await transaction.get(liveRef);
    const state = normalizeLiveTimelineState(liveSnapshot.exists ? liveSnapshot.data() : null);
    if (!state.timeline) {
      throw securityError('failed-precondition', 'invalid-payload', 'Executive milestones have not been initialized. Initialize the live roadmap before releasing this week.');
    }
    patch['strategyLayer.executiveMilestoneTimelineSnapshot'] = snapshotFromLiveTimeline(state, actor.email, new Date().toISOString());
  }
  transaction.update(weekRef, patch);
  return { week: { ...weekSnapshot.data(), ...patch } };
}));

const saveDashboardWeekFields = onCall(async request => database().runTransaction(async transaction => {
  const actor = await authenticatedActor(transaction, request);
  const weekRef = database().collection('weeks').doc(requireWeekId(request.data));
  const weekSnapshot = await transaction.get(weekRef);
  if (!weekSnapshot.exists) throw securityError('not-found', 'not-found', 'The reporting week no longer exists.');
  const patch = buildWeekFieldsPatch(weekSnapshot.data(), request.data, actor);
  transaction.update(weekRef, patch);
  return { week: { ...weekSnapshot.data(), ...patch } };
}));

const createDashboardWeek = onCall(async request => database().runTransaction(async transaction => {
  const actor = await authenticatedActor(transaction, request);
  assertBoundedJson(request.data);
  assertAllowedKeys(request.data, ['weekId', 'weekLabel', 'weekDate', 'sourceWeekId'], 'Week creation request');
  const weekId = requireWeekId(request.data);
  const weekRef = database().collection('weeks').doc(weekId);
  const existing = await transaction.get(weekRef);
  if (existing.exists) throw securityError('already-exists', 'conflict', 'This reporting week already exists.');
  let sourceWeek;
  if (request.data.sourceWeekId) {
    const sourceRef = database().collection('weeks').doc(requireId(request.data.sourceWeekId, 'Source week identifier'));
    const sourceSnapshot = await transaction.get(sourceRef);
    if (!sourceSnapshot.exists) throw securityError('not-found', 'not-found', 'The source reporting week no longer exists.');
    sourceWeek = sourceSnapshot.data();
  }
  const week = buildCreatedWeek(request.data, actor, sourceWeek);
  transaction.create(weekRef, week);
  return { week: { ...week, __documentId: weekId } };
}));

const saveDashboardGanttTemplateSettings = onCall(async request => database().runTransaction(async transaction => {
  const actor = await authenticatedActor(transaction, request);
  const settingsRef = database().collection('dashboardSettings').doc('team-2-portfolio');
  const snapshot = await transaction.get(settingsRef);
  const patch = buildGanttTemplateSettingsPatch(snapshot.exists ? snapshot.data() : {}, request.data, actor);
  transaction.set(settingsRef, { ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { config: { system: patch.system, 'hardware-module': patch['hardware-module'] }, revision: patch.revision };
}));

module.exports = {
  assertAllowedKeys, assertBoundedJson, assertDraftWeek, buildCreatedWeek, buildProjectPatch,
  buildAuthenticatedActor,
  buildGanttTemplateSettingsPatch, buildWeekFieldsPatch, canMutateProject, canSetWeekRelease, canDeleteProject, canCreateProject,
  canManageWeekFields, identityTokens, ownerOrDeputyMatches, ownershipTokens,
  projectRevisionFingerprint, updateProjectSectionMetadata, saveDashboardProject,
  deleteDashboardProject, setDashboardProjectAttention, setDashboardWeekRelease,
  saveDashboardWeekFields, createDashboardWeek, saveDashboardGanttTemplateSettings,
};
