export const packedSummaryContext = {
  currentProjects: [
    { name: 'Scenario One / Alpha' },
    { name: 'Scenario One / Beta' }
  ],
  historicalProjects: [{ name: 'Scenario One / Released' }]
};

export const packedMovementNoAskSummary = [
  'WEEKLY MOVEMENT Portfolio Summary: Delivery remains stable.',
  '- Project: Scenario One / Alpha Movement: Validation completed. Blocker: None Next step: Confirm the release date.',
  '- Project: Scenario One / Released Movement: Archived after release. Blocker: None Next step: Retain the project record.',
  'MANAGEMENT ASK',
  'No immediate management decision required this week.'
].join('\n');

export const packedHeadingAndAskSummary = [
  'WEEKLY MOVEMENT Portfolio Summary: One decision needs support.',
  'Project: Scenario One / Beta Movement: Integration entered review. Blocker: Supplier timing remains open. Next step: Confirm recovery ownership.',
  'MANAGEMENT ASK - Project: Scenario One / Beta Decision / Support needed: Approve supplier escalation. Business impact: Protects the pilot date.'
].join('\n');

export const packedMissingFieldSummary = [
  'WEEKLY MOVEMENT Portfolio Summary: Delivery remains stable.',
  '- Project: Scenario One / Alpha Movement: Validation completed. Blocker: None.',
  'MANAGEMENT ASK',
  'No immediate management decision required this week.'
].join('\n');

export const packedDuplicateFieldSummary = [
  'WEEKLY MOVEMENT Portfolio Summary: Delivery remains stable.',
  '- Project: Scenario One / Alpha Movement: Validation completed. Blocker: None Blocker: Still none Next step: Confirm the release date.',
  'MANAGEMENT ASK',
  'No immediate management decision required this week.'
].join('\n');

export const packedReversedFieldSummary = [
  'WEEKLY MOVEMENT Portfolio Summary: Delivery remains stable.',
  '- Project: Scenario One / Alpha Movement: Validation completed. Next step: Confirm the release date. Blocker: None.',
  'MANAGEMENT ASK',
  'No immediate management decision required this week.'
].join('\n');

export const packedMixedFieldFamilySummary = [
  'WEEKLY MOVEMENT Portfolio Summary: One decision needs support.',
  'Project: Scenario One / Beta Movement: Integration entered review. Blocker: Supplier timing remains open. Next step: Confirm recovery ownership.',
  'MANAGEMENT ASK - Project: Scenario One / Beta Decision / Support needed: Approve supplier escalation. Next step: Confirm the owner. Business impact: Protects the pilot date.'
].join('\n');

export const packedUnknownProjectSummary = packedMovementNoAskSummary.replace(
  'Scenario One / Alpha',
  'Scenario One / Unknown'
);
