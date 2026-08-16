import {
  activeProjects,
  geminiSummaryWithFormattingVariants,
  historicalProjects,
  invalidSummaryCases,
  validAskSummary,
  validNoAskSummary
} from './weekly-summary-contract-fixtures.mjs';
import {
  structuredExecutiveSummaryFixture,
  stressExecutiveSummaryFixture
} from '../pdf-service/test/report-fixtures.mjs';

const projectContext = projects => ({
  currentProjects: projects.map(name => ({ name })),
  historicalProjects: []
});

const movementProjects = [
  'Platform Modernization',
  'Module Refresh',
  'Power Controller',
  'Battery Gateway',
  'Rack Prototype',
  'Edge Platform'
];

const stressProjects = [
  'PMS',
  'Master Controller',
  'Zettabyte',
  'Phone Booth Rack',
  'Container',
  'Battery Gateway'
];

// Captured from a real Gemini response during local validation. Keep this
// fixture verbatim so the corpus exercises the same paste path as the user.
const observedGeminiDraftAndReleased = [
  'WEEKLY MOVEMENT',
  'Portfolio Summary: Portfolio count remained stable at one active project following the transition of a new draft into tracking.',
  '',
  '- Project: TEST / DO NOT DELETE · Draft project',
  'Movement: Added to the active portfolio this week in On Track status at 25% progress.',
  'Blocker: None',
  'Next step: Continue tracking progress under the Keep Watching attention level.',
  '- Project: TEST / DO NOT DELETE · Released project',
  'Movement: Transitioned out and removed from the active tracking portfolio.',
  'Blocker: None',
  'Next step: Archive project records according to standard release protocol.',
  '',
  'MANAGEMENT ASK',
  'No immediate management decision required this week.'
].join('\n');

export const weeklySummaryCorpus = [
  {
    id: 'canonical-no-ask',
    sourceType: 'synthetic',
    observed: false,
    source: validNoAskSummary,
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'accept'
  },
  {
    id: 'gemini-formatting-variants',
    sourceType: 'synthetic',
    observed: false,
    source: geminiSummaryWithFormattingVariants,
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'accept'
  },
  {
    id: 'canonical-management-ask',
    sourceType: 'synthetic',
    observed: false,
    source: validAskSummary,
    context: { currentProjects: activeProjects, historicalProjects: [] },
    expected: 'accept'
  },
  {
    id: 'structured-six-project',
    sourceType: 'synthetic',
    observed: false,
    source: structuredExecutiveSummaryFixture(),
    context: projectContext(movementProjects),
    expected: 'accept'
  },
  {
    id: 'stress-six-project-long-fields',
    sourceType: 'synthetic',
    observed: false,
    source: stressExecutiveSummaryFixture(),
    context: projectContext(stressProjects),
    expected: 'accept'
  },
  {
    id: 'missing-next-step',
    sourceType: 'synthetic',
    observed: false,
    source: invalidSummaryCases.find(([name]) => name === 'missing-next-step')[1],
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'reject',
    expectedError: 'expected "Next step:"'
  },
  {
    id: 'unknown-project',
    sourceType: 'synthetic',
    observed: false,
    source: invalidSummaryCases.find(([name]) => name === 'unknown-project')[1],
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'reject',
    expectedError: 'not an active project name'
  },
  {
    id: 'markdown-heading',
    sourceType: 'synthetic',
    observed: false,
    source: invalidSummaryCases.find(([name]) => name === 'markdown-heading')[1],
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'reject',
    expectedError: 'Markdown heading'
  },
  {
    id: 'unlabelled-prose',
    sourceType: 'synthetic',
    observed: false,
    source: invalidSummaryCases.find(([name]) => name === 'unlabelled-prose')[1],
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'reject',
    expectedError: 'expected "Blocker:"'
  },
  {
    id: 'too-many-management-asks',
    sourceType: 'synthetic',
    observed: false,
    source: invalidSummaryCases.find(([name]) => name === 'too-many-asks')[1],
    context: { currentProjects: activeProjects, historicalProjects: [] },
    expected: 'reject',
    expectedError: 'at most four'
  },
  {
    id: 'observed-gemini-draft-and-released',
    sourceType: 'gemini',
    observed: true,
    source: observedGeminiDraftAndReleased,
    context: {
      currentProjects: [{ name: 'TEST / DO NOT DELETE · Draft project' }],
      historicalProjects: [{ name: 'TEST / DO NOT DELETE · Released project' }]
    },
    expected: 'accept'
  }
];
