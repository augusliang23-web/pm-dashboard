// The production Cloud Run service accepts only the deployed dashboard origin.
// Explicit local emulator previews use the local PDF service instead.
const productionPdfServiceUrl = 'https://pm-dashboard-pdf-a4naj265kq-as.a.run.app';
const localPdfServicePort = 8181;
const localPdfHosts = new Set(['localhost', '127.0.0.1']);
const localPdfParams = new URLSearchParams(window.location.search);
const useLocalPdfService = localPdfHosts.has(window.location.hostname)
  && localPdfParams.get('emulator') === '1';

window.PM_DASHBOARD_PDF_SERVICE_URL = useLocalPdfService
  ? `http://${window.location.hostname}:${localPdfServicePort}`
  : productionPdfServiceUrl;
