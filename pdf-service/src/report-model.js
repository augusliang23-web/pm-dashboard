const VALID_STATUSES = new Set(['green', 'yellow', 'red']);
const VALID_ATTENTION = new Set(['action', 'monitor', 'strategy', 'watch']);

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}

function nonNegativeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function optionalNonNegativeNumber(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function listItemText(value) {
  return String(value || '').replace(/^\s*(?:[•*-]|\d+\.)\s+/, '').trim();
}

function lines(value) {
  const source = Array.isArray(value)
    ? value.flatMap(item => String(item || '').split('\n'))
    : String(value || '').split('\n');
  return source.map(listItemText).filter(Boolean);
}

function cleanPeriodPart(value) {
  return String(value || '').trim().replace(/\s*(?:-|\u2013|\u2014)\s*/g, '\u2013');
}

export function formatSectionUpdate(project = {}, section) {
  const record = project?.sectionUpdatedAt?.[section];
  const savedAt = record?.savedAt ? new Date(record.savedAt) : null;
  const date = savedAt && !Number.isNaN(savedAt.getTime())
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(savedAt)
    : '';
  const editorName = String(record?.editorName || '').trim();
  return date && editorName ? `Updated · ${date} · ${editorName}` : 'No update recorded';
}

export function formatReportingPeriod(week = {}) {
  const label = cleanPeriodPart(week.weekLabel);
  const date = cleanPeriodPart(week.weekDate);
  if (!label) return date || 'Current reporting period';
  if (!date) return label;
  const year = label.match(/\b(20\d{2})\b/)?.[1];
  const dated = /\b20\d{2}\b/.test(date) ? date : `${date}${year ? `, ${year}` : ''}`;
  return `${label} \u00B7 ${dated}`;
}

function comparable(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function projectLevel(value) {
  return ['system', 'hardware-module', 'software'].includes(value) ? value : 'system';
}

function attentionFor(project) {
  const explicit = String(project.attentionManual || project.attention || '').toLowerCase();
  if (VALID_ATTENTION.has(explicit)) return explicit;
  if (project.status === 'red') return 'action';
  if (project.status === 'yellow') return 'monitor';
  return 'watch';
}

function riskActionPairs(source, risks, actions) {
  const stored = Array.isArray(source.riskActions)
    ? source.riskActions
    : Array.isArray(source.riskPairs) ? source.riskPairs : [];
  const structured = stored.map((item, index) => ({
    risk: lines(item?.risk || item?.description).join('\n'),
    action: lines(item?.action || item?.actions || item?.mitigation || item?.requiredAction).join('\n'),
    primary: item?.primary === true || item?.isPrimary === true || index === 0
  })).filter(item => item.risk);
  if (structured.length) return structured;
  return risks.map((risk, index) => ({ risk, action: '', primary: index === 0 }));
}

export function normalizeProjectForReport(source = {}) {
  const project = source && typeof source === 'object' ? source : {};
  const normalizedStatus = String(project.status || '').toLowerCase();
  const status = VALID_STATUSES.has(normalizedStatus) ? normalizedStatus : 'green';
  const risks = lines(project.risk);
  const actions = lines(project.weeklyActions || project.weeklyAction || project.futureActivities || project.next);
  const model = {
    ...project,
    code: String(project.code || '').trim(),
    name: String(project.name || project.code || 'Untitled project').trim(),
    projectLevel: projectLevel(project.projectLevel),
    status,
    progress: clampPercent(project.progress),
    attention: '',
    highlights: lines(project.highlight || project.accomplishments),
    risks,
    actions,
    riskActions: riskActionPairs(project, risks, actions),
    milestones: Array.isArray(project.milestones) ? project.milestones.map(item => ({ ...item })) : [],
    quarterlyMilestones: Array.isArray(project.quarterlyMilestones)
      ? project.quarterlyMilestones.map(item => ({ ...item })) : [],
    workstreams: (Array.isArray(project.ganttWorkstreams) ? project.ganttWorkstreams : []).map((row, index) => ({
      id: String(row?.id || `workstream-${index + 1}`),
      name: String(row?.name || 'Workstream'),
      startDate: String(row?.startDate || ''),
      endDate: String(row?.endDate || ''),
      status: String(row?.status || 'not-started'),
      progress: clampPercent(row?.progress),
      milestoneId: String(row?.milestoneId || ''),
      sortOrder: Number.isFinite(Number(row?.sortOrder)) ? Number(row.sortOrder) : index
    })).sort((a, b) => a.sortOrder - b.sortOrder),
    teamMembers: Array.isArray(project.teamMembers) ? project.teamMembers.map(member => ({ ...member })) : [],
    resources: project.resources && typeof project.resources === 'object' ? { ...project.resources } : {},
    budgetSource: project.budget && typeof project.budget === 'object' ? { ...project.budget } : {}
  };
  model.attention = attentionFor(model);
  return model;
}

export function disciplineRows(project) {
  if (project?.dataStatus?.team?.noAllocationRequired === true) return [];
  const members = Array.isArray(project?.teamMembers) ? project.teamMembers : [];
  const resources = project?.resources && typeof project.resources === 'object' ? project.resources : {};
  const roles = new Map();
  members.forEach(member => {
    const label = String(member?.roleName || member?.role || '').trim().replace(/\s+/g, ' ');
    const key = comparable(label);
    if (key && !roles.has(key)) roles.set(key, label);
  });
  return [...roles.entries()].map(([key, label]) => {
    const match = Object.entries(resources).find(([resourceKey, entry]) => {
      const stored = entry && typeof entry === 'object' ? entry.role || entry.label : '';
      return comparable(stored) === key
        || comparable(String(resourceKey).replace(/^role_/, '').replace(/_/g, ' ')) === key;
    });
    const entry = match?.[1] && typeof match[1] === 'object' ? match[1] : {};
    const estimated = nonNegativeNumber(entry.estimated);
    const actual = optionalNonNegativeNumber(entry.actual);
    return { label, estimated, actual, remaining: actual === null ? null : Math.max(estimated - actual, 0) };
  });
}

export function budgetTotals(project) {
  const budget = project?.budgetSource || project?.budget || {};
  const currency = String(budget.currency || 'USD').toUpperCase();
  const total = nonNegativeNumber(budget.totalEstimated);
  const planned = (Array.isArray(budget.monthlyPlans) ? budget.monthlyPlans : [])
    .reduce((sum, item) => sum + nonNegativeNumber(item?.amount), 0);
  const actual = (Array.isArray(budget.actuals) ? budget.actuals : [])
    .reduce((sum, item) => sum + nonNegativeNumber(item?.amount), 0);
  return {
    currency,
    total,
    planned,
    actual,
    variance: actual - planned,
    planGap: total - planned,
    usedPct: total ? Math.round((actual / total) * 100) : 0
  };
}

export function buildProjectReportModel({ week = {}, project = {}, sections = [] } = {}) {
  const model = normalizeProjectForReport(project);
  return {
    ...model,
    period: formatReportingPeriod(week),
    sections: [...sections],
    disciplines: disciplineRows(model),
    budget: budgetTotals(model)
  };
}

function scopeLevel(scope) {
  if (scope === 'module' || scope === 'hardware-module') return 'hardware-module';
  if (scope === 'software') return 'software';
  if (scope === 'all') return 'all';
  return 'system';
}

function scopedProjects(projects, scope) {
  const level = scopeLevel(scope);
  const normalized = (Array.isArray(projects) ? projects : []).map(normalizeProjectForReport)
    .filter(project => !['hidden', 'archived'].includes(project.visibility));
  return level === 'all' ? normalized : normalized.filter(project => project.projectLevel === level);
}

function healthSummary(projects) {
  const counts = { total: projects.length, green: 0, yellow: 0, red: 0, averageProgress: 0 };
  projects.forEach(project => { counts[project.status] += 1; });
  counts.averageProgress = projects.length
    ? Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / projects.length)
    : 0;
  return counts;
}

function buildRiskRows(projects) {
  return projects.filter(project => project.riskActions.length
    || ['yellow', 'red'].includes(project.status)
    || ['action', 'monitor'].includes(project.attention))
    .map(project => {
      const primary = project.riskActions.find(item => item.primary) || project.riskActions[0] || {};
      const checkpoint = project.milestones.find(item => ['at-risk', 'risk'].includes(item?.status))?.date
        || project.milestones[0]?.date || '';
      return {
        projectName: project.name,
        projectCode: project.code,
        risk: primary.risk || project.risks[0] || '',
        action: primary.action || project.actions[0] || '',
        owner: String(project.owner || 'Unassigned'),
        checkpoint: String(checkpoint || ''),
        attention: project.attention,
        status: project.status
      };
    });
}

function buildResourceSummary(projects) {
  const people = new Map();
  const functions = new Map();
  const byLevel = { system: 0, 'hardware-module': 0, software: 0 };
  let totalEffort = 0;
  let projectsWithAllocation = 0;
  projects.forEach(project => {
    const members = project.teamMembers.filter(member => String(member?.name || '').trim());
    if (members.length) projectsWithAllocation += 1;
    members.forEach(member => {
      const name = String(member.name).trim();
      const role = String(member.roleName || member.role || 'Unassigned').trim() || 'Unassigned';
      const effort = nonNegativeNumber(member.effortPct ?? member.effort);
      totalEffort += effort;
      byLevel[project.projectLevel] += effort / 100;
      const person = people.get(comparable(name)) || { name, effort: 0 };
      person.effort += effort;
      people.set(comparable(name), person);
      const functionKey = comparable(role);
      const fn = functions.get(functionKey) || {
        role, totalFte: 0, names: new Set(), levels: { system: 0, 'hardware-module': 0, software: 0 }
      };
      fn.totalFte += effort / 100;
      fn.names.add(comparable(name));
      fn.levels[project.projectLevel] += effort / 100;
      functions.set(functionKey, fn);
    });
  });
  const totalAllocatedFte = round(totalEffort / 100);
  return {
    totalAllocatedFte,
    allocationCoverage: projects.length ? Math.round((projectsWithAllocation / projects.length) * 100) : 0,
    overallocatedPeople: [...people.values()].filter(person => person.effort > 100).length,
    availableCapacityFte: round(Math.max(people.size - totalAllocatedFte, 0)),
    byLevel: Object.fromEntries(Object.entries(byLevel).map(([key, value]) => [key, round(value)])),
    byFunction: [...functions.values()].map(item => ({
      role: item.role,
      totalFte: round(item.totalFte),
      knownPeople: item.names.size,
      capacityFte: item.names.size,
      utilizationPct: item.names.size ? Math.round((item.totalFte / item.names.size) * 100) : 0,
      levels: Object.fromEntries(Object.entries(item.levels).map(([key, value]) => [key, round(value)]))
    })).sort((a, b) => b.totalFte - a.totalFte || a.role.localeCompare(b.role))
  };
}

function buildBudgetSummary(projects) {
  const projectRows = projects.map(project => ({ project, ...budgetTotals(project) }));
  const currencies = new Set(projectRows.map(row => row.currency));
  const currency = projectRows[0]?.currency || 'USD';
  const categories = new Map();
  projects.forEach(project => {
    const actuals = project.budgetSource?.actuals || [];
    actuals.forEach(item => {
      const name = String(item?.categoryName || item?.category || 'Other');
      categories.set(name, (categories.get(name) || 0) + nonNegativeNumber(item?.amount));
    });
  });
  const totals = projectRows.reduce((result, row) => ({
    total: result.total + row.total,
    planned: result.planned + row.planned,
    actual: result.actual + row.actual
  }), { total: 0, planned: 0, actual: 0 });
  return {
    currency,
    mixedCurrencies: currencies.size > 1,
    ...totals,
    variance: totals.actual - totals.planned,
    planGap: totals.total - totals.planned,
    usedPct: totals.total ? Math.round((totals.actual / totals.total) * 100) : 0,
    projectRows,
    categories: [...categories.entries()].map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
  };
}

function buildTrend(trendWeeks, scope) {
  return (Array.isArray(trendWeeks) ? trendWeeks : []).slice(-6).map(week => {
    const projects = scopedProjects(week?.projects, scope);
    const riskPressure = projects.reduce((sum, project) => {
      const count = project.risks.length;
      return sum + count * (project.status === 'red' ? 1.5 : 1);
    }, 0);
    return {
      label: String(week?.weekLabel || week?.weekDate || ''),
      riskPressure: round(riskPressure),
      avgProgress: projects.length
        ? Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / projects.length)
        : 0
    };
  });
}

