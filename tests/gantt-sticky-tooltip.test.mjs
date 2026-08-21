import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const renderStart = dashboard.indexOf("function renderProjectGantt(project, targetId = 'pd_schedule')");
const renderEnd = dashboard.indexOf('\nconst RESOURCE_LABELS', renderStart);
const renderer = dashboard.slice(renderStart, renderEnd);

test('root Schedule scopes two-axis sticky behavior to detail and editor preview', () => {
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(dashboard, /#pd_schedule \.gantt-chart--interactive[\s\S]*#workstreamGanttPreview \.gantt-chart--interactive/);
  assert.match(dashboard, /max-height:\s*min\(60vh,\s*720px\)/);
  assert.match(dashboard, /overflow:\s*auto/);
  assert.match(dashboard, /\.gantt-axis--sticky[\s\S]*position:\s*sticky[\s\S]*top:\s*0/);
  assert.match(dashboard, /\.gantt-axis-label--sticky\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*left:\s*0[^}]*z-index:\s*(?:[2-9]|[1-9]\d*)[^}]*background:/);
  assert.match(dashboard, /\.gantt-name--sticky\s*\{[^}]*position:\s*sticky[^}]*left:\s*0[^}]*z-index:\s*(?:[2-9]|[1-9]\d*)[^}]*background:/);
  assert.match(dashboard, /\.gantt-axis--sticky\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*z-index:\s*(?:[2-9]|[1-9]\d*)[^}]*background:/);
  assert.match(renderer, /targetId === 'pd_schedule'[\s\S]*targetId === 'workstreamGanttPreview'/);
  assert.doesNotMatch(dashboard, /#onePageGantt \.gantt-chart--interactive|#printReportGantt \.gantt-chart--interactive/);
});

