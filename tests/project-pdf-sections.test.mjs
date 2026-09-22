// UPDATED (UAT PDF picker UI remediation): project-brief/project-update are restored as a UAT-profile-only picker
// capability (Control Plane requirement, on top of the pdf-service request-contract restoration in 095bf77). The
// #projectPdfSectionPicker markup, renderProjectUpdateReport, and PROJECT_PDF_SECTIONS were always common source
// shared byte-for-byte between the Production and UAT baselines (confirmed identical in both e1f0e5c and a04c0c1);
// only the two checkbox <label> options were missing after the consolidation merge. They are restored gated
// data-profile-only="uat" -- present in this file's *source text* (dashboardSource('production') only strips the
// resolved data-profile-only attribute, the same as it does for every other profile-gated element; it never
// removes the element), but never visible, checkable, or submittable for Production. See
// tests/project-pdf-sections.uat.test.mjs for the runtime-gating tests (isProfileVisible, the picker never checks
// or submits these sections for Production) and tests/dashboard-profile-invariants.test.mjs for the two named,
// reviewed exceptions to the byte-for-byte Production invariant this change required.
import { dashboardSource, dashboardSourceAsync, rawDashboardSource } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await dashboardSourceAsync('production');

test('project PDF picker always includes the one-page summary and exposes selectable detail sections', () => {
  assert.match(dashboard, /id="projectPdfSectionPicker"/);
  assert.match(dashboard, /one-page summary[\s\S]*always included as the first page/);
  assert.match(dashboard, /data-pdf-section="milestone"/);
  assert.match(dashboard, /data-pdf-section="gantt"/);
  assert.match(dashboard, /data-pdf-section="team-allocation"/);
  assert.match(dashboard, /data-pdf-section="budget"/);
  assert.match(dashboard, /data-pdf-section="resources"/);
  assert.match(dashboard, /Milestone/);
  assert.match(dashboard, /Gantt Chart/);
  assert.match(dashboard, /Team allocation/);
  assert.match(dashboard, /Budget/);
  assert.match(dashboard, /Discipline hours/);
});

test('the project-brief/project-update picker options exist only as a UAT-gated capability, not a plain Production option', () => {
  // The shipped source (not a per-profile reconstruction) is the only place the data-profile-only="uat" gate
  // itself can be asserted; dashboardSource() resolves/strips it for both profile views, as it does for every
  // other profile-gated element in this codebase.
  const raw = rawDashboardSource();
  const pickerStart = raw.indexOf('id="projectPdfSectionPicker"');
  const pickerEnd = raw.indexOf('</div>\n</div>', pickerStart);
  const picker = raw.slice(pickerStart, pickerEnd);
  assert.match(picker, /data-profile-only="uat"><input type="checkbox" data-pdf-section="project-brief">/);
  assert.match(picker, /data-profile-only="uat"><input type="checkbox" data-pdf-section="project-update">/);
  // The Production profile view may still contain the strings (common markup, gated at runtime -- see
  // isProfileVisible() below and tests/project-pdf-sections.uat.test.mjs for the runtime-gating proof), but the
  // functions that decide what a Production user actually sees/submits must gate through isProfileVisible().
  assert.match(dashboard, /function openProjectPdfSectionPicker\(code\) \{[\s\S]*?isProfileVisible[\s\S]*?\n\}/);
  assert.match(dashboard, /async function confirmProjectPdfExport\(\) \{[\s\S]*?isProfileVisible[\s\S]*?\n\}/);
});

test('the project update report renderer is common source, reachable only through the UAT-gated picker', () => {
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
