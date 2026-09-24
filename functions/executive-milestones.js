'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const {
  applyApprovedRequest,
  applyDirectStructureChange,
  applyItemUpdate,
  canonicalSectionId,
  createChangeRequest,
  normalizeRole,
} = require('./executive-milestone-core');
const { defaultTimelineConfig, normalizeTimelineConfig } = require('./executive-timeline-config');
const {
  liveTimelineAsWeek,
  liveTimelineFromWeek,
  liveTimelineRef,
  nextLiveTimelineState,
  normalizeLiveTimelineState,
} = require('./executive-live-timeline');

const db = getFirestore();
const CALLABLE_OPTIONS = { region: 'us-central1', cors: true };
const RAGS = new Set(['green', 'yellow', 'red']);

function requireEmail(request) {
  if (!request.auth || !request.auth.token?.email) {
    throw new HttpsError('unauthenticated', 'A signed-in email account is required.');
  }
  const email = String(request.auth.token.email).trim().toLowerCase();
  return email;
}

async function getActor(transaction, request) {
  const email = requireEmail(request);
  const userRef = db.collection('users').doc(email);
  const userSnapshot = await transaction.get(userRef);
  if (!userSnapshot.exists || userSnapshot.data().active === false) {
    throw new HttpsError('permission-denied', 'The dashboard account is not active.');
  }
  const role = normalizeRole(userSnapshot.data().role);
  if (!role) throw new HttpsError('permission-denied', 'The dashboard role is not authorized.');
  return { email, role, uid: request.auth.uid, userRef };
}

function requireSourceWeekId(data) {
  const weekId = String(data?.sourceWeekId || '').trim();
  if (!weekId || weekId.includes('/')) throw new HttpsError('invalid-argument', 'A valid sourceWeekId is required.');
  return weekId;
}

function executiveTimelineConfigRef() {
  return db.collection('executiveMilestoneConfig').doc('timeline');
}

async function readExecutiveTimelineConfig(transaction) {
  const snapshot = await transaction.get(executiveTimelineConfigRef());
  return normalizeTimelineConfig(snapshot.exists ? snapshot.data() : defaultTimelineConfig());
}

function configuredLabel(config, collection, id) {
  const key = collection === 'sections' ? 'sectionId' : 'quarterId';
  return config[collection].find(item => item[key] === String(id || ''))?.label || String(id || '');
}

function withConfigMetadata(record, config) {
  return {
    ...record,
    configVersion: config.version,
    sourceSectionLabel: configuredLabel(config, 'sections', record.sourceSectionId || record.sectionId || record.before?.sectionId),
    sourceQuarterLabel: configuredLabel(config, 'quarters', record.before?.quarterKey || record.quarterKey),
    targetSectionLabel: configuredLabel(config, 'sections', record.targetSectionId || record.after?.sectionId || record.sectionId),
    targetQuarterLabel: configuredLabel(config, 'quarters', record.after?.quarterKey || record.quarterKey),
  };
}

async function readLiveTimeline(transaction) {
  const liveRef = liveTimelineRef(db);
  const snapshot = await transaction.get(liveRef);
  const state = normalizeLiveTimelineState(snapshot.exists ? snapshot.data() : null);
  if (!state.timeline) {
    throw new HttpsError('failed-precondition', 'Executive milestones have not been initialized. Ask an administrator to initialize the live roadmap.');
  }
  return { liveRef, state };
}

function saveLiveTimeline(transaction, liveRef, state, timeline, actorEmail, now) {
  const nextState = nextLiveTimelineState(state, timeline, actorEmail, now);
  transaction.set(liveRef, nextState, { merge: true });
  return nextState;
}

function asHttpsError(error) {
  if (error instanceof HttpsError) return error;
  const codes = new Set([
    'invalid-argument', 'not-found', 'already-exists', 'permission-denied',
    'failed-precondition', 'aborted', 'unauthenticated',
  ]);
  return new HttpsError(codes.has(error?.code) ? error.code : 'internal', error?.message || 'Executive milestone operation failed.');
}

function worstRag(items) {
  const severity = { green: 0, yellow: 1, red: 2 };
  const rags = items
    .map(item => String(item?.rag || '').toLowerCase())
    .filter(rag => Object.hasOwn(severity, rag));
  if (!rags.length) return null;
  return rags.reduce((worst, rag) => severity[rag] > severity[worst] ? rag : worst, rags[0]);
}

