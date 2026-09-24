// The PDF Cloud Run endpoint for this environment comes from env-config.js (window.PM_DASHBOARD_ENV.pdfServiceUrl),
// never from a value hardcoded here. It is null until that environment's dedicated PDF service is deployed and
// verified; professional-pdf-client.mjs then refuses cleanly instead of falling back to another environment's
// service. Explicit local emulator previews use the local PDF service instead.
const pmDashboardEnv = window.PM_DASHBOARD_ENV;
if (!pmDashboardEnv) throw new Error('Dashboard environment configuration must load before professional-pdf-config.js.');

const localPdfServicePort = 8181;
const localPdfHosts = new Set(['localhost', '127.0.0.1']);
const localPdfParams = new URLSearchParams(window.location.search);
const useLocalPdfService = localPdfHosts.has(window.location.hostname)
  && localPdfParams.get('emulator') === '1';

window.PM_DASHBOARD_PDF_SERVICE_URL = useLocalPdfService
  ? `http://${window.location.hostname}:${localPdfServicePort}`
  : (pmDashboardEnv.pdfServiceUrl || '');
