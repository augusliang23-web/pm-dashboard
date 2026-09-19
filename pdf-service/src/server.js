import http from 'node:http';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createReportHandler, createOnePagerPreviewHandler } from './app.js';
import { createFirebaseAppOptions } from './firebase-app-options.js';
import { renderPdfBuffer } from './pdf-renderer.js';
import { applyCors, handlePreflight } from './cors.js';

initializeApp(createFirebaseAppOptions(process.env, { applicationDefault }));
const db = getFirestore();
const auth = getAuth();
const adapters = {
  verifyIdToken: token => auth.verifyIdToken(token),
  getUserByEmail: async email => (await db.collection('users').doc(email).get()).data(),
  getWeekById: async id => (await db.collection('weeks').doc(id).get()).data(),
  getDashboardSettings: async () => (await db.collection('dashboardSettings').doc('team-2-portfolio').get()).data(),
  getTrendWeeks: async week => {
    const snapshot = await db.collection('weeks')
      .where('weekLabel', '<=', String(week.weekLabel || ''))
      .orderBy('weekLabel', 'desc')
      .limit(6)
      .get();
    return snapshot.docs.map(document => document.data()).reverse();
  }
};
const handler = createReportHandler({ adapters, renderPdf: renderPdfBuffer });
const previewHandler = createOnePagerPreviewHandler({ adapters });
const ROUTES = {
  '/v1/reports/project': handler,
  '/v1/reports/overview': handler,
  '/v1/reports/one-pager-preview': previewHandler
};

http.createServer((request, response) => {
  if (handlePreflight(request, response, process.env.ALLOWED_ORIGIN)) return;
  const routeHandler = request.method === 'POST' ? ROUTES[request.url] : undefined;
  if (!routeHandler) return response.writeHead(404).end();
  if (!applyCors(request, response, process.env.ALLOWED_ORIGIN)) return response.writeHead(403).end();
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { raw += chunk; if (raw.length > 65536) request.destroy(); });
  request.on('end', () => { try { routeHandler({ headers: request.headers, body: JSON.parse(raw) }, response); } catch { response.writeHead(400).end(); } });
}).listen(process.env.PORT || 8080);
