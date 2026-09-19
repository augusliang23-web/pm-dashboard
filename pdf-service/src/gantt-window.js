const DEFAULT_WINDOW_MONTHS = 6;
const BACKWARD_BUFFER_MONTHS = 1;
const MIN_WINDOW_MONTHS = 1;
const MAX_WINDOW_MONTHS = 36;
const PROTECTED_STATUSES = new Set(['at-risk', 'delayed', 'risk']);

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMonthsUtc(date, months) {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function isValidWindowMonths(value) {
  return Number.isInteger(value) && value >= MIN_WINDOW_MONTHS && value <= MAX_WINDOW_MONTHS;
}

/**
 * Anchors the display window to the reporting week's own date rather than the
 * server clock, so a PDF regenerated for a past week keeps showing that
 * week's window instead of drifting with "today". Falls back to the current
 * UTC date when the week carries no parseable date.
 */
export function resolveReportAnchorDate(week = {}) {
  const year = String(week?.weekLabel || '').match(/\b(20\d{2})\b/)?.[1];
  const rangeEnd = String(week?.weekDate || '').split(/\s*(?:-|–|—)\s*/).filter(Boolean).at(-1);
  if (rangeEnd) {
    const candidate = new Date(`${rangeEnd}${year ? `, ${year}` : ''} UTC`);
    if (!Number.isNaN(candidate.getTime())) return candidate;
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Sanitizes the raw dashboardSettings/team-2-portfolio document into a clean
 * { defaultMonths, overrides } shape, discarding anything out of range so a
 * malformed or partially-written setting can never crash report generation.
 */
export function resolveGanttWindowSettings(source) {
  const doc = source && typeof source === 'object' ? source : {};
  const defaultMonths = Number(doc.ganttWindowDefaultMonths);
  const overridesSource = doc.ganttWindowOverrides && typeof doc.ganttWindowOverrides === 'object'
    ? doc.ganttWindowOverrides
    : {};
  const overrides = {};
  for (const [code, months] of Object.entries(overridesSource)) {
    const numeric = Number(months);
    const trimmedCode = String(code || '').trim();
    if (trimmedCode && isValidWindowMonths(numeric)) overrides[trimmedCode] = numeric;
  }
  return {
    defaultMonths: isValidWindowMonths(defaultMonths) ? defaultMonths : DEFAULT_WINDOW_MONTHS,
    overrides
  };
}

/**
 * Returns the effective window length for a project from an already-resolved
 * { defaultMonths, overrides } settings object (see resolveGanttWindowSettings
 * above, which is the only place that reads the raw Firestore document shape).
 *
 * Returns null when the caller passed no settings object at all - distinct
 * from an explicit (even empty) settings object, which always resolves to at
 * least the 6-month default. Report generation (report-data.js) always
 * resolves and passes a settings object, so production PDFs always have a
 * window applied; callers that omit the argument (most existing report-model
 * call sites and their tests) get unfiltered Gantt data, exactly as before
 * this feature existed.
 */
export function resolveGanttWindowMonths(projectCode, settings) {
  if (!settings || typeof settings !== 'object') return null;
  const code = String(projectCode || '').trim();
  const overrides = settings.overrides && typeof settings.overrides === 'object' ? settings.overrides : {};
  const overrideMonths = code ? Number(overrides[code]) : NaN;
  if (isValidWindowMonths(overrideMonths)) return overrideMonths;
  const defaultMonths = Number(settings.defaultMonths);
  return isValidWindowMonths(defaultMonths) ? defaultMonths : DEFAULT_WINDOW_MONTHS;
}

/**
 * Bounds the Gantt/Schedule Summary quadrant to a display window around the
 * reporting week - a short buffer backward (recently-completed context) plus
 * an admin-configured number of months forward. At-risk/delayed workstreams
 * and workstreams with no parseable dates are always kept: a filtered task
 * disappearing from the one-pager only ever happens when it is safely outside
 * the window and not something the PM needs management attention on right now.
 */
export function filterWorkstreamsByWindow({ workstreams = [], anchorDate, windowMonths = DEFAULT_WINDOW_MONTHS } = {}) {
  const rows = Array.isArray(workstreams) ? workstreams : [];
  const anchor = anchorDate instanceof Date && !Number.isNaN(anchorDate.getTime())
    ? anchorDate
    : resolveReportAnchorDate();
  const months = isValidWindowMonths(windowMonths) ? windowMonths : DEFAULT_WINDOW_MONTHS;
  const windowStart = addMonthsUtc(anchor, -BACKWARD_BUFFER_MONTHS);
  const windowEnd = addMonthsUtc(anchor, months);

  let filteredOutCount = 0;
  const kept = rows.filter(item => {
    if (PROTECTED_STATUSES.has(String(item?.status || '').toLowerCase())) return true;
    const start = parseIsoDate(item?.startDate);
    const end = parseIsoDate(item?.endDate);
    if (!start || !end) return true;
    const inWindow = end >= windowStart && start <= windowEnd;
    if (!inWindow) filteredOutCount += 1;
    return inWindow;
  });

  return { workstreams: kept, filteredOutCount, totalCount: rows.length };
}

export { DEFAULT_WINDOW_MONTHS, MIN_WINDOW_MONTHS, MAX_WINDOW_MONTHS, BACKWARD_BUFFER_MONTHS };
