import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOverviewReportHtml } from '../src/overview-report.js';
import {
  compactExecutiveSummaryFixture,
  completeOverviewReportFixture,
  legacyExecutiveSummaryFixture,
  verboseExecutiveSummaryFixture
} from './report-fixtures.mjs';

test('emits Executive Summary as one ordered measurable flow', () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = legacyExecutiveSummaryFixture();

  const html = renderOverviewReportHtml(fixture);

  assert.equal((html.match(/data-measured-flow="executive-summary"/g) || []).length, 1);
  assert.equal((html.match(/data-pdf-flow-item(?:\s|>)/g) || []).length, 13);
  assert.match(html, /data-flow-kind="portfolio-summary"/);
  assert.match(html, /data-flow-kind="priority-project"/);
  assert.match(html, /data-flow-kind="management-decision"/);
  assert.match(html, /data-flow-kind="project-context"/);
  const kinds = [...html.matchAll(/data-flow-kind="([^"]+)"/g)].map(match => match[1]);
  assert.ok(kinds.indexOf('priority-project') < kinds.indexOf('management-decision'));
  assert.ok(kinds.indexOf('management-decision') < kinds.indexOf('project-context'));
});

test('renders compact Executive Summary as one measurable source page', () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = compactExecutiveSummaryFixture();

  const html = renderOverviewReportHtml(fixture);

  assert.equal((html.match(/<section class="report-page" data-report-section="executive-summary-/g) || []).length, 1);
  assert.match(html, /data-report-section="executive-summary-brief"/);
  assert.match(html, /data-page-section="executive-summary-context"/);
  assert.match(html, /Decision Brief/);
  assert.match(html, /Project Context/);
  assert.match(html, /Management decisions/);
  assert.match(html, /Priority projects/);
});

test('keeps verbose projects and management decisions in the measurable flow', () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = verboseExecutiveSummaryFixture();

  const html = renderOverviewReportHtml(fixture);

  assert.equal((html.match(/<section class="report-page" data-report-section="executive-summary-/g) || []).length, 1);
  assert.equal((html.match(/data-flow-kind="priority-project"/g) || []).length, 2);
  assert.equal((html.match(/data-flow-kind="management-decision"/g) || []).length, 4);
  assert.equal((html.match(/data-flow-kind="project-context"/g) || []).length, 6);
  assert.equal((html.match(/class="report-page-head"/g) || []).length, 1);
  assert.equal((html.match(/class="report-footer"/g) || []).length, 1);
});

test('puts a legacy unbulleted weekly summary into one measurable flow', () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = legacyExecutiveSummaryFixture();

  const html = renderOverviewReportHtml(fixture);

  assert.equal((html.match(/<section class="report-page" data-report-section="executive-summary-/g) || []).length, 1);
  assert.equal((html.match(/class="report-page-head"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="empty-state"/);
});

test('renders all ten selected Overview sections in dashboard reading order', () => {
  const html = renderOverviewReportHtml(completeOverviewReportFixture());
  const ids = [
    'health-focus', 'weekly-trend', 'executive-summary', 'attention-matrix',
    'risk-actions', 'executive-milestones', 'quarterly-roadmap', 'project-portfolio',
    'resource-analytics', 'budget-overview'
  ];

  ids.forEach(id => assert.match(html, new RegExp(`data-section-unit="${id}"`)));
  const positions = ids.map(id => html.indexOf(`data-section-unit="${id}"`));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(html, /weekly-trend-svg/);
  assert.match(html, /attention-quadrant action/);
  assert.match(html, /quarter-grid/);
  assert.match(html, /resource-function-bar/);
  assert.match(html, /budget-variance/);
});

test('renders permitted Executive milestones and Quarterly Roadmap as compact measured flows', () => {
  const fixture = completeOverviewReportFixture();
  fixture.executiveAudienceView = 'pm-engineering';
  fixture.sections = ['executive-milestones', 'quarterly-roadmap'];

  const html = renderOverviewReportHtml(fixture);

  assert.match(html, /data-measured-flow="executive-roadmap"/);
  assert.match(html, /data-flow-kind="executive-roadmap-category"/);
  assert.match(html, /data-measured-flow="quarterly-roadmap"/);
  assert.match(html, /data-flow-kind="quarterly-roadmap-quarter"/);
  assert.match(html, /Executive Milestones/);
  assert.match(html, /Shared delivery/);
  assert.match(html, /Engineering/);
  assert.match(html, /Public/);
  assert.doesNotMatch(html, /Commercial Q3|Leadership Q4/);
  assert.doesNotMatch(html, /Â/);
  assert.ok(html.indexOf('data-section-unit="executive-milestones"') < html.indexOf('data-section-unit="quarterly-roadmap"'));
});

test('keeps overview signals together while giving Executive Summary dedicated pages', () => {
  const html = renderOverviewReportHtml(completeOverviewReportFixture());

  assert.equal((html.match(/data-report-section="overview-opening"/g) || []).length, 1);
  assert.equal((html.match(/data-report-section="overview-management"/g) || []).length, 1);
  assert.match(html, /data-report-section="overview-opening"[\s\S]*data-section-unit="health-focus"[\s\S]*data-section-unit="weekly-trend"/);
  assert.doesNotMatch(
    html.match(/data-report-section="overview-opening"[\s\S]*?<\/section>/)?.[0] || '',
    /data-section-unit="executive-summary"/
  );
  assert.equal((html.match(/<section class="report-page" data-report-section="executive-summary-/g) || []).length, 1);
  assert.match(html, /data-report-section="overview-management"[\s\S]*data-section-unit="attention-matrix"[\s\S]*data-section-unit="risk-actions"/);
});

test('uses one measured source flow per project portfolio', () => {
  const html = renderOverviewReportHtml(completeOverviewReportFixture());
  const pageCount = (html.match(/data-report-section="project-portfolio"/g) || []).length;

  assert.equal(pageCount, 2);
  assert.equal((html.match(/data-measured-flow="project-portfolio-/g) || []).length, 2);
  assert.match(html, /class="report-page-context"[^>]*>Platform Modernization<\/div>/);
  assert.match(html, /class="report-page-context"[^>]*>Module Refresh<\/div>/);
  assert.doesNotMatch(html, /Project Portfolio · Continued/);
});

test('renders complete project highlights, risk actions, and Gantt workstreams', () => {
  const fixture = completeOverviewReportFixture();
  const project = fixture.week.projects[0];
  fixture.week.projects = [project];
  fixture.sections = ['project-portfolio'];
  project.highlight = ['HIGHLIGHT-ONE', 'HIGHLIGHT-TWO', 'HIGHLIGHT-THREE'].join('\n');
  project.riskActions = Array.from({ length: 3 }, (_, index) => ({
    risk: `RISK-${index + 1}`,
    action: `ACTION-${index + 1}`,
    primary: index === 0
  }));
  project.ganttWorkstreams = Array.from({ length: 12 }, (_, index) => ({
    name: `WORKSTREAM-${index + 1}`,
    startDate: `2026-07-${String(index + 1).padStart(2, '0')}`,
    endDate: `2026-07-${String(index + 2).padStart(2, '0')}`,
    status: 'in-progress',
    progress: index * 5
  }));

  const html = renderOverviewReportHtml(fixture);

  for (const marker of [
    'HIGHLIGHT-ONE', 'HIGHLIGHT-TWO', 'HIGHLIGHT-THREE',
    'RISK-1', 'RISK-2', 'RISK-3', 'ACTION-1', 'ACTION-2', 'ACTION-3',
    ...Array.from({ length: 12 }, (_, index) => `WORKSTREAM-${index + 1}`)
  ]) {
    assert.equal((html.match(new RegExp(`${marker}(?!\\d)`, 'g')) || []).length, 1, `${marker} must appear once`);
  }
  assert.equal((html.match(/data-measured-flow="project-portfolio-PMS-001"/g) || []).length, 1);
  assert.doesNotMatch(html, /Primary risk and action pair/);
});

test('omits Overview sections with no reportable data', () => {
  const html = renderOverviewReportHtml({
    week: { weekLabel: 'W28 2026', projects: [] },
    sections: ['health-focus', 'project-portfolio', 'risk-actions']
  });
  assert.match(html, /Portfolio Health &amp; Focus|Portfolio Health & Focus/);
  assert.doesNotMatch(html, /Project Portfolio/);
  assert.doesNotMatch(html, /Risk Actions/);
});

test('omits Executive milestones when no timeline is saved', () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-milestones', 'quarterly-roadmap'];
  delete fixture.week.strategyLayer.executiveMilestoneTimeline;

  const html = renderOverviewReportHtml(fixture);

  assert.doesNotMatch(html, /data-section-unit="executive-milestones"/);
  assert.match(html, /data-section-unit="quarterly-roadmap"/);
});

test('renders weekly key actions independently and omits risks when none are stored', () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['project-portfolio'];
  fixture.week.projects = [{
    ...fixture.week.projects[0],
    risk: '',
    weeklyActions: 'Continue flowchart update',
    riskActions: []
  }];

  const html = renderOverviewReportHtml(fixture);

  assert.match(html, /Weekly Key Actions[\s\S]*Continue flowchart update/);
  assert.match(html, /data-flow-kind="project-weekly-actions"/);
  assert.doesNotMatch(html, /Risks &amp; required actions/);
  assert.doesNotMatch(html, /No active blocker reported\./);
});

test('escapes Overview project content and contains no interactive controls', () => {
  const fixture = completeOverviewReportFixture();
  fixture.week.projects[0].name = '<img src=x onerror=alert(1)>';
  fixture.week.projects[0].risk = '<script>alert(1)</script>';

  const html = renderOverviewReportHtml(fixture);

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /thead \{ display:table-header-group/);
  assert.doesNotMatch(html, /<script|onclick=|<button|<select|<input/);
});
