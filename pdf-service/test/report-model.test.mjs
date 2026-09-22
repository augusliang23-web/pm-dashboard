import test from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetTotals,
  buildOverviewReportModel,
  buildProjectReportModel,
  disciplineRows,
  formatReportingPeriod,
  normalizeProjectForReport
} from '../src/report-model.js';
import { completeOverviewReportFixture } from './report-fixtures.mjs';

test('formats a reporting week and date range together', () => {
  assert.equal(
    formatReportingPeriod({ weekLabel: 'W28 2026', weekDate: 'Jul 6 - Jul 12' }),
    'W28 2026 · Jul 6–Jul 12, 2026'
  );
  assert.equal(formatReportingPeriod({ weekLabel: 'W28 2026' }), 'W28 2026');
  assert.equal(formatReportingPeriod({ weekDate: 'Jul 6 - Jul 12, 2026' }), 'Jul 6–Jul 12, 2026');
});

test('uses the formatted period in both report models', () => {
  const week = { weekLabel: 'W28 2026', weekDate: 'Jul 6 - Jul 12', projects: [] };

  assert.equal(buildProjectReportModel({ week, project: {}, sections: [] }).period, 'W28 2026 · Jul 6–Jul 12, 2026');
  assert.equal(buildOverviewReportModel({ week, sections: [] }).period, 'W28 2026 · Jul 6–Jul 12, 2026');
});

test('normalizes project values used by every selected project section', () => {
  const model = buildProjectReportModel({
    week: { weekLabel: 'W28 2026' },
    sections: ['gantt', 'resources', 'budget'],
    project: {
      code: 'PMS-001', status: 'RED', progress: 135,
      ganttWorkstreams: [{ name: 'Build', startDate: '2026-07-01', endDate: '2026-07-31', progress: 45 }],
      teamMembers: [{ name: 'A', roleName: 'Firmware', effortPct: 60 }],
      resources: { role_firmware: { role: 'Firmware', estimated: 100, actual: 40 } },
      budget: { currency: 'USD', totalEstimated: 1000, monthlyPlans: [{ amount: 600 }], actuals: [{ amount: 450 }] }
    }
  });

  assert.equal(model.status, 'red');
  assert.equal(model.progress, 100);
  assert.equal(model.period, 'W28 2026');
  assert.equal(model.workstreams[0].name, 'Build');
  assert.deepEqual(model.disciplines[0], { label: 'Firmware', estimated: 100, actual: 40, remaining: 60 });
  assert.equal(model.budget.usedPct, 45);
});

test('computes PDF summary lanes from workstreams, milestones and PM overrides', () => {
  const model = buildProjectReportModel({
    week: { weekLabel: 'W28 2026' },
    sections: ['gantt'],
    project: {
      code: 'PMS-001',
      milestones: [{ id: 'ms-1', name: 'Pilot Build' }],
      ganttWorkstreams: [
        { id: 'a', name: 'Firmware bring-up', startDate: '2026-07-01', endDate: '2026-07-10', progress: 40, milestoneId: 'ms-1' },
        { id: 'b', name: 'Enclosure tooling', startDate: '2026-07-05', endDate: '2026-07-20', progress: 60, milestoneId: 'ms-1' },
        { id: 'c', name: 'Field validation', startDate: '2026-08-01', endDate: '2026-08-15', progress: 0, status: 'at-risk' }
      ]
    }
  });

  assert.ok(Array.isArray(model.summaryLanes));
  const pilotLane = model.summaryLanes.find(lane => lane.label === 'Pilot Build');
  assert.ok(pilotLane);
  assert.deepEqual(pilotLane.workstreamIds.sort(), ['a', 'b']);
  const riskyLane = model.summaryLanes.find(lane => lane.workstreamIds.includes('c'));
  assert.equal(riskyLane.hasRisk, true);
  assert.equal(model.summaryLanesLowConfidence, false);
});

