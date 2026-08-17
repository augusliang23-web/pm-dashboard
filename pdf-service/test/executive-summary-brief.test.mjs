import test from 'node:test';
import assert from 'node:assert/strict';

let parseExecutiveSummaryBrief;
try {
  ({ parseExecutiveSummaryBrief } = await import('../src/executive-summary-brief.js'));
} catch {
  parseExecutiveSummaryBrief = undefined;
}

const { validateExecutiveSummaryForPdf } = await import('../src/executive-summary-brief.js');
const { validateWeeklySummaryForPdf } = await import('../src/weekly-summary-contract.js');
const {
  activeProjects,
  invalidSummaryCases,
  historicalProjects,
  validAskSummary,
  validNoAskSummary
} = await import('../../tests/weekly-summary-contract-fixtures.mjs');
const { normalizeWeeklySummaryForSave } = await import('../../js/weekly-summary-contract.mjs');
const {
  packedHeadingAndAskSummary,
  packedSummaryContext
} = await import('../../tests/weekly-summary-packed-fixtures.mjs');

const historicalMovementSummary = `WEEKLY MOVEMENT
Portfolio Summary: One project was released from active tracking.
- Project: Released project
  Movement: Transitioned out of active tracking.
  Blocker: None
  Next step: Archive project records.
MANAGEMENT ASK
No immediate management decision required this week.`;

test('accepts the same canonical summaries as the browser contract', () => {
  assert.equal(validateExecutiveSummaryForPdf(validNoAskSummary, activeProjects).ok, true);
  assert.equal(validateExecutiveSummaryForPdf(validAskSummary, activeProjects).ok, true);
});

test('accepts a canonical movement for a project removed since the comparison week', () => {
  assert.equal(validateExecutiveSummaryForPdf(historicalMovementSummary, historicalProjects).ok, true);
});

test('accepts browser-repaired packed Copilot text as canonical PDF input', () => {
  const repaired = normalizeWeeklySummaryForSave(packedHeadingAndAskSummary, packedSummaryContext);
  assert.equal(repaired.ok, true);
  const pdfResult = validateExecutiveSummaryForPdf(repaired.canonicalText);
  assert.equal(pdfResult.ok, true);
});

test('still rejects malformed canonical movement structure', () => {
  const invalid = historicalMovementSummary.replace('  Next step: Archive project records.\n', '');
  const result = validateExecutiveSummaryForPdf(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.message.includes('expected "Next step:"')));
});

for (const [name, source, expected] of invalidSummaryCases) {
  test(`rejects ${name} for PDF export`, () => {
    const result = validateWeeklySummaryForPdf(source, activeProjects);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.message.includes(expected)));
  });
}

test('parses structured movement and management ask fields', () => {
  assert.equal(typeof parseExecutiveSummaryBrief, 'function');
  const brief = parseExecutiveSummaryBrief(`WEEKLY MOVEMENT
Portfolio Summary: Delivery remains stable.
- Project: Alpha
  Movement: Validation completed.
  Blocker: Supplier date remains open.
  Next step: Confirm the recovery plan.
- Project: Beta
  Movement: Build started.
  Blocker: None
  Next step: Complete bring-up.
MANAGEMENT ASK
- Project: Beta
  Decision / Support needed: Approve lab priority.
  Business impact: Protects the launch date.`);

  assert.equal(brief.portfolioSummary, 'Delivery remains stable.');
  assert.deepEqual(brief.projects[0], {
    projectName: 'Alpha',
    movement: 'Validation completed.',
    blocker: 'Supplier date remains open.',
    nextStep: 'Confirm the recovery plan.'
  });
  assert.deepEqual(brief.managementAsks[0], {
    projectName: 'Beta',
    supportNeeded: 'Approve lab priority.',
    businessImpact: 'Protects the launch date.'
  });
  assert.deepEqual(brief.priorityProjects.map(item => item.projectName), ['Beta', 'Alpha']);
});

test('maps legacy project bullets without requiring historical rewrites', () => {
  const brief = parseExecutiveSummaryBrief(`## WEEKLY MOVEMENT
Portfolio Summary: Stable portfolio.
- Alpha: Progress increased and validation remains blocked.
## MANAGEMENT ASK
- Alpha: Confirm laboratory priority.`);

  assert.deepEqual(brief.projects[0], {
    projectName: 'Alpha',
    movement: 'Progress increased and validation remains blocked.',
    blocker: '',
    nextStep: ''
  });
  assert.deepEqual(brief.managementAsks[0], {
    projectName: 'Alpha',
    supportNeeded: 'Confirm laboratory priority.',
    businessImpact: ''
  });
});

test('maps unbulleted legacy summaries with an inline weekly movement heading', () => {
  const brief = parseExecutiveSummaryBrief(`WEEKLY MOVEMENT Portfolio Summary: Stable portfolio delivery.
PMS: Progress advanced through startup flowchart review.
Master Controller: Main-board review completed.
MANAGEMENT ASK
PMS: Support cross-functional resource alignment.
Master Controller: Confirm the long-lead procurement strategy.`);

  assert.equal(brief.portfolioSummary, 'Stable portfolio delivery.');
  assert.deepEqual(brief.projects, [
    {
      projectName: 'PMS',
      movement: 'Progress advanced through startup flowchart review.',
      blocker: '',
      nextStep: ''
    },
    {
      projectName: 'Master Controller',
      movement: 'Main-board review completed.',
      blocker: '',
      nextStep: ''
    }
  ]);
  assert.deepEqual(brief.managementAsks, [
    {
      projectName: 'PMS',
      supportNeeded: 'Support cross-functional resource alignment.',
      businessImpact: ''
    },
    {
      projectName: 'Master Controller',
      supportNeeded: 'Confirm the long-lead procurement strategy.',
      businessImpact: ''
    }
  ]);
  assert.equal(brief.fallbackText, '');
});

test('caps display content and reports additional details', () => {
  const movement = Array.from({ length: 7 }, (_, index) =>
    `- Project: P${index + 1}\n  Movement: M${index + 1}\n  Blocker: None\n  Next step: N${index + 1}`
  ).join('\n');
  const asks = Array.from({ length: 5 }, (_, index) =>
    `- Project: P${index + 1}\n  Decision / Support needed: D${index + 1}\n  Business impact: I${index + 1}`
  ).join('\n');
  const brief = parseExecutiveSummaryBrief(`WEEKLY MOVEMENT\n${movement}\nMANAGEMENT ASK\n${asks}`);

  assert.equal(brief.projects.length, 6);
  assert.equal(brief.priorityProjects.length, 2);
  assert.equal(brief.managementAsks.length, 4);
  assert.equal(brief.hasAdditionalContent, true);
});

test('keeps malformed narrative as a safe fallback', () => {
  const brief = parseExecutiveSummaryBrief('Portfolio execution remains stable without labelled fields.');

  assert.equal(brief.portfolioSummary, 'Portfolio execution remains stable without labelled fields.');
  assert.equal(brief.fallbackText, 'Portfolio execution remains stable without labelled fields.');
  assert.deepEqual(brief.projects, []);
  assert.deepEqual(brief.managementAsks, []);
});
