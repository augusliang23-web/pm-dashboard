const VALID_ROLES = new Set(['admin', 'pm', 'vip', 'sales', 'bd', 'engineering', 'product', 'executive']);

export function normalizeDashboardRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return VALID_ROLES.has(value) ? value : '';
}

export function canReadDraftWeeks(role) {
  return ['admin', 'pm'].includes(normalizeDashboardRole(role));
}

export function isProjectManagerAccount(account = {}) {
  const role = normalizeDashboardRole(account.role);
  return role === 'pm' || (role === 'admin' && account.isProjectManager === true);
}

export function buildProjectManagerList(accounts = [], displayName = value => value) {
  return [...new Set(accounts
    .filter(isProjectManagerAccount)
    .map(account => String(displayName(account.id || account.email || '')).trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function reconcileProjectManagerFilter(value, list = []) {
  return value === 'all' || list.includes(value) ? value : 'all';
}
