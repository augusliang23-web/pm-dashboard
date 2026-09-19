import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryLanes } from '../src/workstream-summary.js';

function workstream(overrides = {}) {
  return {
    id: overrides.id || `ws-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Workstream', startDate: '2026-01-01', endDate: '2026-01-31',
    status: 'on-track', progress: 50, milestoneId: '', sortOrder: 0,
    ...overrides
  };
}

test('returns no lanes for an empty workstream list', () => {
  assert.deepEqual(buildSummaryLanes({ workstreams: [] }), { lanes: [], lowConfidence: false, ungroupedCount: 0 });
});

test('groups by linked milestone first when available', () => {
  const milestones = [{ id: 'ms-1', name: 'Pilot Build' }];
  const { lanes } = buildSummaryLanes({
    milestones,
    workstreams: [
      workstream({ id: 'a', name: 'Firmware bring-up', milestoneId: 'ms-1' }),
      workstream({ id: 'b', name: 'Enclosure tooling', milestoneId: 'ms-1' }),
      workstream({ id: 'c', name: 'Unrelated task', milestoneId: '' })
    ]
  });

  const pilotLane = lanes.find(lane => lane.label === 'Pilot Build');
  assert.ok(pilotLane, 'expected a lane named after the linked milestone');
  assert.deepEqual(pilotLane.workstreamIds.sort(), ['a', 'b']);
});

test('falls back to a keyword stem when there is no milestone link', () => {
  const { lanes } = buildSummaryLanes({
    workstreams: [
      workstream({ id: 'a', name: 'Design - Mechanical' }),
      workstream({ id: 'b', name: 'Design - Electrical' }),
      workstream({ id: 'c', name: 'Integration' })
    ]
  });

  const designLane = lanes.find(lane => lane.label === 'Design');
  assert.ok(designLane, 'expected workstreams with a shared name stem to be grouped together');
  assert.deepEqual(designLane.workstreamIds.sort(), ['a', 'b']);
  assert.equal(lanes.find(lane => lane.label === 'Integration')?.workstreamIds.length, 1);
});

test('a PM-assigned summaryGroupId overrides milestone and keyword grouping', () => {
  const milestones = [{ id: 'ms-1', name: 'Pilot Build' }];
  const pdfSummaryLanes = [{ id: 'lane-custom', label: 'Custom Phase', progress: 70, sortOrder: 0 }];
  const { lanes } = buildSummaryLanes({
    milestones,
    pdfSummaryLanes,
    workstreams: [
      workstream({ id: 'a', name: 'Firmware bring-up', milestoneId: 'ms-1', summaryGroupId: 'lane-custom' }),
      workstream({ id: 'b', name: 'Firmware bring-up 2', milestoneId: 'ms-1' })
    ]
  });

  const customLane = lanes.find(lane => lane.label === 'Custom Phase');
  assert.ok(customLane, 'expected the PM-named custom lane to exist');
  assert.deepEqual(customLane.workstreamIds, ['a']);
  assert.equal(customLane.progress, 70);
  assert.notEqual(lanes.find(lane => lane.label === 'Pilot Build')?.workstreamIds.includes('a'), true);
});

test('merges the most time-adjacent lanes down to 8 when there are more than 8 groups', () => {
  const workstreams = Array.from({ length: 10 }, (_, index) => workstream({
    id: `ws-${index}`,
    name: `Unique Phase ${String.fromCharCode(65 + index)}`,
    startDate: `2026-0${(index % 9) + 1}-01`,
    endDate: `2026-0${(index % 9) + 1}-20`
  }));
  const { lanes } = buildSummaryLanes({ workstreams });

  assert.ok(lanes.length <= 8, `expected at most 8 lanes, got ${lanes.length}`);
  const totalWorkstreams = lanes.reduce((sum, lane) => sum + lane.workstreamCount, 0);
  assert.equal(totalWorkstreams, 10, 'no workstream should be dropped during merging');
});

test('never merges away a lane that contains an at-risk or delayed workstream', () => {
  const workstreams = [
    ...Array.from({ length: 9 }, (_, index) => workstream({
      id: `safe-${index}`,
      name: `Safe Phase ${String.fromCharCode(65 + index)}`,
      startDate: '2026-01-01', endDate: '2026-01-10'
    })),
    workstream({ id: 'risky', name: 'Vendor Integration', status: 'at-risk', startDate: '2026-01-05', endDate: '2026-01-08' })
  ];
  const { lanes } = buildSummaryLanes({ workstreams });

  const riskyLane = lanes.find(lane => lane.workstreamIds.includes('risky'));
  assert.ok(riskyLane, 'the at-risk workstream must still be present in a lane');
  assert.equal(riskyLane.workstreamCount, 1, 'the at-risk lane must not have absorbed or been absorbed by another lane');
  assert.equal(riskyLane.hasRisk, true);
});

test('flags low confidence when most workstreams have no milestone or shared name stem', () => {
  const workstreams = Array.from({ length: 6 }, (_, index) => workstream({
    id: `ws-${index}`,
    name: `Totally Unrelated Task ${index}`
  }));
  const { lowConfidence, ungroupedCount } = buildSummaryLanes({ workstreams });

  assert.equal(lowConfidence, true);
  assert.equal(ungroupedCount, 6);
});

test('does not flag low confidence when most workstreams are grouped by milestone', () => {
  const milestones = [{ id: 'ms-1', name: 'Pilot Build' }];
  const workstreams = [
    workstream({ id: 'a', name: 'Firmware', milestoneId: 'ms-1' }),
    workstream({ id: 'b', name: 'Hardware', milestoneId: 'ms-1' }),
    workstream({ id: 'c', name: 'Software', milestoneId: 'ms-1' })
  ];
  const { lowConfidence } = buildSummaryLanes({ milestones, workstreams });

  assert.equal(lowConfidence, false);
});

test('defaults lane progress to a duration-weighted average when no manual override exists', () => {
  const { lanes } = buildSummaryLanes({
    workstreams: [
      workstream({ id: 'a', name: 'Integration - Alpha', startDate: '2026-01-01', endDate: '2026-01-10', progress: 100 }),
      workstream({ id: 'b', name: 'Integration - Beta', startDate: '2026-01-11', endDate: '2026-02-19', progress: 0 })
    ]
  });

  const lane = lanes.find(item => item.label === 'Integration');
  assert.ok(lane);
  assert.ok(lane.progress < 50, 'the longer, 0%-complete workstream should pull the weighted average down');
  assert.equal(lane.suggestedProgress, lane.progress);
});

test('lanes are sorted by their earliest start date', () => {
  const { lanes } = buildSummaryLanes({
    workstreams: [
      workstream({ id: 'a', name: 'Late Phase', startDate: '2026-06-01', endDate: '2026-06-10' }),
      workstream({ id: 'b', name: 'Early Phase', startDate: '2026-01-01', endDate: '2026-01-10' })
    ]
  });

  assert.deepEqual(lanes.map(lane => lane.label), ['Early Phase', 'Late Phase']);
});
