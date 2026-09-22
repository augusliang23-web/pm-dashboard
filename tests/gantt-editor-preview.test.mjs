import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as portfolioCore from '../js/portfolio-core.mjs';

const dashboard = await dashboardSourceAsync('production');

test('Gantt progress segments clamp values and split completed from remaining work', () => {
  assert.equal(typeof portfolioCore.getGanttProgressSegments, 'function');
  assert.deepEqual(portfolioCore.getGanttProgressSegments(0), {
    progress: 0,
    completedPercent: 0,
    remainingPercent: 100
  });
  assert.deepEqual(portfolioCore.getGanttProgressSegments(45), {
    progress: 45,
    completedPercent: 45,
    remainingPercent: 55
  });
  assert.deepEqual(portfolioCore.getGanttProgressSegments(100), {
    progress: 100,
    completedPercent: 100,
    remainingPercent: 0
  });
  assert.equal(portfolioCore.getGanttProgressSegments(-5).completedPercent, 0);
  assert.equal(portfolioCore.getGanttProgressSegments(125).completedPercent, 100);
  assert.equal(portfolioCore.getGanttProgressSegments('invalid').completedPercent, 0);
});

test('shared Gantt renderer uses a gray base with a green completed overlay', () => {
  assert.match(dashboard, /getGanttProgressSegments/);
  assert.match(dashboard, /class="gantt-bar-completed"/);
  assert.match(dashboard, /\.gantt-bar-completed\s*\{[^}]*background:var\(--green\)/s);
  assert.doesNotMatch(dashboard, /\.gantt-bar\.at-risk\s*\{/);
  assert.doesNotMatch(dashboard, /\.gantt-bar\.delayed\s*\{/);
  assert.doesNotMatch(dashboard, /\.gantt-bar\.completed\s*\{/);
});

test('Project Editor exposes a shared live Schedule Preview', () => {
  assert.match(dashboard, /id="workstreamPreviewStatus"[^>]+role="status"/);
  assert.match(dashboard, /id="workstreamGanttPreview"/);
  assert.match(dashboard, /function scheduleWorkstreamPreview\(\)/);
  assert.match(dashboard, /function renderWorkstreamEditorPreview\(\)/);
  assert.match(
    dashboard,
    /renderProjectGantt\(\s*\{[\s\S]*ganttWorkstreams,[\s\S]*milestones:[\s\S]*\},\s*'workstreamGanttPreview'\s*\)/
  );
});

test('draft schedule interactions refresh preview without saving', () => {
  const previewSource = dashboard.slice(
    dashboard.indexOf('function scheduleWorkstreamPreview()'),
    dashboard.indexOf('window.saveProjEdit')
  );
  assert.match(previewSource, /requestAnimationFrame/);
  assert.match(previewSource, /collectWorkstreams\(\)/);
  assert.match(previewSource, /scheduleWorkstreamPreview\(\)/);
  assert.match(dashboard, /setGanttScale[\s\S]*scheduleWorkstreamPreview\(\)/);
  assert.match(dashboard, /removeWorkstreamRow[\s\S]*scheduleWorkstreamPreview\(\)/);
  assert.doesNotMatch(previewSource, /runTransaction|setDoc|updateDoc/);
});

test('editor preview explains omitted invalid date rows', () => {
  assert.match(
    dashboard,
    /Complete valid start and end dates to preview[\s\S]*workstream/
  );
});

test('workstream row exposes a PDF summary group field independent of the interactive Gantt renderer', () => {
  assert.match(dashboard, /class="fi ws-summary-group"/);
  assert.match(dashboard, /aria-label="PDF summary group"/);
  assert.match(dashboard, />PDF summary group</);
  const collectSource = dashboard.slice(
    dashboard.indexOf('function collectWorkstreams()'),
    dashboard.indexOf('function collectSummaryLaneProgressOverrides()')
  );
  assert.match(collectSource, /summaryGroupId:\s*div\.querySelector\('\.ws-summary-group'\)\.value/);
});

test('the PDF summary lane progress panel is driven by distinct group labels and updates with the preview', () => {
  assert.match(dashboard, /function renderSummaryLaneProgressEditor\(\)/);
  assert.match(dashboard, /function collectSummaryLanes\(\)/);
  assert.match(dashboard, /id="summaryLaneProgressContainer"/);
  const previewSource = dashboard.slice(
    dashboard.indexOf('function renderWorkstreamEditorPreview()'),
    dashboard.indexOf('function clearWorkstreamErrors()')
  );
  assert.match(previewSource, /renderSummaryLaneProgressEditor\(\)/);
});

test('saving a project includes collected PDF summary lanes alongside the workstreams', () => {
  const saveSource = dashboard.slice(
    dashboard.indexOf('window.saveProjEdit = async'),
    dashboard.indexOf('let transactionResult = null;')
  );
  assert.match(saveSource, /ganttWorkstreams,\s*\n\s*pdfSummaryLanes:\s*collectSummaryLanes\(\)/);
});
