// Server mirror of js/permission-registry.mjs. Functions deploy only the functions/ directory, so the
// registry is duplicated here; test/permission-registry-parity.test.cjs keeps both copies identical.
//
// Resolution: explicit per-user override -> role default -> deny. Unknown capabilities fail closed.
// Roles are raw Firestore roles (users/{email}.role), never Production UI perspectives.

const KNOWN_ROLES = Object.freeze([
  'admin', 'pm', 'vip', 'executive', 'engineering', 'business', 'sales', 'bd', 'product',
]);

// Roles that work in the working-team view (draft weeks, project editor, release banner).
const WORKING_ROLES = Object.freeze(['pm', 'engineering', 'business', 'sales', 'bd', 'product']);
const ALL_NON_ADMIN_ROLES = Object.freeze([...WORKING_ROLES, 'vip', 'executive']);

// label/description: reviewed Admin-facing presentation for the User Permissions page.
// roleDefaults: roles that hold the capability without an override.
// delegable: whether a per-user override may change the role default.
// adminLocked: Admin's foundational access; no override (even stale or malformed data) can remove it.
// grantableRoles: roles that an explicit `true` override may enable (never 'admin').
const CAPABILITIES = Object.freeze({
  // Manage Weeks workflow: open Week Management, Copilot prompt, Weekly Summary save, Create Next Week.
  // Excludes Production -> UAT sync/restore, week release, strategy layer and Executive governance.
  'week.manage': Object.freeze({
    label: 'Manage Weeks',
    description: 'Open Week Management, write the Weekly Summary and create the next reporting week.',
    roleDefaults: Object.freeze(['admin']),
    delegable: true,
    adminLocked: true,
    grantableRoles: ALL_NON_ADMIN_ROLES,
  }),
  // Release to the audience / Revert to Draft (setDashboardWeekRelease). PM keeps today's access by default.
  // Not grantable to VIP/Executive: their perspective has no release controls or draft weeks to act on.
  'week.release': Object.freeze({
    label: 'Release Week',
    description: 'Release a week to its audience and revert it back to draft.',
    roleDefaults: Object.freeze(['admin', 'pm']),
    delegable: true,
    adminLocked: true,
    grantableRoles: WORKING_ROLES,
  }),
  // Global Gantt administration: default Gantt templates and the PDF Gantt display window. Viewing Gantt charts and
  // editing an individual project's schedule are not part of this capability.
  'gantt.manage': Object.freeze({
    label: 'Manage Gantt',
    description: 'Change the default Gantt templates and the PDF Gantt display window.',
    roleDefaults: Object.freeze(['admin']),
    delegable: true,
    adminLocked: true,
    grantableRoles: ALL_NON_ADMIN_ROLES,
  }),
  // Project administration: create and delete projects. Editing an existing project stays ownership-based
  // (owner/deputy), and an Admin's right to edit any project stays role-only. Not grantable to VIP/Executive:
  // they have no project editor and see released (locked) weeks only.
  'project.manage': Object.freeze({
    label: 'Manage Projects',
    description: 'Add new projects and delete projects.',
    roleDefaults: Object.freeze(['admin']),
    delegable: true,
    adminLocked: true,
    grantableRoles: WORKING_ROLES,
  }),
  // Reserved: only raw-role Admin may manage user permissions. Never delegable.
  'permissions.manage': Object.freeze({
    label: 'Manage user permissions',
    description: 'Raw-role Admin only.',
    roleDefaults: Object.freeze(['admin']),
    delegable: false,
    adminLocked: true,
    grantableRoles: Object.freeze([]),
  }),
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function normalizePermissionRole(role) {
  const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return KNOWN_ROLES.includes(value) ? value : '';
}

function isKnownCapability(capability) {
  return typeof capability === 'string' && hasOwn(CAPABILITIES, capability);
}

// Keeps only known capabilities with boolean values; anything else (null, strings, stale keys) inherits.
function normalizePermissionOverrides(overrides) {
  const result = {};
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return result;
  for (const capability of Object.keys(CAPABILITIES)) {
    if (hasOwn(overrides, capability) && typeof overrides[capability] === 'boolean') {
      result[capability] = overrides[capability];
    }
  }
  return result;
}

// The default (no override) effective state of a capability for a role.
function roleDefault(capability, role) {
  if (!isKnownCapability(capability)) return false;
  const normalizedRole = normalizePermissionRole(role);
  return Boolean(normalizedRole) && CAPABILITIES[capability].roleDefaults.includes(normalizedRole);
}

function can(capability, { role, overrides } = {}) {
  if (!isKnownCapability(capability)) return false;
  const definition = CAPABILITIES[capability];
  const normalizedRole = normalizePermissionRole(role);
  if (!normalizedRole) return false;
  const base = definition.roleDefaults.includes(normalizedRole);
  // Admin keeps every role-default capability: an override (even stale or malformed data) never removes it.
  if (normalizedRole === 'admin' || !definition.delegable) return base;
  const override = normalizePermissionOverrides(overrides)[capability];
  if (override === false) return false;
  if (override === true) return definition.grantableRoles.includes(normalizedRole);
  return base;
}

module.exports = {
  CAPABILITIES, can, isKnownCapability, normalizePermissionOverrides, normalizePermissionRole, roleDefault,
};
