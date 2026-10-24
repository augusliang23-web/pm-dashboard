import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { dashboardSource } from './helpers/dashboard-source.mjs';
import { overviewHistory } from './helpers/overview-provenance-fixture.mjs';
import * as deliveryTrendsModule from '../js/delivery-trends-page.mjs';
import { calculateDeliveryTrends } from '../shared/delivery-trends.mjs';
import { loadAuthorizedReport } from '../pdf-service/src/report-data.js';

// Exercise the real snapshot producer and page wiring, rather than supplying a valid source in a test.
function productionSnapshot(weeks, metadata = {}, fail = false) {
  const source = dashboardSource('production');
  const start = source.indexOf('function initData(');
  const body = source.slice(start, source.indexOf('\n}\n', start) + 3);
  const stateStart = source.indexOf('function currentDeliveryTrendsState(');
  const stateBody = source.slice(stateStart, source.indexOf('\n}\n', stateStart) + 3);
  let snapshot, error;
  const context = vm.createContext({
    window: {}, document: { getElementById: () => null }, db: {},
    weeksUnsub: null, deliveryTrendsRawWeeks: [], deliveryTrendsHistoryState: {},
    currentRole: 'admin', currentUser: { uid: 'synthetic' }, authSessionGeneration: 1,
    allWeeks: [], currentIdx: -1, jumpToLatestOnNextRender: false,
    deliveryTrendsModule, deliveryTrendsWindow: 6, overviewScope: 'system',
    canCurrentUser: () => false, getEmailKey: () => 'synthetic@example.test',
    isAuthInitializationCurrent: () => true, collection: () => ({}), query: () => ({}), orderBy: () => ({}), where: () => ({}),
    onSnapshot: (_q, _options, success, failure) => { snapshot = success; error = failure; return () => {}; },
    normalizeProject: p => ({ ...p }), projectRevisionFingerprint: () => 'fixture',
    sortWeeksByLabel: w => [...w].sort((a, b) => a.weekLabel.localeCompare(b.weekLabel)),
    render: () => {}, hideLoader: () => {}, showDataLoadError: () => {}, isDeliveryTrendsExecutive: () => false
  });
  vm.runInContext(`${body}\n${stateBody}\ninitData(1, currentUser);`, context);
  if (fail) error(new Error('synthetic offline'));
  else snapshot({ metadata, docs: weeks.map(({ weekId, ...data }) => ({ id: weekId, data: () => structuredClone(data) })) });
  if (weeks.length && !fail) context.currentIdx = context.allWeeks.findIndex(w => w.__documentId === 'W42-2026');
  return { context, state: windowWeeks => vm.runInContext(`currentDeliveryTrendsState(${windowWeeks})`, context) };
}

for (const windowWeeks of [6, 12]) {
  test(`Production snapshot W42 → canonical ${windowWeeks}-week contract → PDF parity`, async () => {
    const weeks = overviewHistory().reverse();
    const { state } = productionSnapshot(weeks);
    const web = state(windowWeeks).contract;
    assert.equal(web.provenance.source, 'production');
    assert.notEqual(web.status, 'unavailable');
    assert.equal(web.summary.currentCompletionPct, 34);
    assert.equal(web.summary.weeklyProgressGainPp, 2);
    assert.equal(web.weeklySeries.length, windowWeeks);
    assert.equal(web.projects.filter(p => p.isInAnchorScope).length, 3);
    assert.ok(web.projects.every(p => p.trend.length === windowWeeks));
    const anchor = weeks.find(w => w.weekId === 'W42-2026');
    const pdf = await loadAuthorizedReport({ idToken: 'synthetic',
      request: { mode: 'overview', weekId: anchor.weekId, overviewScope: 'system', windowWeeks,
        sections: ['portfolio-delivery-performance'], projectCodes: anchor.projects.map(p => p.code) },
      adapters: { verifyIdToken: async () => ({ uid:'synthetic-uid',email: 'synthetic@example.test',firebase:{sign_in_provider:'password'} }),
        getUserByEmail: async () => ({ authUid:'synthetic-uid',role: 'admin' }), getWeekById: async () => anchor,
        getDeliveryHistory: async () => ({ complete: true, weeks }),
        getDeliveryTrendsProvenance: () => ({ source: 'production', asOf: web.provenance.asOf }) }
    });
    assert.deepEqual(pdf.deliveryTrends, web);
    assert.doesNotMatch(deliveryTrendsModule.renderDeliveryTrendsPageHtml(state(windowWeeks)), /could not be validated/);
  });
}

test('real snapshot cache/error/empty paths retain completeness safeguards and canonical provenance', () => {
  for (const metadata of [{ fromCache: true }, { hasPendingWrites: true }]) {
    assert.equal(productionSnapshot(overviewHistory(), metadata).state(6).state, 'unavailable');
  }
  for (const fail of [false, true]) {
    const { context, state } = productionSnapshot([], {}, fail);
    assert.equal(context.deliveryTrendsHistoryState.source, 'production');
    assert.equal(state(6).state, 'unavailable');
  }
});

test('missing history, invalid periods and released-only boundaries still fail closed or retain null gaps', () => {
  const weeks = overviewHistory().filter(w => w.weekId !== 'W40-2026');
  const { state, context } = productionSnapshot(weeks);
  const web = state(6).contract;
  assert.equal(web.weeklySeries.find(w => w.label === '2026-W40').gainPp, null);
  assert.equal(web.weeklySeries.find(w => w.label === '2026-W41').gainPp, null);
  context.currentRole = 'executive';
  context.currentIdx = context.allWeeks.findIndex(w => w.__documentId === 'W43-2026');
  assert.equal(state(6).contract.status, 'unavailable');
  context.currentRole = 'admin';
  assert.notEqual(state(6).contract.status, 'unavailable');
  const malformed = overviewHistory(); malformed[0].weekDate = 'not a date';
  assert.equal(productionSnapshot(malformed).state(6).contract.status, 'unavailable');
  // Deliberately invalid enums are still rejected by the unchanged canonical validator.
  assert.equal(calculateDeliveryTrends({ source: 'prod' }).warnings[0].code, 'invalid-provenance');
});
