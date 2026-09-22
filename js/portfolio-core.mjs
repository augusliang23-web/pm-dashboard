export const PROJECT_LEVEL = Object.freeze({
  SYSTEM: 'system',
  HARDWARE_MODULE: 'hardware-module',
  SOFTWARE: 'software',
});

export const PROJECT_LIFECYCLE = Object.freeze({
  ACTIVE: 'active',
  ON_HOLD: 'on-hold',
  COMPLETED: 'completed',
});

export const OVERVIEW_SCOPE = Object.freeze({
  SYSTEM: PROJECT_LEVEL.SYSTEM,
  HARDWARE_MODULE: PROJECT_LEVEL.HARDWARE_MODULE,
  SOFTWARE: PROJECT_LEVEL.SOFTWARE,
  ALL: 'all',
});

export const RESOURCE_DISCIPLINES = Object.freeze([
  'hardware',
  'firmware',
  'systemElectrical',
  'mechanical',
  'pmo',
]);

const PROJECT_LEVELS = new Set(Object.values(PROJECT_LEVEL));
const OVERVIEW_SCOPES = new Set(Object.values(OVERVIEW_SCOPE));
const PROJECT_LIFECYCLES = new Set(Object.values(PROJECT_LIFECYCLE));
const OVERVIEW_RAG_STATUSES = new Set(['green', 'yellow', 'red']);
const OVERVIEW_MILESTONE_STATUSES = new Set(['planned', 'to-do', 'in-progress', 'done', 'at-risk']);
const RESOURCE_DISCIPLINE_SET = new Set(RESOURCE_DISCIPLINES);
const WORKSTREAM_STATUSES = new Set(['not-started', 'on-track', 'at-risk', 'delayed', 'completed']);
export const BUILT_IN_WORKSTREAM_TEMPLATES = Object.freeze({
  [PROJECT_LEVEL.SYSTEM]: Object.freeze(['Design', 'Integration', 'Validation', 'Certification', 'Launch']),
  [PROJECT_LEVEL.HARDWARE_MODULE]: Object.freeze(['Documentation', 'BOM Verification', 'Procurement', 'Assembly/Test', 'Certification']),
  [PROJECT_LEVEL.SOFTWARE]: Object.freeze(['Requirements', 'Development', 'Integration', 'Validation', 'Release']),
});

