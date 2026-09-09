import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Overview exposes one Portfolio Roadmap with two view tabs', () => {
  assert.match(dashboard, /Portfolio Roadmap/);
  assert.match(dashboard, /Executive Outcomes/);
  assert.match(dashboard, /Project Milestones/);
  assert.match(dashboard, /window\.setPortfolioRoadmapView/);
  assert.doesNotMatch(dashboard, /Quarterly milestones across projects/);
  assert.doesNotMatch(dashboard, /Portfolio-wide executive timeline/);
});

test('executive roadmap has one edit action and project roadmap points to project cards', () => {
  const start = dashboard.indexOf('function renderQuarterlyBoard');
  const end = dashboard.indexOf('function renderAttentionMatrix', start);
  const source = dashboard.slice(start, end);
  assert.equal((source.match(/openExecutiveTimelineEditor\(\)/g) || []).length, 1);
  assert.match(source, /Edit Quarterly Milestones/);
  assert.doesNotMatch(source, /Edit Executive Roadmap/);
  assert.match(source, /Edit milestones from the project card/);
  assert.doesNotMatch(source, /Manage Strategy/);
});
