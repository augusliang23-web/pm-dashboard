// REAL-BROWSER smoke tests of the REAL dashboard bundle (built with scripts/build-hosting.mjs) with MOCKED Firebase.
//
//   * Actual full-app browser test .................. YES (real index.html, real dashboard code, real Chromium)
//   * Authenticated end-to-end against Firebase ....... NO  (Firebase Auth/Firestore/Functions are replaced by stubs
//                                                           in tests/browser/firebase-stubs.mjs)
// Data is SYNTHETIC. No credentials, no network backend, no Production or UAT data.
import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import * as engine from '../../shared/delivery-trends.mjs';
import { serveProfile, openDashboard } from '../../tests/browser/dashboard-harness.mjs';
import { buildFake } from '../../tests/browser/firebase-stubs.mjs';

const PHASE2A = typeof engine.normalizeDeliveryReportingPeriod === 'function';
const wait = ms => new Promise(done => setTimeout(done, ms));
const KNOWN_EXTERNAL = /Failed to load resource: net::ERR_FAILED/; // blocked Google Fonts / FX-rate requests

const project = (k, i, extra = {}) => ({ projectId: `p${k}`, code: `SYN-${k}`, name: `Synthetic Project ${k}`, owner: `Synthetic PM ${k}`, projectManager: `Synthetic PM ${k}`, status: ['green', 'yellow', 'red'][k - 1], progress: 10 * k + i * 2, projectLevel: k === 3 ? 'software' : 'system', visibility: 'active', lifecycle: 'active', milestones: [], riskActions: [], ...extra });
// Stored weekDate values follow getIsoWeekData: "<Mon> - <Fri>". Phase 2A validates them against the labelled ISO week.
const DAY = 86400000;
const isoMonday = (year, week) => { const jan4 = Date.UTC(year, 0, 4); return jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (week - 1) * 7 * DAY; };
const monthDay = time => new Date(time).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekDate = (year, week) => `${monthDay(isoMonday(year, week))} - ${monthDay(isoMonday(year, week) + 4 * DAY)}`;
const PERIODS = [[2025, 50], [2025, 51], [2025, 52], [2026, 1], [2026, 2], [2026, 3], [2026, 4], [2026, 5]];
function weeksFixture({ withPeriod = true, draftIndex = -1 } = {}) {
  return PERIODS.map(([year, week], i) => ({
    __id: `W${week}-${year}`, weekLabel: `W${week} ${year}`, weekDate: weekDate(year, week), isReleased: i !== draftIndex, version: 1, summary: '', lastModifiedBy: 'qa@example.test',
    ...(withPeriod ? { reportingPeriod: { year, week } } : {}), projects: [1, 2, 3].map(k => project(k, i))
  }));
}

let browser; let uat; let prod;
test.before(async () => {
  browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  uat = await serveProfile('uat');
  prod = await serveProfile('prod');
});
test.after(async () => { await browser?.close(); await uat?.close(); await prod?.close(); });

const visible = (page, selector) => page.evaluate(sel => { const e = document.querySelector(sel); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; }, selector);
const open = async (profile, fakeOptions, extra = {}) => {
  const session = await openDashboard(browser, { baseUrl: profile.baseUrl, fake: buildFake(fakeOptions), ...extra });
  await wait(1800);
  return session;
};
const realErrors = errors => errors.filter(message => !KNOWN_EXTERNAL.test(message));