export function formatStatusDate(value) {
  let candidate = value;
  try {
    if (candidate && typeof candidate.toDate === 'function') candidate = candidate.toDate();
    else if (candidate && Number.isFinite(candidate.seconds)) {
      candidate = new Date(candidate.seconds * 1000 + Number(candidate.nanoseconds || 0) / 1000000);
    }
  } catch {
    return 'Not available';
  }
  const date = candidate instanceof Date ? new Date(candidate.getTime()) : new Date(candidate);
  if (!candidate || Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function resolveProjectStatusDate(project = {}, reportingPeriod = {}) {
  const projectCandidates = [project.statusDate, project.updatedAt, project.lastUpdatedAt];
  const reportingCandidates = [
    reportingPeriod.statusDate,
    reportingPeriod.reportingDate,
    reportingPeriod.weekEnding,
    reportingPeriod.weekEndDate,
    reportingPeriod.weekDate,
  ];
  for (const candidate of [...projectCandidates, ...reportingCandidates]) {
    const formatted = formatStatusDate(candidate);
    if (formatted !== 'Not available') return formatted;
  }

  const rangeEnd = String(reportingPeriod.weekDate || '').split(/\s+-\s+/).at(-1);
  const year = String(reportingPeriod.weekLabel || '').match(/\b(20\d{2})\b/)?.[1];
  return rangeEnd && year ? formatStatusDate(`${rangeEnd}, ${year} UTC`) : 'Not available';
}

function contentLines(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  return String(value || '').split('\n').map(item => item.trim()).filter(Boolean);
}

function multilineContent(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean).join('\n');
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

export function normalizeRiskActionRows(project = {}) {
  const stored = project.riskActions || project.riskPairs;
  if (Array.isArray(stored) && stored.length) {
    const rows = stored.map((item, sourceIndex) => ({
      risk: multilineContent(item?.risk || item?.description),
      action: multilineContent(item?.action || item?.actions || item?.mitigation || item?.requiredAction),
      primary: item?.primary === true || item?.isPrimary === true,
      sourceIndex,
    })).filter(item => item.risk || item.action);
    if (rows.length && !rows.some(item => item.primary)) rows[0].primary = true;
    return rows
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.sourceIndex - b.sourceIndex)
      .map(({ sourceIndex, ...item }) => item);
  }
  const risks = contentLines(project.risk);
  const actions = contentLines(project.next);
  return Array.from({ length: Math.max(risks.length, actions.length) }, (_, index) => ({
    risk: risks[index] || '',
    action: actions[index] || '',
    primary: index === 0,
  }));
}

export function getFocusTrapIndex(currentIndex, count, shiftKey) {
  if (count <= 0) return -1;
  if (currentIndex < 0) return shiftKey ? count - 1 : 0;
  if (shiftKey && currentIndex === 0) return count - 1;
  if (!shiftKey && currentIndex === count - 1) return 0;
  return currentIndex;
}

export function normalizeProject(source = {}) {
  const project = source && typeof source === 'object' ? source : {};

  return {
    ...project,
    projectLevel: PROJECT_LEVELS.has(project.projectLevel)
      ? project.projectLevel
      : PROJECT_LEVEL.SYSTEM,
    lifecycle: PROJECT_LIFECYCLES.has(project.lifecycle)
      ? project.lifecycle
      : PROJECT_LIFECYCLE.ACTIVE,
    projectType: stringValue(project.projectType ?? project.type),
    classification: stringValue(project.classification),
    productFamily: stringValue(project.productFamily),
    ganttWorkstreams: Array.isArray(project.ganttWorkstreams)
      ? project.ganttWorkstreams.map(normalizeWorkstream)
      : [],
    resources: isPlainObject(project.resources)
      ? Object.fromEntries(Object.entries(project.resources).map(([key, value]) => [
        key,
        RESOURCE_DISCIPLINE_SET.has(key)
          ? { ...(isPlainObject(value) ? value : {}), ...normalizeResourceEntry(value) }
          : value,
      ]))
      : {},
  };
}

export function normalizeResourceEntry(source = {}) {
  const entry = source && typeof source === 'object' ? source : {};
  const estimatedNumber = Number(entry.estimated);
  const actualBlank = entry.actual === null
    || entry.actual === undefined
    || (typeof entry.actual === 'string' && !entry.actual.trim());
  const actualNumber = actualBlank ? NaN : Number(entry.actual);
  const estimated = Number.isFinite(estimatedNumber) ? Math.max(estimatedNumber, 0) : 0;
  const actual = !actualBlank && Number.isFinite(actualNumber) ? Math.max(actualNumber, 0) : null;

  return {
    estimated,
    actual,
    remaining: actual === null ? null : Math.max(estimated - actual, 0),
    updatedAt: normalizeTimestamp(entry.updatedAt),
  };
}

export function validateResourceInput(value, blank = false) {
  if (blank) return { valid: true, value: null };
  return Number.isFinite(value) && value >= 0
    ? { valid: true, value }
    : { valid: false, value: null };
}

export function mergeResourceEntry(previousSource, estimated, actual, changedAt) {
  const source = previousSource && typeof previousSource === 'object' ? previousSource : {};
  const previous = normalizeResourceEntry(source);
  const unchanged = estimated === previous.estimated && actual === previous.actual;
  return {
    ...source,
    ...normalizeResourceEntry({
      estimated,
      actual,
      updatedAt: unchanged ? previous.updatedAt : changedAt,
    }),
  };
}

function validateWorkstreamTemplateNames(source) {
  const names = Array.isArray(source) ? source.map(name => String(name ?? '').trim()) : [];
  const errors = [];
  if (names.length < 1) errors.push('Add at least 1 workstream.');
  if (names.length > 20) errors.push('Use no more than 20 workstreams.');
  if (names.some(name => !name)) errors.push('Workstream names cannot be blank.');
  const comparable = names.filter(Boolean).map(name => name.toLocaleLowerCase());
  if (new Set(comparable).size !== comparable.length) {
    errors.push('Workstream names must be unique within this template (case-insensitive).');
  }
  return { names, errors };
}

function comparableRole(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function roleResourceKey(label) {
  const comparable = comparableRole(label);
  const legacyKeys = {
    hardware: 'hardware',
    firmware: 'firmware',
    'system electrical': 'systemElectrical',
    mechanical: 'mechanical',
    pmo: 'pmo',
  };
  return legacyKeys[comparable]
    || `role_${comparable.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unassigned'}`;
}

export function deriveRoleResourceRows(teamMembers = [], resources = {}, noAllocationRequired = false) {
  if (noAllocationRequired || !Array.isArray(teamMembers) || !teamMembers.length) return [];
  const sourceResources = resources && typeof resources === 'object' ? resources : {};
  const uniqueRoles = new Map();
  teamMembers.forEach(member => {
    const label = String(member?.roleName || member?.role || '').trim().replace(/\s+/g, ' ');
    const comparable = comparableRole(label);
    if (comparable && !uniqueRoles.has(comparable)) uniqueRoles.set(comparable, label);
  });

  return Array.from(uniqueRoles.entries()).map(([comparable, label]) => {
    const generatedKey = roleResourceKey(label);
    const matchingEntry = Object.entries(sourceResources).find(([key, entry]) => {
      const storedLabel = entry && typeof entry === 'object' ? entry.role || entry.label : '';
      return comparableRole(storedLabel) === comparable
        || comparableRole(key.replace(/^role_/, '').replace(/_/g, ' ')) === comparable;
    });
    const key = matchingEntry?.[0] || generatedKey;
    const source = matchingEntry?.[1] || sourceResources[generatedKey] || {};
    return {
      key,
      label,
      entry: {
        ...(source && typeof source === 'object' ? source : {}),
        ...normalizeResourceEntry(source),
      },
    };
  });
}

export function validateWorkstreamTemplateConfig(source = {}) {
  const config = {};
  const errors = {};
  for (const level of [PROJECT_LEVEL.SYSTEM, PROJECT_LEVEL.HARDWARE_MODULE]) {
    const result = validateWorkstreamTemplateNames(source?.[level]);
    config[level] = result.names;
    if (result.errors.length) errors[level] = result.errors;
  }
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    config,
  };
}

export function resolveWorkstreamTemplateConfig(source) {
  const result = validateWorkstreamTemplateConfig(source);
  const selected = result.valid ? result.config : BUILT_IN_WORKSTREAM_TEMPLATES;
  return {
    [PROJECT_LEVEL.SYSTEM]: [...selected[PROJECT_LEVEL.SYSTEM]],
    [PROJECT_LEVEL.HARDWARE_MODULE]: [...selected[PROJECT_LEVEL.HARDWARE_MODULE]],
    [PROJECT_LEVEL.SOFTWARE]: [...(selected[PROJECT_LEVEL.SOFTWARE] || BUILT_IN_WORKSTREAM_TEMPLATES[PROJECT_LEVEL.SOFTWARE])],
  };
}

export const DEFAULT_GANTT_WINDOW_MONTHS = 6;
export const GANTT_WINDOW_MONTHS_RANGE = Object.freeze({ min: 1, max: 36 });

function isValidGanttWindowMonths(value) {
  return Number.isInteger(value) && value >= GANTT_WINDOW_MONTHS_RANGE.min && value <= GANTT_WINDOW_MONTHS_RANGE.max;
}

/**
 * Validates an admin's draft Gantt display-window settings (default months
 * plus per-project overrides, keyed by project code) before it is sent to
 * saveDashboardGanttWindowSettings.
 */
export function validateGanttWindowConfig(source = {}) {
  const errors = {};
  const rangeMessage = `Enter a whole number of months between ${GANTT_WINDOW_MONTHS_RANGE.min} and ${GANTT_WINDOW_MONTHS_RANGE.max}.`;
  const defaultMonths = Number(source?.defaultMonths);
  if (!isValidGanttWindowMonths(defaultMonths)) errors.defaultMonths = [rangeMessage];

  const overridesSource = source?.overrides && typeof source.overrides === 'object' && !Array.isArray(source.overrides)
    ? source.overrides
    : {};
  const overrides = {};
  const overrideErrors = [];
  const seenCodes = new Set();
  for (const [code, months] of Object.entries(overridesSource)) {
    const trimmedCode = String(code || '').trim();
    if (!trimmedCode) {
      overrideErrors.push('Every project override needs a project selected.');
      continue;
    }
    if (seenCodes.has(trimmedCode)) {
      overrideErrors.push(`${trimmedCode} is selected more than once.`);
      continue;
    }
    seenCodes.add(trimmedCode);
    const numericMonths = Number(months);
    if (!isValidGanttWindowMonths(numericMonths)) {
      overrideErrors.push(`${trimmedCode}: ${rangeMessage}`);
      continue;
    }
    overrides[trimmedCode] = numericMonths;
  }
  if (overrideErrors.length) errors.overrides = overrideErrors;

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    config: {
      defaultMonths: isValidGanttWindowMonths(defaultMonths) ? defaultMonths : DEFAULT_GANTT_WINDOW_MONTHS,
      overrides,
    },
  };
}

