export const activeProjects = [
  { name: 'PMS' },
  { name: 'Master Controller' }
];

export const historicalProjects = [
  { name: 'Released project' }
];

export const geminiSummaryWithFormattingVariants = [
  'WEEKLY MOVEMENT',
  'Portfolio Summary: Delivery remained stable.',
  '',
  'Project: PMS',
  'Movement：Validation completed.',
  'Blocker: None',
  'Next step: Confirm the release date.',
  '',
  '• Project: Released project',
  '  Movement: Transitioned out of active tracking.',
  '  Blocker: None',
  '  Next step: Archive project records.',
  '',
  'MANAGEMENT ASK',
  'No immediate management decision required this week.'
].join('\n');

export const validNoAskSummary = [
  'WEEKLY MOVEMENT',
  'Portfolio Summary: Delivery remained stable.',
  '',
  '- Project: PMS',
  '  Movement: Validation completed.',
  '  Blocker: None',
  '  Next step: Confirm the release date.',
  '',
  'MANAGEMENT ASK',
  'No immediate management decision required this week.'
].join('\n');

export const validAskSummary = [
  'WEEKLY MOVEMENT',
  'Portfolio Summary: One decision requires leadership support.',
  '',
  '- Project: Master Controller',
  '  Movement: Layout review completed.',
  '  Blocker: Supplier timing remains open.',
  '  Next step: Confirm the recovery plan.',
  '',
  'MANAGEMENT ASK',
  '- Project: Master Controller',
  '  Decision / Support needed: Approve supplier escalation.',
  '  Business impact: Protects the prototype schedule.'
].join('\n');

export const invalidSummaryCases = [
  [
    'missing-next-step',
    validNoAskSummary.replace('  Next step: Confirm the release date.\n', ''),
    'expected "Next step:"'
  ],
  [
    'unknown-project',
    validNoAskSummary.replace('Project: PMS', 'Project: Invented project'),
    'is not an active project name'
  ],
  [
    'markdown-heading',
    validNoAskSummary.replace('WEEKLY MOVEMENT', '## WEEKLY MOVEMENT'),
    'Markdown heading'
  ],
  [
    'unlabelled-prose',
    validNoAskSummary.replace('  Blocker: None', '  Unexpected prose'),
    'expected "Blocker:"'
  ],
  [
    'missing-management-body',
    validNoAskSummary.replace('No immediate management decision required this week.', ''),
    'MANAGEMENT ASK'
  ],
  [
    'too-many-asks',
    `${validAskSummary}
- Project: PMS
  Decision / Support needed: A
  Business impact: B
- Project: PMS
  Decision / Support needed: C
  Business impact: D
- Project: PMS
  Decision / Support needed: E
  Business impact: F
- Project: PMS
  Decision / Support needed: G
  Business impact: H`,
    'at most four'
  ]
];