test('a manually assigned summaryGroupId and pdfSummaryLanes override survive normalization', () => {
  const model = buildProjectReportModel({
    week: { weekLabel: 'W28 2026' },
    sections: ['gantt'],
    project: {
      code: 'PMS-001',
      pdfSummaryLanes: [{ id: 'lane-custom', label: 'Custom Phase', progress: 90, sortOrder: 0 }],
      ganttWorkstreams: [
        { id: 'a', name: 'Firmware bring-up', startDate: '2026-07-01', endDate: '2026-07-10', progress: 40, summaryGroupId: 'lane-custom' }
      ]
    }
  });

  assert.equal(model.workstreams[0].summaryGroupId, 'lane-custom');
  assert.deepEqual(model.pdfSummaryLanes, [{ id: 'lane-custom', label: 'Custom Phase', progress: 90, sortOrder: 0 }]);
  const lane = model.summaryLanes.find(item => item.label === 'Custom Phase');
  assert.ok(lane);
  assert.equal(lane.progress, 90);
});

test('a pdfSummaryLanes entry with no manual progress falls back to the calculated average instead of 0%', () => {
  const model = buildProjectReportModel({
    week: { weekLabel: 'W28 2026' },
    sections: ['gantt'],
    project: {
      code: 'PMS-001',
      pdfSummaryLanes: [{ id: 'lane-custom', label: 'Custom Phase', progress: null, sortOrder: 0 }],
      ganttWorkstreams: [
        { id: 'a', name: 'Firmware bring-up', startDate: '2026-07-01', endDate: '2026-07-10', progress: 80, summaryGroupId: 'lane-custom' }
      ]
    }
  });

  assert.equal(model.pdfSummaryLanes[0].progress, null);
  const lane = model.summaryLanes.find(item => item.label === 'Custom Phase');
  assert.equal(lane.progress, 80, 'a null override must fall back to the weighted-average suggestion, not 0%');
});

test('does not window-filter Gantt data when no ganttWindowSettings is provided', () => {
  const model = buildProjectReportModel({
    week: { weekLabel: 'W28 2026', weekDate: 'Jul 6 - Jul 12' },
    sections: ['gantt'],
    project: {
      code: 'PMS-001',
      ganttWorkstreams: [
        { id: 'a', name: 'Far future work', startDate: '2028-01-01', endDate: '2028-01-10', progress: 0 }
      ]
    }
  });

  assert.equal(model.ganttWindowMonths, null);
  assert.equal(model.ganttWindowFilteredCount, 0);
  assert.equal(model.summaryLanes.length, 1);
});

test('bounds the schedule summary to the configured window and counts what it hid', () => {
  const model = buildProjectReportModel({
    week: { weekLabel: 'W28 2026', weekDate: 'Jul 6 - Jul 12' },
    sections: ['gantt'],
    ganttWindowSettings: { defaultMonths: 3, overrides: {} },
    project: {
      code: 'PMS-001',
      ganttWorkstreams: [
        { id: 'a', name: 'In window', startDate: '2026-07-15', endDate: '2026-08-01', progress: 40 },
        { id: 'b', name: 'Beyond window', startDate: '2027-01-01', endDate: '2027-01-10', progress: 0 },
        { id: 'c', name: 'Beyond window but at-risk', startDate: '2027-06-01', endDate: '2027-06-10', progress: 0, status: 'at-risk' }
      ]
    }
  });

  assert.equal(model.ganttWindowMonths, 3);
  assert.equal(model.ganttWindowFilteredCount, 1);
  const ids = model.summaryLanes.flatMap(lane => lane.workstreamIds);
  assert.deepEqual(ids.sort(), ['a', 'c']);
});

test('applies a project-code override ahead of the portfolio default window in both report models', () => {
  const week = { weekLabel: 'W28 2026', weekDate: 'Jul 6 - Jul 12' };
  const ganttWindowSettings = { defaultMonths: 1, overrides: { 'PMS-001': 12 } };
  const farWorkstream = { id: 'a', name: 'Far but overridden', startDate: '2027-01-01', endDate: '2027-01-10', progress: 0 };

  const projectModel = buildProjectReportModel({
    week, ganttWindowSettings, sections: ['gantt'],
    project: { code: 'PMS-001', ganttWorkstreams: [farWorkstream] }
  });
  assert.equal(projectModel.ganttWindowMonths, 12);
  assert.equal(projectModel.ganttWindowFilteredCount, 0);

  const overviewModel = buildOverviewReportModel({
    week: { ...week, projects: [{ code: 'PMS-001', ganttWorkstreams: [farWorkstream] }] },
    sections: ['project-portfolio'], ganttWindowSettings
  });
  assert.equal(overviewModel.projects[0].ganttWindowMonths, 12);
  assert.equal(overviewModel.projects[0].ganttWindowFilteredCount, 0);
});

