// Real dashboard + Auth/Firestore/Functions emulators + Chromium. SYNTHETIC data only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { buildHosting } from '../build-hosting.mjs';
import { loadHostingEnv } from '../hosting-env.mjs';
import { overviewHistory } from '../../tests/helpers/overview-provenance-fixture.mjs';

const project = 'demo-pm-dashboard-v22t';
assert.equal(process.env.GCLOUD_PROJECT, project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
const root = resolve(new URL('../..', import.meta.url).pathname);
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const pdfRequire = createRequire(new URL('../../pdf-service/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const puppeteer = pdfRequire('puppeteer');
const app = initializeApp({ projectId: project }), db = getFirestore(app), auth = getAuth(app);
const out = resolve(root, 'outputs/v231-overview-hotfix');
await mkdir(out, { recursive: true });
const results = [], errors = [];
const email = 'hotfix.admin@example.test', password = 'SyntheticOnly!2026';
// All writes are guarded by the exact demo project and emulator endpoints above.
for (const [address, displayName] of [[email, 'Synthetic Admin'], ['hotfix.a@example.test', 'Synthetic PM A'], ['hotfix.b@example.test', 'Synthetic PM B']]) {
  try { await auth.createUser({ email: address, password, emailVerified: true }); }
  catch (e) { if (e.code !== 'auth/email-already-exists') throw e; }
  await db.collection('users').doc(address).set({ role: address === email ? 'admin' : 'pm', displayName, isProjectManager: address !== email });
}
const weeks = overviewHistory();
for (const { weekId, ...data } of weeks) await db.collection('weeks').doc(weekId).set(data);
await db.collection('releaseCapabilities').doc('v231').set({ schemaVersion: 1, projectId: project, drafts: true, archiveRecovery: true, enforceDraftPublish: true });
const sites = {};
for (const profile of ['prod', 'uat']) {
  sites[profile] = resolve(root, `tmp/v231-overview-hotfix-${profile}`);
  await buildHosting({ rootDir: root, outDir: sites[profile], env: await loadHostingEnv(root, profile) });
}
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const [, profile, ...parts] = pathname.split('/');
    const site = sites[profile === 'baseline' ? 'prod' : profile];
    if (!site) return res.writeHead(404).end();
    const file = parts.join('/') || 'index.html', path = resolve(site, file);
    if (!path.startsWith(site + '/')) return res.writeHead(403).end();
    let content = await readFile(path);
    if (profile === 'baseline' && file === 'index.html') content = content.toString().replaceAll("source: 'production'", "source: 'prod'");
    res.setHeader('Content-Type', extname(path) === '.html' ? 'text/html' : /\.m?js$/.test(path) ? 'text/javascript' : 'application/octet-stream');
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
let browser;
await new Promise(r => server.listen(4198, '127.0.0.1', r));
try {
  browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  for (const profile of ['baseline', 'prod', 'uat']) {
    const browserContext = await browser.createBrowserContext();
    const page = await browserContext.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    page.on('pageerror', e => errors.push({ profile, message: e.message }));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const u = new URL(request.url());
      if (['127.0.0.1', 'localhost', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname) || u.protocol === 'data:') request.continue();
      else request.abort();
    });
    const click = async selector => {
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#globalLoader')).display === 'none');
      await page.click(selector);
    };
    const selectWeek = async id => {
      await page.waitForFunction(label => [...document.querySelectorAll('#wNavSelect option')].some(o => o.textContent.startsWith(label)), { timeout: 30000 }, id);
      const value = await page.$$eval('#wNavSelect option', (options, label) => options.find(o => o.textContent.startsWith(label))?.value, id);
      assert.ok(value !== undefined);
      await page.select('#wNavSelect', value);
      await page.waitForFunction(label => document.querySelector('#bannerTitle')?.textContent.includes(label), {}, id);
    };
    const panel = async () => page.$eval('.delivery-trends-overview-panel', e => ({
      text: e.textContent, values: [...e.querySelectorAll('.dt-card-value')].map(n => n.textContent.trim()),
      labels: [...e.querySelectorAll('.dt-trend-svg .dt-axis-label')].map(n => n.textContent),
      projects: e.querySelectorAll('.dt-row').length,
      gaps: e.querySelectorAll('.dt-trend-svg .dt-gap').length,
      provenanceWarnings: e.querySelectorAll('[data-warning-code="invalid-provenance"]').length
    }));
    await page.goto(`http://127.0.0.1:4198/${profile}/?emulator=1&firestorePort=8188&authPort=9198&functionsPort=5108`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#email');
    await page.type('#email', email); await page.type('#password', password);
    await click('#loginOverlay button');
    await page.waitForFunction(() => document.querySelector('#syncDot')?.classList.contains('ok'), { timeout: 30000 });
    await selectWeek('W42 2026');
    await click('#btnOverview');
    await page.waitForSelector('.delivery-trends-overview-panel .dt-card-value');
    if (profile === 'baseline') {
      const observed = await panel();
      assert.equal(observed.provenanceWarnings, 1);
      assert.ok(observed.values.includes('N/A')); assert.equal(observed.labels.length, 0);
      results.push({ profile, check: 'W42 original deployed failure reproduced', observed });
    } else {
      for (const windowWeeks of [6, 12]) {
        await click(`[data-overview-trend-window="${windowWeeks}"]`);
        await page.waitForFunction(n => document.querySelectorAll('.dt-trend-svg .dt-axis-label').length === n, {}, windowWeeks);
        const observed = await panel();
        assert.equal(observed.provenanceWarnings, 0);
        assert.ok(observed.values.includes('34%')); assert.ok(observed.values.includes('+2pp'));
        assert.equal(observed.projects, 3);
        results.push({ profile, check: `W42 Active/All PMs ${windowWeeks} weeks`, observed });
      }
      // Overview is deliberately portfolio-wide in the existing UI; PM filtering applies to normal view only.
      const options = await page.$$eval('#topPmSelect option', nodes => nodes.map(n => n.value));
      for (const pm of ['all', 'Synthetic PM A', 'Synthetic PM B']) {
        assert.ok(options.includes(pm), JSON.stringify(options));
        await page.select('#topPmSelect', pm);
        assert.ok((await panel()).values.includes('34%'));
        results.push({ profile, check: `existing portfolio-wide Overview scope with PM=${pm}`, result: 'PASS' });
      }
      await page.select('#topPmSelect', 'all');
      await selectWeek('W43 2026'); assert.ok((await panel()).values.includes('36%'));
      await selectWeek('W42 2026');
      const missing = db.collection('weeks').doc('W40-2026');
      await missing.delete();
      await page.waitForFunction(() => document.querySelectorAll('.dt-trend-svg .dt-gap').length === 2);
      assert.equal((await panel()).gaps, 2);
      results.push({ profile, check: 'missing W40 gives W40/W41 null comparison gaps', result: 'PASS' });
      const { weekId, ...restore } = weeks.find(w => w.weekId === 'W40-2026');
      await missing.set(restore);
      await page.waitForFunction(() => document.querySelectorAll('.dt-trend-svg .dt-gap').length === 0);
    }
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#globalLoader')).display === 'none');
    await page.screenshot({ path: resolve(out, `${profile}-w42.png`), fullPage: true });
    await (await page.$('.delivery-trends-overview-panel')).screenshot({ path: resolve(out, `${profile}-w42-panel.png`) });
    await browserContext.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(resolve(out, 'browser-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), data: 'SYNTHETIC emulator only', results, errors }, null, 2));
  await browser?.close(); await new Promise(r => server.close(r));
}
console.log(`PASS ${results.length} browser checks; no page errors. Evidence: ${out}`);