test('A-L: UAT admin workflow — open, 6/12 weeks, change week, scope, Overview round-trip, no JS errors', { timeout: 120000 }, async () => {
  const { page, errors } = await open(uat, { role: 'admin', weeks: weeksFixture() });
  try {
    // A/B: dashboard loaded; UAT navigation entry exists and is understandable.
    assert.equal(await page.$eval('#displayRole', e => e.textContent), 'ADMIN');
    assert.equal(await visible(page, '#btnDeliveryTrends'), true);
    assert.equal(await page.$eval('#btnDeliveryTrends', e => e.getAttribute('aria-label')), 'Delivery Trends');
    assert.match(await page.$eval('#btnDeliveryTrends', e => e.innerText), /Trends/);
    // Cross-year ordering in the real page: the latest week is W5 2026, not W52 2025.
    assert.equal(await page.$eval('#bannerTitle', e => e.textContent), 'W5 2026');
    const options = await page.$$eval('#wNavSelect option', list => list.map(o => o.textContent.split(' (')[0]));
    assert.deepEqual(options, ['W50 2025', 'W51 2025', 'W52 2025', 'W1 2026', 'W2 2026', 'W3 2026', 'W4 2026', 'W5 2026']);

    // C/D: open Delivery Trends; the independent view replaces both existing views.
    await page.click('#btnDeliveryTrends'); await wait(500);
    assert.equal(await visible(page, '#deliveryTrendsView'), true);
    assert.equal(await visible(page, '#normalView'), false);
    assert.equal(await visible(page, '#execView'), false);
    assert.equal(await page.$eval('#btnDeliveryTrends', e => e.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.$$eval('#deliveryTrendsView .dt-card', list => list.length), 4);
    assert.equal(await page.$$eval('#deliveryTrendsView .dt-row', list => list.length) > 0 || PHASE2A === false, true);
    const text = await page.$eval('#deliveryTrendsView', e => e.innerText);
    assert.match(text, /weekly progress gain/i);
    if (PHASE2A) assert.match(text, /project manager/i);
    else assert.match(text, /scope membership data \(isInAnchorScope\) is not provided yet/);
    assert.doesNotMatch(text, /NaN|undefined|\bnull\b/);
    assert.doesNotMatch(text, /Synthetic data for preview only/, 'saved weeks are not labelled synthetic');

    // E: 6 -> 12 weeks.
    const pointsAt = () => page.$$eval('#deliveryTrendsView .dt-dot-point, #deliveryTrendsView .dt-gap', list => list.length);
    const labelsAt = () => page.$$eval('#deliveryTrendsView .dt-axis-label', list => list.map(e => e.textContent));
    assert.equal((await labelsAt()).length, 6);
    await page.click('[data-dt-window="12"]'); await wait(300);
    assert.equal((await labelsAt()).length, 12);
    assert.equal(await page.$eval('[data-dt-window="12"]', e => e.getAttribute('aria-pressed')), 'true');
    await page.click('[data-dt-window="6"]'); await wait(300);
    assert.equal((await labelsAt()).length, 6);
    assert.ok((await pointsAt()) >= 1);

    // F: change the selected reporting week; the anchor (last axis label) follows it, with W52 2025 -> W1 2026 order.
    const anchorLabel = async () => (await labelsAt()).at(-1);
    assert.match(await anchorLabel(), /W05 2026|2026-W5/);
    await page.select('#wNavSelect', '3'); await wait(500); // W1 2026
    assert.equal(await page.$eval('#bannerTitle', e => e.textContent), 'W1 2026');
    assert.match(await anchorLabel(), /W01 2026|2026-W1/);
    assert.equal(await visible(page, '#deliveryTrendsView'), true, 'still on Delivery Trends after changing the week');
    await page.select('#wNavSelect', '2'); await wait(500); // W52 2025
    assert.match(await anchorLabel(), /W52 2025|2025-W52/);
    await page.select('#wNavSelect', '7'); await wait(300);

    // G/H: Overview scope is shared; switching to Overview closes Delivery Trends and keeps Overview working.
    await page.click('#btnOverview'); await wait(500);
    assert.equal(await visible(page, '#deliveryTrendsView'), false);
    assert.equal(await visible(page, '#execView'), true);
    assert.equal(await page.$eval('#btnDeliveryTrends', e => e.getAttribute('aria-pressed')), 'false');
    assert.ok((await page.$eval('#execView', e => e.innerText)).length > 200, 'Overview still renders');
    await page.click('[data-overview-scope="software"]'); await wait(400);
    assert.equal(await page.$eval('[data-overview-scope="software"]', e => e.classList.contains('active')), true);

    // I: reopen Delivery Trends under the new scope (software has one project).
    await page.click('#btnDeliveryTrends'); await wait(500);
    assert.equal(await visible(page, '#deliveryTrendsView'), true);
    assert.equal(await visible(page, '#execView'), false);
    if (PHASE2A) {
      const names = await page.$$eval('#deliveryTrendsView .dt-row-name', list => list.map(e => e.textContent));
      assert.deepEqual(names, ['Synthetic Project 3']);
    }
    // Toggling again returns to the normal project view.
    await page.click('#btnDeliveryTrends'); await wait(400);
    assert.equal(await visible(page, '#deliveryTrendsView'), false);
    assert.equal(await visible(page, '#normalView'), true);

    // J: no uncaught JavaScript errors anywhere in the flow.
    assert.deepEqual(realErrors(errors), []);
  } finally { await page.close(); }
});

test('Delivery Trends reads no extra Firestore data and writes nothing while navigating', { timeout: 60000 }, async () => {
  const { page } = await open(uat, { role: 'admin', weeks: weeksFixture() });
  try {
    const before = await page.evaluate(() => ({ reads: window.__FAKE.reads.length, listeners: window.__FAKE.listeners.length, writes: window.__FAKE.writes.map(w => w.path) }));
    await page.click('#btnDeliveryTrends'); await wait(400);
    await page.click('[data-dt-window="12"]'); await wait(300);
    await page.select('#wNavSelect', '4'); await wait(300);
    const after = await page.evaluate(() => ({ reads: window.__FAKE.reads.length, listeners: window.__FAKE.listeners.length, writes: window.__FAKE.writes.map(w => w.path) }));
    assert.equal(after.reads, before.reads, 'no new Firestore reads');
    assert.equal(after.listeners, before.listeners, 'no new listeners');
    assert.deepEqual(after.writes, before.writes, 'no Firestore writes caused by Delivery Trends');
  } finally { await page.close(); }
});

test('weeks without verified reporting periods yield an explicit state, never guessed numbers', { timeout: 60000 }, async () => {
  const { page } = await open(uat, { role: 'admin', weeks: weeksFixture({ withPeriod: false }) });
  try {
    await page.click('#btnDeliveryTrends'); await wait(500);
    const text = await page.$eval('#deliveryTrendsView', e => e.innerText);
    if (PHASE2A) {
      assert.match(text, /weekly progress gain/i); // stored "W<n> <year>" labels are verified period evidence
    } else {
      assert.match(text, /cannot be calculated/);
      assert.doesNotMatch(text, /\+\d/);
    }
  } finally { await page.close(); }
});

test('prototype fallback (no saved weeks) is never shown as verified data', { timeout: 60000 }, async () => {
  const { page } = await open(uat, { role: 'admin', weeks: [] });
  try {
    assert.match(await page.$eval('#bannerTitle', e => e.textContent), /Prototype/);
    await page.click('#btnDeliveryTrends'); await wait(500);
    const text = await page.$eval('#deliveryTrendsView', e => e.innerText);
    assert.match(text, /prototype data/);
    assert.match(text, /never presented as verified UAT or Production data/);
    assert.equal(await page.$$eval('#deliveryTrendsView .dt-card', list => list.length), 0);
    assert.doesNotMatch(text, /DEMO-|weekly progress gain/i);
  } finally { await page.close(); }
});

test('K: mobile layout at 390px and 320px has no horizontal overflow and a 2x2 KPI grid', { timeout: 60000 }, async () => {
  for (const width of [390, 320]) {
    const { page } = await open(uat, { role: 'admin', weeks: weeksFixture() }, { viewport: { width, height: 800 } });
    try {
      await page.click('#btnDeliveryTrends'); await wait(500);
      const metrics = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#deliveryTrendsView .dt-card')].map(card => { const r = card.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; });
        const scroller = document.querySelector('#deliveryTrendsView .dt-trend-scroll');
        const view = document.getElementById('deliveryTrendsView');
        // The Delivery Trends view itself must fit the viewport. (The pre-existing app header is wider than a phone on
        // every view -- documented in PHASE2C.md -- so document-level overflow is not a Delivery Trends property.)
        return { overflow: view.scrollWidth - view.clientWidth, outside: [...view.querySelectorAll('*')].filter(e => !e.closest('.dt-trend-scroll') && e.getBoundingClientRect().right > window.innerWidth + 1).length, cards, trendScrolls: !!scroller && scroller.scrollWidth >= scroller.clientWidth, labelHidden: getComputedStyle(document.querySelector('#btnDeliveryTrends .dt-nav-label')).display };
      });
      assert.ok(metrics.overflow <= 0, `${width}px view overflow=${metrics.overflow}`);
      assert.equal(metrics.outside, 0, `${width}px: nothing outside the viewport except the scrollable trend chart`);
      assert.equal(metrics.cards.length, 4);
      assert.equal(new Set(metrics.cards.map(card => card.y)).size, 2, `${width}px: two rows of cards`);
      assert.equal(new Set(metrics.cards.map(card => card.x)).size, 2, `${width}px: two columns of cards`);
      assert.equal(metrics.labelHidden, 'none', 'nav label collapses to the icon on narrow screens');
    } finally { await page.close(); }
  }
});