/**
 * Sanitizes the raw dashboardSettings/team-2-portfolio document (as read
 * from Firestore) into a clean { defaultMonths, overrides } shape, falling
 * back to the 6-month default whenever a field is missing or malformed.
 */
export function resolveGanttWindowConfig(source) {
  const doc = source && typeof source === 'object' ? source : {};
  const defaultMonths = Number(doc.ganttWindowDefaultMonths);
  const overridesSource = doc.ganttWindowOverrides && typeof doc.ganttWindowOverrides === 'object'
    ? doc.ganttWindowOverrides
    : {};
  const overrides = {};
  for (const [code, months] of Object.entries(overridesSource)) {
    const trimmedCode = String(code || '').trim();
    const numeric = Number(months);
    if (trimmedCode && isValidGanttWindowMonths(numeric)) overrides[trimmedCode] = numeric;
  }
  return {
    defaultMonths: isValidGanttWindowMonths(defaultMonths) ? defaultMonths : DEFAULT_GANTT_WINDOW_MONTHS,
    overrides,
  };
}

export function createDefaultWorkstreams(projectLevel, templateConfigOrNames) {
  const level = PROJECT_LEVELS.has(projectLevel) ? projectLevel : PROJECT_LEVEL.SYSTEM;
  let names;
  if (Array.isArray(templateConfigOrNames)) {
    const direct = validateWorkstreamTemplateNames(templateConfigOrNames);
    names = direct.errors.length ? BUILT_IN_WORKSTREAM_TEMPLATES[level] : direct.names;
  } else {
    names = resolveWorkstreamTemplateConfig(templateConfigOrNames)[level];
  }
  return names.map((name, index) => normalizeWorkstream({ name }, index));
}

