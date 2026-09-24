const CORE_PROJECT_SECTIONS = new Set([
  'milestone',
  'gantt',
  'team-allocation',
  'resources',
  'budget'
]);

// The UAT project-brief / project-update section picker (Control Plane: "must be preserved", UAT-profile-only).
// Kept as its own set so the capability switch below is a single, explicit addition/removal, never a scattered
// per-branch check.
const PROJECT_BRIEF_UPDATE_SECTIONS = new Set(['project-brief', 'project-update']);

// Backward-compatible export: the full section vocabulary this module understands, independent of which
// environment enables project-brief/project-update. Environment gating happens inside parseReportRequest.
const PROJECT_SECTIONS = new Set([...CORE_PROJECT_SECTIONS, ...PROJECT_BRIEF_UPDATE_SECTIONS]);

const OVERVIEW_SECTIONS = new Set([
  'health-focus',
  'weekly-trend',
  'executive-summary',
  'attention-matrix',
  'risk-actions',
  'executive-milestones',
  'quarterly-roadmap',
  'project-portfolio',
  'resource-analytics',
  'budget-overview'
]);

const EXECUTIVE_AUDIENCE_VIEWS = new Set([
  'leadership',
  'all-working-team',
  'pm-engineering',
  'business-product',
  'everyone'
]);

export class ReportRequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ReportRequestError';
    this.statusCode = statusCode;
  }
}

function requiredText(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new ReportRequestError(`${field} is required.`);
  return normalized;
}

// `features` is the same explicit, environment-resolved capability object server.js already threads through for
// getLiveExecutiveTimeline (see src/environment.js's target.features): never inferred from hostname, repository
// name, or any other fallback. It defaults to enabled because this function is also called directly, with no
// second argument, by unit tests that port the original UAT behavior unmodified; the real server path never omits
// it (asserted by a static test), so that default is unreachable in a deployed environment.
export function parseReportRequest(input, features = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ReportRequestError('Report request must be an object.');
  }
  const allowProjectBriefUpdate = features.projectBriefUpdateSections !== false;

  const mode = requiredText(input.mode, 'mode');
  if (mode !== 'project' && mode !== 'overview') {
    throw new ReportRequestError(`Unsupported report mode: ${mode}.`);
  }

  const allowedFields = new Set(mode === 'project'
    ? ['mode', 'weekId', 'projectCode', 'sections']
    : ['mode', 'weekId', 'sections', 'overviewScope', 'executiveAudienceView', 'projectCodes']);
  for (const field of Object.keys(input)) {
    if (!allowedFields.has(field)) {
      throw new ReportRequestError(`Unexpected report request field: ${field}.`);
    }
  }

  const weekId = requiredText(input.weekId, 'weekId');
  const projectCode = mode === 'project' ? requiredText(input.projectCode, 'projectCode') : undefined;
  if (!Array.isArray(input.sections)) {
    throw new ReportRequestError('Report sections must be an array.');
  }
  if (mode === 'overview' && input.sections.length === 0) {
    throw new ReportRequestError('At least one report section is required.');
  }

  const allowedSections = mode === 'project'
    ? (allowProjectBriefUpdate ? PROJECT_SECTIONS : CORE_PROJECT_SECTIONS)
    : OVERVIEW_SECTIONS;
  const sections = input.sections.map(section => requiredText(section, 'section'));
  const uniqueSections = [...new Set(sections)];
  if (uniqueSections.length !== sections.length) {
    throw new ReportRequestError('Report sections must be unique.');
  }
  for (const section of sections) {
    if (!allowedSections.has(section)) {
      throw new ReportRequestError(`Unknown report section: ${section}.`);
    }
  }

  const request = { mode, weekId, sections };
  if (projectCode) request.projectCode = projectCode;
  if (mode === 'overview' && input.overviewScope !== undefined) {
    const overviewScope = requiredText(input.overviewScope, 'overviewScope');
    if (!['system', 'module', 'hardware-module', 'software', 'all'].includes(overviewScope)) {
      throw new ReportRequestError(`Unsupported overviewScope: ${overviewScope}.`);
    }
    request.overviewScope = overviewScope === 'module' ? 'hardware-module' : overviewScope;
  }
  if (mode === 'overview') {
    if (!Array.isArray(input.projectCodes) || input.projectCodes.length === 0) {
      throw new ReportRequestError('At least one project selection is required.');
    }
    const projectCodes = input.projectCodes.map(code => requiredText(code, 'project code'));
    if (new Set(projectCodes).size !== projectCodes.length) {
      throw new ReportRequestError('Project selections must be unique.');
    }
    request.projectCodes = projectCodes;
  }
  if (mode === 'overview' && input.executiveAudienceView !== undefined) {
    if (!sections.includes('executive-milestones')) {
      throw new ReportRequestError('executiveAudienceView requires the Executive milestones section.');
    }
    const executiveAudienceView = requiredText(input.executiveAudienceView, 'executiveAudienceView');
    if (!EXECUTIVE_AUDIENCE_VIEWS.has(executiveAudienceView)) {
      throw new ReportRequestError(`Unsupported executiveAudienceView: ${executiveAudienceView}.`);
    }
    request.executiveAudienceView = executiveAudienceView;
  }
  return request;
}

export { PROJECT_SECTIONS, CORE_PROJECT_SECTIONS, PROJECT_BRIEF_UPDATE_SECTIONS, OVERVIEW_SECTIONS, requiredText };
