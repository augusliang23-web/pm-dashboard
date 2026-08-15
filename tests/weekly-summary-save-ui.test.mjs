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
    assert.match(source, /import \{ validateWeeklySummaryForSave \} from "\.\/js\/weekly-summary-contract\.mjs"/);
  });

  test(`dashboard ${index + 1} validates before writing Weekly Summary`, () => {
    const start = source.indexOf('window.saveWeekSummary = async () => {');
    const end = source.indexOf('window.createNewWeekFromManage = async () => {', start);
    assert.ok(start >= 0 && end > start, 'saveWeekSummary boundary must exist');
    const saveSource = source.slice(start, end);
    assert.match(saveSource, /const result = validateWeeklySummaryForSave\(field\.value, activeProjectsForWeek\(week\)\)/);
    assert.match(saveSource, /if \(!result\.ok\) \{\s+setWeeklySummaryValidation\(result\);\s+return;/);
    assert.ok(saveSource.indexOf('validateWeeklySummaryForSave') < saveSource.indexOf('await setDoc'));
    assert.doesNotMatch(saveSource, /cleanWeeklySummaryTextarea/);
  });
}
