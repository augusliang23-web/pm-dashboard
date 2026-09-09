const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeLiveTimelineState,
  nextLiveTimelineState,
  snapshotFromLiveTimeline,
} = require('../executive-live-timeline');

test('builds a versioned live state and independent release snapshot', () => {
  const state = normalizeLiveTimelineState({
    timeline: { rows: [{ sectionId: 'customer-engagements', cells: { q1: [] } }] },
    version: 4,
  });
  const next = nextLiveTimelineState(state, {
    rows: [{ sectionId: 'customer-engagements', cells: { q1: [{ id: 'item-1' }] } }],
  }, 'bd@example.com', '2026-07-23T00:00:00.000Z');
  const snapshot = snapshotFromLiveTimeline(next, 'pm@example.com', '2026-07-24T00:00:00.000Z');

  assert.equal(next.version, 5);
  assert.equal(snapshot.timelineVersion, 5);
  next.timeline.rows[0].cells.q1[0].id = 'later-change';
  assert.equal(snapshot.timeline.rows[0].cells.q1[0].id, 'item-1');
});
