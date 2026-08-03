const PROJECT_SECTIONS = new Set([
  'project-brief',
  'project-update',
  'milestone',
  'gantt',
  'team-allocation',
  'resources',
  'budget'
]);

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

export function parseReportRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ReportRequestError('Report request must be an object.');
  }

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
  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    throw new ReportRequestError('At least one report section is required.');
  }

  const allowedSections = mode === 'project' ? PROJECT_SECTIONS : OVERVIEW_SECTIONS;
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

export { PROJECT_SECTIONS, OVERVIEW_SECTIONS };
