import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeeklySummaryForSave, validateWeeklySummaryForSave } from '../js/weekly-summary-contract.mjs';
import {
  activeProjects,
  invalidSummaryCases,
  validAskSummary,
  validNoAskSummary
} from './weekly-summary-contract-fixtures.mjs';
import { packedHeadingAndAskSummary, packedMovementNoAskSummary, packedSummaryContext } from './weekly-summary-packed-fixtures.mjs';

test('accepts canonical no-ask source without changing it', () => {
  const result = validateWeeklySummaryForSave(validNoAskSummary, activeProjects);
  assert.equal(result.ok, true);
  assert.equal(result.canonicalText, validNoAskSummary);
  assert.equal(result.brief.projects[0].projectName, 'PMS');
  assert.deepEqual(result.brief.managementAsks, []);
});

test('accepts canonical management asks', () => {
  const result = validateWeeklySummaryForSave(validAskSummary, activeProjects);
  assert.equal(result.ok, true);
  assert.deepEqual(result.brief.managementAsks[0], {
    projectName: 'Master Controller',
    supportNeeded: 'Approve supplier escalation.',
    businessImpact: 'Protects the prototype schedule.'
  });
});

test('contract accepts complete packed movement input after normalization', () => {
  const result = normalizeWeeklySummaryForSave(packedMovementNoAskSummary, packedSummaryContext);

  assert.equal(result.ok, true);
  assert.match(result.canonicalText, /- Project: Scenario One \/ Alpha/);
});

test('contract accepts complete packed heading and management ask input after normalization', () => {
  const result = normalizeWeeklySummaryForSave(packedHeadingAndAskSummary, packedSummaryContext);

  assert.equal(result.ok, true);
  assert.equal(result.brief.managementAsks[0].projectName, 'Scenario One / Beta');
});

for (const [name, source, expected] of invalidSummaryCases) {
  test(`rejects ${name}`, () => {
    const result = validateWeeklySummaryForSave(source, activeProjects);
    assert.equal(result.ok, false);
    assert.equal(result.canonicalText, '');
    assert.ok(result.errors.some(error => error.message.includes(expected)));
  });
}