function calculateOverrideTarget(timeline, scope, targetId, config = defaultTimelineConfig()) {
  const rows = Array.isArray(timeline?.rows) ? timeline.rows : [];
  if (scope === 'section') {
    if (!config.sections.some(section => section.sectionId === targetId)) throw new HttpsError('not-found', 'Executive section was not found.');
    const row = rows.find(candidate => canonicalSectionId(candidate?.sectionId) === canonicalSectionId(targetId));
    if (!row) throw new HttpsError('not-found', 'Executive section was not found.');
    const cells = Array.isArray(row.cells)
      ? row.cells
      : config.quarters.map(quarter => row.cells?.[quarter.quarterId] || []);
    return worstRag(cells.flat());
  }
  const quarterIndex = config.quarters.findIndex(quarter => quarter.quarterId === targetId);
  if (scope === 'quarter' && quarterIndex >= 0) {
    return worstRag(rows.flatMap(row => Array.isArray(row.cells) ? row.cells[quarterIndex] || [] : row.cells?.[targetId] || []));
  }
  throw new HttpsError('invalid-argument', 'A valid RAG override target is required.');
}

function sameIds(left, right, field) {
  return left.length === right.length && left.every((item, index) => item[field] === right[index][field]);
}

function validateTimelineConfigChange(currentConfig, rawConfig) {
  if (!Array.isArray(rawConfig?.sections) || !Array.isArray(rawConfig?.quarters)) {
    throw new HttpsError('invalid-argument', 'Timeline sections and quarters are required.');
  }
  const nextConfig = normalizeTimelineConfig(rawConfig);
  if (nextConfig.sections.length !== rawConfig.sections.length || nextConfig.quarters.length !== rawConfig.quarters.length) {
    throw new HttpsError('invalid-argument', 'Every Section and Quarter needs a stable ID and a label.');
  }
  if (new Set(nextConfig.sections.map(section => section.sectionId)).size !== nextConfig.sections.length
    || new Set(nextConfig.quarters.map(quarter => quarter.quarterId)).size !== nextConfig.quarters.length) {
    throw new HttpsError('invalid-argument', 'Section and Quarter IDs must be unique.');
  }
  if (!sameIds(currentConfig.sections, nextConfig.sections, 'sectionId') || !sameIds(currentConfig.quarters, nextConfig.quarters, 'quarterId')) {
    throw new HttpsError('invalid-argument', 'Section and Quarter IDs cannot be changed here.');
  }
  return { ...nextConfig, version: currentConfig.version + 1 };
}

const addExecutiveMilestoneUpdate = onCall(CALLABLE_OPTIONS, async request => {
  try {
    const updateRef = db.collection('executiveMilestoneUpdates').doc();
    const result = await db.runTransaction(async transaction => {
      const actor = await getActor(transaction, request);
      const config = await readExecutiveTimelineConfig(transaction);
      const { liveRef, state } = await readLiveTimeline(transaction);
      const now = new Date().toISOString();
      const applied = applyItemUpdate(liveTimelineAsWeek(state), {
        ...request.data,
        weekId: 'live',
        role: actor.role,
        actorEmail: actor.email,
        config,
        now,
      });
      const nextState = saveLiveTimeline(transaction, liveRef, state, applied.week.strategyLayer.executiveMilestoneTimeline, actor.email, now);
      transaction.create(updateRef, { ...withConfigMetadata(applied.updateRecord, config), updateId: updateRef.id, timelineVersion: nextState.version });
      return { applied, nextState };
    });
    return { ok: true, itemId: result.applied.item.id, version: result.applied.item.version, timelineVersion: result.nextState.version };
  } catch (error) {
    throw asHttpsError(error);
  }
});

const createExecutiveMilestoneChangeRequest = onCall(CALLABLE_OPTIONS, async request => {
  try {
    const requestRef = db.collection('executiveMilestoneChangeRequests').doc();
    const changeRequest = await db.runTransaction(async transaction => {
      const actor = await getActor(transaction, request);
      const config = await readExecutiveTimelineConfig(transaction);
      const { state } = await readLiveTimeline(transaction);
      const created = createChangeRequest(liveTimelineAsWeek(state), {
        ...request.data,
        weekId: 'live',
        requestId: requestRef.id,
        role: actor.role,
        requesterEmail: actor.email,
        config,
        now: new Date().toISOString(),
      });
      transaction.create(requestRef, { ...withConfigMetadata(created, config), timelineVersion: state.version });
      return created;
    });
    return { ok: true, itemId: changeRequest.itemId, requestId: requestRef.id };
  } catch (error) {
    throw asHttpsError(error);
  }
});

