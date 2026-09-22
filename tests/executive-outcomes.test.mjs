import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateExecutiveOutcome,
  executiveSourceKey,
  normalizeExecutiveOutcome,
} from '../js/executive-outcomes.mjs';

test('legacy executive text becomes a manual outcome without rewriting history', () => {
  assert.deepEqual(normalizeExecutiveOutcome('Launch lighthouse site'), {
    id: '',
    text: 'Launch lighthouse site',
    version: 0,
    rag: 'green',
    latestStatusText: '',
    latestStatusAt: '',
    latestStatusBy: '',
    progressMode: 'manual',
    manualProgress: 0,
    manualHealth: 'on-track',
    statusReason: '',
    statusUpdatedAt: '',
    statusUpdatedBy: '',
    sources: [],
  });
});

test('normalizes governance fields without losing compatibility metadata', () => {
  assert.deepEqual(normalizeExecutiveOutcome({
    id: 'exec-1',
    text: 'Launch',
    version: 4,
    rag: 'yellow',
    latestStatusText: 'Customer date moved',
    latestStatusAt: '2026-07-18T00:00:00.000Z',
    latestStatusBy: 'owner@example.com',
  }), {
    id: 'exec-1',
    text: 'Launch',
    version: 4,
    rag: 'yellow',
    latestStatusText: 'Customer date moved',
    latestStatusAt: '2026-07-18T00:00:00.000Z',
    latestStatusBy: 'owner@example.com',
    progressMode: 'manual',
    manualProgress: 0,
    manualHealth: 'at-risk',
    statusReason: '',
    statusUpdatedAt: '',
    statusUpdatedBy: '',
    sources: [],
  });
});

test('source references normalize from Firestore-safe keyed objects', () => {
  const normalized = normalizeExecutiveOutcome({
    text: 'Commercial readiness',
    progressMode: 'auto',
    sources: {
      source1: { projectCode: 'SYS-1', type: 'milestone', milestoneId: 'ms-1' },
      source2: { projectCode: 'MOD-1', type: 'quarterly', milestoneId: 'qms-1' },
    },
  });
  assert.equal(normalized.sources.length, 2);
  assert.equal(executiveSourceKey(normalized.sources[1]), 'quarterly|MOD-1|qms-1');
});

test('manual outcomes use approved progress and health values', () => {
  const result = calculateExecutiveOutcome({
    progressMode: 'manual',
    manualProgress: 75,
    manualHealth: 'at-risk',
  }, {});

  assert.equal(result.progress, 75);
  assert.equal(result.health, 'yellow');
  assert.equal(result.mode, 'manual');
});

test('auto outcomes average valid evidence and use the worst source health', () => {
  const refs = [
    { projectCode: 'SYS-1', type: 'milestone', milestoneId: 'ms-1' },
    { projectCode: 'MOD-1', type: 'quarterly', milestoneId: 'qms-1' },
  ];
  const lookup = Object.fromEntries([
    [executiveSourceKey(refs[0]), { progress: 50, health: 'green', label: 'System milestone' }],
    [executiveSourceKey(refs[1]), { progress: 75, health: 'yellow', label: 'Module target' }],
  ]);
  const result = calculateExecutiveOutcome({ progressMode: 'auto', sources: refs }, lookup);

  assert.equal(result.progress, 63);
  assert.equal(result.health, 'yellow');
  assert.equal(result.validSources.length, 2);
  assert.deepEqual(result.missingSources, []);
});

test('missing evidence is flagged and never silently treated as zero', () => {
  const missing = { projectCode: 'SYS-1', type: 'milestone', milestoneId: 'missing' };
  const result = calculateExecutiveOutcome({
    progressMode: 'auto',
    sources: [missing],
  }, {});

  assert.equal(result.progress, null);
  assert.equal(result.health, 'unknown');
  assert.equal(result.validSources.length, 0);
  assert.deepEqual(result.missingSources, [missing]);
});

test('overdue evidence makes an automatic outcome red', () => {
  const ref = { projectCode: 'SYS-1', type: 'quarterly', milestoneId: 'qms-1' };
  const result = calculateExecutiveOutcome(
    { progressMode: 'auto', sources: [ref] },
    { [executiveSourceKey(ref)]: { progress: 75, health: 'green', overdue: true } },
  );
  assert.equal(result.health, 'red');
});
