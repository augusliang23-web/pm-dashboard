import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sources = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../team-2/index.html', import.meta.url), 'utf8')
]);

for (const [index, source] of sources.entries()) {
  test(`dashboard ${index + 1} exposes the Weekly Summary validation panel`, () => {
    assert.match(source, /id="weeklySummaryValidation"[^>]*role="alert"[^>]*aria-live="assertive"/);
    assert.match(source, /import \{ normalizeWeeklySummaryForSave \} from "\.\/js\/weekly-summary-contract\.mjs"/);
  });

  test(`dashboard ${index + 1} validates before writing Weekly Summary`, () => {
    const start = source.indexOf('window.saveWeekSummary = async () => {');
    const end = source.indexOf('window.createNewWeekFromManage = async () => {', start);
    assert.ok(start >= 0 && end > start, 'saveWeekSummary boundary must exist');
    const saveSource = source.slice(start, end);
    assert.match(saveSource, /const result = normalizeWeeklySummaryForSave\(field\.value, summaryProjectContext\(week\)\)/);
    assert.match(saveSource, /if \(!result\.ok\) \{\s+setWeeklySummaryValidation\(result\);\s+return;/);
    const writeIndexes = [
      saveSource.indexOf('await setDoc'),
      saveSource.indexOf('saveWeekFields')
    ].filter(index => index >= 0);
    assert.ok(writeIndexes.length, 'saveWeekSummary must call the dashboard write path');
    assert.ok(saveSource.indexOf('normalizeWeeklySummaryForSave') < Math.min(...writeIndexes));
    assert.doesNotMatch(saveSource, /cleanWeeklySummaryTextarea/);
});

test('successful saves expose automatic corrections in a separate accessible dialog', () => {
  for (const source of sources) {
    assert.match(source, /id="weeklySummaryCorrectionOverlay"[^>]*role="dialog"/);
    assert.match(source, /id="weeklySummaryCorrectionDetails"/);
    assert.match(source, /showWeeklySummaryCorrections\(result\.corrections\)/);
    assert.match(source, /showWeeklySummaryCorrections[\s\S]*detail\.textContent = item\.message \|\|/);
  }
});
}
