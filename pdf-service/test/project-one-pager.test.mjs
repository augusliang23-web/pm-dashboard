import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProjectOnePagerHtml } from '../src/project-one-pager.js';
import { buildProjectReportModel } from '../src/report-model.js';
import { completeProjectReportFixture } from './report-fixtures.mjs';

function buildModel(overrides = {}) {
  const fixture = completeProjectReportFixture();
  return buildProjectReportModel({
    week: fixture.week,
    sections: fixture.sections,
    project: { ...fixture.project, ...overrides }
  });
}

test('renders exactly one one-pager section with the project name, status and progress', () => {
  const model = buildModel();
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.equal((html.match(/class="one-pager"/g) || []).length, 1);
  assert.match(html, /Platform Modernization/);
  assert.match(html, /62%/);
  assert.match(html, /Critical/);
});

test('renders highlights, action items and the primary risk / required action', () => {
  const model = buildModel();
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.match(html, /Prototype approved/);
  assert.match(html, /Pilot environment ready/);
  assert.match(html, /Confirm alternate supplier/);
  assert.match(html, /Vendor lead time/);
});

test('preserves a leading "-" or "N." in highlight/action text instead of stripping it as a bullet marker', () => {
  const model = buildModel({
    highlight: '- 5% under target\nSecond point',
    weeklyActions: '3.1 spec review\nBeta'
  });
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.match(html, /<li>- 5% under target<\/li>/);
  assert.match(html, /<li>3\.1 spec review<\/li>/);
  assert.doesNotMatch(html, /<li>5% under target<\/li>/);
  assert.doesNotMatch(html, /<li>spec review<\/li>/);
});

test('lists every risk and its required action with raw (unstripped) text', () => {
  const model = buildModel({
    riskActions: [{ risk: '- Vendor lead time', action: '3.1 confirm supplier', primary: true }]
  });
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.match(html, /<p>- Vendor lead time<\/p>/);
  assert.match(html, /<p>3\.1 confirm supplier<\/p>/);
});

test('lists every risk and its required action, not just the primary one', () => {
  const model = buildModel({
    riskActions: [
      { risk: 'Vendor lead time', action: 'Confirm alternate supplier', primary: true },
      { risk: 'Lab capacity is constrained', action: 'Reserve backup validation slot' },
      { risk: 'Firmware regression uncovered', action: 'Assign owner and target date' }
    ]
  });
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.equal((html.match(/one-pager-risk-pair/g) || []).length, 3);
  assert.match(html, /Vendor lead time/);
  assert.match(html, /Lab capacity is constrained/);
  assert.match(html, /Firmware regression uncovered/);
  assert.match(html, /Reserve backup validation slot/);
  assert.match(html, /Assign owner and target date/);
  assert.match(html, /Primary risk/);
});

test('shows an empty-state message for highlights and actions instead of a blank quadrant', () => {
  const model = buildModel({ highlight: '', weeklyActions: '' });
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.match(html, /No highlight reported\./);
  assert.match(html, /No action reported\./);
});

test('renders one Gantt row per summary lane, not per raw workstream', () => {
  const model = buildModel({
    ganttWorkstreams: [
      { id: 'a', name: 'Design - Mechanical', startDate: '2026-01-01', endDate: '2026-01-20', progress: 100, status: 'completed' },
      { id: 'b', name: 'Design - Electrical', startDate: '2026-01-05', endDate: '2026-01-25', progress: 80, status: 'on-track' },
      { id: 'c', name: 'Integration', startDate: '2026-02-01', endDate: '2026-03-01', progress: 20, status: 'at-risk' }
    ]
  });
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.equal((html.match(/one-pager-gantt-row/g) || []).length, model.summaryLanes.length);
  assert.equal(model.summaryLanes.length, 2);
  assert.match(html, /Design/);
  assert.match(html, /Integration/);
});

test('surfaces a low-confidence note when most workstreams could not be auto-grouped', () => {
  const model = buildModel({
    ganttWorkstreams: Array.from({ length: 6 }, (_, index) => ({
      id: `ws-${index}`, name: `Totally Unrelated Task ${index}`,
      startDate: '2026-01-01', endDate: '2026-01-10', progress: 10
    }))
  });
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.match(html, /could not be confidently auto-grouped/);
});

