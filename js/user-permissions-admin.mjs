// Admin User Permissions page model. Pure functions only: the page wiring lives in index.html and every change
// is authorized and applied by the setUserPermissionOverrides callable.
//
// The page shows one ON/OFF switch per delegable capability and nothing else. Internally the backend keeps its
// role-default + override model (true / false / null); this module translates the Admin's desired EFFECTIVE state
// into the override to store, so that model never reaches the UI:
//   desired state equals the role default  -> null  (inherit; the stored key is removed)
//   desired state differs from the default -> true / false
import { CAPABILITIES, can, normalizePermissionRole, roleDefault } from './permission-registry.mjs';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const ROLE_LABELS = Object.freeze({
  admin: 'Admin', pm: 'PM', vip: 'VIP', executive: 'Executive Owner', engineering: 'Engineering',
  business: 'Business', sales: 'Sales', bd: 'BD', product: 'Product',
});

export function roleLabel(role) {
  return ROLE_LABELS[normalizePermissionRole(role)] || 'Unrecognized role';
}

// Only reviewed, delegable capabilities with presentation metadata get a switch, in registry order.
export function configurableCapabilities() {
  return Object.entries(CAPABILITIES)
    .filter(([, definition]) => definition.delegable === true && typeof definition.label === 'string' && definition.label)
    .map(([key, definition]) => ({ key, label: definition.label, description: definition.description || '' }));
}

// Stored overrides as the resolver reads them: true, false, or null (inherit) for missing/malformed values.
export function storedPermissionState(overrides) {
  const source = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};
  return Object.fromEntries(configurableCapabilities().map(({ key }) => [
    key, hasOwn(source, key) && typeof source[key] === 'boolean' ? source[key] : null,
  ]));
}

export function effectiveState(key, role, stored) {
  const value = stored?.[key];
  return can(key, { role, overrides: typeof value === 'boolean' ? { [key]: value } : {} });
}

// Whether an Admin may switch this capability for a user in this role. Admin is locked; roles that cannot be
// granted a capability (and do not hold it by default) show the switch as unavailable.
export function switchAvailability(key, role) {
  const definition = CAPABILITIES[key];
  const normalizedRole = normalizePermissionRole(role);
  if (!definition || !normalizedRole) return { available: false, locked: false, reason: 'This user has no recognized dashboard role.' };
  if (normalizedRole === 'admin' && definition.adminLocked === true) return { available: false, locked: true, reason: 'Always on for Admin.' };
  if (roleDefault(key, normalizedRole) || definition.grantableRoles.includes(normalizedRole)) return { available: true, locked: false, reason: '' };
  return { available: false, locked: false, reason: 'Not available for this role.' };
}

// Rows for the switches. `saving` is the capability whose change is in flight, if any.
export function buildSwitchRows({ role, stored, saving = '' }) {
  return configurableCapabilities().map(({ key, label, description }) => {
    const availability = switchAvailability(key, role);
    return {
      key, label, description,
      on: effectiveState(key, role, stored),
      locked: availability.locked,
      available: availability.available,
      note: availability.reason,
      saving: saving === key,
    };
  });
}

// The override to store so the user's EFFECTIVE state becomes `desiredOn`; null removes the stored key.
// Returns undefined when the desired state cannot be reached for this role (the switch is unavailable).
export function overrideForDesiredState(key, role, desiredOn) {
  const availability = switchAvailability(key, role);
  if (!availability.available) return undefined;
  const base = roleDefault(key, role);
  if (desiredOn === base) return null;
  return desiredOn === true || desiredOn === false ? desiredOn : undefined;
}

// The callable payload for one switch change.
export function switchChange(key, role, desiredOn) {
  const override = overrideForDesiredState(key, role, desiredOn);
  return override === undefined ? null : { [key]: override };
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

function auditTimeMillis(entry) {
  const at = entry?.at;
  if (typeof at?.toMillis === 'function') return at.toMillis();
  if (at instanceof Date) return at.getTime();
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function describeAuditChange(change, roleAtChange) {
  const key = change?.capability;
  const label = CAPABILITIES[key]?.label || String(key || 'Unknown capability');
  if (!CAPABILITIES[key]) return `${label}: changed`;
  const stateOf = value => can(key, { role: roleAtChange, overrides: typeof value === 'boolean' ? { [key]: value } : {} });
  const before = stateOf(change.before);
  const after = stateOf(change.after);
  const text = state => (state ? 'On' : 'Off');
  return `${label}: ${text(before)} → ${text(after)}${before === after ? ' (setting tidied, no effective change)' : ''}`;
}

// Most recent first, limited to `limit` entries, each change described in plain ON/OFF terms.
export function describeAuditEntries(entries = [], limit = 10) {
  return [...entries]
    .sort((left, right) => auditTimeMillis(right) - auditTimeMillis(left))
    .slice(0, limit)
    .map(entry => ({
      at: auditTimeMillis(entry),
      actorEmail: String(entry?.actorEmail || ''),
      changes: (Array.isArray(entry?.changes) ? entry.changes : []).map(change => describeAuditChange(change, entry?.roleAtChange)),
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
