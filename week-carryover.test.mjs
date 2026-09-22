import assert from 'node:assert/strict';
import { copyPreviousWeekCarryover } from './week-carryover.mjs';

const previousWeek = {
  projects: [
    { code: 'ACTIVE', visibility: 'active', milestones: [{ name: 'Keep me' }] },
    { code: 'ARCHIVED', visibility: 'archived' }
  ],
  strategyLayer: {
    activeTrack: 'power',
    tracks: [{ id: 'power', label: 'Power Systems' }],
    quarterGoals: { 'Q3 2026': ['Ship prototype'] },
    executiveMilestoneTimeline: {
      title: 'Selected 2026 DCDC Milestone Timeline',
      quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
      rows: [
        {
          sectionId: 'ioe-product-portfolio',
          label: 'IoE Product Portfolio',
          cells: {
            q1: [{ id: 'exec-1', text: 'Architecture freeze', version: 3, rag: 'yellow', latestStatusText: 'EVT date confirmed', latestStatusAt: '2026-07-01T00:00:00.000Z', latestStatusBy: 'pm@example.com' }],
            q2: ['EVT complete', 'Customer demo'],
            q3: [],
            q4: ['Launch']
          }
        }
      ],
      phases: ['Planning', 'EVT', 'DVT', 'Launch']
    },
    projectMap: { ACTIVE: { track: 'power' } }
  }
};

const copied = copyPreviousWeekCarryover(previousWeek);

assert.deepEqual(copied.strategyLayer, previousWeek.strategyLayer);
assert.notEqual(copied.strategyLayer, previousWeek.strategyLayer);
assert.notEqual(
  copied.strategyLayer.executiveMilestoneTimeline.rows,
  previousWeek.strategyLayer.executiveMilestoneTimeline.rows
);
assert.deepEqual(copied.strategyLayer.executiveMilestoneTimeline.rows[0].cells.q1[0], previousWeek.strategyLayer.executiveMilestoneTimeline.rows[0].cells.q1[0]);
assert.notEqual(copied.strategyLayer.executiveMilestoneTimeline.rows[0].cells.q1[0], previousWeek.strategyLayer.executiveMilestoneTimeline.rows[0].cells.q1[0]);
assert.deepEqual(copied.projects, [previousWeek.projects[0]]);

copied.strategyLayer.executiveMilestoneTimeline.rows[0].cells.q2.push('Changed later');
assert.equal(previousWeek.strategyLayer.executiveMilestoneTimeline.rows[0].cells.q2.length, 2);

console.log('week carryover tests passed');
