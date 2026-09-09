import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateExecutiveCategory,
  executiveOutcomeStatusLabel,
  normalizeExecutiveCategoryOverride,
} from '../js/executive-outcomes.mjs';

test('category averages valid outcomes and uses worst health', () => {
  const result = calculateExecutiveCategory([
    { progress: 100, health: 'green' },
    { progress: 50, health: 'yellow' },
  ]);

  assert.equal(result.progress, 75);
  assert.equal(result.health, 'yellow');
  assert.equal(result.status, 'at-risk');
  assert.equal(result.overridden, false);
});

test('category ignores missing progress instead of treating it as zero', () => {
  const result = calculateExecutiveCategory([
    { progress: null, health: 'unknown' },
    { progress: 50, health: 'green' },
  ]);

  assert.equal(result.progress, 50);
  assert.equal(result.health, 'green');
});

test('100 percent displays Achieved / Done', () => {
  assert.equal(executiveOutcomeStatusLabel(100, 'green'), 'Achieved / Done');
  assert.equal(executiveOutcomeStatusLabel(100, 'yellow'), 'Achieved / Done');
});

test('category override requires a reason and can be removed', () => {
  assert.deepEqual(normalizeExecutiveCategoryOverride({
    enabled: true,
    progress: 75,
    health: 'at-risk',
    reason: 'Board commitment',
  }), {
    enabled: true,
    progress: 75,
    health: 'at-risk',
    reason: 'Board commitment',
  });

  assert.equal(normalizeExecutiveCategoryOverride({
    enabled: true,
    progress: 75,
    health: 'at-risk',
    reason: ' ',
  }).enabled, false);
  assert.equal(normalizeExecutiveCategoryOverride({ enabled: false }).enabled, false);
});

test('manual category override replaces calculated progress and health', () => {
  const result = calculateExecutiveCategory(
    [{ progress: 100, health: 'green' }],
    { enabled: true, progress: 50, health: 'delayed', reason: 'External dependency' },
  );

  assert.equal(result.progress, 50);
  assert.equal(result.health, 'red');
  assert.equal(result.status, 'delayed');
  assert.equal(result.overridden, true);
  assert.equal(result.reason, 'External dependency');
});
