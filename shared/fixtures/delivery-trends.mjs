// Synthetic only; no Production records.
export const project = (overrides = {}) => ({ projectId: 'a', code: 'A', progress: 20,
  projectLevel: 'system', visibility: 'active', lifecycle: 'active', status: 'green', baselineId: 'b1', ...overrides });
export const week = (number, projects = [project()], overrides = {}) => ({
  weekId: `2026-W${number}`, reportingPeriod: { year: 2026, week: number }, isReleased: true, projects, ...overrides });
export const input = (weeks = [week(40), week(41, [project({ progress: 30 })])], overrides = {}) => ({
  source: 'synthetic', asOf: '2026-10-14T00:00:00Z', anchorWeekId: weeks.at(-1).weekId,
  windowWeeks: 6, publicationMode: 'released', scope: { projectLevel: 'system' }, weeks, ...overrides });