const EXECUTIVE_AUDIENCES_BY_VIEW = {
  leadership: new Set(['all-working-team', 'pm-engineering', 'business-product', 'leadership-only', 'everyone']),
  'all-working-team': new Set(['all-working-team', 'everyone']),
  'pm-engineering': new Set(['all-working-team', 'pm-engineering', 'everyone']),
  'business-product': new Set(['all-working-team', 'business-product', 'everyone']),
  everyone: new Set(['everyone'])
};

function executiveTimelineCell(cells, index) {
  if (Array.isArray(cells)) return cells[index];
  return cells && typeof cells === 'object' ? cells[`q${index + 1}`] : undefined;
}

function executiveOutcomeText(value) {
  if (value && typeof value === 'object') return String(value.text || value.label || '').trim();
  return String(value || '').trim();
}

function normalizeExecutiveMilestones(week, executiveAudienceView) {
  const source = week?.strategyLayer?.executiveMilestoneTimeline || week?.executiveMilestoneTimeline;
  const allowedAudiences = EXECUTIVE_AUDIENCES_BY_VIEW[executiveAudienceView] || new Set();
  const quarters = Array.from({ length: 4 }, (_, index) => String(source?.quarters?.[index] || `Q${index + 1}`));
  const phases = Array.from({ length: 4 }, (_, index) => String(source?.phases?.[index] || ''));
  const rows = (Array.isArray(source?.rows) ? source.rows : []).map(row => ({
    label: String(row?.label || '').trim(),
    audience: String(row?.audience || 'leadership-only').trim(),
    cells: Array.from({ length: 4 }, (_, index) => {
      const cell = executiveTimelineCell(row?.cells, index);
      const values = Array.isArray(cell) ? cell : cell === undefined || cell === null ? [] : [cell];
      return values.map(executiveOutcomeText).filter(Boolean);
    })
  })).filter(row => allowedAudiences.has(row.audience))
    .filter(row => row.label || row.cells.some(cell => cell.length));
  return {
    title: String(source?.title || 'Executive Milestones').trim(),
    quarters,
    phases,
    rows
  };
}

