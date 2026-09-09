import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Overview renders Q1-Q4 weighted milestone KPI summaries', () => {
  assert.match(dashboard, /function renderQuarterKpiSummary\(/);
  assert.match(dashboard, /calculateQuarterlyKpi\(milestones, quarter, reportingDate\)/);
  for (const label of [
    'Weighted progress',
    'Completed',
    'At Risk',
    'Overdue',
    'On-time delivery',
  ]) {
    assert.match(dashboard, new RegExp(label));
  }
  assert.match(dashboard, /quarter-kpi-grid/);
  assert.match(dashboard, /quarters\.map\(quarter => renderQuarterKpiSummary/);
});

test('quarterly milestone detail exposes completion, weight, health, and contribution', () => {
  assert.match(dashboard, /quarterlyWeightValue\(i\.weight\)/);
  assert.match(dashboard, /Weight \$\{quarterlyWeightLabel\(i\.weight\)\}/);
  assert.match(dashboard, /Contribution \$\{i\.progress \* quarterlyWeightValue\(i\.weight\)\}/);
  assert.match(dashboard, /Actual completion/);
});
