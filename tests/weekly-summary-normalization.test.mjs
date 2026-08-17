import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWeeklySummaryForSave
} from '../js/weekly-summary-contract.mjs';
import {
  activeProjects,
  geminiSummaryWithFormattingVariants,
  historicalProjects,
  validNoAskSummary
} from './weekly-summary-contract-fixtures.mjs';
import {
  packedDuplicateFieldSummary,
  packedHeadingAndAskSummary,
  packedMixedFieldFamilySummary,
  packedMissingFieldSummary,
  packedMovementNoAskSummary,
  packedReversedFieldSummary,
  packedSummaryContext,
  packedUnknownProjectSummary
} from './weekly-summary-packed-fixtures.mjs';

test('normalizes missing project markers and label punctuation in one paste', () => {
  const result = normalizeWeeklySummaryForSave(
    geminiSummaryWithFormattingVariants,
    { currentProjects: [{ name: 'PMS' }], historicalProjects }
  );

  assert.equal(result.ok, true);
  assert.match(result.canonicalText, /- Project: PMS/);
  assert.match(result.canonicalText, /- Project: Released project/);
  assert.match(result.canonicalText, /  Movement: Validation completed\./);
  assert.ok(result.corrections.some(item => item.line === 4 && item.message.includes('Project:')));
  assert.ok(result.corrections.some(item => item.line === 5 && item.message.includes('Movement')));
  assert.equal(result.brief.projects[1].projectName, 'Released project');
});

test('normalizes star and bullet project markers', () => {
  const source = validNoAskSummary.replace(
    '\nMANAGEMENT ASK',
    '\n- Project: Master Controller\n  Movement: Review completed.\n  Blocker: None\n  Next step: Confirm the rollout.\n\nMANAGEMENT ASK'
  )
    .replace('- Project: PMS', '* Project: PMS')
    .replace('- Project: Master Controller', '• Project: Master Controller');
  const result = normalizeWeeklySummaryForSave(source, { currentProjects: activeProjects });

  assert.equal(result.ok, true);
  assert.match(result.canonicalText, /- Project: PMS/);
  assert.match(result.canonicalText, /- Project: Master Controller/);
  assert.equal(result.corrections.length, 2);
});

test('keeps canonical input unchanged and reports no corrections', () => {
  const result = normalizeWeeklySummaryForSave(validNoAskSummary, { currentProjects: activeProjects });

  assert.equal(result.ok, true);
  assert.equal(result.canonicalText, validNoAskSummary);
  assert.deepEqual(result.corrections, []);
});

test('rejects an unknown project after repairable formatting is normalized', () => {
  const source = validNoAskSummary.replace('- Project: PMS', 'Project: Invented project');
  const result = normalizeWeeklySummaryForSave(source, { currentProjects: activeProjects });

  assert.equal(result.ok, false);
  assert.equal(result.canonicalText, '');
  assert.ok(result.errors.some(error => error.message.includes('not found in the current or comparison-week project list')));
});

test('rejects a historical project in a management ask', () => {
  const source = [
    validNoAskSummary.replace('No immediate management decision required this week.', [
      '- Project: Released project',
      '  Decision / Support needed: Approve archive timing.',
      '  Business impact: Keeps records controlled.'
    ].join('\n'))
  ].join('\n');
  const result = normalizeWeeklySummaryForSave(source, {
    currentProjects: activeProjects.slice(0, 1),
    historicalProjects
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.message.includes('current active project')));
});

test('expands a packed movement summary and preserves its canonical meaning', () => {
  const result = normalizeWeeklySummaryForSave(packedMovementNoAskSummary, packedSummaryContext);

  assert.equal(result.ok, true);
  assert.match(result.canonicalText, /WEEKLY MOVEMENT\nPortfolio Summary: Delivery remains stable\./);
  assert.match(result.canonicalText, /- Project: Scenario One \/ Alpha\n  Movement: Validation completed\.\n  Blocker: None\n  Next step: Confirm the release date\./);
  assert.match(result.canonicalText, /- Project: Scenario One \/ Released\n  Movement: Archived after release\./);
  assert.ok(result.corrections.some(item => item.message.includes('expanded a packed movement entry')));
});

test('expands packed heading, movement, and management ask entries', () => {
  const result = normalizeWeeklySummaryForSave(packedHeadingAndAskSummary, packedSummaryContext);

  assert.equal(result.ok, true);
  assert.match(result.canonicalText, /MANAGEMENT ASK\n- Project: Scenario One \/ Beta\n  Decision \/ Support needed: Approve supplier escalation\./);
  assert.ok(result.corrections.some(item => item.message.includes('expanded a packed management ask entry')));
});

for (const [name, source, expected] of [
  ['missing packed field', packedMissingFieldSummary, null],
  ['duplicate packed field', packedDuplicateFieldSummary, null],
  ['reversed packed fields', packedReversedFieldSummary, null],
  ['mixed packed field families', packedMixedFieldFamilySummary, null],
  ['unknown packed project', packedUnknownProjectSummary, 'not an active project name']
]) {
  test(`keeps unsafe ${name} blocked`, () => {
    const result = normalizeWeeklySummaryForSave(source, packedSummaryContext);

    assert.equal(result.ok, false);
    assert.equal(result.canonicalText, '');
    if (expected) assert.ok(result.errors.some(error => error.message.includes(expected)));
    else assert.ok(result.errors.length > 0);
  });
}
