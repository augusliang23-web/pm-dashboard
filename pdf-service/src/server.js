import http from 'node:http';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createReportHandler } from './app.js';
import { createFirebaseAppOptions } from './firebase-app-options.js';
import { renderPdfBuffer } from './pdf-renderer.js';
import { applyCors, handlePreflight } from './cors.js';

initializeApp(createFirebaseAppOptions(process.env, { applicationDefault }));
const db = getFirestore();
const auth = getAuth();
const handler = createReportHandler({
  adapters: {
    verifyIdToken: token => auth.verifyIdToken(token),
    getUserByEmail: async email => (await db.collection('users').doc(email).get()).data(),
    getWeekById: async id => (await db.collection('weeks').doc(id).get()).data(),
    getTrendWeeks: async week => {
      const snapshot = await db.collection('weeks')
        .where('weekLabel', '<=', String(week.weekLabel || ''))
        .orderBy('weekLabel', 'desc')
        .limit(6)
        .get();
      return snapshot.docs.map(document => document.data()).reverse();
    }
  },
  renderPdf: renderPdfBuffer
});

http.createServer((request, response) => {
  if (handlePreflight(request, response, process.env.ALLOWED_ORIGIN)) return;
  if (request.method !== 'POST' || !['/v1/reports/project', '/v1/reports/overview'].includes(request.url)) return response.writeHead(404).end();
  if (!applyCors(request, response, process.env.ALLOWED_ORIGIN)) return response.writeHead(403).end();
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { raw += chunk; if (raw.length > 65536) request.destroy(); });
  request.on('end', () => { try { handler({ headers: request.headers, body: JSON.parse(raw) }, response); } catch { response.writeHead(400).end(); } });
}).listen(process.env.PORT || 8080);