const withdrawExecutiveMilestoneChangeRequest = onCall(CALLABLE_OPTIONS, async request => {
  try {
    const requestId = String(request.data?.requestId || '').trim();
    if (!requestId || requestId.includes('/')) throw new HttpsError('invalid-argument', 'A valid requestId is required.');

    const requestRef = db.collection('executiveMilestoneChangeRequests').doc(requestId);
    const auditRef = db.collection('executiveMilestoneAudit').doc();
    const result = await db.runTransaction(async transaction => {
      const actor = await getActor(transaction, request);
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new HttpsError('not-found', 'Change request was not found.');
      const changeRequest = requestSnapshot.data();
      if (changeRequest.requesterEmail !== actor.email) {
        throw new HttpsError('permission-denied', 'Only the requester can withdraw this change request.');
      }
      if (changeRequest.state !== 'pending') {
        throw new HttpsError('failed-precondition', 'Only pending change requests can be withdrawn.');
      }
      const now = new Date().toISOString();
      const withdrawn = {
        ...changeRequest,
        state: 'withdrawn',
        withdrawnAt: now,
        withdrawnBy: actor.email,
        updatedAt: now,
      };
      transaction.update(requestRef, withdrawn);
      transaction.create(auditRef, {
        auditId: auditRef.id,
        action: 'withdraw-change-request',
        requestId,
        itemId: changeRequest.itemId,
        timelineVersion: changeRequest.timelineVersion,
        actorEmail: actor.email,
        actorRole: actor.role,
        createdAt: now,
      });
      return withdrawn;
    });
    return { ok: true, requestId, state: result.state };
  } catch (error) {
    throw asHttpsError(error);
  }
});

const decideExecutiveMilestoneChangeRequest = onCall(CALLABLE_OPTIONS, async request => {
  try {
    const requestId = String(request.data?.requestId || '').trim();
    const decision = String(request.data?.decision || '').trim().toLowerCase();
    const decisionNote = String(request.data?.decisionNote || '').trim();
    if (!requestId || requestId.includes('/')) throw new HttpsError('invalid-argument', 'A valid requestId is required.');
    if (!['approve', 'reject'].includes(decision)) throw new HttpsError('invalid-argument', 'Decision must be approve or reject.');
    if (decision === 'reject' && !decisionNote) throw new HttpsError('invalid-argument', 'A rejection comment is required.');

    const requestRef = db.collection('executiveMilestoneChangeRequests').doc(requestId);
    const auditRef = db.collection('executiveMilestoneAudit').doc();
    const result = await db.runTransaction(async transaction => {
      const actor = await getActor(transaction, request);
      if (actor.role !== 'executive') throw new HttpsError('permission-denied', 'Only the Executive Owner may decide requests.');
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new HttpsError('not-found', 'Change request was not found.');
      const changeRequest = requestSnapshot.data();
      const config = await readExecutiveTimelineConfig(transaction);
      const now = new Date().toISOString();

      if (decision === 'reject') {
        if (changeRequest.state !== 'pending') throw new HttpsError('failed-precondition', 'Request is not pending.');
        const rejected = {
          ...changeRequest,
          state: 'rejected',
          updatedAt: now,
          decidedAt: now,
          decidedBy: actor.email,
          decisionNote,
        };
        const rejectedAudit = withConfigMetadata({
          auditId: auditRef.id,
          action: 'rejected-change',
          requestId,
          itemId: changeRequest.itemId,
          changeType: changeRequest.changeType,
          before: changeRequest.before,
          after: changeRequest.after,
          reason: changeRequest.reason,
          decisionNote,
          actorEmail: actor.email,
          actorRole: actor.role,
          createdAt: now,
        }, config);
        transaction.update(requestRef, rejected);
        transaction.create(auditRef, rejectedAudit);
        return { request: rejected, alreadyApplied: false };
      }

      const { liveRef, state } = await readLiveTimeline(transaction);
      const applied = applyApprovedRequest(liveTimelineAsWeek(state), changeRequest, {
        role: actor.role,
        actorEmail: actor.email,
        decisionNote,
        config,
        now,
      });
      const nextState = applied.request.state === 'applied' && !applied.alreadyApplied
        ? saveLiveTimeline(transaction, liveRef, state, applied.week.strategyLayer.executiveMilestoneTimeline, actor.email, now)
        : state;
      if (!applied.alreadyApplied) transaction.update(requestRef, applied.request);
      if (applied.audit) transaction.create(auditRef, { ...withConfigMetadata(applied.audit, config), auditId: auditRef.id, timelineVersion: nextState.version });
      return { ...applied, nextState };
    });
    return {
      ok: true,
      itemId: result.request.itemId,
      requestId,
      state: result.request.state,
      alreadyApplied: result.alreadyApplied === true,
      timelineVersion: result.nextState?.version ?? result.request.timelineVersion ?? null,
    };
  } catch (error) {
    throw asHttpsError(error);
  }
});