test('role and session behavior in the real page: Executive cannot open it; signing in/out resets the view', { timeout: 120000 }, async () => {
  const exec = await open(uat, { role: 'executive', email: 'qa-exec@example.test', weeks: weeksFixture() });
  try {
    assert.equal(await visible(exec.page, '#btnDeliveryTrends'), false, 'Executive/VIP never see the Delivery Trends entry');
    assert.equal(await visible(exec.page, '#deliveryTrendsView'), false);
    assert.equal(await visible(exec.page, '#normalView'), true, 'Executive keeps the existing project view');
    await exec.page.evaluate(() => window.toggleDeliveryTrends && window.toggleDeliveryTrends());
    await wait(300);
    assert.equal(await visible(exec.page, '#deliveryTrendsView'), false, 'direct invocation is refused for Executive');
  } finally { await exec.page.close(); }

  const pm = await open(uat, { role: 'pm', email: 'qa-pm@example.test', weeks: weeksFixture({ draftIndex: 6 }) });
  try {
    assert.equal(await visible(pm.page, '#btnDeliveryTrends'), true, 'PM sees the entry');
    await pm.page.click('#btnDeliveryTrends'); await wait(500);
    assert.equal(await visible(pm.page, '#deliveryTrendsView'), true);
    // Session change: sign out, then sign in as an Executive; the previous view must not survive.
    await pm.page.evaluate(() => window.__fakeAuthChange(null)); await wait(500);
    assert.equal(await visible(pm.page, '#deliveryTrendsView'), false, 'signed-out page shows no Delivery Trends');
    await pm.page.evaluate(() => {
      window.__FAKE.documents['users/qa-exec@example.test'] = { role: 'executive', displayName: 'QA Exec', email: 'qa-exec@example.test' };
      window.__fakeAuthChange({ uid: 'synthetic-exec', email: 'qa-exec@example.test', displayName: 'QA Exec', getIdToken: async () => 't' });
    });
    await wait(1500);
    assert.equal(await visible(pm.page, '#deliveryTrendsView'), false, 'a new user does not inherit the previous Delivery Trends view');
    assert.equal(await visible(pm.page, '#btnDeliveryTrends'), false);
    assert.deepEqual(realErrors(pm.errors), []);
  } finally { await pm.page.close(); }
});