test('resource and budget helpers preserve unknown actuals and zero-valued budgets', () => {
  const project = normalizeProjectForReport({
    teamMembers: [{ name: 'A', roleName: 'PMO', effortPct: 25 }],
    resources: { role_pmo: { role: 'PMO', estimated: 20, actual: '' } },
    budget: { currency: 'SGD', totalEstimated: 0, monthlyPlans: [], actuals: [] }
  });

  assert.deepEqual(disciplineRows(project), [{ label: 'PMO', estimated: 20, actual: null, remaining: null }]);
  assert.deepEqual(budgetTotals(project), {
    currency: 'SGD', total: 0, planned: 0, actual: 0, variance: 0, planGap: 0, usedPct: 0
  });
});

test('keeps normalized analytics arrays while preserving raw report text', () => {
  const project = normalizeProjectForReport({
    highlight: '• Parent\n  1. Child\n\n  · 3.1 detail',
    weeklyActions: '1. First\n  2. Second',
    riskActions: [{ risk: '• Risk\n  - detail\n', action: '  • Action\n\n  3.1 follow-up', primary: true }],
  });

  assert.deepEqual(project.highlights, ['Parent', 'Child', '· 3.1 detail']);
  assert.deepEqual(project.actions, ['First', 'Second']);
  assert.deepEqual(project.riskActions, [{ risk: 'Risk\ndetail', action: 'Action\n3.1 follow-up', primary: true }]);
  assert.deepEqual(project.rawHighlightLines, ['• Parent', '  1. Child', '', '  · 3.1 detail']);
  assert.deepEqual(project.rawActionLines, ['1. First', '  2. Second']);
  assert.deepEqual(project.rawRiskActionPairs, [{
    risk: '• Risk\n  - detail\n',
    action: '  • Action\n\n  3.1 follow-up',
    primary: true
  }]);
});

test('preserves CRLF and array text lines while normalized whitespace stays empty', () => {
  const project = normalizeProjectForReport({
    highlight: ['Alpha\r\nBeta', '• '],
    weeklyActions: '  \r\n\t'
  });

  assert.deepEqual(project.rawHighlightLines, ['Alpha', 'Beta', '• ']);
  assert.equal(project.rawHighlightText, 'Alpha\r\nBeta\n• ');
  assert.deepEqual(project.highlights, ['Alpha', 'Beta']);
  assert.deepEqual(project.rawActionLines, ['  ', '\t']);
  assert.deepEqual(project.actions, []);
});

test('keeps weekly actions out of risk action pairs without an explicit risk', () => {
  const project = normalizeProjectForReport({
    weeklyActions: 'Continue flowchart update',
    risk: '',
    riskActions: [{ risk: '', action: 'This is not a risk action' }]
  });

  assert.deepEqual(project.actions, ['Continue flowchart update']);
  assert.deepEqual(project.riskActions, []);
});

test('keeps weekly actions out of risk action pairs without an explicit risk', () => {
  const project = normalizeProjectForReport({
    weeklyActions: 'Continue flowchart update',
    risk: '',
    riskActions: [{ risk: '', action: 'This is not a risk action' }]
  });

  assert.deepEqual(project.actions, ['Continue flowchart update']);
  assert.deepEqual(project.riskActions, []);
});