const applyDirectExecutiveMilestoneChange = onCall(CALLABLE_OPTIONS, async request => {
  try {
    const auditRef = db.collection('executiveMilestoneAudit').doc();
    const result = await db.runTransaction(async transaction => {
      const actor = await getActor(transaction, request);
      const config = await readExecutiveTimelineConfig(transaction);
      const { liveRef, state } = await readLiveTimeline(transaction);
      const now = new Date().toISOString();
      const applied = applyDirectStructureChange(liveTimelineAsWeek(state), {
        ...request.data,
        role: actor.role,
        actorEmail: actor.email,
        config,
        now,
      });
      const nextState = saveLiveTimeline(transaction, liveRef, state, applied.week.strategyLayer.executiveMilestoneTimeline, actor.email, now);
      transaction.create(auditRef, { ...withConfigMetadata(applied.audit, config), auditId: auditRef.id, timelineVersion: nextState.version });
      return { applied, nextState };
    });
    return { ok: true, itemId: result.applied.audit.itemId, version: result.applied.item?.version ?? null, timelineVersion: result.nextState.version };
  } catch (error) {
    throw asHttpsError(error);
  }
});

const saveExecutiveMilestoneTimelineConfig = onCall(CALLABLE_OPTIONS, async request => {
  try {
    const expectedVersion = Number.parseInt(request.data?.expectedVersion, 10);
    const reason = String(request.data?.reason || '').trim();
    if (!Number.isFinite(expectedVersion) || expectedVersion < 1) throw new HttpsError('invalid-argument', 'A valid timeline configuration version is required.');
    if (!reason) throw new HttpsError('invalid-argument', 'A reason is required for timeline settings changes.');
    const auditRef = db.collection('executiveMilestoneAudit').doc();
    const result = await db.runTransaction(async transaction => {
      const actor = await getActor(transaction, request);
      if (!['admin', 'executive'].includes(actor.role)) throw new HttpsError('permission-denied', 'Only Admin or Executive Owner can edit timeline settings.');
      const configRef = executiveTimelineConfigRef();
      const configSnapshot = await transaction.get(configRef);
      const currentConfig = normalizeTimelineConfig(configSnapshot.exists ? configSnapshot.data() : defaultTimelineConfig());
      if (expectedVersion !== currentConfig.version) throw new HttpsError('aborted', 'Timeline settings changed. Reload and try again.');
      const nextConfig = validateTimelineConfigChange(currentConfig, request.data?.config);
      transaction.set(configRef, { ...nextConfig, updatedAt: new Date().toISOString(), updatedBy: actor.email });
      transaction.create(auditRef, {
        auditId: auditRef.id,
        action: 'timeline-config-change',
        reason,
        before: currentConfig,
        after: nextConfig,
        configVersion: nextConfig.version,
        actorEmail: actor.email,
        actorRole: actor.role,
        createdAt: new Date().toISOString(),
      });
      return nextConfig;
    });
    return { ok: true, version: result.version };
  } catch (error) {
    throw asHttpsError(error);
  }
});