export function normalizeWorkstream(source = {}, index = 0) {
  const row = source && typeof source === 'object' ? source : {};
  const numericProgress = Number(row.progress);
  const numericSortOrder = Number(row.sortOrder);

  return {
    id: stringValue(row.id) || `workstream-${index + 1}`,
    name: stringValue(row.name),
    startDate: stringValue(row.startDate),
    endDate: stringValue(row.endDate),
    status: WORKSTREAM_STATUSES.has(row.status) ? row.status : 'not-started',
    progress: Number.isFinite(numericProgress) ? numericProgress : 0,
    milestoneId: stringValue(row.milestoneId),
    summaryGroupId: stringValue(row.summaryGroupId),
    sortOrder: Number.isFinite(numericSortOrder) ? numericSortOrder : index,
  };
}

export function getGanttProgressSegments(value) {
  const numeric = Number(value);
  const progress = Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : 0;
  return {
    progress,
    completedPercent: progress,
    remainingPercent: 100 - progress,
  };
}

export function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
}

const CALENDAR_DAY_MS = 86400000;
const CALENDAR_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcWeekStart(date) {
  const value = utcDay(date);
  const mondayOffset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - mondayOffset);
  return value;
}

function utcMonthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * CALENDAR_DAY_MS);
}

function addUtcMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function isoWeekNumber(date) {
  const thursday = utcDay(date);
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7),
  );
  return 1 + Math.round(
    (thursday.getTime() - firstThursday.getTime()) / (7 * CALENDAR_DAY_MS),
  );
}