test('L: the Production profile does not expose Delivery Trends', { timeout: 60000 }, async () => {
  const { page, errors } = await open(prod, { role: 'admin', weeks: weeksFixture() });
  try {
    assert.equal(await visible(page, '#btnDeliveryTrends'), false);
    assert.equal(await visible(page, '#deliveryTrendsView'), false);
    assert.equal(await visible(page, '#deliveryPerformanceOption'), false);
    await page.evaluate(() => window.toggleDeliveryTrends && window.toggleDeliveryTrends());
    await wait(300);
    assert.equal(await visible(page, '#deliveryTrendsView'), false, 'the UAT-only toggle is inert in Production');
    // Production keeps its legacy week order and existing navigation.
    assert.ok(await page.$eval('#bannerTitle', e => e.textContent));
    assert.equal(await visible(page, '#btnOverview'), true);
    await page.click('#btnOverview'); await wait(400);
    assert.equal(await visible(page, '#execView'), true);
    assert.deepEqual(realErrors(errors), []);
  } finally { await page.close(); }
});

test('PDF dialog regression: new section is hidden, never requested; existing sections and project selection still reach the backend', { timeout: 120000 }, async () => {
  const session = await openDashboard(browser, { baseUrl: uat.baseUrl, fake: buildFake({ role: 'admin', weeks: weeksFixture() }) });
  const { page } = session;
  const pdfRequests = [];
  page.removeAllListeners('request');
  page.on('request', request => {
    const url = request.url();
    if (url.includes('.run.app') && request.method() === 'OPTIONS') { request.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } }); return; }
    if (url.includes('.run.app')) { pdfRequests.push({ url, body: request.postData() }); request.respond({ status: 400, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'stubbed backend' }) }); return; }
    request.continue();
  });
  // The first handler (stubs) was removed above; re-register Firebase stubs for later navigation-free use is not needed.
  try {
    await wait(1800);
    await page.evaluate(() => openOverviewPrintDialog());
    await wait(300);
    assert.equal(await visible(page, '#deliveryPerformanceOption'), false, 'the new section is not offered while the backend flag is false');
    const values = await page.$$eval('#overviewPrintSections input[type="checkbox"]', list => list.map(input => input.value));
    assert.ok(values.includes('health-focus') && values.includes('weekly-trend'));
    // Even if a user forced the hidden box on, the request builder refuses to send it.
    await page.evaluate(() => { const box = document.querySelector('#deliveryPerformanceOption input'); box.checked = true; });
    await page.evaluate(() => confirmOverviewPrint()); await wait(300);
    await page.evaluate(() => confirmOverviewProjectPrint()); await wait(800);
    assert.equal(pdfRequests.length, 1, 'exactly one export request');
    const body = JSON.parse(pdfRequests[0].body);
    assert.equal(body.mode, 'overview');
    assert.ok(!body.sections.includes('portfolio-delivery-performance'), 'unsupported section never reaches the old backend');
    assert.ok(body.sections.includes('health-focus'));
    assert.equal(body.overviewScope, 'all');
    assert.ok(Array.isArray(body.projectCodes) && body.projectCodes.length === 3, 'selected-project behavior preserved');
    assert.equal(body.weekId, 'W5-2026');
    assert.match(pdfRequests[0].url, /\/v1\/reports\/overview$/);
  } finally { await page.close(); }
});