const initializeExecutiveMilestoneLiveTimeline = onCall(CALLABLE_OPTIONS, async request => {
  try {
    const sourceWeekId = requireSourceWeekId(request.data);
    const result = await db.runTransaction(async transaction => {
      const actor = await getActor(transaction, request);
      if (actor.role !== 'admin') throw new HttpsError('permission-denied', 'Only administrators can initialize the live Executive timeline.');
      const liveRef = liveTimelineRef(db);
      const liveSnapshot = await transaction.get(liveRef);
      if (liveSnapshot.exists && normalizeLiveTimelineState(liveSnapshot.data()).timeline) {
        throw new HttpsError('already-exists', 'The live Executive timeline is already initialized.');
      }
      const sourceSnapshot = await transaction.get(db.collection('weeks').doc(sourceWeekId));
      if (!sourceSnapshot.exists) throw new HttpsError('not-found', 'The selected source reporting week was not found.');
      const timeline = liveTimelineFromWeek(sourceSnapshot.data());
      if (!timeline) throw new HttpsError('failed-precondition', 'The selected reporting week has no Executive milestone timeline.');
      const now = new Date().toISOString();
      const state = { timeline, version: 1, initializedAt: now, initializedBy: actor.email, updatedAt: now, updatedBy: actor.email };
      transaction.set(liveRef, state);
      return state;
    });
    return { ok: true, timelineVersion: result.version };
  } catch (error) {
    throw asHttpsError(error);
  }
});

const setExecutiveRagOverride = onCall(CALLABLE_OPTIONS, async request => {
  try {
    const scope = String(request.data?.scope || '').trim().toLowerCase();
    const targetId = String(request.data?.targetId || '').trim();
    const replacementValue = request.data?.rag == null ? null : String(request.data.rag).trim().toLowerCase();
    const reason = String(request.data?.reason || '').trim();
    if (!['section', 'quarter'].includes(scope)) throw new HttpsError('invalid-argument', 'Override scope must be section or quarter.');
    if (replacementValue !== null && !RAGS.has(replacementValue)) throw new HttpsError('invalid-argument', 'Override RAG must be green, yellow, red, or null.');
    if (!reason) throw new HttpsError('invalid-argument', 'An override reason is required.');

    const auditRef = db.collection('executiveMilestoneAudit').doc();
    const result = await db.runTransaction(async transaction => {
      const actor = await getActor(transaction, request);
      if (!['admin', 'executive'].includes(actor.role)) throw new HttpsError('permission-denied', 'Role is not authorized to override Executive RAG.');
      const config = await readExecutiveTimelineConfig(transaction);
      const { liveRef, state } = await readLiveTimeline(transaction);
      const now = new Date().toISOString();
      const timeline = JSON.parse(JSON.stringify(state.timeline || {}));
      const calculatedValue = calculateOverrideTarget(timeline, scope, targetId, config);
      const key = [scope, targetId].join(':');
      timeline.ragOverrides = timeline.ragOverrides && typeof timeline.ragOverrides === 'object' ? timeline.ragOverrides : {};
      const previousOverride = timeline.ragOverrides[key] || null;
      if (replacementValue === null) delete timeline.ragOverrides[key];
      else timeline.ragOverrides[key] = {
        scope,
        targetId,
        calculatedValue,
        replacementValue,
        reason,
        actorEmail: actor.email,
        actorRole: actor.role,
        updatedAt: now,
      };
      const nextState = saveLiveTimeline(transaction, liveRef, state, timeline, actor.email, now);
      const audit = {
        auditId: auditRef.id,
        action: replacementValue === null ? 'remove-rag-override' : 'set-rag-override',
        scope,
        targetId,
        calculatedValue,
        previousOverride,
        replacementValue,
        reason,
        actorEmail: actor.email,
        actorRole: actor.role,
        configVersion: config.version,
        timelineVersion: nextState.version,
        createdAt: now,
      };
      transaction.create(auditRef, audit);
      return audit;
    });
    return { ok: true, scope, targetId, rag: result.replacementValue, timelineVersion: result.timelineVersion };
  } catch (error) {
    throw asHttpsError(error);
  }
});

module.exports = {
  addExecutiveMilestoneUpdate,
  createExecutiveMilestoneChangeRequest,
  withdrawExecutiveMilestoneChangeRequest,
  decideExecutiveMilestoneChangeRequest,
  applyDirectExecutiveMilestoneChange,
  initializeExecutiveMilestoneLiveTimeline,
  saveExecutiveMilestoneTimelineConfig,
  setExecutiveRagOverride,
};
