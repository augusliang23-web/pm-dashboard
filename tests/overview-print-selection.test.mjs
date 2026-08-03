import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../team-2/index.html', import.meta.url), 'utf8');
const deployedDashboards = [
  ['root', readFileSync(new URL('../index.html', import.meta.url), 'utf8')],
  ['team-2', dashboard],
];

test('Overview PDF uses a second step to choose every active project in every deployed entry point', () => {
  for (const [entryPoint, source] of deployedDashboards) {
    assert.match(source, /id="overviewProjectPrintOverlay"/, entryPoint);
    assert.match(source, />Next: choose projects</, entryPoint);
    assert.match(source, /onclick="setOverviewProjectPrintSelection\(true\)"[^>]*>Select all</, entryPoint);
    assert.match(source, /onclick="setOverviewProjectPrintSelection\(false\)"[^>]*>Clear</, entryPoint);
    assert.match(source, /Select at least one project to export\./, entryPoint);
    assert.match(source, /buildOverviewProjectOptions\(/, entryPoint);
    assert.match(source, /buildOverviewPdfRequest\(/, entryPoint);
    assert.match(source, /projectCodes/, entryPoint);
    assert.match(source, /selectedProjectCodes/, entryPoint);
    assert.match(source, /All active projects you can access are listed\./, entryPoint);
    const pickerStart = source.indexOf('function getActiveOverviewProjectsForPdf()');
    const pickerEnd = source.indexOf('function setOverviewProjectPrintValidation', pickerStart);
    assert.notEqual(pickerStart, -1, entryPoint);
    const pickerSource = source.slice(pickerStart, pickerEnd);
    assert.match(pickerSource, /getRoleVisibleProjectsForOverview\(projects\)/, entryPoint);
    assert.match(pickerSource, /filter\(project => !project\?\.visibility \|\| project\.visibility === 'active'\)/, entryPoint);
    assert.doesNotMatch(pickerSource, /getOverviewProjects|overviewScope/, entryPoint);
    const start = source.indexOf('window.confirmOverviewProjectPrint =');
    const end = source.indexOf('window.setOverviewScope', start);
    const exportSource = source.slice(start, end);
    assert.match(exportSource, /overviewScope:\s*'all'/, entryPoint);
    assert.doesNotMatch(exportSource, /localStorage|setDoc|updateDoc|runTransaction/, entryPoint);
  }
});

test('Overview PDF opens a section selection dialog with approved presets', () => {
  assert.match(dashboard, /onclick="openOverviewPrintDialog\(\)"/);
  assert.match(dashboard, /id="overviewPrintOverlay"/);
  for (const preset of ['all', 'executive', 'roadmap', 'resource', 'budget', 'custom']) {
    assert.ok(dashboard.includes(`applyOverviewPrintPreset('${preset}')`));
  }
});

test('every Overview report section has a selectable print identity', () => {
  for (const section of [
    'health-focus',
    'weekly-trend',
    'executive-summary',
    'attention-matrix',
    'risk-actions',
    'quarterly-roadmap',
    'project-portfolio',
    'resource-analytics',
    'budget-overview',
  ]) {
    assert.ok(dashboard.includes(`data-print-section="${section}"`), section);
  }
});

test('Overview selection sends the validated two-step request and does not persist data', () => {
  const start = dashboard.indexOf('window.confirmOverviewPrint =');
  const end = dashboard.indexOf('window.setOverviewScope', start);
  const source = dashboard.slice(start, end);
  assert.ok(source.includes('Select at least one section to export.'));
  assert.ok(source.includes('Select at least one project to export.'));
  assert.ok(source.includes('downloadProfessionalReport'));
  assert.ok(source.includes('buildOverviewPdfRequest'));
  assert.ok(source.includes('overviewScope'));
  assert.ok(source.includes('projectCodes'));
  assert.doesNotMatch(source, /localStorage|setDoc|updateDoc|runTransaction/);
  assert.match(dashboard, /function renderOverviewPrintReport\(/);
  assert.match(dashboard, /function renderPresentationReportPage\(/);
  assert.match(dashboard, /document\.body\.classList\.add\('print-presentation-report'\)/);
});

test('Overview project portfolio repeats its heading while preserving complete project cards', () => {
  assert.match(dashboard, /function renderOverviewPortfolioReportPages\(/);
  assert.match(dashboard, /\.exec-project-card/);
  assert.match(dashboard, /portfolioCards\.slice\(index, index \+ 1\)/);
  assert.match(dashboard, /Project Portfolio/);
});

test('resource and budget are separate PDF export choices', () => {
  assert.ok(dashboard.includes('Resource analytics</label>'));
  assert.ok(dashboard.includes('Budget overview</label>'));
  assert.ok(dashboard.includes("resource: ['resource-analytics']"));
  assert.ok(dashboard.includes("budget: ['budget-overview']"));
});
