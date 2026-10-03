// Server mirror of js/permission-registry.mjs. Functions deploy only the functions/ directory, so the
// registry is duplicated here; test/permission-registry-parity.test.cjs keeps both copies identical.
//
// Resolution: explicit per-user override -> role default -> deny. Unknown capabilities fail closed.
// Roles are raw Firestore roles (users/{email}.role), never Production UI perspectives.

const KNOWN_ROLES = Object.freeze([
  'admin', 'pm', 'vip', 'executive', 'engineering', 'business', 'sales', 'bd', 'product',
]);

// roleDefaults: roles that hold the capability without an override.
// delegable: whether a per-user override may change the role default.
// grantableRoles: roles that an explicit `true` override may enable (never 'admin').
const CAPABILITIES = Object.freeze({
  // Manage Weeks workflow: open Week Management, Copilot prompt, Weekly Summary save, Create Next Week.
  // Excludes Production -> UAT sync/restore, week release, strategy layer and Executive governance.
  'week.manage': Object.freeze({
    roleDefaults: Object.freeze(['admin']),
    delegable: true,
    grantableRoles: Object.freeze(['pm', 'engineering', 'business', 'sales', 'bd', 'product', 'vip', 'executive']),
  }),
  // Reserved: only raw-role Admin may manage user permissions. Never delegable.
  'permissions.manage': Object.freeze({
    roleDefaults: Object.freeze(['admin']),
    delegable: false,
    grantableRoles: Object.freeze([]),
  }),
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function normalizePermissionRole(role) {
  const value = String(role || '').trim().toLowerCase();
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

function can(capability, { role, overrides } = {}) {
  if (!isKnownCapability(capability)) return false;
  const definition = CAPABILITIES[capability];
  const normalizedRole = normalizePermissionRole(role);
  if (!normalizedRole) return false;
  const roleDefault = definition.roleDefaults.includes(normalizedRole);
  // Admin keeps every role-default capability: an override (even stale or malformed data) never removes it.
  if (normalizedRole === 'admin' || !definition.delegable) return roleDefault;
  const override = normalizePermissionOverrides(overrides)[capability];
  if (override === false) return false;
  if (override === true) return definition.grantableRoles.includes(normalizedRole);
  return roleDefault;
}

module.exports = {
  CAPABILITIES, can, isKnownCapability, normalizePermissionOverrides, normalizePermissionRole,
};
