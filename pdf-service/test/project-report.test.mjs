import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProjectReportHtml } from '../src/project-report.js';
import { completeProjectReportFixture } from './report-fixtures.mjs';

test('renders every selected project section with dashboard visual structures', () => {
  const html = renderProjectReportHtml(completeProjectReportFixture());

  for (const section of ['project-summary', 'milestone', 'gantt', 'resource', 'budget']) {
    assert.match(html, new RegExp(`data-report-section="${section}"`));
  }
  assert.match(html, /project-brief-grid/);
  assert.match(html, /status-badge red/);
  assert.match(html, /gantt-row/);
  assert.match(html, /team-allocation-table/);
  assert.match(html, /discipline-hours-table/);
  assert.match(html, /budget-comparison/);
  assert.match(html, /W28 2026 · Jul 6–Jul 12, 2026/);
  assert.match(html, /\.gantt-grid/);
  assert.doesNotMatch(html, /\.report-page\s*\{[^}]*overflow:hidden/);
  assert.doesNotMatch(html, /<script|onclick=|<button|<select|<input/);
});

test('uses vertical milestones for long milestone collections and omits empty sections', () => {
  const html = renderProjectReportHtml({
    week: { weekLabel: 'W28 2026' },
    project: {
      name: 'PMS', code: 'PMS-001', progress: 60,
      milestones: [
        { name: 'Discovery', date: '2026-04-30' },
        { name: 'Design', date: '2026-07-15' },
        { name: 'Demo', date: '2026-07-15' },
        { name: 'Integration', date: '2026-08-17' }
      ]
    },
    sections: ['project-brief', 'milestone']
  });
  assert.match(html, /milestone-list/);
  assert.doesNotMatch(html, /Team allocation/);
  assert.match(html, /@page \{ size: A4 landscape/);
});

test('uses a compact timeline only for three or fewer short milestones', () => {
  const html = renderProjectReportHtml({
    week: { weekLabel: 'W28 2026' },
    project: { name: 'PMS', milestones: [{ name: 'Plan' }, { name: 'Build' }, { name: 'Release' }] },
    sections: ['milestone']
  });
  assert.match(html, /milestone-timeline/);
});

test('escapes project content and omits pages that were not selected', () => {
  const fixture = completeProjectReportFixture();
  fixture.project.name = '<img src=x onerror=alert(1)>';
  fixture.project.highlight = '<script>alert(1)</script>';
  fixture.sections = ['project-brief', 'project-update'];

  const html = renderProjectReportHtml(fixture);

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /data-report-section="gantt"/);
  assert.doesNotMatch(html, /<script>/);
});

test('keeps weekly key actions while omitting an empty risk block', () => {
  const fixture = completeProjectReportFixture();
  fixture.sections = ['project-update'];
  fixture.project.risk = '';
  fixture.project.weeklyActions = 'Continue flowchart update';

  const html = renderProjectReportHtml(fixture);

  assert.match(html, /Weekly actions[\s\S]*Continue flowchart update/);
  assert.doesNotMatch(html, /Risk \/ Blocker/);
  assert.doesNotMatch(html, /No risk or blocker reported\./);
});

test('renders compact per-section update metadata in project PDF sections', () => {
  const fixture = completeProjectReportFixture();
  fixture.sections = ['project-brief', 'project-update'];
  fixture.project.sectionUpdatedAt = {
    status: { savedAt: '2026-08-01T08:00:00.000Z', editorName: 'AUGUS.LIANG' },
    highlights: { savedAt: '2026-08-01T08:00:00.000Z', editorName: 'AUGUS.LIANG' },
  };

  const html = renderProjectReportHtml(fixture);

  assert.match(html, /Updated · 1 Aug 2026 · AUGUS\.LIANG/);
  assert.match(html, /No update recorded/);
});

test('keeps long milestone items in vertical rows', () => {
  const fixture = completeProjectReportFixture();
  fixture.sections = ['milestone'];
  fixture.project.milestones = Array.from({ length: 5 }, (_, index) => ({
    name: `Long milestone ${index + 1} requiring a complete printable row`,
    date: `2026-0${index + 4}-15`,
    status: index === 4 ? 'at-risk' : 'planned'
  }));

  const html = renderProjectReportHtml(fixture);

  assert.match(html, /milestone-list/);
  assert.match(html, /milestone-row keep-together/);
});

test('marks every variable project section for measured continuation pages', () => {
  const fixture = completeProjectReportFixture();
  fixture.project.milestones = Array.from({ length: 8 }, (_, index) => ({
    name: `Milestone marker ${index + 1}`,
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    status: 'planned'
  }));
  fixture.project.ganttWorkstreams = Array.from({ length: 12 }, (_, index) => ({
    name: `Gantt marker ${index + 1}`,
    startDate: '2026-07-01',
    endDate: '2026-08-31',
    status: 'in-progress',
    progress: index * 5
  }));
  fixture.project.teamMembers = Array.from({ length: 10 }, (_, index) => ({
    name: `Member ${index + 1}`,
    roleName: `Role ${index + 1}`,
    effortPct: 50
  }));
  fixture.project.resources = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
    `role_${index + 1}`,
    { role: `Role ${index + 1}`, estimated: 100, actual: 50 }
  ]));

  const html = renderProjectReportHtml(fixture);

  for (const flow of ['milestone', 'gantt', 'resource', 'budget']) {
    assert.match(html, new RegExp(`data-measured-flow="${flow}"`));
  }
  assert.match(html, /data-pdf-repeat-on-page/);
  assert.ok((html.match(/data-pdf-split-unit/g) || []).length >= 40);
  assert.match(html, /Milestone marker 8/);
  assert.match(html, /Gantt marker 12/);
  assert.match(html, /Member 10/);
  assert.match(html, /Role 10/);
});