export function buildOverviewReportModel({
  week = {},
  trendWeeks = [],
  sections = [],
  overviewScope = 'system',
  executiveAudienceView = 'leadership',
  projectSelectionApplied = false,
  projectSelectionIsPartial = false
} = {}) {
  const projects = scopedProjects(week.projects, overviewScope);
  const attention = { action: [], monitor: [], strategy: [], watch: [] };
  projects.forEach(project => attention[project.attention].push(project));
  const quarterlyItems = projects.flatMap(project => project.quarterlyMilestones.map(item => ({
    ...item,
    projectName: project.name,
    projectCode: project.code,
    quarter: String(item?.quarter || '').toUpperCase()
  })));
  return {
    period: formatReportingPeriod(week),
    sections: [...sections],
    overviewScope: scopeLevel(overviewScope),
    executiveSummary: String(week.executiveSummary || week.summary || week.overviewSummary || ''),
    projectSelectionApplied,
    projectSelectionIsPartial,
    projects,
    health: healthSummary(projects),
    attention,
    riskRows: buildRiskRows(projects),
    executiveMilestones: projectSelectionIsPartial
      ? { title: 'Executive Milestones', quarters: [], phases: [], rows: [] }
      : normalizeExecutiveMilestones(week, executiveAudienceView),
    quarterlyItems,
    resource: buildResourceSummary(projects),
    budget: buildBudgetSummary(projects),
    trend: buildTrend(trendWeeks, overviewScope)
  };
}
