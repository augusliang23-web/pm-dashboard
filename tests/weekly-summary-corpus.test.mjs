import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWeeklySummaryForSave } from '../js/weekly-summary-contract.mjs';
import { validateWeeklySummaryForPdf } from '../pdf-service/src/weekly-summary-contract.js';
import { weeklySummaryCorpus } from './weekly-summary-corpus.mjs';

test('weekly summary corpus has unique, fully specified cases', () => {
  assert.ok(weeklySummaryCorpus.length >= 8);
  const ids = weeklySummaryCorpus.map(testCase => testCase.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const testCase of weeklySummaryCorpus) {
    assert.match(testCase.id, /^[a-z0-9-]+$/);
    assert.ok(testCase.source.trim());
    assert.ok(['accept', 'reject'].includes(testCase.expected));
    assert.ok(Array.isArray(testCase.context.currentProjects));
    if (testCase.expected === 'reject') assert.ok(testCase.expectedError);
  }
});

for (const testCase of weeklySummaryCorpus) {
  test(`corpus ${testCase.id} has the expected save outcome`, () => {
    const result = normalizeWeeklySummaryForSave(testCase.source, testCase.context);
    if (testCase.expected === 'reject') {
      assert.equal(result.ok, false);
      assert.ok(result.errors.some(error => error.message.includes(testCase.expectedError)));
      return;
    }

    assert.equal(result.ok, true);
    assert.ok(result.canonicalText);
    const pdfResult = validateWeeklySummaryForPdf(
      result.canonicalText,
      testCase.context.currentProjects,
      { requireProjectMembership: testCase.context.historicalProjects.length === 0 }
    );
    assert.equal(pdfResult.ok, true);

    const repeated = normalizeWeeklySummaryForSave(result.canonicalText, testCase.context);
    assert.equal(repeated.ok, true);
    assert.deepEqual(repeated.corrections, []);
  });
}
