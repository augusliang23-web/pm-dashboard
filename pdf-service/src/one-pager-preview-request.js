import { ReportRequestError, requiredText } from './report-request.js';

/**
 * Parses the one-page PDF preview request: a project + optional draft Gantt
 * window settings. Unlike parseReportRequest, the settings shape itself is
 * NOT strictly validated here - resolveGanttWindowSettings (gantt-window.js)
 * already sanitizes any malformed or out-of-range value back to a safe
 * default, which is fine for a read-only, unsaved preview. Keeping this
 * lenient avoids duplicating the strict validation that already runs
 * client-side (portfolio-core.mjs) and server-side on save
 * (project-dashboard-writes.js) before anything is persisted.
 */
export function parseOnePagerPreviewRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ReportRequestError('Preview request must be an object.');
  }
  const allowedFields = new Set(['weekId', 'projectCode', 'ganttWindowSettings']);
  for (const field of Object.keys(input)) {
    if (!allowedFields.has(field)) {
      throw new ReportRequestError(`Unexpected preview request field: ${field}.`);
    }
  }
  return {
    weekId: requiredText(input.weekId, 'weekId'),
    projectCode: requiredText(input.projectCode, 'projectCode'),
    ganttWindowSettings: input.ganttWindowSettings
  };
}
