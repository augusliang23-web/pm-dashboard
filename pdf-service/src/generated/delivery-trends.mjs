/** Pure authorized-data calculation. See CONTRACT.md. No I/O or ambient clock. */
const DAY = 86400000;
const WEEK = 7 * DAY;
const LEVELS = new Set(['system', 'hardware-module', 'software', 'all']);
const text = value => typeof value === 'string' ? value.trim() : '';
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const changes = () => ({ firstObserved: [], confirmedCompleted: [], missingObservation: [],
  ambiguousIdentity: [], enteredScope: [], exitedScope: [], confirmedRebaseline: [] });
const summary = () => ({ weeklyProgressGainPp: null, comparableCount: 0, projectsProgressedCount: null,
  currentCompletionPct: null, health: { green: null, yellow: null, red: null, unknown: null } });

function percent(value) {
  if (typeof value === 'string') {
    if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    value = Number(value);
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function yearStart(year) {
  const jan4 = Date.UTC(year, 0, 4);
  const day = new Date(jan4).getUTCDay() || 7;
  return jan4 - (day - 1) * DAY;
}
function periodStart(period) {
  if (!period || !Number.isInteger(period.year) || period.year < 1900 || period.year > 9998
    || !Number.isInteger(period.week) || period.week < 1 || period.week > 53) return null;
  const start = yearStart(period.year) + (period.week - 1) * WEEK;
  return start < yearStart(period.year + 1) ? start : null;
}
function periodAt(start) {
  const year = new Date(start + 3 * DAY).getUTCFullYear();
  return { year, week: Math.floor((start - yearStart(year)) / WEEK) + 1 };
}
function identity(project) {
  const id = text(project?.projectId);
  if (id) return `id:${id}`;
  const code = text(project?.code).toLowerCase();
  return code ? `code:${code}` : null;
}
function inScope(project, key, scope) {
  const visible = !project.visibility || project.visibility === 'active';
  const level = project.projectLevel || 'system';
  return visible && (scope.projectLevel === 'all' || level === scope.projectLevel)
    && (!scope.projectKeys || scope.projectKeys.includes(key));
}
function confirmedRebaseline(previous, current) {
  const evidence = current.rebaseline;
  return evidence?.verified === true && Boolean(text(previous.baselineId))
    && Boolean(text(current.baselineId)) && previous.baselineId !== current.baselineId
    && evidence.fromBaselineId === previous.baselineId && evidence.toBaselineId === current.baselineId;
}

/**
 * @param {object} input Pre-authorized weeks and explicit source/period/policy metadata.
 * @returns {object} delivery-trends/v1 presentation result; unavailable metrics are null.
 */
export function calculateDeliveryTrends(input = {}) {
  const result = { contractVersion: 'delivery-trends/v1', provenance: {
    source: text(input?.source) || null, anchorWeekId: text(input?.anchorWeekId) || null,
    asOf: text(input?.asOf) || null, windowWeeks: input?.windowWeeks ?? null
  }, status: 'unavailable', summary: summary(), weeklySeries: [], projects: [], changes: changes(), warnings: [] };
  const warn = (code, weekId = null, count = 1) => result.warnings.push({ code, message: code.replaceAll('-', ' '), weekId, count });
  const invalid = code => { warn(code); return result; };
  if (!['production', 'uat', 'synthetic'].includes(input?.source)
    || !text(input?.asOf) || !Number.isFinite(Date.parse(input.asOf))
    || !text(input?.anchorWeekId)) return invalid('invalid-provenance');
  if (![6, 12].includes(input.windowWeeks)) return invalid('invalid-window');
  if (!['released', 'include-drafts'].includes(input.publicationMode)) return invalid('invalid-publication-policy');
  const scope = input.scope;
  if (!scope || !LEVELS.has(scope.projectLevel)
    || (scope.projectKeys != null && (!Array.isArray(scope.projectKeys)
      || scope.projectKeys.some(key => typeof key !== 'string' || !/^(id|code):.+$/.test(key))))) return invalid('invalid-scope');
  if (!Array.isArray(input.weeks)) return invalid('invalid-weeks');
  const seenIds = new Set();
  const seenPeriods = new Set();
  const eligible = [];
  for (const source of input.weeks) {
    // Publication exclusion happens before diagnostics: excluded records reveal no details.
    if (input.publicationMode === 'released' && source?.isReleased !== true) continue;
    const weekId = text(source?.weekId);
    const start = periodStart(source?.reportingPeriod);
    if (!weekId || start === null || !Array.isArray(source.projects)) return invalid('invalid-reporting-week');
    if (seenIds.has(weekId) || seenPeriods.has(start)) return invalid('ambiguous-week-order');
    seenIds.add(weekId); seenPeriods.add(start); eligible.push({ ...source, weekId, start });
  }
  const anchor = eligible.find(week => week.weekId === input.anchorWeekId);
  if (!anchor) return invalid('anchor-unavailable');
  const first = anchor.start - (input.windowWeeks - 1) * WEEK;
  const relevant = eligible.filter(week => week.start >= first - WEEK && week.start <= anchor.start)
    .sort((a, b) => a.start - b.start);
  const byStart = new Map();
  const ambiguousKeys = new Set();
  let unidentifiedCount = 0;
  for (const week of relevant) {
    const counts = new Map();
    const codeCounts = new Map();
    for (const project of week.projects) {
      const code = text(project?.code).toLowerCase();
      if (code) codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
      const key = identity(project);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const rows = new Map();
    let rejected = 0;
    for (const project of week.projects) {
      const key = identity(project);
      if (!key || counts.get(key) !== 1 || (key.startsWith('code:') && codeCounts.get(key.slice(5)) !== 1)) {
        rejected++;
        if (key) ambiguousKeys.add(key);
        else unidentifiedCount++;
        continue;
      }
      rows.set(key, { project, key, scoped: inScope(project, key, scope), completionPct: percent(project.progress) });
    }
    if (rejected) {
      warn('ambiguous-project-identity', week.weekId, rejected);
      // Raw rejected identity/display details never enter diagnostics.
    }
    byStart.set(week.start, { ...week, rows, rejected });
  }
  // Any duplicate in the requested history invalidates that key throughout the window.
  for (const week of byStart.values()) for (const key of ambiguousKeys) week.rows.delete(key);
  const firstSeen = new Set();
  const projectSeries = new Map();
  const baseline = byStart.get(first - WEEK);
  if (baseline) for (const key of baseline.rows.keys()) firstSeen.add(key);
  for (let start = first; start <= anchor.start; start += WEEK) {
    const current = byStart.get(start);
    const previous = byStart.get(start - WEEK);
    const row = { weekId: current?.weekId ?? null, reportingPeriod: periodAt(start),
      status: 'unavailable', ...summary(), changes: changes(), scopeProjectCount: null, validProgressCount: null,
      missingProgressCount: null, comparison: { previousWeekId: previous?.weekId ?? null,
        status: 'unavailable', identityConfidence: null, baselineVerification: null, excludedByReason: {} } };
    if (!current) {
      warn('missing-calendar-week');
      result.weeklySeries.push(row);
      continue;
    }
    row.health = { green: 0, yellow: 0, red: 0, unknown: 0 };
    const scoped = [...current.rows.values()].filter(item => item.scoped);
    row.scopeProjectCount = scoped.length;
    const valid = scoped.filter(item => item.completionPct !== null);
    row.validProgressCount = valid.length;
    row.missingProgressCount = scoped.length - valid.length;
    row.currentCompletionPct = valid.length ? round(valid.reduce((sum, item) => sum + item.completionPct, 0) / valid.length) : null;
    if (row.missingProgressCount) warn('missing-or-invalid-progress', current.weekId, row.missingProgressCount);
    for (const item of scoped) {
      const health = ['green', 'yellow', 'red'].includes(item.project.status) ? item.project.status : 'unknown';
      row.health[health]++;
    }
    let deltaSum = 0;
    let progressed = 0;
    let provisional = false;
    let unverified = false;
    const event = key => {
      const project = current.rows.get(key)?.project || previous?.rows.get(key)?.project || {};
      return { key, projectId: text(project.projectId) || null, code: text(project.code) || null,
        name: text(project.name) || text(project.code) || text(project.projectId) || null,
        weekId: current.weekId, previousWeekId: previous?.weekId ?? null };
    };
    for (const [key, item] of current.rows) {
      const prior = previous?.rows.get(key);
      if (item.scoped && !firstSeen.has(key)) row.changes.firstObserved.push(event(key));
      if (previous && prior) {
        if (!prior.scoped && item.scoped) row.changes.enteredScope.push(event(key));
        if (prior.scoped && !item.scoped) row.changes.exitedScope.push(event(key));
        if ((prior.scoped || item.scoped) && ['active', 'on-hold'].includes(prior.project.lifecycle)
          && item.project.lifecycle === 'completed') row.changes.confirmedCompleted.push(event(key));
        const reset = confirmedRebaseline(prior.project, item.project);
        if (reset && (prior.scoped || item.scoped)) row.changes.confirmedRebaseline.push(event(key));
        if (prior.scoped && item.scoped) {
          const reason = reset ? 'confirmed-rebaseline' : prior.completionPct === null || item.completionPct === null ? 'invalid-progress' : null;
          if (reason) row.comparison.excludedByReason[reason] = (row.comparison.excludedByReason[reason] || 0) + 1;
          else {
            row.comparableCount++;
            const delta = item.completionPct - prior.completionPct;
            deltaSum += delta; if (delta > 0) progressed++;
            provisional ||= key.startsWith('code:');
            unverified ||= !text(prior.project.baselineId) || prior.project.baselineId !== item.project.baselineId;
          }
        }
      }
      if (item.scoped && !projectSeries.has(key)) projectSeries.set(key, {
        key, projectId: text(item.project.projectId) || null, code: text(item.project.code) || null,
        identityConfidence: key.startsWith('id:') ? 'immutable-id' : 'legacy-provisional', history: []
      });
      firstSeen.add(key);
    }
    if (previous) {
      for (const [key, prior] of previous.rows) if (prior.scoped && !current.rows.has(key) && !ambiguousKeys.has(key)) {
        row.changes.missingObservation.push(event(key));
      }
    } else warn('comparison-baseline-unavailable', current.weekId);
    if (row.comparableCount) {
      row.weeklyProgressGainPp = round(deltaSum / row.comparableCount);
      row.projectsProgressedCount = progressed;
      row.comparison.status = provisional || unverified ? 'partial' : 'ok';
      row.comparison.identityConfidence = provisional ? 'legacy-provisional' : 'immutable-id';
      row.comparison.baselineVerification = unverified ? 'unverified' : 'consistent';
      if (provisional) warn('legacy-provisional-match', current.weekId);
      if (unverified) warn('baseline-unverified', current.weekId);
    }
    row.status = row.comparison.status === 'ok' && !row.missingProgressCount ? 'ok' : 'partial';
    result.weeklySeries.push(row);
  }
  // Rectangular project histories preserve null gaps, including scope absence.
  for (const series of projectSeries.values()) {
    series.history = result.weeklySeries.map(row => {
      const item = byStart.get(periodStart(row.reportingPeriod))?.rows.get(series.key);
      return { weekId: row.weekId, reportingPeriod: { ...row.reportingPeriod },
        completionPct: item?.scoped ? item.completionPct : null,
        observation: !item ? 'missing' : !item.scoped ? 'out-of-scope' : item.completionPct === null ? 'invalid-progress' : 'recorded' };
    });
  }
  for (const row of result.weeklySeries) {
    row.gainPp = row.weeklyProgressGainPp;
    row.label = `${row.reportingPeriod.year}-W${String(row.reportingPeriod.week).padStart(2, '0')}`;
  }
  const anchorRows = byStart.get(anchor.start)?.rows;
  const priorRows = byStart.get(anchor.start - WEEK)?.rows;
  for (const series of projectSeries.values()) {
    const current = anchorRows?.get(series.key);
    const prior = priorRows?.get(series.key);
    const metadata = current?.project || [...byStart.values()].reverse().find(week => week.rows.has(series.key))?.rows.get(series.key)?.project || {};
    series.code = text(metadata.code) || null;
    series.name = text(metadata.name) || series.code || series.projectId;
    series.projectManager = text(metadata.projectManager) || text(metadata.pm) || text(metadata.owner) || null;
    series.status = current?.scoped && ['green','yellow','red'].includes(metadata.status) ? metadata.status : null;
    series.currentCompletionPct = current?.scoped ? current.completionPct : null;
    series.comparable = Boolean(current?.scoped && prior?.scoped && current.completionPct !== null
      && prior.completionPct !== null && !confirmedRebaseline(prior.project, current.project));
    series.weeklyChangePp = series.comparable ? round(current.completionPct - prior.completionPct) : null;
    series.trend = series.history.map(point => ({ weekId: point.weekId,
      label: `${point.reportingPeriod.year}-W${String(point.reportingPeriod.week).padStart(2,'0')}`, progressPct: point.completionPct }));
  }
  result.projects = [...projectSeries.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const latest = result.weeklySeries.at(-1);
  result.changes = { ...latest.changes, ambiguousIdentity: Array.from(
    { length: ambiguousKeys.size + unidentifiedCount }, () => ({ name: 'Ambiguous project identity' })) };
  result.summary = { weeklyProgressGainPp: latest.weeklyProgressGainPp, comparableCount: latest.comparableCount,
    projectsProgressedCount: latest.projectsProgressedCount, currentCompletionPct: latest.currentCompletionPct,
    health: { ...latest.health } };
  result.status = result.warnings.length || latest.status !== 'ok' ? 'partial' : 'ok';
  return result;
}
