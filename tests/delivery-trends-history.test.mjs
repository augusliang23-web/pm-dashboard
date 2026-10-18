import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardSource } from './helpers/dashboard-source.mjs';
import { canReadDraftWeeks, normalizeDashboardRole } from '../js/dashboard-access.mjs';
import { sortWeeksChronologically } from '../js/week-order.mjs';
import { buildDeliveryTrendsState, renderDeliveryTrendsPageHtml, PROTOTYPE_REASON } from '../js/delivery-trends-page.mjs';
import { renderDeliveryTrendsPage } from '../js/delivery-trends-view.mjs';

// All data here is SYNTHETIC. Nothing is read from Firestore.
const AS_OF = '2026-10-14T00:00:00.000Z';
const project = (id, name, progress, extra = {}) => ({ projectId: id, code: id.toUpperCase(), name, projectManager: `PM of ${name}`, owner: `PM of ${name}`, progress, status: 'green', projectLevel: 'system', visibility: 'active', lifecycle: 'active', ...extra });
const week = (n, projects, extra = {}) => ({ weekId: `W${n}-2026`, weekLabel: `W${n} 2026`, isReleased: true, version: 1, reportingPeriod: { year: 2026, week: n }, projects, ...extra });
const state = (weeks, idx, windowWeeks = 6, extra = {}) => buildDeliveryTrendsState({ weeks, currentIdx: idx, windowWeeks, overviewScope: 'system', role: 'admin', source: 'uat', asOf: AS_OF, historyComplete: true, ...extra });
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => week(from + i, [project('p1', 'Alpha', 10 + from + i)]));
const gains = s => s.contract.weeklySeries.map(entry => entry.gainPp);

