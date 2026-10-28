import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHosting } from '../../scripts/build-hosting.mjs';
import { loadHostingEnv } from '../../scripts/hosting-env.mjs';
import { stubModuleFor } from './firebase-stubs.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };

// Builds the REAL hosting bundle for a profile ('uat' | 'prod') into a temp dir and serves it on localhost.
export async function serveProfile(profile) {
  const outDir = await mkdtemp(join(tmpdir(), `dashboard-${profile}-`));
  const env = await loadHostingEnv(ROOT, profile);
  await buildHosting({ rootDir: ROOT, outDir, env });
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      const file = resolve(outDir, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(outDir + sep)) { response.writeHead(403).end(); return; }
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, async close() { await new Promise(done => server.close(done)); await rm(outDir, { recursive: true, force: true }); } };
}

// Opens the dashboard in a real browser page with mocked Firebase (see firebase-stubs.mjs). Nothing leaves localhost
// except blocked font requests; the Firebase CDN modules are replaced by stubs.
export async function openDashboard(browser, { baseUrl, fake, viewport = { width: 1280, height: 900 }, search = '' }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console.error: ${message.text()}`); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    const stub = stubModuleFor(url);
    if (stub) { request.respond({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: stub }); return; }
    if (url.startsWith(baseUrl) || url.startsWith('data:') || url.startsWith('blob:')) { request.continue(); return; }
    externalRequests.push(url);
    request.abort();
  });
  await page.evaluateOnNewDocument(data => {
    data.user.getIdToken = async () => 'synthetic-token';
    window.__FAKE = data;
  }, fake);
  await page.goto(`${baseUrl}/${search}`, { waitUntil: 'load' });
  return { page, errors, externalRequests };
}