test('an invalid week label is kept but never becomes the default reporting week (real page, cross-year order)', { timeout: 60000 }, async () => {
  const weeks = [...weeksFixture(), { __id: 'junk-doc', weekLabel: 'W26 2026 Prototype', weekDate: 'Jun 22 - Jun 28', isReleased: true, version: 1, summary: '', projects: [] }];
  const { page } = await open(uat, { role: 'admin', weeks });
  try {
    assert.equal(await page.$eval('#bannerTitle', e => e.textContent), 'W5 2026', 'default is the latest VALID ISO week');
    const options = await page.$$eval('#wNavSelect option', list => list.map(o => o.textContent.split(' (')[0]));
    assert.equal(options.at(-1), 'W26 2026 Prototype', 'the invalid week is preserved, after every valid week');
    assert.equal(options.length, 9);
    await page.click('#btnDeliveryTrends'); await wait(500);
    // Phase 2A is fail-closed by design: one stored week whose label cannot be verified as an ISO week makes the whole
    // history unavailable (the PDF pipeline behaves identically, so Browser and PDF stay in parity). The page must say so
    // explicitly and show no numbers; it must not guess a date for the invalid week or silently drop it.
    const gated = await page.$eval('#deliveryTrendsView', e => e.innerText);
    assert.match(gated, /cannot be calculated/);
    assert.match(gated, /verified ISO week periods/);
    assert.doesNotMatch(gated, /\+\d+(\.\d+)?pp/);
    // Manual selection of the invalid week is possible and yields an explicit, non-numeric state.
    await page.select('#wNavSelect', '8'); await wait(500);
    const text = await page.$eval('#deliveryTrendsView', e => e.innerText);
    assert.doesNotMatch(text, /\+\d+(\.\d+)?pp/);
  } finally { await page.close(); }
});

test('history that the server has not confirmed (cache-only snapshot) yields no trusted numbers', { timeout: 60000 }, async () => {
  const fake = buildFake({ role: 'admin', weeks: weeksFixture() });
  fake.fromCache = true;
  const { page } = await openDashboard(browser, { baseUrl: uat.baseUrl, fake });
  try {
    await wait(1800);
    await page.click('#btnDeliveryTrends'); await wait(500);
    const text = await page.$eval('#deliveryTrendsView', e => e.innerText);
    assert.match(text, /not been confirmed by the server/);
    assert.equal(await page.$$eval('#deliveryTrendsView .dt-card', list => list.length), 0);
    assert.doesNotMatch(text, /\+\d+(\.\d+)?pp/);
  } finally { await page.close(); }
});

test('sales (released-only) sees the draft week as a gap in the real page; admin sees data for it', { timeout: 120000 }, async () => {
  const draftIndex = 4; // W2 2026 is a draft
  const gapCount = async role => {
    const all = weeksFixture({ draftIndex });
    // initData loads every week for admin/pm and released weeks only for everyone else (the stub applies where isReleased == true).
    const { page } = await open(uat, { role, email: `qa-${role}@example.test`, weeks: all });
    try {
      await page.click('#btnDeliveryTrends'); await wait(500);
      await page.click('[data-dt-window="12"]'); await wait(300);
      return await page.$$eval('#deliveryTrendsView .dt-gap', list => list.length);
    } finally { await page.close(); }
  };
  const salesGaps = await gapCount('sales');
  const adminGaps = await gapCount('admin');
  assert.ok(salesGaps > adminGaps, `sales gaps (${salesGaps}) > admin gaps (${adminGaps})`);
});