// ---- 6 / 12 week completeness ------------------------------------------------------------------------------------
test('6 displayed weekly changes need 7 consecutive source weeks; 12 need 13', () => {
  assert.deepEqual(gains(state(range(35, 41), 6, 6)), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(gains(state(range(29, 41), 12, 12)), Array(12).fill(1));
});

test('one source week too few leaves the first displayed change unavailable (null), never zero', () => {
  const six = state(range(36, 41), 5, 6);
  assert.deepEqual(gains(six), [null, 1, 1, 1, 1, 1]);
  assert.equal(six.contract.weeklySeries[0].comparableCount, 0);
  const twelve = state(range(30, 41), 11, 12);
  assert.deepEqual(gains(twelve), [null, ...Array(11).fill(1)]);
  assert.match(renderDeliveryTrendsPageHtml(six), /History is incomplete/);
  assert.match(renderDeliveryTrendsPageHtml(six), /class="dt-gap"/);
});

test('a missing calendar week creates gaps and is announced, never bridged or zero-filled', () => {
  const weeks = range(35, 41).filter(w => w.reportingPeriod.week !== 38);
  const s = state(weeks, 5, 6);
  assert.deepEqual(gains(s), [1, 1, null, null, 1, 1]);
  assert.ok(s.contract.warnings.some(w => w.code === 'missing-calendar-week'));
  const html = renderDeliveryTrendsPageHtml(s);
  assert.equal((html.match(/class="dt-gap"/g) || []).length, 2);
  assert.match(html, /have no report and are shown as gaps/);
  assert.match(html, /History is incomplete/);
});

test('complete history does not claim to be incomplete', () => {
  assert.doesNotMatch(renderDeliveryTrendsPageHtml(state(range(35, 41), 6, 6)), /History is incomplete/);
});

test('unreleased weeks are gaps for released-only readers and ordinary weeks for draft readers', () => {
  const weeks = range(35, 41); weeks[3].isReleased = false; // W38 is a draft
  const releasedOnly = state(weeks.filter(w => w.isReleased), 5, 6, { role: 'sales' });
  assert.deepEqual(gains(releasedOnly), [1, 1, null, null, 1, 1]);
  assert.deepEqual(gains(state(weeks, 6, 6)), [1, 1, 1, 1, 1, 1]);
});

test('out-of-order input is handled by period, not by array position', () => {
  const ordered = state(range(35, 41), 6, 6).contract;
  const shuffled = [...range(35, 41)].reverse();
  const viaSort = state(sortWeeksChronologically(shuffled), 6, 6).contract;
  assert.deepEqual(viaSort.weeklySeries.map(x => x.gainPp), ordered.weeklySeries.map(x => x.gainPp));
  assert.equal(viaSort.provenance.anchorWeekId, 'W41-2026');
});

test('a historical anchor never uses later weeks (no future observations)', () => {
  const weeks = range(35, 43);
  weeks[8].projects.push(project('future', 'Future Secret', 99)); // W43 only
  const s = state(weeks, 3, 6); // anchor W38
  assert.equal(s.contract.provenance.anchorWeekId, 'W38-2026');
  assert.deepEqual(s.contract.weeklySeries.map(x => x.label), ['2026-W33', '2026-W34', '2026-W35', '2026-W36', '2026-W37', '2026-W38']);
  assert.doesNotMatch(JSON.stringify(s.contract) + renderDeliveryTrendsPageHtml(s), /Future Secret|FUTURE/);
});

test('duplicate records for the same period make the result unavailable instead of picking one silently', () => {
  const weeks = [...range(35, 41), { ...week(41, [project('p1', 'Alpha', 99)]), weekId: 'W41-copy', version: 2 }];
  const s = state(weeks, 6, 6);
  assert.equal(s.contract.status, 'unavailable');
  assert.equal(s.contract.summary.weeklyProgressGainPp, null);
});

test('revised historical records are reflected (latest saved data) and the result is tied to asOf', () => {
  const weeks = range(35, 41);
  const before = state(weeks, 6, 6).contract;
  weeks[2] = week(37, [project('p1', 'Alpha', 50)], { version: 2 }); // history revised
  const after = state(weeks, 6, 6).contract;
  assert.notDeepEqual(after.weeklySeries.map(x => x.gainPp), before.weeklySeries.map(x => x.gainPp));
  assert.equal(after.provenance.asOf, AS_OF);
});

test('invalid progress is excluded and reported, never treated as zero', () => {
  const weeks = range(35, 41);
  weeks[5].projects[0].progress = null;
  const s = state(weeks, 6, 6);
  assert.equal(s.contract.summary.currentCompletionPct, 51);
  assert.ok(s.contract.weeklySeries[4].gainPp === null || s.contract.weeklySeries[4].gainPp !== 0);
  assert.equal(s.contract.weeklySeries[4].gainPp, null);
});

// ---- role and visibility matrix ------------------------------------------------------------------------------------
const ROLES = ['admin', 'pm', 'sales', 'engineering', 'business', 'product', 'bd', 'vip', 'executive'];
const SECRETS = { draft: ['ZZ-DRAFT', 'Draftonly Secret', 'PM of Draftonly Secret'], future: ['ZZ-FUTURE', 'Future Secret', 'PM of Future Secret'],
  hidden: ['ZZ-HIDDEN', 'Hidden Secret', 'PM of Hidden Secret'], archived: ['ZZ-ARCH', 'Archived Secret', 'PM of Archived Secret'], software: ['ZZ-SOFT', 'Software Secret', 'PM of Software Secret'] };

function matrixWeeks() {
  const weeks = [];
  for (let n = 35; n <= 43; n++) {
    const projects = [project('p1', 'Alpha', 10 + n), project('zz-hidden', 'Hidden Secret', 20 + n, { visibility: 'hidden' }), project('zz-arch', 'Archived Secret', 30 + n, { visibility: 'archived' }), project('zz-soft', 'Software Secret', 40 + n, { projectLevel: 'software' })];
    if (n === 38) projects.push(project('zz-draft', 'Draftonly Secret', 5)); // exists only in a DRAFT week
    if (n === 43) projects.push(project('zz-future', 'Future Secret', 5)); // exists only AFTER the anchor
    if (n >= 35 && n <= 37) projects.push(project('zz-hist', 'Historical Only', 60 + n)); // gone at the anchor
    weeks.push(week(n, projects, { isReleased: n !== 38 }));
  }
  return weeks;
}
// Mirrors initData: draft-capable roles (admin, pm) load every week; everyone else loads released weeks only.
const loadedFor = role => matrixWeeks().filter(w => canReadDraftWeeks(role) || w.isReleased);
const everything = (s) => JSON.stringify(s.contract ?? s) + renderDeliveryTrendsPageHtml(s) + (s.contract ? renderDeliveryTrendsPage(s.contract) : '');

for (const role of ROLES) {
  test(`role matrix: ${role} sees only authorized history (draft/future/hidden/archived/out-of-scope never leak)`, () => {
    const weeks = loadedFor(role);
    const idx = weeks.findIndex(w => w.weekId === 'W41-2026');
    const exec = ['vip', 'executive'].includes(normalizeDashboardRole(role));
    const s = state(weeks, idx, 12, { role, executivePerspective: exec });
    assert.equal(s.state, 'ready');
    const output = everything(s);
    for (const secret of [...SECRETS.future, ...SECRETS.hidden, ...SECRETS.archived, ...SECRETS.software]) assert.ok(!output.includes(secret), `${role} must not see ${secret}`);
    if (!canReadDraftWeeks(role)) for (const secret of SECRETS.draft) assert.ok(!output.includes(secret), `${role} must not see draft-only ${secret}`);
    // Current project list never contains historical-only projects.
    const rows = renderDeliveryTrendsPageHtml(s).match(/<section class="dt-panel" data-dt-section="projects">[\s\S]*?<\/section>/)?.[0] || '';
    assert.doesNotMatch(rows, /Historical Only|ZZ-HIST/);
    // Draft week is a gap for released-only readers, a normal week for draft readers.
    const w38 = s.contract.weeklySeries.find(x => x.label === '2026-W38');
    if (canReadDraftWeeks(role)) assert.equal(w38.gainPp !== null, true);
    else assert.equal(w38.gainPp, null);
  });
}

test('hidden/archived/out-of-scope projects are excluded even when the user switches scope or admin visibility', () => {
  const weeks = loadedFor('admin');
  const idx = weeks.findIndex(w => w.weekId === 'W41-2026');
  for (const overviewScope of ['system', 'software', 'all', 'hardware-module']) {
    const s = state(weeks, idx, 6, { overviewScope, visibilityFilter: 'all' });
    const output = everything(s);
    for (const secret of [...SECRETS.future, ...SECRETS.hidden, ...SECRETS.archived]) assert.ok(!output.includes(secret), `${overviewScope}: ${secret}`);
    if (overviewScope === 'system') for (const secret of SECRETS.software) assert.ok(!output.includes(secret));
  }
});

test('diagnostics and warnings contain codes and week ids only, never project names, codes or managers', () => {
  const weeks = loadedFor('admin');
  const s = state(weeks, weeks.findIndex(w => w.weekId === 'W41-2026'), 12);
  for (const warning of s.contract.warnings) assert.deepEqual(Object.keys(warning).sort(), ['code', 'count', 'message', 'weekId']);
  const warningsText = JSON.stringify(s.contract.warnings);
  for (const secret of Object.values(SECRETS).flat()) assert.ok(!warningsText.includes(secret));
});

test('executive perspective loads released weeks only even if a draft week were passed in', () => {
  const weeks = matrixWeeks(); // includes the draft W38
  const s = state(weeks, weeks.findIndex(w => w.weekId === 'W41-2026'), 12, { role: 'executive', executivePerspective: true });
  assert.ok(!everything(s).includes('Draftonly Secret'));
  assert.equal(s.contract.weeklySeries.find(x => x.label === '2026-W38').gainPp, null);
});

test('an unreleased anchor is unavailable to an executive instead of leaking draft data', () => {
  const weeks = matrixWeeks();
  const idx = weeks.findIndex(w => w.weekId === 'W38-2026');
  const s = state(weeks, idx, 6, { role: 'executive', executivePerspective: true });
  assert.notEqual(s.contract.status, 'ok');
  assert.equal(s.contract.summary.weeklyProgressGainPp, null);
  assert.ok(!everything(s).includes('Draftonly Secret'));
});

// ---- synthetic / prototype provenance --------------------------------------------------------------------------------
test('the built-in prototype fallback is never presented as verified UAT or Production data', () => {
  const source = dashboardSource('uat');
  const start = source.indexOf('function buildPrototypeWeeks(');
  const body = source.slice(start, source.indexOf('\n}\n', start) + 3);
  const prototype = new Function(`${body}; return buildPrototypeWeeks();`)();
  assert.ok(prototype.length >= 1);
  assert.ok(prototype.every(w => !w.weekId && !w.__documentId), 'prototype weeks carry no saved document id');
  const s = buildDeliveryTrendsState({ weeks: prototype, currentIdx: 0, windowWeeks: 6, overviewScope: 'system', role: 'admin', source: 'uat', asOf: AS_OF, historyComplete: true });
  assert.equal(s.state, 'unavailable');
  assert.equal(s.prototype, true);
  // Confirmed zero weeks: raw history is empty with source 'uat'; returns insufficient reporting history, NOT prototype data.
  const viaSnapshot = buildDeliveryTrendsState({ weeks: [], currentIdx: 0, anchorWeekId: undefined, windowWeeks: 6, overviewScope: 'system', role: 'admin', source: 'uat', asOf: AS_OF, historyComplete: true });
  assert.equal(viaSnapshot.state, 'unavailable');
  assert.equal(viaSnapshot.prototype, undefined);
  assert.equal(viaSnapshot.reason, 'Insufficient reporting history to calculate delivery trends.');
  assert.equal(s.contract, undefined);
  const html = renderDeliveryTrendsPageHtml(s);
  assert.match(html, /prototype data/);
  assert.match(html, /never presented as verified UAT or Production data/);
  assert.doesNotMatch(html, /dt-cards|Weekly Progress Gain|DEMO-/);
  assert.equal(s.reason, PROTOTYPE_REASON);
});

test('a mixed dataset that contains any unsaved week is not treated as live', () => {
  const weeks = [...range(35, 41), { weekLabel: 'W26 2026 Prototype', isReleased: true, projects: [project('demo', 'Demo', 62)] }];
  const s = state(weeks, 6, 6);
  assert.equal(s.prototype, true);
});

test('saved weeks carry the real environment as provenance and are not labelled synthetic', () => {
  const s = state(range(35, 41), 6, 6);
  assert.equal(s.contract.provenance.source, 'uat');
  assert.doesNotMatch(renderDeliveryTrendsPageHtml(s), /Synthetic data for preview only/);
});

test('an explicit synthetic source is always disclosed on the page', () => {
  const s = state(range(35, 41), 6, 6, { source: 'synthetic' });
  assert.match(renderDeliveryTrendsPageHtml(s), /Synthetic data for preview only/);
});
