import http from 'node:http';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createReportHandler, createOnePagerPreviewHandler } from './app.js';
import { initializeFirebaseAdmin, resolveRuntimeTarget } from './environment.js';
import { renderPdfBuffer } from './pdf-renderer.js';
import { applyCors, handlePreflight } from './cors.js';

const target = resolveRuntimeTarget(process.env);
const app = initializeFirebaseAdmin({ target, initializeApp, applicationDefault });
const db = getFirestore(app);
const auth = getAuth(app);
const adapters = {
  verifyIdToken: token => auth.verifyIdToken(token),
  getUserByEmail: async email => (await db.collection('users').doc(email).get()).data(),
  getWeekById: async id => (await db.collection('weeks').doc(id).get()).data(),
  ...(target.features.liveExecutiveTimeline
    ? { getLiveExecutiveTimeline: async () => (await db.collection('executiveMilestoneState').doc('live').get()).data() }
    : {}),
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
  if (handlePreflight(request, response, target.allowedOrigins)) return;
  const routeHandler = request.method === 'POST' ? ROUTES[request.url] : undefined;
  if (!routeHandler) return response.writeHead(404).end();
  if (!applyCors(request, response, target.allowedOrigins)) return response.writeHead(403).end();
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { raw += chunk; if (raw.length > 65536) request.destroy(); });
  request.on('end', () => { try { routeHandler({ headers: request.headers, body: JSON.parse(raw) }, response); } catch { response.writeHead(400).end(); } });
}).listen(process.env.PORT || 8080);
