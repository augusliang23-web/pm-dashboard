// Browser/PDF parity across every dashboard role: the same stored weeks, the same role, anchor, scope and window must
// produce the identical canonical contract in the Browser page state and the PDF report data. SYNTHETIC data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoundedDeliveryHistoryReader, loadAuthorizedReport } from '../src/report-data.js';
import { buildOverviewReportModel } from '../src/report-model.js';
import { renderOverviewReportHtml } from '../src/overview-report.js';
import { parseReportRequest } from '../src/report-request.js';
import { buildDeliveryTrendsState } from '../../js/delivery-trends-page.mjs';
import { canReadDraftWeeks } from '../../js/dashboard-access.mjs';
import { sortWeeksChronologically } from '../../js/week-order.mjs';

const ROLES = ['admin', 'pm', 'sales', 'engineering', 'business', 'product', 'bd', 'vip', 'executive'];
const SECTION = 'portfolio-delivery-performance';
const AS_OF = '2026-10-14T00:00:00.000Z';
const DAY = 86400000;
const isoMonday = (year, week) => { const jan4 = Date.UTC(year, 0, 4); return jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (week - 1) * 7 * DAY; };
const monthDay = time => new Date(time).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const project = (id, name, progress, extra = {}) => ({ projectId: id, code: id.toUpperCase(), name, owner: `PM ${id}`, projectManager: `PM ${id}`, progress, status: ['green', 'yellow', 'red'][id.length % 3], projectLevel: 'system', visibility: 'active', lifecycle: 'active', ...extra });
function docs() {
  const map = new Map();
  // Cross-year history: W50 2025 .. W4 2026 (W52 2025 -> W1 2026 rollover); W53 is not a valid 2025 week.
  const periods = [[2025, 50], [2025, 51], [2025, 52], [2026, 1], [2026, 2], [2026, 3], [2026, 4], [2026, 5], [2026, 6]];
  periods.forEach(([year, week], i) => {
    const projects = [project('a', 'Alpha', 10 + i * 2), project('b', 'Bravo', 30 + i), project('hid', 'Hidden', 50, { visibility: 'hidden' }), project('soft', 'Soft', 40 + i, { projectLevel: 'software' })];
    if (i >= 2 && i <= 3) projects.push(project('gone', 'Gone Later', 70 + i));
    map.set(`W${week}-${year}`, { weekLabel: `W${week} ${year}`, weekDate: `${monthDay(isoMonday(year, week))} - ${monthDay(isoMonday(year, week) + 4 * DAY)}`, isReleased: !(week === 1 && year === 2026) && !(week === 6 && year === 2026), version: 1, projects });
  });
  return map;
}
const fakeDb = (map) => ({ collection: () => ({ f: null, lim: 50, after: null, where(f, o, v) { this.f = [f, v]; return this; }, orderBy() { return this; }, limit(n) { this.lim = n; return this; }, startAfter(c) { this.after = c; return this; },
  async get() { let ids = [...map.keys()].sort(); if (this.f) ids = ids.filter(id => map.get(id)[this.f[0]] === this.f[1]); if (this.after) ids = ids.filter(id => id > this.after); ids = ids.slice(0, this.lim); return { docs: ids.map(id => ({ id, data: () => JSON.parse(JSON.stringify(map.get(id))) })) }; } }) });

async function pdf(role, weekId, map, { windowWeeks, overviewScope = 'all', projectCodes } = {}) {
  const reader = createBoundedDeliveryHistoryReader({ db: fakeDb(map) });
  const request = parseReportRequest({ mode: 'overview', weekId, sections: [SECTION], overviewScope, projectCodes }, { deliveryPerformanceSection: true });
  return loadAuthorizedReport({ request, idToken: 't', adapters: { verifyIdToken: async () => ({uid:'pdf-fixture',firebase:{sign_in_provider:'password'},email: 'qa@example.test' }), getUserByEmail: async () => ({authUid:'pdf-fixture',role }),
    getWeekById: async id => JSON.parse(JSON.stringify(map.get(id))), getDeliveryHistory: reader, deliveryTrendsWindowWeeks: windowWeeks, getDeliveryTrendsProvenance: () => ({ source: 'synthetic', asOf: AS_OF }) } });
}
// What the dashboard has loaded for a role (initData): admin/pm read every week, everyone else released weeks only.
function browser(role, weekId, map, { windowWeeks = 6, overviewScope = 'all' } = {}) {
  const raw = [...map.entries()].filter(([, week]) => canReadDraftWeeks(role) || week.isReleased).map(([id, week]) => ({ ...JSON.parse(JSON.stringify(week)), weekId: id }));
  return buildDeliveryTrendsState({ weeks: raw, anchorWeekId: weekId, currentIdx: 0, windowWeeks, overviewScope, role, executivePerspective: ['vip', 'executive'].includes(role), historyComplete: true, source: 'synthetic', asOf: AS_OF });
}
const allCodes = map => [...new Set([...map.values()].flatMap(week => week.projects.map(p => p.code)))];

