import { parseReportRequest } from './report-request.js';
import { parseOnePagerPreviewRequest } from './one-pager-preview-request.js';
import { loadAuthorizedReport } from './report-data.js';
import { renderProjectReportHtml } from './project-report.js';
import { renderOverviewReportHtml } from './overview-report.js';
import { renderProjectOnePagerHtml } from './project-one-pager.js';
import { buildProjectReportModel } from './report-model.js';
import { reportDocument } from './report-html.js';
import { sendPdfDownload } from './pdf-response.js';

function sendError(response, error) {
  const statusCode = error?.statusCode || 500;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, private');
  response.end(JSON.stringify({ error: statusCode === 500 ? 'Unable to generate report.' : error.message }));
}

export function createReportHandler({ adapters, renderPdf }) {
  return async ({ headers = {}, body }, response) => {
    try {
      const authorization = String(headers.authorization || '');
      if (!authorization.startsWith('Bearer ')) {
        const error = new Error('A Firebase bearer token is required.');
        error.statusCode = 401;
        throw error;
      }
      const request = parseReportRequest(body);
      const report = await loadAuthorizedReport({ request, idToken: authorization.slice(7).trim(), adapters });
      const html = request.mode === 'project'
        ? renderProjectReportHtml(report)
        : renderOverviewReportHtml({ ...report, projectPortfolioLayout: 'one-page' });
      const pdf = await renderPdf(html);
      const name = request.mode === 'project' ? `${report.project.code}-${request.weekId}.pdf` : `overview-${request.weekId}.pdf`;
      sendPdfDownload(response, pdf, name.replace(/[^A-Za-z0-9._-]/g, '-'));
    } catch (error) {
      sendError(response, error);
    }
  };
}

/**
 * Renders just the one-page quadrant summary as standalone HTML (no
 * Puppeteer/PDF generation) so an admin can preview it against a draft,
 * not-yet-saved Gantt display-window setting before deciding whether to
 * save. Read-only: it never touches dashboardSettings, and reuses the same
 * bearer-token auth and per-project access rules as the real PDF export.
 */
export function createOnePagerPreviewHandler({ adapters }) {
  return async ({ headers = {}, body }, response) => {
    try {
      const authorization = String(headers.authorization || '');
      if (!authorization.startsWith('Bearer ')) {
        const error = new Error('A Firebase bearer token is required.');
        error.statusCode = 401;
        throw error;
      }
      const previewRequest = parseOnePagerPreviewRequest(body);
      const report = await loadAuthorizedReport({
        request: {
          mode: 'project',
          weekId: previewRequest.weekId,
          projectCode: previewRequest.projectCode,
          sections: [],
          previewGanttWindowSettings: previewRequest.ganttWindowSettings ?? {}
        },
        idToken: authorization.slice(7).trim(),
        adapters
      });
      const model = buildProjectReportModel({
        week: report.week, project: report.project, sections: [], ganttWindowSettings: report.ganttWindowSettings
      });
      const html = reportDocument({
        title: model.name || model.code || 'Project preview',
        period: model.period,
        reportKind: 'project',
        body: renderProjectOnePagerHtml(model, model.period)
      });
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store, private');
      response.end(html);
    } catch (error) {
      sendError(response, error);
    }
  };
}
