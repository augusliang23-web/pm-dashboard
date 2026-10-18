import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as weekOrder from '../js/week-order.mjs';

// Runs the REAL initData__uat snapshot handler (extracted from index.html) in a sandbox and feeds it snapshots.
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const init = source.match(/function initData__uat\([\s\S]*?\n\}/)[0];
const doc = (id, weekLabel) => ({ id, data: () => ({ weekLabel, weekDate: 'Jan 5 - Jan 9', isReleased: true, projects: [] }) });
const snap = (docs, meta = { fromCache: false, hasPendingWrites: false }) => ({ metadata: meta, docs });

function harness(overrides = {}) {
  let listener, errorListener;
  let renderCalls = 0, hideLoaderCalls = 0, errorCalls = 0;
  const context = vm.createContext({
    weeksUnsub: null, executiveTimelineConfigUnsub: null, executiveLiveTimelineUnsub: null, executivePendingMilestoneUnsub: null,
    deliveryTrendsRawWeeks: [], deliveryTrendsHistoryState: { source: null, complete: false }, db: {}, currentRole: 'admin', authSessionGeneration: 1, currentUser: { uid: 'u' },
    getEmailKey: () => 'u@example.test', canReadDraftWeeks: () => true, canCurrentUser: () => false, isAuthInitializationCurrent: () => true,
    collection: (_, name) => ({ name }), doc: () => ({ name: 'settings' }), query: ref => ref, orderBy: () => {}, where: () => {},
    onSnapshot: (target, ...args) => {
      if (target.name === 'weeks') {
        if (typeof args[0] === 'object') args.shift();
        [listener, errorListener] = args;
      }
      return () => {};
    },
    normalizeProject: p => ({ ...p }), projectRevisionFingerprint: JSON.stringify, sortWeeksByLabel: x => x,
    sortWeeksChronologically: weekOrder.sortWeeksChronologically, latestValidWeekIndex: weekOrder.latestValidWeekIndex,
    currentIdx: -1, jumpToLatestOnNextRender: true, allWeeks: [], escHtml: String,
    document: { getElementById: () => ({ innerHTML: '', value: '' }) },
    render: () => { renderCalls++; },
    hideLoader: () => { hideLoaderCalls++; },
    showDataLoadError: () => { errorCalls++; },
    buildPrototypeWeeks: () => [{ weekLabel: 'W26 2026 Prototype', weekDate: 'Jun 22 - Jun 28', isReleased: true, projects: [] }],
    ...overrides
  });
  vm.runInContext(init + ';initData__uat(1,{uid:"u"});', context);
  return {
    context,
    push: (docs, meta) => listener(snap(docs, meta)),
    error: err => errorListener && errorListener(err),
    label: () => context.allWeeks[context.currentIdx]?.weekLabel,
    renderCalls: () => renderCalls,
    hideLoaderCalls: () => hideLoaderCalls,
    errorCalls: () => errorCalls
  };
}

test('REPRODUCTION: an invalid label sorts last and must not become the default reporting week', () => {
  const h = harness();
  h.push([doc('W2-2026', 'W2 2026'), doc('X-1', 'W26 2026 Prototype'), doc('W52-2025', 'W52 2025'), doc('W1-2026', 'W1 2026')]);
  assert.deepEqual(h.context.allWeeks.map(w => w.weekLabel), ['W52 2025', 'W1 2026', 'W2 2026', 'W26 2026 Prototype']);
  assert.equal(h.label(), 'W2 2026', 'default selection is the latest VALID ISO week');
});

test('invalid weeks are preserved (never deleted) and keep their Firestore ids', () => {
  const h = harness();
  h.push([doc('W2-2026', 'W2 2026'), doc('weird-id', 'W26 2026 Prototype'), doc('W53-2025', 'W53 2025')]);
  assert.equal(h.context.allWeeks.length, 3);
  assert.deepEqual(h.context.allWeeks.map(w => w.__documentId).sort(), ['W2-2026', 'W53-2025', 'weird-id']);
  assert.equal(h.label(), 'W2 2026');
});

test('no valid week at all keeps the legacy default (the only available week) and never invents a date', () => {
  const h = harness();
  h.push([doc('a', 'Sprint A'), doc('b', 'Sprint B')]);
  assert.equal(h.context.currentIdx, 1);
  assert.equal(weekOrder.latestValidWeekIndex(h.context.allWeeks), -1);
});

test('CASE A: server-confirmed empty leaves official portfolio empty without synthetic prototype fallback', () => {
  const h = harness();
  h.push([], { fromCache: false, hasPendingWrites: false });
  assert.equal(h.context.allWeeks.length, 0);
  assert.equal(h.context.currentIdx, -1);
  assert.equal(h.context.deliveryTrendsHistoryState.source, 'uat');
  assert.equal(h.context.deliveryTrendsHistoryState.complete, true);
  assert.equal(h.hideLoaderCalls(), 1);
  assert.equal(h.renderCalls(), 1);
});

test('CASE B: initial cache-only empty does not claim authoritative No Data', () => {
  const h = harness();
  h.push([], { fromCache: true, hasPendingWrites: false });
  assert.equal(h.context.allWeeks.length, 0);
  assert.equal(h.context.currentIdx, -1);
  assert.equal(h.context.deliveryTrendsHistoryState.complete, false);
  assert.equal(h.hideLoaderCalls(), 0, 'loader is not hidden on cache-only empty');
  assert.equal(h.renderCalls(), 0, 'authoritative render is not called on cache-only empty');
});

