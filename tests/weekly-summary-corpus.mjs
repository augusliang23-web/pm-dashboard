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

export const weeklySummaryCorpus = [
  {
    id: 'canonical-no-ask',
    source: validNoAskSummary,
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'accept'
  },
  {
    id: 'gemini-formatting-variants',
    source: geminiSummaryWithFormattingVariants,
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'accept'
  },
  {
    id: 'canonical-management-ask',
    source: validAskSummary,
    context: { currentProjects: activeProjects, historicalProjects: [] },
    expected: 'accept'
  },
  {
    id: 'structured-six-project',
    source: structuredExecutiveSummaryFixture(),
    context: projectContext(movementProjects),
    expected: 'accept'
  },
  {
    id: 'stress-six-project-long-fields',
    source: stressExecutiveSummaryFixture(),
    context: projectContext(stressProjects),
    expected: 'accept'
  },
  {
    id: 'missing-next-step',
    source: invalidSummaryCases.find(([name]) => name === 'missing-next-step')[1],
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'reject',
    expectedError: 'expected "Next step:"'
  },
  {
    id: 'unknown-project',
    source: invalidSummaryCases.find(([name]) => name === 'unknown-project')[1],
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'reject',
    expectedError: 'not an active project name'
  },
  {
    id: 'markdown-heading',
    source: invalidSummaryCases.find(([name]) => name === 'markdown-heading')[1],
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'reject',
    expectedError: 'Markdown heading'
  },
  {
    id: 'unlabelled-prose',
    source: invalidSummaryCases.find(([name]) => name === 'unlabelled-prose')[1],
    context: { currentProjects: activeProjects, historicalProjects },
    expected: 'reject',
    expectedError: 'expected "Blocker:"'
  },
  {
    id: 'too-many-management-asks',
    source: invalidSummaryCases.find(([name]) => name === 'too-many-asks')[1],
    context: { currentProjects: activeProjects, historicalProjects: [] },
    expected: 'reject',
    expectedError: 'at most four'
  }
];
