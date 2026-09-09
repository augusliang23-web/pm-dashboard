import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const detailStart = html.indexOf('<div class="overlay" id="projDetailOverlay"');
const detailEnd = html.indexOf('<div class="overlay" id="onePageStatusModal"', detailStart);
const detail = html.slice(detailStart, detailEnd);

test('Single Project header removes the One-page Status entry point', () => {
  assert.ok(detailStart >= 0 && detailEnd > detailStart);
  assert.doesNotMatch(detail, /One-page Status/);
  assert.match(detail, /aria-label="Close project detail"/);
});

test('Single Project upper grid gives narrative two-thirds and Milestone one-third', () => {
  assert.match(
    html,
    /\.detail-grid\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(280px,\s*1fr\)/,
  );
  assert.match(
    html,
    /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.detail-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
});

test('post-milestone sections follow the approved full-width order', () => {
  const milestone = detail.indexOf('id="pd_milestones"');
  const schedule = detail.indexOf('id="pd_schedule"');
  const quarters = detail.indexOf('id="pd_quarterly_milestones"');
  const resources = detail.indexOf('id="pd_resources"');
  const team = detail.indexOf('id="pd_team_effort"');
  const budget = detail.indexOf('id="pd_budget_snapshot"');

  assert.ok(milestone >= 0);
  assert.ok(milestone < schedule);
  assert.ok(schedule < quarters);
  assert.ok(quarters < resources);
  assert.ok(resources < team);
  assert.ok(team < budget);
  assert.match(detail, /detail-full-width detail-resources-section/);
  assert.match(detail, /detail-full-width detail-resource-summary-section/);
});

test('team effort and budget snapshot use aligned semantic tables', () => {
  assert.match(detail, /class="detail-rb-table-wrap" id="pd_team_effort"/);
  assert.match(detail, /class="detail-rb-table-wrap" id="pd_budget_snapshot"/);
  assert.match(html, /class="detail-summary-table team-effort-table"/);
  assert.match(html, /<th>Name<\/th><th>Role<\/th><th>Allocation<\/th>/);
  assert.match(html, /class="detail-summary-table budget-snapshot-table"/);
  assert.match(html, /<th>Metric<\/th><th>Amount<\/th>/);
});

test('Gantt exposes descriptive scale controls and calendar guidance', () => {
  assert.match(html, />Weekly view<\/button>/);
  assert.match(html, />Monthly view<\/button>/);
  assert.match(html, /aria-pressed="\$\{ganttScale === 'week'\}"/);
  assert.match(html, /axis\.rangeLabel/);
  assert.match(html, /axis\.guidance/);
});

test('Gantt header and rows share calendar-axis positions', () => {
  assert.match(html, /buildGanttCalendarAxis\(min,\s*max,\s*ganttScale\)/);
  assert.match(html, /class="gantt-calendar-groups"/);
  assert.match(html, /class="gantt-calendar-ticks"/);
  assert.match(html, /class="gantt-grid-line"/);
  assert.match(html, /const gridLines = axis\.ticks\.map/);
  assert.doesNotMatch(
    html,
    /\.gantt-track\s*\{[^}]*repeating-linear-gradient/,
  );
});
