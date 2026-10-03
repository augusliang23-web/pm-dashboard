// Admin User Permissions page model. Pure functions only: the page wiring lives in index.html and every
// change is authorized and applied by the setUserPermissionOverrides callable.
//
// A capability's stored override is tri-state: true (Custom enabled), false (Custom disabled) or null
// (inherit the role default). The checkbox shows the effective access; the draft keeps the override.
import { CAPABILITIES, can, normalizePermissionRole } from './permission-registry.mjs';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export const PERMISSION_STATE_LABELS = Object.freeze({
  'role-default': 'Role default',
  'custom-enabled': 'Custom enabled',
  'custom-disabled': 'Custom disabled',
});

const ROLE_LABELS = Object.freeze({
  admin: 'Admin', pm: 'PM', vip: 'VIP', executive: 'Executive Owner', engineering: 'Engineering',
  business: 'Business', sales: 'Sales', bd: 'BD', product: 'Product',
});

export function roleLabel(role) {
  return ROLE_LABELS[normalizePermissionRole(role)] || 'Unrecognized role';
}

// Only reviewed, delegable capabilities with presentation metadata are user-configurable.
export function configurableCapabilities() {
  return Object.entries(CAPABILITIES)
    .filter(([, definition]) => definition.delegable === true && typeof definition.label === 'string' && definition.label)
    .map(([key, definition]) => ({ key, label: definition.label, description: definition.description || '' }));
}

// Stored overrides as the resolver reads them: only boolean values for configurable capabilities.
export function storedPermissionState(overrides) {
  const source = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};
  return Object.fromEntries(configurableCapabilities().map(({ key }) => [
    key, hasOwn(source, key) && typeof source[key] === 'boolean' ? source[key] : null,
  ]));
}

function overrideState(value) {
  if (value === true) return 'custom-enabled';
  if (value === false) return 'custom-disabled';
  return 'role-default';
}

export function buildPermissionRows({ role, stored, draft }) {
  const normalizedRole = normalizePermissionRole(role);
  return configurableCapabilities().map(({ key, label, description }) => {
    const definition = CAPABILITIES[key];
    const storedValue = stored?.[key] ?? null;
    const draftValue = hasOwn(draft || {}, key) ? draft[key] : storedValue;
    const locked = !normalizedRole || (normalizedRole === 'admin' && definition.roleDefaults.includes('admin'));
    const roleDefault = can(key, { role: normalizedRole });
    const effective = can(key, { role: normalizedRole, overrides: draftValue === null ? {} : { [key]: draftValue } });
    return {
      key, label, description, roleDefault, effective, locked,
      lockReason: !normalizedRole ? 'This user has no recognized dashboard role.'
        : locked ? 'Locked for Admin' : '',
      stored: storedValue,
      draft: draftValue,
      state: overrideState(draftValue),
      stateLabel: PERMISSION_STATE_LABELS[overrideState(draftValue)],
      dirty: draftValue !== storedValue,
      canReset: !locked && draftValue !== null,
    };
  });
}

// Checking or unchecking always records an explicit override; Reset returns the capability to inherit.
export function draftAfterToggle(draft, key, checked) {
  return { ...draft, [key]: checked === true };
}

export function draftAfterReset(draft, key) {
  return { ...draft, [key]: null };
}

export function draftAfterResetAll(draft) {
  return { ...draft, ...Object.fromEntries(configurableCapabilities().map(({ key }) => [key, null])) };
}

// The minimal mutation payload: only capabilities whose override differs from what is stored.
export function permissionChanges(stored, draft) {
  const changes = {};
  for (const { key } of configurableCapabilities()) {
    const storedValue = stored?.[key] ?? null;
    const draftValue = hasOwn(draft || {}, key) ? draft[key] : storedValue;
    if (draftValue !== storedValue) changes[key] = draftValue;
  }
  return changes;
}

function sortText(value) {
  return String(value || '').toLocaleLowerCase();
}

// Only the fields the page needs; nothing else from users/{email} reaches the view.
export function permissionUserOptions(accounts = [], displayNameFor = email => email) {
  return accounts
    .map(account => {
      const email = String(account?.id || account?.email || '').trim().toLowerCase();
      const storedName = typeof account?.displayName === 'string' ? account.displayName.trim() : '';
      return {
        email,
        name: storedName || String(displayNameFor(email) || email),
        role: normalizePermissionRole(account?.role),
      };
    })
    .filter(user => user.email)
    .sort((left, right) => sortText(left.name).localeCompare(sortText(right.name))
      || left.email.localeCompare(right.email));
}

function overrideText(value) {
  if (value === true) return 'Enabled';
  if (value === false) return 'Disabled';
  return 'Role default';
}

function auditTimeMillis(entry) {
  const at = entry?.at;
  if (typeof at?.toMillis === 'function') return at.toMillis();
  if (at instanceof Date) return at.getTime();
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Most recent first, limited to `limit` entries, each change described as "Label: before → after".
export function describeAuditEntries(entries = [], limit = 10) {
  return [...entries]
    .sort((left, right) => auditTimeMillis(right) - auditTimeMillis(left))
    .slice(0, limit)
    .map(entry => ({
      at: auditTimeMillis(entry),
      actorEmail: String(entry?.actorEmail || ''),
      changes: (Array.isArray(entry?.changes) ? entry.changes : []).map(change => {
        const label = CAPABILITIES[change?.capability]?.label || String(change?.capability || 'Unknown capability');
        return `${label}: ${overrideText(change?.before)} → ${overrideText(change?.after)}`;
      }),
    }));
}

export function isPermissionConflict(error) {
  return error?.details?.reason === 'permission-revision-conflict';
}

// Mirrors the callable: a missing or malformed revision reads as 0.
export function storedPermissionRevision(data) {
  const revision = data?.revision;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export function createUserPermissionsApi({ functions, httpsCallable }) {
  const setUserPermissionOverrides = httpsCallable(functions, 'setUserPermissionOverrides');
  return {
    setOverrides: data => setUserPermissionOverrides(data).then(result => result.data),
  };
}
