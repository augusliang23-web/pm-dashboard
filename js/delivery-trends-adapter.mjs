import { calculateDeliveryTrends, normalizeDeliveryReportingPeriod, normalizeDeliveryProjectData } from '../shared/delivery-trends.mjs';
export { calculateDeliveryTrends };

/** Browser-facing boundary: explicit existing permissions, no authentication or Firebase SDK. */
export function createDeliveryTrendsInput({ weeks, source, asOf, anchorWeekId, windowWeeks,
  publicationMode, scope, canReadWeek, canReadProject } = {}) {
  if (!Array.isArray(weeks) || typeof canReadWeek !== 'function' || typeof canReadProject !== 'function') {
    throw new TypeError('Explicit week and project authorization predicates are required.');
  }
  const authorized = [];
  try {
    for (const week of weeks) {
      if (canReadWeek(week) !== true) continue;
      // Only requested publication data crosses this boundary.
      if (publicationMode === 'released' && week?.isReleased !== true) continue;
      if (!Array.isArray(week?.projects)) throw new TypeError('Invalid authorized reporting data.');
      const projects = [];
      for (const project of week.projects) {
        if (canReadProject(project, week) !== true) continue;
        const row = normalizeDeliveryProjectData(project);
        projects.push(row);
      }
      authorized.push({ weekId: week?.weekId || week?.__documentId,
        reportingPeriod: normalizeDeliveryReportingPeriod(week),
        isReleased: week?.isReleased === true, version: Number.isSafeInteger(week?.version) && week.version >= 0 ? week.version : null, projects });
    }
  } catch {
    throw new Error('Authorization evaluation failed; metrics input was not created.');
  }
  return { source, asOf, anchorWeekId, windowWeeks, publicationMode,
    scope: scope ? { projectLevel: scope.projectLevel, projectKeys: scope.projectKeys ? [...scope.projectKeys] : null } : null,
    weeks: authorized };
}

/** Bounded SDK-independent loader. The caller supplies a normally authenticated page reader. */
export async function loadDeliveryTrendsInput(options = {}) {
  if (typeof options.readHistoryPage !== 'function' || typeof options.canReadWeek !== 'function'
    || typeof options.canReadProject !== 'function'
    || !['released','include-drafts'].includes(options.publicationMode)) {
    throw new TypeError('Explicit authorized history reader and policies are required.');
  }
  let cursor = null;
  const cursors = new Set();
  const weeks = [];
  for (let page = 0; page < 6; page++) {
    let result;
    try { result = await options.readHistoryPage({ cursor, pageSize: 50, publicationMode: options.publicationMode }); }
    catch { throw new Error('Authorized history read failed.'); }
    if (!Array.isArray(result?.weeks) || result.weeks.length > 50) throw new Error('Invalid bounded history page.');
    weeks.push(...result.weeks);
    if (result.nextCursor === null) return createDeliveryTrendsInput({ ...options, weeks });
    if (typeof result.nextCursor !== 'string' || !result.nextCursor || cursors.has(result.nextCursor)) throw new Error('Invalid history cursor.');
    cursor = result.nextCursor; cursors.add(cursor);
  }
  throw new Error('Authorized history read limit reached; completeness is unavailable.');
}
