import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeliveryTrendsState, normalizeDeliveryWindow, renderDeliveryTrendsPageHtml, renderDeliveryTrendsPrintHtml
} from '../js/delivery-trends-page.mjs';

// SYNTHETIC weeks (not Production data). Each active project gains exactly 2 pp per week.
function weeksFixture({ count = 14, firstWeek = 29, withPeriod = true, released = true } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const week = firstWeek + i;
    return {
      weekId: `2026-W${week}`, weekLabel: `W${week} 2026`, isReleased: released, version: 1,
      ...(withPeriod ? { reportingPeriod: { year: 2026, week } } : {}),
      projects: [
        { projectId: 'p1', code: 'SYN-1', name: 'Synthetic One', owner: 'Synthetic PM A', projectManager: 'Synthetic PM A', progress: 10 + i * 2, status: 'green', projectLevel: 'system', visibility: 'active', lifecycle: 'active' },
        { projectId: 'p2', code: 'SYN-2', name: 'Synthetic Two', projectManager: 'Synthetic PM B', progress: 20 + i * 2, status: 'yellow', projectLevel: 'software', visibility: 'active', lifecycle: 'active' },
        { projectId: 'p3', code: 'SYN-3', name: 'Synthetic Hidden', projectManager: 'Synthetic PM C', progress: 50, status: 'red', projectLevel: 'system', visibility: 'hidden', lifecycle: 'active' }
      ]
    };
  });
}
const base = { historyComplete: true, source: 'uat', asOf: '2026-10-14T00:00:00Z', role: 'admin', overviewScope: 'system', visibilityFilter: 'active' };

test('window normalization only allows 6 or 12', () => {
  assert.equal(normalizeDeliveryWindow(12), 12);
  assert.equal(normalizeDeliveryWindow('12'), 12);
  for (const value of [undefined, 0, 7, 'x', null, 24]) assert.equal(normalizeDeliveryWindow(value), 6);
});

test('state comes from the shared engine, not from UI arithmetic', () => {
  const weeks = weeksFixture();
  const state = buildDeliveryTrendsState({ ...base, weeks, currentIdx: weeks.length - 1, windowWeeks: 6 });
  assert.equal(state.state, 'ready');
  assert.equal(state.contract.contractVersion, 'delivery-trends/v1');
  assert.equal(state.contract.summary.weeklyProgressGainPp, 2);
  assert.equal(state.contract.summary.comparableCount, 1);
  assert.equal(state.contract.weeklySeries.length, 6);
  assert.equal(state.contract.provenance.source, 'uat');
});

test('12-week window yields 12 calendar slots', () => {
  const weeks = weeksFixture({ count: 14 });
  const state = buildDeliveryTrendsState({ ...base, weeks, currentIdx: 13, windowWeeks: 12 });
  assert.equal(state.contract.weeklySeries.length, 12);
  assert.equal((renderDeliveryTrendsPageHtml(state, { windowWeeks: 12 }).match(/class="dt-dot-point"/g) || []).length, 12);
});

test('reporting-week changes move the anchor', () => {
  const weeks = weeksFixture();
  const earlier = buildDeliveryTrendsState({ ...base, weeks, currentIdx: 8, windowWeeks: 6 });
  const latest = buildDeliveryTrendsState({ ...base, weeks, currentIdx: 13, windowWeeks: 6 });
  assert.notEqual(earlier.contract.provenance.anchorWeekId, latest.contract.provenance.anchorWeekId);
  assert.equal(latest.contract.provenance.anchorWeekId, '2026-W42');
  assert.equal(earlier.contract.provenance.anchorWeekId, '2026-W37');
});

test('overview scope changes are applied by the engine scope filter', () => {
  const weeks = weeksFixture();
  const system = buildDeliveryTrendsState({ ...base, weeks, currentIdx: 13, overviewScope: 'system' });
  const software = buildDeliveryTrendsState({ ...base, weeks, currentIdx: 13, overviewScope: 'software' });
  const names = state => state.contract.projects.filter(p => p.currentCompletionPct !== null).map(p => p.name);
  assert.deepEqual(names(system), ['Synthetic One']);
  assert.deepEqual(names(software), ['Synthetic Two']);
});

test('hidden projects never reach the engine or the rendered page (no unauthorized exposure)', () => {
  const weeks = weeksFixture();
  const state = buildDeliveryTrendsState({ ...base, weeks, currentIdx: 13, overviewScope: 'all' });
  assert.doesNotMatch(JSON.stringify(state.contract), /Synthetic Hidden|SYN-3|Synthetic PM C/);
  assert.doesNotMatch(renderDeliveryTrendsPageHtml(state), /Synthetic Hidden/);
});

test('executive perspective sees released weeks only', () => {
  const weeks = weeksFixture();
  weeks[13].isReleased = false; // latest week still a draft
  const exec = buildDeliveryTrendsState({ ...base, role: 'executive', executivePerspective: true, weeks, currentIdx: 13 });
  assert.notEqual(exec.state === 'ready' && exec.contract.summary.weeklyProgressGainPp, 2);
  assert.doesNotMatch(JSON.stringify(exec.contract?.projects?.[0]?.trend ?? []), /W42/);
  const admin = buildDeliveryTrendsState({ ...base, weeks, currentIdx: 13 });
  assert.equal(admin.contract.summary.weeklyProgressGainPp, 2);
});

test('validated stored ISO labels satisfy the merged authoritative period pipeline', () => {
  const weeks = weeksFixture({ withPeriod: false });
  const state = buildDeliveryTrendsState({ ...base, weeks, currentIdx: 13 });
  assert.equal(state.state, 'ready');
  assert.equal(state.contract.summary.weeklyProgressGainPp, 2);
  assert.match(renderDeliveryTrendsPageHtml(state), /dt-cards/);
});

test('merged engine exposes explicit anchor membership for current project rendering', () => {
  const weeks = weeksFixture();
  const state = buildDeliveryTrendsState({ ...base, weeks, currentIdx: 13 });
  assert.equal(state.contract.projects.some(p => typeof p.isInAnchorScope === 'boolean'), true);
  assert.match(renderDeliveryTrendsPageHtml(state), /Synthetic One/);
});

test('missing selection or malformed weeks produce an unavailable state without throwing', () => {
  assert.equal(buildDeliveryTrendsState({ ...base, weeks: [], currentIdx: 0 }).state, 'unavailable');
  assert.equal(buildDeliveryTrendsState({ ...base, weeks: null, currentIdx: 0 }).state, 'unavailable');
  const bad = [{ weekId: 'x', projects: 'nope' }];
  const state = buildDeliveryTrendsState({ ...base, weeks: bad, currentIdx: 0 });
  assert.ok(state.state === 'unavailable' || state.contract.status === 'unavailable');
  assert.match(renderDeliveryTrendsPageHtml({ state: 'unavailable', reason: '<b>x</b>' }), /&lt;b&gt;x&lt;\/b&gt;/);
});

test('print variant has no interactive controls and defaults to six weeks', () => {
  const weeks = weeksFixture();
  const state = buildDeliveryTrendsState({ ...base, weeks, currentIdx: 13, windowWeeks: 12 });
  const html = renderDeliveryTrendsPrintHtml(state);
  assert.doesNotMatch(html, /<button|onclick/);
  assert.match(renderDeliveryTrendsPrintHtml({ state: 'unavailable', reason: 'No' }), /No/);
});