test('root interactive bars expose dates and keyboard metadata without a native tooltip', () => {
  const rowRenderStart = renderer.indexOf('rows.map(row => {');
  const rowRenderer = renderer.slice(rowRenderStart, renderer.indexOf('}).join', rowRenderStart));
  assert.ok(rowRenderStart >= 0 && rowRenderer.length > 0);
  const interactiveGateMatch = renderer.match(/(?:const|let)\s+isInteractiveScheduleTarget\s*=\s*[\s\S]{0,600}?;|function\s+isInteractiveScheduleTarget\s*\([^)]*\)\s*\{[\s\S]{0,800}?\}/);
  assert.ok(interactiveGateMatch, 'renderer must define the interactive target gate');
  const interactiveGate = interactiveGateMatch[0];
  assert.match(interactiveGate, /pd_schedule/);
  assert.match(interactiveGate, /workstreamGanttPreview/);
  assert.doesNotMatch(interactiveGate, /onePageGantt|printReportGantt/);
  const gateTargetLiterals = [...interactiveGate.matchAll(/['"]([^'\"]*(?:Gantt|schedule)[^'\"]*)['"]/gi)].map(match => match[1]);
  assert.deepEqual(new Set(gateTargetLiterals), new Set(['pd_schedule', 'workstreamGanttPreview']));
  const startDateBinding = rowRenderer.match(/(?:const|let)\s+(\w*start\w*)\s*=\s*formatStatusDate\(([^)]*)\)/i);
  const endDateBinding = rowRenderer.match(/(?:const|let)\s+(\w*end\w*)\s*=\s*formatStatusDate\(([^)]*)\)/i);
  assert.ok(startDateBinding, 'renderer must format a named start date value');
  assert.ok(endDateBinding, 'renderer must format a named end date value');
  assert.match(startDateBinding[2], /\b(?:row\.)?(?:start|startDate)\b/i);
  assert.match(endDateBinding[2], /\b(?:row\.)?(?:end|endDate)\b/i);
  assert.match(rowRenderer, new RegExp(`data-gantt-start="[^"\\n]*\\$\\{[^}]*\\b${startDateBinding[1]}\\b[^}]*\\}`));
  assert.match(rowRenderer, new RegExp(`data-gantt-end="[^"\\n]*\\$\\{[^}]*\\b${endDateBinding[1]}\\b[^}]*\\}`));
  assert.match(rowRenderer, /data-gantt-tooltip="true"[\s\S]*data-gantt-workstream="\$\{[^}]*row\.name/);
  assert.match(rowRenderer, /data-gantt-progress="\$\{[^}]*segments\.progress/);
  const barAttributesBinding = rowRenderer.match(/const\s+barAttributes\s*=\s*isInteractiveScheduleTarget\s*\?\s*([\s\S]{0,700}?)(?:\n\s*:|;)/);
  assert.ok(barAttributesBinding, 'renderer must define conditional interactive bar attributes');
  assert.match(barAttributesBinding[1], /data-gantt-tooltip="true"/);
  assert.match(barAttributesBinding[1], /data-gantt-workstream="\$\{[^}]*row\.name/);
  const interactiveBar = rowRenderer.slice(rowRenderer.indexOf('data-gantt-tooltip="true"'), rowRenderer.indexOf('</span>', rowRenderer.indexOf('data-gantt-tooltip="true"')));
  assert.match(interactiveBar, /tabindex="0"/);
  assert.match(interactiveBar, /aria-label=/);
  for (const semanticField of ['row.name', 'segments.progress', 'Start', 'End']) {
    assert.ok(interactiveBar.includes(semanticField), `accessible bar label must expose ${semanticField}`);
  }
  const interactiveBarTagMatch = rowRenderer.match(/<span\b(?=[^>]*\bgantt-bar\b)[^>]*>/);
  assert.ok(interactiveBarTagMatch, 'renderer must emit a workstream bar opening tag');
  assert.match(interactiveBarTagMatch[0], /\$\{\s*barAttributes\s*\}/);
  assert.doesNotMatch(interactiveBarTagMatch[0], /\/\*\s*data-gantt-tooltip="true"\s*\*\//);
  const titleAttributeBinding = rowRenderer.match(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*isInteractiveScheduleTarget\s*\?\s*(['"]{2}|null|undefined)\s*:\s*([\s\S]{0,500}?)(?:;|\n)/);
  assert.ok(titleAttributeBinding, 'renderer must define a conditional native-title attribute value');
  assert.ok(['""', "''", 'null', 'undefined'].includes(titleAttributeBinding[2]), 'interactive title arm must be empty');
  assert.match(titleAttributeBinding[3], /title\s*=\s*['"][^'\"]*['"]/);
  assert.match(titleAttributeBinding[3], /escHtml\([^)]*row\.name/);
  assert.match(interactiveBarTagMatch[0], new RegExp(`\\$\\{\\s*${titleAttributeBinding[1]}\\s*\\}`));
  assert.match(dashboard, /renderProjectGantt\([^)]*,\s*['"]onePageGantt['"]\)/);
  assert.match(dashboard, /renderProjectGantt\([^)]*,\s*['"]printReportGantt['"]\)/);
  assert.match(rowRenderer, /gantt-milestone[\s\S]*title="\$\{escHtml\(/);
  assert.doesNotMatch(rowRenderer, /aria-describedby="ganttScheduleTooltip"/);
});

test('root tooltip controller delegates hover focus Escape and scroll state', () => {
  assert.match(dashboard, /id\s*=\s*["']ganttScheduleTooltip["']/);
  assert.match(dashboard, /setAttribute\(["']role["'],\s*["']tooltip["']\)/);
  for (const state of ['activeBar', 'hoveredBar', 'focusedBar', 'dismissedBar']) {
    assert.ok(dashboard.includes(state), `${state} must be explicit controller state`);
  }
  for (const eventName of ['pointerover', 'pointerout', 'focusin', 'focusout', 'keydown', 'scroll']) {
    assert.ok(dashboard.includes(`'${eventName}'`), `${eventName} must be delegated`);
  }
  assert.match(dashboard, /pointerover[\s\S]{0,1400}(?:dismissedBar\s*=\s*null|dismissedBar\s*===\s*null)[\s\S]{0,700}activeBar/);
  assert.match(dashboard, /focusin[\s\S]{0,1400}(?:dismissedBar\s*=\s*null|dismissedBar\s*===\s*null)[\s\S]{0,700}activeBar/);
  assert.match(dashboard, /pointerout[\s\S]{0,1800}(?:if\s*\([^)]*focusedBar|focusedBar\s*\?)[\s\S]{0,900}(?:hoveredBar|syncTooltip\(\))/);
  assert.match(dashboard, /focusout[\s\S]{0,1800}(?:if\s*\([^)]*hoveredBar|hoveredBar\s*\?)[\s\S]{0,900}(?:focusedBar|syncTooltip\(\))/);
  assert.match(dashboard, /key\s*!==?\s*["']Escape["']|key\s*===\s*["']Escape["']/);
  assert.match(dashboard, /Escape[\s\S]{0,700}dismissedBar\s*=\s*activeBar[\s\S]{0,700}hide\(\)/);
  assert.match(dashboard, /if\s*\(event\.key\s*!==\s*["']Escape["']\s*\|\|\s*!activeBar\)\s*return;[\s\S]{0,240}event\.preventDefault\(\);[\s\S]{0,160}event\.stopImmediatePropagation\(\);/);
  assert.match(dashboard, /(?:function\s+hide|(?:const|let)\s+hide\s*=)[\s\S]{0,1200}activeBar\.removeAttribute\(["']aria-describedby["']\)[\s\S]{0,300}activeBar\s*=\s*(?:null|undefined)/);
  assert.match(dashboard, /activeBar[\s\S]{0,700}setAttribute\(["']aria-describedby["'],\s*["']ganttScheduleTooltip["']\)/);
  assert.match(dashboard, /getBoundingClientRect\(\)/);
  assert.match(dashboard, /window\.innerWidth/);
  assert.match(dashboard, /window\.innerHeight/);
  assert.match(dashboard, /hideIfOwnedBy/);
});
