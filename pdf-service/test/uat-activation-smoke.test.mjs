// UAT activation smoke: the SHIPPED UAT registry -> resolved runtime target -> real request handler -> real report data
// -> real Chromium PDF. Synthetic stored weeks only; no cloud access. Also proves F-1 through the full HTTP-shaped handler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportHandler } from '../src/app.js';
import { loadTargetRegistry, resolveRuntimeTarget } from '../src/environment.js';
import { createBoundedDeliveryHistoryReader } from '../src/report-data.js';
import { renderPdfBuffer } from '../src/pdf-renderer.js';

const SECTION = 'portfolio-delivery-performance';
const DAY = 86400000;
const isoMonday = (y, w) => { const j = Date.UTC(y, 0, 4); return j - ((new Date(j).getUTCDay() + 6) % 7) * DAY + (w - 1) * 7 * DAY; };
const md = t => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const physicalPages = pdf => (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;

// Mirrors the reported UAT shape: 2026-W17..W39, W39 is a draft, projects identified by code only.
const docs = new Map();
for (let w = 17; w <= 39; w += 1) {
  docs.set(`W${w}-2026`, { weekLabel: `W${w} 2026`, weekDate: `${md(isoMonday(2026, w))} - ${md(isoMonday(2026, w) + 4 * DAY)}`, isReleased: w !== 39, version: 1, summary: '',
    projects: Array.from({ length: 6 }, (_, k) => ({ code: `SYN-${k + 1}`, name: `Synthetic Project ${k + 1}`, owner: `Synthetic PM ${k + 1}`, progress: 10 * (k + 1) + (w - 17) * 0.8, status: 'green', visibility: 'active' })) });
}
const fakeDb = { collection: () => ({ f: null, lim: 50, after: null, where(f, o, v) { this.f = [f, v]; return this; }, orderBy() { return this; }, limit(n) { this.lim = n; return this; }, startAfter(c) { this.after = c; return this; },
  async get() { let ids = [...docs.keys()].sort(); if (this.f) ids = ids.filter(id => docs.get(id)[this.f[0]] === this.f[1]); if (this.after) ids = ids.filter(id => id > this.after); ids = ids.slice(0, this.lim); return { docs: ids.map(id => ({ id, data: () => JSON.parse(JSON.stringify(docs.get(id))) })) }; } }) };
const adapters = role => ({ verifyIdToken: async () => ({uid:'pdf-fixture',firebase:{sign_in_provider:'password'},email: 'qa@example.test' }), getUserByEmail: async () => ({authUid:'pdf-fixture',role }), getWeekById: async id => JSON.parse(JSON.stringify(docs.get(id))),
  getDeliveryHistory: createBoundedDeliveryHistoryReader({ db: fakeDb }), getDeliveryTrendsProvenance: () => ({ source: 'uat', asOf: '2026-10-15T00:00:00.000Z' }) });
const registry = loadTargetRegistry();
const targetFeatures = name => resolveRuntimeTarget({ PDF_ENVIRONMENT: name, FIREBASE_PROJECT_ID: registry.targets[name].firebaseProjectId, ALLOWED_ORIGIN: registry.targets[name].allowedOrigins.join(','), K_SERVICE: registry.targets[name].serviceName }, registry).features;
const response = () => ({ headers: new Map(), statusCode: 0, body: undefined, setHeader(k, v) { this.headers.set(k, v); }, end(body) { this.body = body; } });
async function post(role, features, body) {
  const handler = createReportHandler({ adapters: adapters(role), renderPdf: renderPdfBuffer, features });
  const res = response(); await handler({ headers: { authorization: 'Bearer synthetic' }, body }, res); return res;
}
const body = (weekId, sections = [SECTION]) => ({ mode: 'overview', weekId, sections, overviewScope: 'all', projectCodes: ['SYN-1', 'SYN-2', 'SYN-3', 'SYN-4', 'SYN-5', 'SYN-6'] });

test.after(async () => { await renderPdfBuffer.close(); });

test('UAT target (shipped registry): pm exports the new section for the latest draft week W39 and for released W38', { timeout: 120000 }, async () => {
  for (const weekId of ['W39-2026', 'W38-2026']) {
    const res = await post('pm', targetFeatures('uat'), body(weekId));
    assert.equal(res.statusCode, 200, weekId);
    assert.equal(res.headers.get('Content-Type'), 'application/pdf');
    assert.equal(Buffer.from(res.body).subarray(0, 4).toString(), '%PDF');
    assert.equal(physicalPages(res.body), 1);
    assert.match(res.headers.get('Content-Disposition'), /attachment/);
  }
});

test('UAT target: existing sections are unaffected when requested together with the new section', { timeout: 120000 }, async () => {
  const res = await post('pm', targetFeatures('uat'), body('W38-2026', ['health-focus', 'weekly-trend', SECTION]));
  assert.equal(res.statusCode, 200);
  assert.ok(physicalPages(res.body) >= 2);
});

test('UAT target F-1 through the HTTP handler: a released-only role gets 403 for a draft week and a PDF for a released week', { timeout: 120000 }, async () => {
  for (const role of ['sales', 'engineering', 'business', 'product', 'bd']) {
    const draft = await post(role, targetFeatures('uat'), body('W39-2026'));
    assert.equal(draft.statusCode, 403, `${role} draft`);
    assert.doesNotMatch(String(draft.body), /Synthetic|SYN-/);
    const released = await post(role, targetFeatures('uat'), body('W38-2026'));
    assert.equal(released.statusCode, 200, `${role} released`);
  }
  const vip = await post('vip', targetFeatures('uat'), body('W39-2026'));
  assert.equal(vip.statusCode, 403);
});

test('Production target (shipped registry) accepts the section for released weeks', { timeout: 60000 }, async () => {
  const res = await post('pm', targetFeatures('production'), body('W38-2026'));
  assert.equal(res.statusCode, 200);
});

test('UAT history read is bounded to the documented limits for this dataset', { timeout: 60000 }, async () => {
  let queries = 0; let read = 0;
  const counting = { collection: () => { const q = fakeDb.collection(); const get = q.get.bind(q); q.get = async () => { queries += 1; const r = await get(); read += r.docs.length; return r; }; return q; } };
  const reader = createBoundedDeliveryHistoryReader({ db: counting });
  const history = await reader({ publicationMode: 'include-drafts' });
  assert.equal(history.complete, true);
  assert.equal(read, 23);
  assert.equal(queries, 1);
  const releasedOnly = await reader({ publicationMode: 'released' });
  assert.equal(releasedOnly.weeks.length, 22);
});
