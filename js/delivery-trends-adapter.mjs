import { calculateDeliveryTrends } from '../shared/delivery-trends.mjs';
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
        const row = {};
        for (const field of ['projectId','code','name','projectManager','pm','owner','progress','projectLevel','visibility','lifecycle','status','baselineId']) {
          // Invalid objects are invalid progress, never retained as diagnostic payloads.
          const value = project?.[field];
          row[field] = value !== null && typeof value === 'object' ? null : value;
        }
        if (project?.rebaseline && typeof project.rebaseline === 'object') row.rebaseline = {
          verified: project.rebaseline.verified === true,
          fromBaselineId: typeof project.rebaseline.fromBaselineId === 'string' ? project.rebaseline.fromBaselineId : null,
          toBaselineId: typeof project.rebaseline.toBaselineId === 'string' ? project.rebaseline.toBaselineId : null
        };
        projects.push(row);
      }
      authorized.push({ weekId: week?.weekId || week?.__documentId,
        reportingPeriod: week?.reportingPeriod ? { year: week.reportingPeriod.year, week: week.reportingPeriod.week } : null,
        isReleased: week?.isReleased === true, version: Number.isSafeInteger(week?.version) && week.version >= 0 ? week.version : null, projects });
    }
  } catch {
    throw new Error('Authorization evaluation failed; metrics input was not created.');
  }
  return { source, asOf, anchorWeekId, windowWeeks, publicationMode,
    scope: scope ? { projectLevel: scope.projectLevel, projectKeys: scope.projectKeys ? [...scope.projectKeys] : null } : null,
    weeks: authorized };
}
