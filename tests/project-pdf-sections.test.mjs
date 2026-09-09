import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('project PDF picker exposes selectable project background and delivery sections', () => {
  assert.match(dashboard, /id="projectPdfSectionPicker"/);
  assert.match(dashboard, /data-pdf-section="project-brief"/);
  assert.match(dashboard, /data-pdf-section="project-update"/);
  assert.match(dashboard, /data-pdf-section="milestone"/);
  assert.match(dashboard, /data-pdf-section="gantt"/);
  assert.match(dashboard, /data-pdf-section="team-allocation"/);
  assert.match(dashboard, /data-pdf-section="budget"/);
  assert.match(dashboard, /data-pdf-section="resources"/);
  assert.match(dashboard, /Project brief/);
  assert.match(dashboard, /Milestone/);
  assert.match(dashboard, /Gantt Chart/);
  assert.match(dashboard, /Team allocation/);
  assert.match(dashboard, /Budget/);
  assert.match(dashboard, /Discipline hours/);
});

test('project PDF includes a selectable executive project update section', () => {
  assert.match(dashboard, /data-pdf-section="project-update"/);
  assert.match(dashboard, /function renderProjectUpdateReport\(/);
  assert.match(dashboard, /project-print-update-card/);
  assert.match(dashboard, /Highlight/);
  assert.match(dashboard, /Risk \/ Blocker/);
  assert.match(dashboard, /Weekly actions/);
});

test('project export opens a section picker before direct professional download', () => {
  const start = dashboard.indexOf('window.exportProjectOnePagePdf =');
  const end = dashboard.indexOf('// ── RENDER ──', start);
  const source = dashboard.slice(start, end);
  assert.match(source, /openProjectPdfSectionPicker/);
  assert.doesNotMatch(source, /window\.print\(\)/);
  assert.match(dashboard, /function confirmProjectPdfExport\(/);
  assert.match(dashboard, /window\.confirmProjectPdfExport\s*=\s*confirmProjectPdfExport/);
  assert.match(dashboard, /function confirmProjectPdfExport\(\)[\s\S]*downloadProfessionalReport/);
});

test('project presentation report keeps complete sections and table rows together', () => {
  assert.match(dashboard, /body\.print-presentation-report \.print-report-unit \{ break-inside:avoid-page/);
  assert.match(dashboard, /body\.print-presentation-report \.project-report-table tr \{ break-inside:avoid-page/);
  assert.match(dashboard, /data-pdf-section="milestone"/);
  assert.match(dashboard, /data-pdf-section="gantt"/);
  assert.match(dashboard, /data-pdf-section="budget"/);
  assert.match(dashboard, /data-pdf-section="resources"/);
});

test('project Gantt uses a presentation report grid that fits a landscape page', () => {
  const printStart = dashboard.indexOf('@media print {');
  const printCss = dashboard.slice(printStart, dashboard.indexOf('</style>', printStart));
  assert.match(printCss, /\.project-report-gantt \.gantt-grid\s*\{[^}]*min-width:\s*0/);
  assert.match(printCss, /\.project-report-gantt \.gantt-name\s*\{[^}]*width:\s*46mm/);
  assert.match(dashboard, /renderProjectGantt\(project, 'printReportGantt'\)/);
});

test('project print separates report pages while keeping the executive summary compact', () => {
  assert.match(dashboard, /project-print-update-grid \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(dashboard, /if \(selected\.has\('milestone'\)\) page\('milestone'/);
  assert.match(dashboard, /if \(selected\.has\('gantt'\)\) page\('gantt'/);
  assert.match(dashboard, /if \(selected\.has\('team-allocation'\)\) page\('team-allocation'/);
});

test('project PDF uses a presentation report with a horizontal milestone timeline and named team allocation', () => {
  assert.match(dashboard, /function renderProjectPrintReport\(/);
  assert.match(dashboard, /function renderProjectMilestoneTimeline\(/);
  assert.match(dashboard, /project-milestone-timeline/);
  assert.match(dashboard, /<th>Name<\/th><th>Role<\/th><th>Allocation<\/th>/);
  assert.match(dashboard, /renderProjectTeamAllocationReport/);
  assert.match(dashboard, /finalizePresentationReport\(pages, 'project'\)/);
});