function calendarDateLabel(date, includeYear = false) {
  const month = CALENDAR_MONTHS[date.getUTCMonth()];
  return includeYear
    ? `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
    : `${month} ${date.getUTCDate()}`;
}

function groupCalendarTicks(ticks, axisEnd, keyForTick, labelForTick) {
  const groups = [];
  ticks.forEach((tick, index) => {
    const key = keyForTick(tick.date);
    const end = ticks[index + 1]?.date || axisEnd;
    const current = groups.at(-1);
    if (current?.key === key) {
      current.end = end;
      current.span += 1;
      return;
    }
    groups.push({
      key,
      label: labelForTick(tick.date),
      start: tick.date,
      end,
      span: 1,
    });
  });
  return groups;
}

export function buildGanttCalendarAxis(start, end, scale = 'month') {
  if (!(start instanceof Date) || !(end instanceof Date)
    || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
    || start > end) return null;

  const actualStart = utcDay(start);
  const actualEnd = utcDay(end);
  const normalizedScale = scale === 'week' ? 'week' : 'month';
  const axisStart = normalizedScale === 'week'
    ? utcWeekStart(actualStart)
    : utcMonthStart(actualStart);
  const finalIntervalStart = normalizedScale === 'week'
    ? utcWeekStart(actualEnd)
    : utcMonthStart(actualEnd);
  const axisEnd = normalizedScale === 'week'
    ? addUtcDays(finalIntervalStart, 7)
    : addUtcMonths(finalIntervalStart, 1);
  const ticks = [];

  for (
    let cursor = new Date(axisStart);
    cursor < axisEnd;
    cursor = normalizedScale === 'week' ? addUtcDays(cursor, 7) : addUtcMonths(cursor, 1)
  ) {
    ticks.push({
      date: cursor,
      label: normalizedScale === 'week'
        ? `W${String(isoWeekNumber(cursor)).padStart(2, '0')} · ${calendarDateLabel(cursor)}`
        : CALENDAR_MONTHS[cursor.getUTCMonth()],
    });
  }

  const groups = normalizedScale === 'week'
    ? groupCalendarTicks(
      ticks,
      axisEnd,
      date => `${date.getUTCFullYear()}-${date.getUTCMonth()}`,
      date => `${CALENDAR_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    )
    : groupCalendarTicks(
      ticks,
      axisEnd,
      date => String(date.getUTCFullYear()),
      date => String(date.getUTCFullYear()),
    );

  return {
    scale: normalizedScale,
    actualStart,
    actualEnd,
    axisStart,
    axisEnd,
    ticks,
    groups,
    guidance: normalizedScale === 'week'
      ? 'Each grid column represents one calendar week.'
      : 'Each grid column represents one calendar month.',
    rangeLabel: `${calendarDateLabel(actualStart, true)} – ${calendarDateLabel(actualEnd, true)}`,
  };
}