test('builds scoped Overview metrics, risk rows, resources, budget and trend points', () => {
  const systemProject = {
    code: 'SYS-1', name: 'System One', projectLevel: 'system', status: 'red', progress: 40,
    owner: 'Owner', attention: 'action', risk: 'Supplier delay', next: 'Escalate supplier',
    teamMembers: [{ name: 'A', roleName: 'Firmware', effortPct: 120 }],
    quarterlyMilestones: [{ quarter: 'Q3', name: 'Pilot', progress: 50 }],
    budget: { currency: 'USD', totalEstimated: 1000, monthlyPlans: [{ amount: 600 }], actuals: [{ amount: 700, categoryName: 'NRE' }] }
  };
  const moduleProject = { code: 'MOD-1', projectLevel: 'hardware-module', status: 'green', progress: 90 };
  const model = buildOverviewReportModel({
    week: { weekLabel: 'W28 2026', executiveSummary: 'Management summary', projects: [systemProject, moduleProject] },
    trendWeeks: [
      { weekLabel: 'W27', projects: [{ ...systemProject, status: 'yellow', progress: 30 }] },
      { weekLabel: 'W28', projects: [systemProject] }
    ],
    sections: ['health-focus', 'weekly-trend'],
    overviewScope: 'system'
  });

  assert.equal(model.projects.length, 1);
  assert.deepEqual(model.health, { total: 1, green: 0, yellow: 0, red: 1, averageProgress: 40 });
  assert.equal(model.riskRows[0].action, 'Escalate supplier');
  assert.equal(model.resource.totalAllocatedFte, 1.2);
  assert.equal(model.resource.overallocatedPeople, 1);
  assert.equal(model.budget.actual, 700);
  assert.equal(model.quarterlyItems[0].quarter, 'Q3');
  assert.deepEqual(model.trend.map(point => point.label), ['W27', 'W28']);
});

test('filters Executive milestones for each authorized audience view', () => {
  const fixture = completeOverviewReportFixture();
  const labelsFor = executiveAudienceView => buildOverviewReportModel({
    ...fixture,
    executiveAudienceView
  }).executiveMilestones.rows.map(row => row.label);

  assert.deepEqual(labelsFor('leadership'), [
    'IoE Product Portfolio', 'Customer Engagements', 'Investors & Strategy'
  ]);
  assert.deepEqual(labelsFor('pm-engineering'), ['IoE Product Portfolio']);
  assert.deepEqual(labelsFor('business-product'), ['IoE Product Portfolio', 'Customer Engagements', 'Investors & Strategy']);
  assert.deepEqual(labelsFor('all-working-team'), ['IoE Product Portfolio']);
  assert.deepEqual(labelsFor('everyone'), ['IoE Product Portfolio']);
});

test('preserves legacy Executive milestone row labels and audience filtering', () => {
  const fixture = completeOverviewReportFixture();
  fixture.week.strategyLayer.executiveMilestoneTimeline = {
    title: 'Legacy Executive Timeline',
    quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
    phases: ['Plan', 'Build', 'Validate', 'Launch'],
    rows: [
      { label: 'Shared delivery', audience: 'all-working-team', cells: [['Shared Q1'], [], [], []] },
      { label: 'Engineering', audience: 'pm-engineering', cells: [[], ['Engineering Q2'], [], []] },
      { label: 'Commercial', audience: 'business-product', cells: [[], [], ['Commercial Q3'], []] },
      { label: 'Leadership', audience: 'leadership-only', cells: [[], [], [], ['Leadership Q4']] },
      { label: 'Public', audience: 'everyone', cells: [['Public Q1'], [], [], []] }
    ]
  };

  const model = buildOverviewReportModel({ ...fixture, executiveAudienceView: 'pm-engineering' });

  assert.deepEqual(model.executiveMilestones.rows.map(row => row.label), [
    'Shared delivery', 'Engineering', 'Public'
  ]);
  assert.equal(JSON.stringify(model.executiveMilestones).includes('IoE Product Portfolio'), false);
  assert.equal(JSON.stringify(model.executiveMilestones).includes('Commercial Q3'), false);
  assert.equal(JSON.stringify(model.executiveMilestones).includes('Leadership Q4'), false);
});

test('normalizes Executive milestone outcomes to display text only', () => {
  const fixture = completeOverviewReportFixture();
  const model = buildOverviewReportModel({ ...fixture, executiveAudienceView: 'leadership' });
  const engineering = model.executiveMilestones.rows.find(row => row.label === 'IoE Product Portfolio');

  assert.deepEqual(engineering.cells, [['Architecture Q1'], ['Engineering Q2'], [], []]);
  assert.equal(JSON.stringify(model.executiveMilestones).includes('Hidden evidence'), false);
});
