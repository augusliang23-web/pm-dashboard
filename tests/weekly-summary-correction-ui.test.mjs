import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sources = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../team-2/index.html', import.meta.url), 'utf8')
]);

for (const [index, source] of sources.entries()) {
  test(`dashboard ${index + 1} reports each normalized line without HTML interpolation`, () => {
    const start = source.indexOf('function showWeeklySummaryCorrections');
    const end = source.indexOf('window.saveWeekSummary = async () => {', start);
    assert.ok(start >= 0 && end > start, 'correction helper must precede save flow');
    const helper = source.slice(start, end);
    assert.match(helper, /weeklySummaryCorrectionDetails/);
    assert.match(helper, /createElement\(['"]div['"]\)/);
    assert.match(helper, /textContent/);
    assert.doesNotMatch(helper, /innerHTML/);
    assert.match(helper, /openAccessibleModal/);
  });
}