export function createTimelineTicks(start, end, scale = 'month', maxTicks = 60) {
  if (!(start instanceof Date) || !(end instanceof Date) || start > end) return [];
  const candidates = [new Date(start)];
  const cursor = new Date(start);
  while (cursor < end) {
    if (scale === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    if (cursor < end) candidates.push(new Date(cursor));
  }
  candidates.push(new Date(end));
  if (candidates.length <= maxTicks) return candidates;
  const stride = Math.ceil((candidates.length - 1) / (maxTicks - 1));
  const ticks = candidates.filter((_, index) => index === 0 || index % stride === 0);
  if (ticks.at(-1).getTime() !== end.getTime()) ticks.push(new Date(end));
  return ticks;
}

export function calculateDropIndex(pointerY, rowBounds = []) {
  const index = rowBounds.findIndex(bounds => pointerY < (bounds.top + bounds.bottom) / 2);
  return index < 0 ? rowBounds.length : index;
}

const ATTENTION_PRIORITY = Object.freeze({
  action: 0,
  strategy: 1,
  monitor: 2,
  watch: 3,
});

export function orderProjectsByAttention(source = [], getAttention = project => project?.attention) {
  const projects = Array.isArray(source) ? source : [];
  return projects
    .map((project, index) => ({
      project,
      index,
      rank: ATTENTION_PRIORITY[getAttention(project)] ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(entry => entry.project);
}

export function validateWorkstreams(rows = [], milestoneIds) {
  if (!Array.isArray(rows)) return [];
  const validMilestones = Array.isArray(milestoneIds) ? new Set(milestoneIds) : null;
  const errors = [];

  rows.forEach((source, index) => {
    const row = normalizeWorkstream(source, index);
    const fields = {};
    if (!row.name) fields.name = 'Name is required.';
    const start = row.startDate ? parseIsoDate(row.startDate) : null;
    const end = row.endDate ? parseIsoDate(row.endDate) : null;
    if (row.startDate && !start) fields.startDate = 'Enter a valid date.';
    if (row.endDate && !end) fields.endDate = 'Enter a valid date.';
    if (start && end && end < start) {
      fields.endDate = 'End date cannot be before start date.';
    }
    if (row.progress < 0 || row.progress > 100) {
      fields.progress = 'Progress must be between 0 and 100.';
    }
    if (validMilestones && row.milestoneId && !validMilestones.has(row.milestoneId)) {
      fields.milestoneId = 'Select an existing milestone.';
    }
    if (Object.keys(fields).length) errors.push({ index, fields });
  });

  return errors;
}

export function filterProjects(source = [], filters = {}) {
  const projects = Array.isArray(source) ? source.map(normalizeProject) : [];
  const scope = normalizedFilter(filters.scope);
  const pm = normalizedFilter(filters.pm);
  const rag = normalizedFilter(filters.rag);
  const lifecycle = normalizedFilter(filters.lifecycle);
  const productFamily = normalizedFilter(filters.productFamily);
  const projectType = normalizedFilter(filters.projectType);
  const classification = normalizedFilter(filters.classification);
  const search = normalizedFilter(filters.search);

  return projects.filter(project => {
    const projectManager = project.pm ?? project.projectManager ?? project.owner;

    return (
      (isAll(scope) || normalizedFilter(project.projectLevel) === scope)
      && (isAll(pm) || normalizedFilter(projectManager) === pm)
      && (isAll(rag) || normalizedFilter(project.status) === rag)
      && (isAll(lifecycle) || normalizedFilter(project.lifecycle) === lifecycle)
      && (isAll(productFamily) || normalizedFilter(project.productFamily) === productFamily)
      && (isAll(projectType) || normalizedFilter(project.projectType) === projectType)
      && (isAll(classification) || normalizedFilter(project.classification) === classification)
      && (!search || normalizedFilter(`${project.code ?? ''} ${project.name ?? ''}`).includes(search))
    );
  });
}

export function normalizeOverviewScope(value) {
  return OVERVIEW_SCOPES.has(value) ? value : OVERVIEW_SCOPE.SYSTEM;
}

export function getOverviewProjects(source = [], scope = OVERVIEW_SCOPE.SYSTEM) {
  const projects = Array.isArray(source) ? source.map(normalizeProject) : [];
  const normalizedScope = normalizeOverviewScope(scope);
  return normalizedScope === OVERVIEW_SCOPE.ALL
    ? projects
    : projects.filter(project => project.projectLevel === normalizedScope);
}

export function getOverviewProjectBadgeLabel(project = {}, scope = OVERVIEW_SCOPE.SYSTEM) {
  if (normalizeOverviewScope(scope) !== OVERVIEW_SCOPE.ALL) return '';
  const level = normalizeProject(project).projectLevel;
  if (level === PROJECT_LEVEL.HARDWARE_MODULE) return 'Module';
  if (level === PROJECT_LEVEL.SOFTWARE) return 'Software';
  return 'System';
}

export function normalizeOverviewRagStatus(value) {
  return OVERVIEW_RAG_STATUSES.has(value) ? value : 'green';
}

export function normalizeOverviewMilestoneStatus(value) {
  return OVERVIEW_MILESTONE_STATUSES.has(value) ? value : 'to-do';
}

export function normalizeOverviewPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0;
}

export function summarizeTeamEffort(members = []) {
  const rows = Array.isArray(members) ? members : [];
  const totalPct = rows.reduce((sum, member) => {
    const effort = Number(member?.effortPct ?? member?.effort);
    return sum + (Number.isFinite(effort) && effort >= 0 && effort <= 100 ? effort : 0);
  }, 0);
  return {
    memberCount: rows.length,
    averagePct: rows.length ? Math.round(totalPct / rows.length) : 0,
    fte: Math.round(totalPct / 10) / 10,
  };
}

function oneDecimal(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

export function buildResourceAnalytics(projects = []) {
  const byLevel = {
    [PROJECT_LEVEL.SYSTEM]: 0,
    [PROJECT_LEVEL.HARDWARE_MODULE]: 0,
    [PROJECT_LEVEL.SOFTWARE]: 0,
  };
  const people = new Map();
  const functions = new Map();
  let totalPct = 0;

  (Array.isArray(projects) ? projects : []).forEach(project => {
    const level = PROJECT_LEVELS.has(project?.projectLevel) ? project.projectLevel : PROJECT_LEVEL.SYSTEM;
    (Array.isArray(project?.teamMembers) ? project.teamMembers : []).forEach(member => {
      const effort = Math.max(0, Number(member?.effortPct ?? member?.effort) || 0);
      const name = String(member?.name || '').trim().toLocaleLowerCase();
      const roleLabel = String(member?.roleName || member?.role || '').trim().replace(/\s+/g, ' ');
      const roleKey = roleLabel.toLocaleLowerCase();
      if (!effort && !name && !roleKey) return;
      totalPct += effort;
      byLevel[level] += effort / 100;
      if (name) people.set(name, (people.get(name) || 0) + effort);
      if (roleKey) {
        const item = functions.get(roleKey) || {
          role: roleLabel,
          people: new Map(),
          levels: {
            [PROJECT_LEVEL.SYSTEM]: 0,
            [PROJECT_LEVEL.HARDWARE_MODULE]: 0,
            [PROJECT_LEVEL.SOFTWARE]: 0,
          },
        };
        item.levels[level] += effort / 100;
        if (name) item.people.set(name, (item.people.get(name) || 0) + effort);
        functions.set(roleKey, item);
      }
    });
  });

  const personLoads = [...people.values()];
  return {
    totalAllocatedFte: oneDecimal(totalPct / 100),
    overallocatedPeople: personLoads.filter(total => total > 100).length,
    availableCapacityFte: oneDecimal(personLoads.reduce((sum, total) => sum + Math.max(100 - total, 0), 0) / 100),
    byLevel: Object.fromEntries(Object.entries(byLevel).map(([level, value]) => [level, oneDecimal(value)])),
    byFunction: [...functions.values()]
      .map(item => {
        const totalFte = oneDecimal(Object.values(item.levels).reduce((sum, value) => sum + value, 0));
        const knownPeople = item.people.size || Math.ceil(totalFte);
        const allocatedPeople = item.people.size
          ? [...item.people.values()].filter(total => total > 0).length
          : knownPeople;
        const capacityFte = oneDecimal(knownPeople);
        return {
          role: item.role,
          levels: Object.fromEntries(Object.entries(item.levels).map(([level, value]) => [level, oneDecimal(value)])),
          totalFte,
          knownPeople,
          allocatedPeople,
          capacityFte,
          utilizationPct: capacityFte ? Math.round((totalFte / capacityFte) * 100) : 0,
        };
      })
      .sort((a, b) => b.totalFte - a.totalFte || a.role.localeCompare(b.role)),
  };
}

export function filterRoleVisibleProjects(source = [], options = {}) {
  const projects = Array.isArray(source) ? source : [];
  const role = stringValue(options.role).toLocaleLowerCase() || 'pm';
  const restrictToActive = options.executivePerspective === true
    || role !== 'admin'
    || options.visibilityFilter === 'active';
  return restrictToActive
    ? projects.filter(project => !project?.visibility || project.visibility === 'active')
    : [...projects];
}

export function parseProjectOwnershipTokens(value) {
  return String(value ?? '')
    .split(/[,;|/\r\n]+/)
    .map(token => token.trim().toLocaleLowerCase())
    .filter(Boolean);
}

export function projectOwnershipMatchesIdentity(project = {}, identity = {}) {
  const email = stringValue(identity.email).toLocaleLowerCase();
  const identityTokens = new Set([
    stringValue(identity.displayName).toLocaleLowerCase(),
    email,
    email.split('@')[0],
  ].filter(Boolean));
  if (!identityTokens.size) return false;

  return [project?.owner, project?.deputy]
    .flatMap(parseProjectOwnershipTokens)
    .some(token => identityTokens.has(token));
}

export function getOverviewScopeStorageKey(identity) {
  const normalized = stringValue(identity);
  return normalized ? `team2.overviewScope.${encodeURIComponent(normalized)}` : '';
}

export function matchOverviewSummaryProjectLine(line, projects = []) {
  const unwrapped = String(line || '')
    .trim()
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '');
  const content = stripSummaryMarkdown(unwrapped).trim();
  const normalizedContent = content.toLocaleLowerCase();
  const identities = (Array.isArray(projects) ? projects : [])
    .flatMap(project => [project?.name, project?.code]
      .map(value => stringValue(value))
      .filter(Boolean)
      .map(key => ({ key, project })))
    .sort((a, b) => b.key.length - a.key.length);

  for (const identity of identities) {
    if (!normalizedContent.startsWith(identity.key.toLocaleLowerCase())) continue;
    const remainder = content.slice(identity.key.length);
    const delimiter = remainder.match(/^\s*:\s*/);
    if (delimiter) {
      return {
        project: identity.project,
        prefix: identity.key,
        body: remainder.slice(delimiter[0].length).trim(),
      };
    }
    if (!/^\s+/.test(remainder)) continue;
    const labeledBody = remainder.trim();
    if (!/^[^:\r\n]{1,48}:\s*\S/.test(labeledBody)) continue;
    return {
      project: identity.project,
      prefix: identity.key,
      body: labeledBody,
    };
  }
  return null;
}

export function filterOverviewSummaryLines(summary, allProjects = [], scopedProjects = allProjects) {
  const included = new Set((Array.isArray(scopedProjects) ? scopedProjects : [])
    .map(projectMembershipKey)
    .filter(Boolean));
  const lines = [];
  let excludedBlockIndent = null;
  String(summary || '').replace(/\r\n?/g, '\n').split('\n').forEach(line => {
    const heading = isOverviewSummaryHeading(line);
    const indent = summaryLineIndent(line);
    const blockStart = summaryBlockStart(line);
    const match = matchOverviewSummaryProjectLine(line, allProjects);
    if (excludedBlockIndent !== null) {
      const isBoundary = !line.trim()
        || heading
        || Boolean(match)
        || (blockStart && blockStart.indent <= excludedBlockIndent);
      if (!isBoundary) return;
      excludedBlockIndent = null;
    }

    if (match && !included.has(projectMembershipKey(match.project))) {
      excludedBlockIndent = blockStart?.indent ?? indent;
      return;
    }
    lines.push(line);
  });
  const withoutOrphanHeadings = lines.filter((line, index) => {
    if (!isOverviewSummaryHeading(line)) return true;
    const sectionEnd = lines.findIndex((candidate, candidateIndex) => (
      candidateIndex > index && isOverviewSummaryHeading(candidate)
    ));
    const end = sectionEnd < 0 ? lines.length : sectionEnd;
    return lines.slice(index + 1, end).some(candidate => candidate.trim());
  });
  while (withoutOrphanHeadings[0]?.trim() === '') withoutOrphanHeadings.shift();
  while (withoutOrphanHeadings.at(-1)?.trim() === '') withoutOrphanHeadings.pop();
  return withoutOrphanHeadings.join('\n');
}

export function normalizeOverviewSummaryHeading(line) {
  const cleaned = stripSummaryMarkdown(line)
    .replace(/^>\s*/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const known = /^(weekly movement|weekly progress|portfolio movement|project movement|executive summary|key updates|management ask|management asks|management request|decision needed|executive ask|support needed)$/i;
  if (known.test(cleaned)) return cleaned;
  if (cleaned.length <= 48 && /^[A-Z][A-Za-z0-9&/() -]+$/.test(cleaned)) return cleaned;
  if (cleaned.length <= 32 && /[\u4e00-\u9fff]/.test(cleaned) && !/[.!?。！？]$/.test(cleaned)) return cleaned;
  return '';
}

function isOverviewSummaryHeading(line) {
  const value = String(line || '').trim();
  if (/^#{1,6}\s+\S/.test(value)) return true;
  return Boolean(normalizeOverviewSummaryHeading(value));
}

function summaryLineIndent(line) {
  const whitespace = String(line || '').match(/^[\t ]*/)?.[0] || '';
  return [...whitespace].reduce((sum, char) => sum + (char === '\t' ? 2 : 1), 0);
}

function summaryBlockStart(line) {
  const match = String(line || '').match(/^([\t ]*)(?:[-*+]|\d+[.)])\s+/);
  return match ? { indent: summaryLineIndent(match[1]) } : null;
}

function stripSummaryMarkdown(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*+/g, '');
}

function projectMembershipKey(project = {}) {
  const code = stringValue(project.code).toLocaleLowerCase();
  return code ? `code:${code}` : `name:${stringValue(project.name).toLocaleLowerCase()}`;
}

function stringValue(value) {
  return (value ?? '').toString().trim();
}

function normalizeTimestamp(value) {
  let date;
  try {
    if (value instanceof Date) {
      date = value;
    } else if (value && typeof value.toDate === 'function') {
      date = value.toDate();
    } else if (value && typeof value === 'object' && Number.isFinite(value.seconds)) {
      const nanoseconds = value.nanoseconds ?? 0;
      if (!Number.isFinite(nanoseconds)) return '';
      date = new Date(value.seconds * 1000 + nanoseconds / 1e6);
    } else if (typeof value === 'string' && value.trim()) {
      date = new Date(value.trim());
    } else {
      return '';
    }
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : '';
  } catch {
    return '';
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedFilter(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isAll(value) {
  return !value || value === 'all';
}
