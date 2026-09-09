import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateQuarterlyKpi,
  normalizeQuarterlyMilestone,
  quarterlyWeightValue,
} from '../js/quarterly-kpi.mjs';

test('legacy quarterly milestone statuses normalize without inventing progress', () => {
  assert.deepEqual(
    normalizeQuarterlyMilestone({ quarter: '2026 Q3', status: 'planned' }),
    {
      quarter: '2026 Q3',
      goal: '',
      window: '',
      progress: 0,
      weight: 'medium',
      health: 'on-track',
      completedDate: '',
      status: 'planned',
    },
  );
  assert.equal(normalizeQuarterlyMilestone({ status: 'done' }).progress, 100);
  assert.equal(normalizeQuarterlyMilestone({ status: 'at-risk' }).health, 'at-risk');
  assert.equal(normalizeQuarterlyMilestone({ status: 'at-risk' }).progress, 0);
});

test('quarterly milestone values are constrained to approved completion and weight levels', () => {
  const normalized = normalizeQuarterlyMilestone({
    progress: 63,
    weight: 'unknown',
    health: 'unknown',
  });
  assert.equal(normalized.progress, 0);
  assert.equal(normalized.weight, 'medium');
  assert.equal(normalized.health, 'on-track');
  assert.equal(quarterlyWeightValue('low'), 1);
  assert.equal(quarterlyWeightValue('medium'), 2);
  assert.equal(quarterlyWeightValue('high'), 3);
});

test('quarter KPI uses weighted progress and reports risk, overdue, and on-time delivery', () => {
  const result = calculateQuarterlyKpi([
    {
      quarter: '2026 Q2',
      window: 'Apr',
      progress: 100,
      weight: 'high',
      health: 'on-track',
      completedDate: '2026-04-20',
    },
    {
      quarter: '2026 Q2',
      window: 'May',
      progress: 50,
      weight: 'low',
      health: 'at-risk',
    },
    {
      quarter: '2026 Q2',
      window: 'Jun',
      progress: 25,
      weight: 'medium',
      health: 'delayed',
    },
  ], '2026 Q2', '2026-07-05');

  assert.equal(result.progress, 67);
  assert.equal(result.completed, 1);
  assert.equal(result.total, 3);
  assert.equal(result.atRisk, 1);
  assert.equal(result.overdue, 2);
  assert.equal(result.onTimeRate, 33);
  assert.equal(result.health, 'red');
});

test('future milestones do not reduce on-time delivery', () => {
  const result = calculateQuarterlyKpi([
    { quarter: '2026 Q3', window: 'Jul', progress: 0 },
  ], '2026 Q3', '2026-06-30');

  assert.equal(result.overdue, 0);
  assert.equal(result.due, 0);
  assert.equal(result.onTimeRate, null);
  assert.equal(result.health, 'green');
});
