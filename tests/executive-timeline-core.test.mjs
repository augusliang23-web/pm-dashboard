import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getExecutiveTimelineCell,
  getExecutiveTimelineItemText,
  serializeExecutiveMilestoneTimeline
} from '../executive-timeline-core.js';

function containsDirectNestedArray(value) {
  if (Array.isArray(value)) {
    return value.some(Array.isArray) || value.some(containsDirectNestedArray);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsDirectNestedArray);
  }
  return false;
}

test('serializes executive timeline without Firestore nested arrays', () => {
  const timeline = {
    title: '2026 timeline',
    quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
    rows: [{
      label: 'Solution',
      cells: [['Alpha'], ['Beta', 'Gamma'], [], ['Delta']]
    }],
    phases: ['One', 'Two', 'Three', 'Four']
  };

  const stored = serializeExecutiveMilestoneTimeline(timeline);

  assert.deepEqual(stored.rows[0].cells, {
    q1: ['Alpha'],
    q2: ['Beta', 'Gamma'],
    q3: [],
    q4: ['Delta']
  });
  assert.equal(containsDirectNestedArray(stored), false);
});

test('reads both legacy array cells and Firestore-safe mapped cells', () => {
  assert.deepEqual(getExecutiveTimelineCell([['Alpha'], ['Beta']], 1), ['Beta']);
  assert.deepEqual(
    getExecutiveTimelineCell({ q1: ['Alpha'], q2: ['Beta'] }, 1),
    ['Beta']
  );
});

test('serialization does not mutate the editor timeline', () => {
  const timeline = {
    rows: [{ label: 'Solution', cells: [['Alpha'], [], [], []] }]
  };

  serializeExecutiveMilestoneTimeline(timeline);

  assert.deepEqual(timeline.rows[0].cells, [['Alpha'], [], [], []]);
});

test('preserves stable item identity and latest update fields during serialization', () => {
  const stored = serializeExecutiveMilestoneTimeline({
    rows: [{
      sectionId: 'ioe-product-portfolio',
      label: 'IoE Product Portfolio',
      cells: [[{
        id: 'exec-1',
        text: 'Launch',
        version: 4,
        rag: 'yellow',
        latestStatusText: 'Customer date moved',
        latestStatusAt: '2026-07-18T00:00:00.000Z',
        latestStatusBy: 'owner@example.com',
      }], [], [], []],
    }],
  });

  assert.equal(stored.rows[0].cells.q1[0].id, 'exec-1');
  assert.equal(stored.rows[0].cells.q1[0].version, 4);
  assert.equal(stored.rows[0].cells.q1[0].rag, 'yellow');
  assert.equal(stored.rows[0].cells.q1[0].latestStatusText, 'Customer date moved');
});

test('reads structured UAT outcomes as their management-facing text', () => {
  assert.equal(
    getExecutiveTimelineItemText({
      text: 'Container integration complete',
      manualProgress: 100,
      manualHealth: 'on-track'
    }),
    'Container integration complete'
  );
  assert.equal(getExecutiveTimelineItemText('Legacy milestone'), 'Legacy milestone');
});

test('production text edits preserve structured UAT outcome metadata', () => {
  const existing = {
    rows: [{
      label: 'Solution',
      cells: {
        q1: [{
          id: 'outcome-1',
          text: 'Container integration',
          manualProgress: 100,
          manualHealth: 'on-track',
          sources: { source1: { projectCode: 'SYS-1', milestoneId: 'ms-1' } }
        }],
        q2: [],
        q3: [],
        q4: []
      }
    }]
  };
  const edited = {
    rows: [{
      label: 'Solution',
      cells: [['Container integration complete'], [], [], []]
    }]
  };

  const stored = serializeExecutiveMilestoneTimeline(edited, existing);

  assert.deepEqual(stored.rows[0].cells.q1[0], {
    id: 'outcome-1',
    text: 'Container integration complete',
    version: 0,
    rag: 'green',
    latestStatusText: '',
    latestStatusAt: '',
    latestStatusBy: '',
    progressMode: 'manual',
    manualProgress: 100,
    manualHealth: 'on-track',
    status: 'on-track',
    statusReason: '',
    statusUpdatedAt: '',
    statusUpdatedBy: '',
    sources: { source1: { type: 'milestone', projectCode: 'SYS-1', milestoneId: 'ms-1' } }
  });
});
