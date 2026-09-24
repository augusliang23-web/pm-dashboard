import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await dashboardSourceAsync('uat');

test('root dashboard reports each normalized line without HTML interpolation', () => {
  const start = source.indexOf('function showWeeklySummaryCorrections');
  const end = source.indexOf('window.saveWeekSummary = async () => {', start);
  assert.ok(start >= 0 && end > start, 'correction helper must precede save flow');
  const helper = source.slice(start, end);
  assert.match(helper, /weeklySummaryCorrectionDetails/);
  assert.match(helper, /createElement\(['"]div['"]\)/);
  assert.match(helper, /textContent/);
  assert.match(helper, /detail\.textContent = item\.message \|\|/);
  assert.doesNotMatch(helper, /innerHTML/);
  assert.match(helper, /openAccessibleModal/);
});
