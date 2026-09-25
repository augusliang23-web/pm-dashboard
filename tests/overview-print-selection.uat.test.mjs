import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = dashboardSource('uat');

test('root Overview PDF uses a second step to choose every active accessible project', () => {
  assert.match(dashboard, /id="overviewProjectPrintOverlay"/);
  assert.match(dashboard, />Next: choose projects</);
  assert.match(dashboard, /onclick="setOverviewProjectPrintSelection\(true\)"[^>]*>Select all</);
  assert.match(dashboard, /onclick="setOverviewProjectPrintSelection\(false\)"[^>]*>Clear</);
  assert.match(dashboard, /Select at least one project to export\./);
  assert.match(dashboard, /buildOverviewProjectOptions\(/);
  assert.match(dashboard, /buildOverviewPdfRequest\(/);
  assert.match(dashboard, /projectCodes/);
  assert.match(dashboard, /selectedProjectCodes/);
  assert.match(dashboard, /All active projects you can access are listed\./);
  const pickerStart = dashboard.indexOf('function getActiveOverviewProjectsForPdf()');
  const pickerEnd = dashboard.indexOf('function setOverviewProjectPrintValidation', pickerStart);
  assert.notEqual(pickerStart, -1);
  const pickerSource = dashboard.slice(pickerStart, pickerEnd);
  assert.match(pickerSource, /filterRoleVisibleProjects\(projects/);
  assert.match(pickerSource, /visibilityFilter:\s*'active'/);
  assert.doesNotMatch(pickerSource, /getOverviewProjects|overviewScope/);
  const start = dashboard.indexOf('window.confirmOverviewProjectPrint =');
  const end = dashboard.indexOf('window.setOverviewScope', start);
  const exportSource = dashboard.slice(start, end);
  assert.match(exportSource, /overviewScope:\s*'all'/);
  assert.doesNotMatch(exportSource, /localStorage|setDoc|updateDoc|runTransaction/);
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
  assert.match(dashboard, /<div class="exec-eyebrow">Risk &amp; Mitigation Actions<\/div>/);
  assert.doesNotMatch(dashboard, /<div class="exec-eyebrow">Risk Action Table<\/div>/);
  const riskTableRenderer = dashboard.match(/function renderRiskActionTable\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(riskTableRenderer, /<th>Mitigation Actions<\/th>/);
  assert.doesNotMatch(riskTableRenderer, /<th>Required Action<\/th>/);
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
