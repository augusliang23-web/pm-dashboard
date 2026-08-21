import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const renderStart = dashboard.indexOf("function renderProjectGantt(project, targetId = 'pd_schedule')");
const renderEnd = dashboard.indexOf('\nconst RESOURCE_LABELS', renderStart);
const renderer = dashboard.slice(renderStart, renderEnd);

test('root Gantt sticky behavior is scoped to detail and editor preview', () => {
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(dashboard, /#pd_schedule \.gantt-chart--interactive[\s\S]*#workstreamGanttPreview \.gantt-chart--interactive/);
  assert.match(dashboard, /max-height:min\(60vh,720px\)/);
  assert.match(dashboard, /\.gantt-axis--sticky[\s\S]*position:sticky[\s\S]*top:0/);
  assert.match(dashboard, /\.gantt-name--sticky[\s\S]*position:sticky[\s\S]*left:0/);
  assert.match(renderer, /targetId === 'pd_schedule'[\s\S]*targetId === 'workstreamGanttPreview'/);
  assert.doesNotMatch(dashboard, /#onePageGantt \.gantt-chart--interactive|#printReportGantt \.gantt-chart--interactive/);
});

test('root interactive bars expose dates, ARIA metadata, and no native tooltip', () => {
  assert.match(renderer, /formatStatusDate\(start\)/);
  assert.match(renderer, /formatStatusDate\(end\)/);
  assert.match(renderer, /data-gantt-tooltip="true"[\s\S]*data-gantt-workstream="\$\{escHtml\(row\.name\)\}/);
  assert.match(renderer, /data-gantt-progress="\$\{segments\.progress\}/);
  assert.match(renderer, /data-gantt-start="\$\{escHtml\(formattedStart\)\}"/);
  assert.match(renderer, /data-gantt-end="\$\{escHtml\(formattedEnd\)\}"/);
  assert.match(renderer, /tabindex="0" aria-label="\$\{escHtml\(barDescription\)\}/);
  assert.match(renderer, /const titleAttribute = isInteractiveScheduleTarget\s*\?\s*''/);
  assert.match(renderer, /escHtml\(row\.name\).*segments\.progress.*completed/);
});

test('root tooltip controller delegates hover focus Escape and scroll state', () => {
  for (const state of ['activeBar', 'hoveredBar', 'focusedBar', 'dismissedBar']) assert.ok(dashboard.includes(state));
  for (const eventName of ['pointerover', 'pointerout', 'focusin', 'focusout', 'keydown', 'scroll']) assert.ok(dashboard.includes(`'${eventName}'`));
  assert.match(dashboard, /id = 'ganttScheduleTooltip'/);
  assert.match(dashboard, /setAttribute\('role', 'tooltip'\)/);
  assert.match(dashboard, /event\.preventDefault\(\);\s*event\.stopImmediatePropagation\(\);/);
  assert.match(dashboard, /aria-describedby', 'ganttScheduleTooltip'/);
  assert.match(dashboard, /hideIfOwnedBy/);
});
