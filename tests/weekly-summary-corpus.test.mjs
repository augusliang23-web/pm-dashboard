import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWeeklySummaryForSave } from '../js/weekly-summary-contract.mjs';
import { validateWeeklySummaryForPdf } from '../pdf-service/src/weekly-summary-contract.js';
import {
  buildDeterministicPackedMutations,
  buildSyntheticWeekContexts,
  weeklySummaryCorpus
} from './weekly-summary-corpus.mjs';

test('weekly summary corpus is exactly 100 fictional cross-week cases', () => {
  assert.equal(weeklySummaryCorpus.length, 100);
  assert.equal(buildSyntheticWeekContexts().length, 20);
  const ids = weeklySummaryCorpus.map(testCase => testCase.id);
  assert.equal(new Set(ids).size, ids.length);
  const familyCounts = weeklySummaryCorpus.reduce((counts, testCase) => {
    counts[testCase.family] = (counts[testCase.family] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(familyCounts, {
    canonical: 20,
    'presentation-variant': 20,
    'packed-movement': 20,
    'packed-heading-and-ask': 20,
    'safety-negative': 20
  });
  assert.equal(weeklySummaryCorpus.filter(testCase => testCase.expected === 'accept').length, 80);
  assert.equal(weeklySummaryCorpus.filter(testCase => testCase.expected === 'reject').length, 20);
  for (const testCase of weeklySummaryCorpus) {
    assert.match(testCase.id, /^[a-z0-9-]+$/);
    assert.equal(testCase.sourceType, 'synthetic');
    assert.equal(testCase.observed, false);
    assert.ok(testCase.source.trim());
    assert.ok(testCase.context.currentProjects.length > 0);
    assert.ok(Array.isArray(testCase.context.historicalProjects));
    assert.ok(!/TEST \/ DO NOT DELETE|company copilot|gemini/i.test(testCase.source));
    if (testCase.expected === 'accept') {
      assert.ok(testCase.expectedCanonical);
      assert.equal(typeof testCase.minimumCorrections, 'number');
    } else {
      assert.ok(testCase.expectedError);
    }
  }
});

for (const testCase of weeklySummaryCorpus) {
  test(`corpus ${testCase.id} has the expected save and PDF outcome`, () => {
    const result = normalizeWeeklySummaryForSave(testCase.source, testCase.context);
    if (testCase.expected === 'reject') {
      assert.equal(result.ok, false);
      assert.equal(result.canonicalText, '');
      assert.ok(result.errors.some(error => error.message.includes(testCase.expectedError)));
      return;
    }

    assert.equal(result.ok, true);
    assert.equal(result.canonicalText, testCase.expectedCanonical);
    assert.ok(result.corrections.length >= testCase.minimumCorrections);
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

test('deterministic packed mutation gate contains 1000 valid variants', () => {
  const firstRun = buildDeterministicPackedMutations();
  const secondRun = buildDeterministicPackedMutations();
  assert.equal(firstRun.length, 1000);
  assert.deepEqual(firstRun, secondRun);
  for (const mutation of firstRun) {
    const result = normalizeWeeklySummaryForSave(mutation.source, mutation.context);
    assert.equal(result.ok, true, mutation.id);
    assert.equal(result.canonicalText, mutation.expectedCanonical, mutation.id);
    assert.ok(result.corrections.length >= 2, mutation.id);
    const repeated = normalizeWeeklySummaryForSave(result.canonicalText, mutation.context);
    assert.deepEqual(repeated.corrections, [], mutation.id);
  }
});