for (const role of ROLES) {
  test(`parity: ${role} — Browser state equals PDF report data for a released anchor (cross-year window, drafts, hidden, out-of-scope)`, async () => {
    const map = docs();
    const web = browser(role, 'W5-2026', map);
    const report = await pdf(role, 'W5-2026', map, { projectCodes: allCodes(map) });
    assert.equal(web.state, 'ready');
    assert.deepEqual(report.deliveryTrends, web.contract);
    assert.deepEqual(buildOverviewReportModel(report).deliveryTrends, web.contract);
    // Same missing-data semantics in the rendered PDF: a draft week is a gap for released-only roles.
    const draftReader = canReadDraftWeeks(role);
    const w1 = web.contract.weeklySeries.find(entry => entry.label === '2026-W01');
    assert.equal(w1.gainPp === null, !draftReader);
    assert.doesNotMatch(JSON.stringify(web.contract) + renderOverviewReportHtml({ ...report, sections: [SECTION] }), /Hidden|HID/);
  });
}

test('parity holds for a six-week PDF and the six-week Browser window, and the Browser 12-week view is a superset of the same definitions', async () => {
  const map = docs();
  const web6 = browser('pm', 'W5-2026', map, { windowWeeks: 6 });
  const web12 = browser('pm', 'W5-2026', map, { windowWeeks: 12 });
  const report = await pdf('pm', 'W5-2026', map, { windowWeeks: 6, projectCodes: allCodes(map) });
  assert.deepEqual(report.deliveryTrends, web6.contract);
  assert.equal(web12.contract.weeklySeries.length, 12);
  assert.deepEqual(web12.contract.weeklySeries.slice(-6).map(e => [e.label, e.gainPp, e.comparableCount]), web6.contract.weeklySeries.map(e => [e.label, e.gainPp, e.comparableCount]));
  assert.equal(web12.contract.summary.weeklyProgressGainPp, web6.contract.summary.weeklyProgressGainPp);
});

test('parity: the explicit reporting-week anchor (not array order) decides the result in both pipelines, historical anchors included', async () => {
  const map = docs();
  for (const anchor of ['W52-2025', 'W3-2026', 'W5-2026']) {
    const web = browser('admin', anchor, map);
    const report = await pdf('admin', anchor, map, { projectCodes: allCodes(map) });
    assert.equal(web.contract.provenance.anchorWeekId, anchor);
    assert.deepEqual(report.deliveryTrends, web.contract, anchor);
  }
});

test('parity: project scope and partial project selection', async () => {
  const map = docs();
  const web = browser('pm', 'W5-2026', map, { overviewScope: 'system' });
  const report = await pdf('pm', 'W5-2026', map, { overviewScope: 'system', projectCodes: allCodes(map) });
  assert.deepEqual(report.deliveryTrends, web.contract);
  // Partial selection is the PDF's own (accepted) behavior: only selected projects, never names of unselected ones.
  const partial = await pdf('pm', 'W5-2026', map, { overviewScope: 'all', projectCodes: ['A'] });
  assert.deepEqual(partial.deliveryTrends.projects.filter(p => p.isInAnchorScope).map(p => p.code), ['A']);
  assert.doesNotMatch(JSON.stringify(partial.deliveryTrends), /Bravo|Soft|"B"/);
});

test('parity: the Browser sorts weeks chronologically, the engine sorts by ISO period; both agree across the year rollover', async () => {
  const map = docs();
  const sortedLabels = sortWeeksChronologically([...map.values()]).map(week => week.weekLabel);
  assert.deepEqual(sortedLabels, ['W50 2025', 'W51 2025', 'W52 2025', 'W1 2026', 'W2 2026', 'W3 2026', 'W4 2026', 'W5 2026', 'W6 2026']);
  const web = browser('pm', 'W5-2026', map);
  assert.deepEqual(web.contract.weeklySeries.map(e => e.label), ['2025-W52', '2026-W01', '2026-W02', '2026-W03', '2026-W04', '2026-W05']);
});

test('Browser requires server-confirmed history; the PDF reader requires complete history: neither invents numbers', async () => {
  const map = docs();
  const raw = [...map.entries()].map(([id, week]) => ({ ...week, weekId: id }));
  const web = buildDeliveryTrendsState({ weeks: raw, anchorWeekId: 'W5-2026', currentIdx: 0, role: 'pm', historyComplete: false, source: 'uat', asOf: AS_OF });
  assert.equal(web.state, 'unavailable');
  const report = await loadAuthorizedReport({ request: parseReportRequest({ mode: 'overview', weekId: 'W5-2026', sections: [SECTION], overviewScope: 'all', projectCodes: ['A'] }, { deliveryPerformanceSection: true }), idToken: 't',
    adapters: { verifyIdToken: async () => ({uid:'pdf-fixture',firebase:{sign_in_provider:'password'},email: 'qa@example.test' }), getUserByEmail: async () => ({authUid:'pdf-fixture',role: 'pm' }), getWeekById: async id => map.get(id), getDeliveryHistory: async () => ({ weeks: [...map.values()], complete: false }) } });
  assert.equal(report.deliveryTrends.status, 'unavailable');
  assert.equal(report.deliveryTrends.summary.weeklyProgressGainPp, null);
});

test('parity: a stored week with an unverifiable label makes Browser and PDF equally unavailable (fail closed, no guessed dates)', async () => {
  const map = docs();
  map.set('junk-doc', { weekLabel: 'W26 2026 Prototype', weekDate: 'Jun 22 - Jun 28', isReleased: true, version: 1, projects: [] });
  const web = browser('pm', 'W5-2026', map);
  const report = await pdf('pm', 'W5-2026', map, { projectCodes: allCodes(map) });
  assert.equal(web.contract.status, 'unavailable');
  assert.deepEqual(report.deliveryTrends, web.contract);
  assert.equal(report.deliveryTrends.summary.weeklyProgressGainPp, null);
});
