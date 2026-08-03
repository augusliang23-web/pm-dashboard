const ROLES = new Set(['admin', 'vip', 'executive', 'pm', 'engineering', 'business', 'sales', 'bd', 'product']);

const EXECUTIVE_VIEWS_BY_ROLE = {
  admin: ['leadership', 'all-working-team', 'pm-engineering', 'business-product', 'everyone'],
  vip: ['leadership', 'all-working-team', 'pm-engineering', 'business-product', 'everyone'],
  executive: ['leadership', 'all-working-team', 'pm-engineering', 'business-product', 'everyone'],
  pm: ['pm-engineering', 'all-working-team', 'everyone'],
  engineering: ['pm-engineering', 'all-working-team', 'everyone'],
  business: ['business-product', 'all-working-team', 'everyone'],
  sales: ['business-product', 'all-working-team', 'everyone'],
  bd: ['business-product', 'all-working-team', 'everyone'],
  product: ['business-product', 'all-working-team', 'everyone']
};

export class ReportAccessError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = 'ReportAccessError';
    this.statusCode = statusCode;
  }
}

export function normalizeDashboardRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return ROLES.has(normalized) ? normalized : '';
}

export function authorizeReportAccess(identity, week) {
  const email = String(identity?.email || '').trim().toLowerCase();
  if (!email) throw new ReportAccessError('A verified email address is required.', 401);
  const role = normalizeDashboardRole(identity?.role);
  if (!role) throw new ReportAccessError('A valid dashboard role is required.');
  if (['vip', 'executive'].includes(role) && week?.isReleased !== true) {
    throw new ReportAccessError('Executive reports are available only for released weeks.');
  }
  return { email, role };
}

export function authorizeExecutiveAudienceView(role, requestedView) {
  const candidateRole = normalizeDashboardRole(role);
  const allowedViews = EXECUTIVE_VIEWS_BY_ROLE[candidateRole];
  if (!allowedViews) throw new ReportAccessError('A valid dashboard role is required.');
  const selectedView = requestedView === undefined ? allowedViews[0] : String(requestedView).trim();
  if (!allowedViews.includes(selectedView)) {
    throw new ReportAccessError('The selected Executive milestone view is not available for this role.');
  }
  return selectedView;
}
