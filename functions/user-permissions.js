// Admin-only per-user permission overrides (userPermissions/{email}) with an atomic audit trail
// (userPermissionAudit/{autoId}). The caller is authorized by the server-read raw role in users/{email}
// -- never by permission-override resolution -- and every change is checked against the capability registry.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { CAPABILITIES, isKnownCapability, normalizePermissionOverrides, normalizePermissionRole } = require('./permission-registry');

const REQUEST_KEYS = ['targetEmail', 'expectedRevision', 'changes'];
const MAX_EMAIL_LENGTH = 320;
const PERMISSION_SCHEMA_VERSION = 1;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function database() {
  return getFirestore();
}

function permissionError(code, reason, message) {
  return new HttpsError(code, message, { reason });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmailId(email) {
  return email.length > 2 && email.length <= MAX_EMAIL_LENGTH && email.includes('@') && !/[/\s]/.test(email);
}

function storedRevision(data) {
  const revision = data?.revision;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function storedOverrides(data) {
  return isPlainObject(data?.overrides) ? { ...data.overrides } : {};
}

// The override as the resolver sees it: true / false, or null (inherit) for missing or malformed values.
function effectiveOverride(overrides, capability) {
  return typeof overrides[capability] === 'boolean' ? overrides[capability] : null;
}

function validatePermissionRequest(data) {
  if (!isPlainObject(data)) {
    throw permissionError('invalid-argument', 'invalid-payload', 'Permission change request must be an object.');
  }
  const unexpected = Object.keys(data).filter(key => !REQUEST_KEYS.includes(key));
  if (unexpected.length) {
    throw permissionError('invalid-argument', 'invalid-payload', `Unsupported permission request field: ${unexpected[0]}.`);
  }
  const targetEmail = normalizeEmail(data.targetEmail);
  if (!isValidEmailId(targetEmail)) {
    throw permissionError('invalid-argument', 'invalid-payload', 'A valid target user email is required.');
  }
  if (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) {
    throw permissionError('invalid-argument', 'invalid-payload', 'Expected revision must be a non-negative integer.');
  }
  if (!isPlainObject(data.changes)) {
    throw permissionError('invalid-argument', 'invalid-payload', 'Permission changes must be an object.');
  }
  const keys = Object.keys(data.changes);
  if (!keys.length || keys.length > Object.keys(CAPABILITIES).length) {
    throw permissionError('invalid-argument', 'invalid-payload', 'Provide at least one capability change.');
  }
  for (const capability of keys) {
    if (!isKnownCapability(capability)) {
      throw permissionError('invalid-argument', 'unknown-capability', `Unknown capability: ${capability}.`);
    }
    if (!CAPABILITIES[capability].delegable) {
      throw permissionError('permission-denied', 'capability-not-delegable', `${CAPABILITIES[capability].label} cannot be delegated.`);
    }
    const value = data.changes[capability];
    if (value !== true && value !== false && value !== null) {
      throw permissionError('invalid-argument', 'invalid-payload', 'Each change must be true, false or null.');
    }
  }
  return { targetEmail, expectedRevision: data.expectedRevision, changes: { ...data.changes } };
}

// Applies validated changes to the stored overrides. Returns the next stored map and the audit entries of
// real changes only; unrelated (including stale) stored keys are preserved untouched.
function planPermissionChange({ targetRole, current, changes }) {
  const next = { ...current };
  const entries = [];
  for (const [capability, value] of Object.entries(changes)) {
    const definition = CAPABILITIES[capability];
    if (targetRole === 'admin' && definition.adminLocked === true && definition.roleDefaults.includes('admin')) {
      throw permissionError('failed-precondition', 'admin-capability-locked', `Admin access to ${definition.label} cannot be changed.`);
    }
    if (value === true && !definition.grantableRoles.includes(targetRole)) {
      throw permissionError('failed-precondition', 'role-not-grantable', `${definition.label} cannot be granted to this role.`);
    }
    const before = effectiveOverride(current, capability);
    if (value === null) {
      if (!hasOwn(current, capability)) continue;
      delete next[capability];
    } else {
      if (current[capability] === value) continue;
      next[capability] = value;
    }
    entries.push({ capability, before, after: value });
  }
  return { overrides: next, entries };
}

function permissionState(targetEmail, role, revision, overrides, changed) {
  return { targetEmail, role, revision, overrides: normalizePermissionOverrides(overrides), changed };
}

async function adminActor(transaction, request) {
  const uid = String(request.auth?.uid || '').trim();
  const email = normalizeEmail(request.auth?.token?.email);
  if (!uid || !email) {
    throw permissionError('unauthenticated', 'unauthenticated', 'Sign in before changing permissions.');
  }
  const snapshot = await transaction.get(database().collection('users').doc(email));
  if (!snapshot.exists || normalizePermissionRole(snapshot.data()?.role) !== 'admin') {
    throw permissionError('permission-denied', 'admin-role-required', 'Only administrators can change user permissions.');
  }
  return { uid, email };
}

const setUserPermissionOverrides = onCall({ serviceAccount: 'pmdash-user-perms@', maxInstances: 20 }, async request => database().runTransaction(async transaction => {
  const actor = await adminActor(transaction, request);
  const { targetEmail, expectedRevision, changes } = validatePermissionRequest(request.data);

  const targetSnapshot = await transaction.get(database().collection('users').doc(targetEmail));
  if (!targetSnapshot.exists) {
    throw permissionError('not-found', 'target-not-found', 'The selected dashboard user no longer exists.');
  }
  const targetRole = normalizePermissionRole(targetSnapshot.data()?.role);
  if (!targetRole) {
    throw permissionError('failed-precondition', 'target-role-unrecognized', 'The selected user has no recognized dashboard role.');
  }

  const permissionRef = database().collection('userPermissions').doc(targetEmail);
  const permissionSnapshot = await transaction.get(permissionRef);
  const existing = permissionSnapshot.exists ? permissionSnapshot.data() : {};
  const revision = storedRevision(existing);
  if (expectedRevision !== revision) {
    throw permissionError('aborted', 'permission-revision-conflict', 'Permissions were changed by another Admin. Reload and review before saving again.');
  }

  const current = storedOverrides(existing);
  const plan = planPermissionChange({ targetRole, current, changes });
  if (!plan.entries.length) {
    // No-op: nothing stored changes, so the revision and audit trail stay untouched.
    return permissionState(targetEmail, targetRole, revision, current, false);
  }

  const revisionAfter = revision + 1;
  transaction.set(permissionRef, {
    ...existing,
    schemaVersion: PERMISSION_SCHEMA_VERSION,
    overrides: plan.overrides,
    revision: revisionAfter,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.email,
  });
  const auditRef = database().collection('userPermissionAudit').doc();
  transaction.create(auditRef, {
    targetEmail,
    actorEmail: actor.email,
    actorUid: actor.uid,
    at: FieldValue.serverTimestamp(),
    revisionBefore: revision,
    revisionAfter,
    roleAtChange: targetRole,
    changes: plan.entries,
  });
  return { ...permissionState(targetEmail, targetRole, revisionAfter, plan.overrides, true), auditId: auditRef.id };
}));

module.exports = {
  planPermissionChange, setUserPermissionOverrides, validatePermissionRequest,
};
