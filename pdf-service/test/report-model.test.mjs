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

test('removes stored list markers before building PDF list items', () => {
  const project = normalizeProjectForReport({
    highlight: '• Parent\n  1. Child',
    weeklyActions: '1. First\n2. Second',
    riskActions: [{ risk: '• Risk', action: '  • Action', primary: true }],
  });

  assert.deepEqual(project.highlights, ['Parent', 'Child']);
  assert.deepEqual(project.actions, ['First', 'Second']);
  assert.deepEqual(project.riskActions, [{ risk: 'Risk', action: 'Action', primary: true }]);
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
    'Shared delivery', 'Engineering', 'Commercial', 'Leadership', 'Public'
  ]);
  assert.deepEqual(labelsFor('pm-engineering'), ['Shared delivery', 'Engineering', 'Public']);
  assert.deepEqual(labelsFor('business-product'), ['Shared delivery', 'Commercial', 'Public']);
  assert.deepEqual(labelsFor('all-working-team'), ['Shared delivery', 'Public']);
  assert.deepEqual(labelsFor('everyone'), ['Public']);
});

test('normalizes Executive milestone outcomes to display text only', () => {
  const fixture = completeOverviewReportFixture();
  const model = buildOverviewReportModel({ ...fixture, executiveAudienceView: 'leadership' });
  const engineering = model.executiveMilestones.rows.find(row => row.label === 'Engineering');

  assert.deepEqual(engineering.cells, [[], ['Engineering Q2'], [], []]);
  assert.equal(JSON.stringify(model.executiveMilestones).includes('Hidden evidence'), false);
});