test('does not surface a low-confidence note when grouping is confident', () => {
  const model = buildModel();
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.doesNotMatch(html, /could not be confidently auto-grouped/);
});

test('surfaces a display-window note when the admin-configured Gantt window hides tasks', () => {
  const fixture = completeProjectReportFixture();
  const model = buildProjectReportModel({
    week: fixture.week,
    sections: fixture.sections,
    ganttWindowSettings: { defaultMonths: 1, overrides: {} },
    project: {
      ...fixture.project,
      ganttWorkstreams: [
        { id: 'a', name: 'Design', startDate: '2026-07-01', endDate: '2026-07-08', status: 'completed', progress: 100 },
        { id: 'b', name: 'Far out work', startDate: '2027-06-01', endDate: '2027-06-10', status: 'not-started', progress: 0 }
      ]
    }
  });
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.match(html, /1 task\(s\) outside the 1-month display window are not shown/);
});

test('does not surface a display-window note when nothing is hidden by the window', () => {
  const model = buildModel();
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.doesNotMatch(html, /display window are not shown/);
});

test('escapes project content to avoid HTML injection from stored fields', () => {
  const model = buildModel({ name: '<img src=x onerror=alert(1)>' });
  const html = renderProjectOnePagerHtml(model, model.period);

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test('highlights and action items shrink to a dense style past 4 items, not before', () => {
  const fourItems = Array.from({ length: 4 }, (_, index) => `Highlight ${index + 1}`).join('\n');
  const fiveItems = Array.from({ length: 5 }, (_, index) => `Highlight ${index + 1}`).join('\n');

  const normalHtml = renderProjectOnePagerHtml(buildModel({ highlight: fourItems }));
  assert.doesNotMatch(normalHtml, /one-pager-list {2}dense/);

  const denseHtml = renderProjectOnePagerHtml(buildModel({ highlight: fiveItems }));
  assert.match(denseHtml, /one-pager-list {2}dense/);
});

test('the risk quadrant shrinks to a dense style past 2 risks, not before', () => {
  const twoRisks = [
    { risk: 'Risk one', action: 'Action one', primary: true },
    { risk: 'Risk two', action: 'Action two' }
  ];
  const threeRisks = [...twoRisks, { risk: 'Risk three', action: 'Action three' }];

  const normalHtml = renderProjectOnePagerHtml(buildModel({ riskActions: twoRisks }));
  assert.doesNotMatch(normalHtml, /one-pager-risk-stack dense/);

  const denseHtml = renderProjectOnePagerHtml(buildModel({ riskActions: threeRisks }));
  assert.match(denseHtml, /one-pager-risk-stack dense/);
  assert.match(denseHtml, /Risk three/);
});

test('the schedule summary shrinks to a dense style only when more than 8 lanes survive grouping', () => {
  // Each workstream carries a distinct milestone and an at-risk status, so
  // none of them can be merged away by the grouping/merge-down-to-8 logic -
  // this is the one realistic way a project ends up with more than 8 lanes.
  const riskyWorkstream = index => ({
    id: `ws-${index}`, name: `Task ${index}`, status: 'at-risk',
    startDate: '2026-01-01', endDate: '2026-01-10', progress: 10, milestoneId: `ms-${index}`
  });
  const milestone = index => ({ id: `ms-${index}`, name: `Milestone ${index}` });

  const eightMilestones = Array.from({ length: 8 }, (_, index) => milestone(index));
  const eightRiskyWorkstreams = Array.from({ length: 8 }, (_, index) => riskyWorkstream(index));
  const nineMilestones = [...eightMilestones, milestone(8)];
  const nineRiskyWorkstreams = [...eightRiskyWorkstreams, riskyWorkstream(8)];

  const normalHtml = renderProjectOnePagerHtml(buildModel({ milestones: eightMilestones, ganttWorkstreams: eightRiskyWorkstreams }));
  assert.doesNotMatch(normalHtml, /one-pager-gantt-stack dense/);
  assert.equal((normalHtml.match(/one-pager-gantt-row/g) || []).length, 8);

  const denseHtml = renderProjectOnePagerHtml(buildModel({ milestones: nineMilestones, ganttWorkstreams: nineRiskyWorkstreams }));
  assert.match(denseHtml, /one-pager-gantt-stack dense/);
  assert.equal((denseHtml.match(/one-pager-gantt-row/g) || []).length, 9);
});