test('CASE C: server-confirmed nonempty followed by cache-only empty preserves verified data', () => {
  const h = harness();
  h.push([doc('W1-2026', 'W1 2026')], { fromCache: false, hasPendingWrites: false });
  assert.equal(h.context.allWeeks.length, 1);
  assert.equal(h.context.deliveryTrendsHistoryState.complete, true);
  assert.equal(h.hideLoaderCalls(), 1);

  // Subsequent cache-only empty snapshot must not wipe verified weeks
  h.push([], { fromCache: true, hasPendingWrites: false });
  assert.equal(h.context.allWeeks.length, 1, 'verified weeks preserved');
  assert.equal(h.context.allWeeks[0].weekLabel, 'W1 2026');
  assert.equal(h.context.deliveryTrendsHistoryState.complete, false, 'marked incomplete while cache is unconfirmed');
});

test('CASE D: network failure or permission error preserves error handling', () => {
  const h = harness();
  h.error(new Error('Permission denied'));
  assert.equal(h.errorCalls(), 1);
  assert.equal(h.context.deliveryTrendsHistoryState.complete, false);
});

test('CASE E: session invalidation stops snapshot processing', () => {
  let isCurrent = true;
  const h = harness({ isAuthInitializationCurrent: () => isCurrent });
  h.push([doc('W1-2026', 'W1 2026')]);
  assert.equal(h.context.allWeeks.length, 1);

  isCurrent = false; // user logged out or switched
  h.push([doc('W2-2026', 'W2 2026')]);
  assert.equal(h.context.allWeeks.length, 1, 'outdated session ignores subsequent snapshot');
});

test('CASE F: server-confirmed transition to empty clears obsolete official weeks', () => {
  const h = harness();
  h.push([doc('W1-2026', 'W1 2026')], { fromCache: false, hasPendingWrites: false });
  assert.equal(h.context.allWeeks.length, 1);

  h.push([], { fromCache: false, hasPendingWrites: false });
  assert.equal(h.context.allWeeks.length, 0, 'authoritative zero-week snapshot clears official portfolio');
  assert.equal(h.context.currentIdx, -1);
  assert.equal(h.context.deliveryTrendsHistoryState.source, 'uat');
  assert.equal(h.context.deliveryTrendsHistoryState.complete, true);
});

test('manual selection survives a snapshot refresh even when an earlier week is added or the order changes', () => {
  const h = harness();
  h.push([doc('W52-2025', 'W52 2025'), doc('W1-2026', 'W1 2026'), doc('W2-2026', 'W2 2026'), doc('W3-2026', 'W3 2026')]);
  h.context.currentIdx = 1; // the user selects W1 2026
  h.context.jumpToLatestOnNextRender = false;
  h.push([doc('W51-2025', 'W51 2025'), doc('W52-2025', 'W52 2025'), doc('W1-2026', 'W1 2026'), doc('W2-2026', 'W2 2026'), doc('W3-2026', 'W3 2026')]);
  assert.equal(h.label(), 'W1 2026', 'selection stays on the same stored week id, not the same array index');
  assert.equal(h.context.allWeeks[h.context.currentIdx].__documentId, 'W1-2026');
});

test('a refresh that removes the selected week falls back to a valid in-range selection', () => {
  const h = harness();
  h.push([doc('W1-2026', 'W1 2026'), doc('W2-2026', 'W2 2026'), doc('W3-2026', 'W3 2026')]);
  h.context.currentIdx = 2; h.context.jumpToLatestOnNextRender = false;
  h.push([doc('W1-2026', 'W1 2026'), doc('W2-2026', 'W2 2026')]);
  assert.ok(h.context.currentIdx >= 0 && h.context.currentIdx < h.context.allWeeks.length);
});

test('creating a new week jumps to the latest valid week (jumpToLatestOnNextRender)', () => {
  const h = harness();
  h.push([doc('W1-2026', 'W1 2026'), doc('W2-2026', 'W2 2026')]);
  h.context.jumpToLatestOnNextRender = true;
  h.push([doc('W1-2026', 'W1 2026'), doc('W2-2026', 'W2 2026'), doc('W3-2026', 'W3 2026'), doc('junk', 'Notes')]);
  assert.equal(h.label(), 'W3 2026');
  assert.equal(h.context.jumpToLatestOnNextRender, false);
});

test('previous/next navigation walks valid weeks chronologically and keeps invalid weeks reachable at the end', () => {
  const h = harness();
  h.push([doc('W2-2026', 'W2 2026'), doc('junk', 'Notes'), doc('W52-2025', 'W52 2025'), doc('W1-2026', 'W1 2026')]);
  const nav = (idx, dir) => Math.max(0, Math.min(h.context.allWeeks.length - 1, idx + dir));
  const walk = []; let idx = 0;
  for (let i = 0; i < 4; i++) { walk.push(h.context.allWeeks[idx].weekLabel); idx = nav(idx, 1); }
  assert.deepEqual(walk, ['W52 2025', 'W1 2026', 'W2 2026', 'Notes']);
});

test('Production initData keeps the legacy selection logic unchanged', () => {
  const prodInit = source.match(/function initData__prod\([\s\S]*?\n\}/)[0];
  assert.match(prodInit, /currentIdx = allWeeks\.length - 1;/);
  assert.doesNotMatch(prodInit, /latestValidWeekIndex|sortWeeksChronologically/);
});
