import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('project detail places Gantt and quarterly milestones below the upper grid', () => {
  const gridStart = html.indexOf('<div class="detail-grid">');
  const gridEnd = html.indexOf('<section class="detail-full-width detail-schedule-section">', gridStart);
  const schedule = html.indexOf('id="pd_schedule"', gridStart);
  const quarters = html.indexOf('id="pd_quarterly_milestones"', gridStart);

  assert.ok(gridStart >= 0 && gridEnd > gridStart);
  assert.ok(schedule > gridEnd);
  assert.ok(quarters > schedule);
  assert.match(html, /\.detail-full-width\s*\{[^}]*min-width:\s*0/);
});

test('project detail quarterly milestones render Q1 through Q4 columns', () => {
  assert.match(html, /function formatDetailQuarterlyMilestones\(project\)[\s\S]*getQuarterLabelsForYear\(year\)/);
  assert.match(html, /class="detail-quarter-column"/);
  assert.match(html, /class="detail-quarter-heading"/);
  assert.match(html, /No milestone in this quarter\./);
});

test('overview orders portfolio and routes both attention controls through one transaction', () => {
  assert.match(html, /orderProjectsByAttention/);
  assert.match(html, /const portfolioProjects = orderProjectsByAttention\(projs, project => project\.attention\)/);
  assert.match(html, /portfolioProjects\.map\(p =>/);
  assert.match(html, /async function updateProjectAttention\(code, attention\)/);

  const bindStart = html.indexOf('function bindDecisionControls(editable)');
  const bindEnd = html.indexOf('// ── UTILS & ACTIONS ──', bindStart);
  const bindSource = html.slice(bindStart, bindEnd);
  assert.equal((bindSource.match(/await updateProjectAttention\(/g) || []).length, 2);
  assert.doesNotMatch(bindSource, /p\.attention\s*=/);
});

test('attention Callable commits server state to UI only after success', () => {
  const start = html.indexOf('async function updateProjectAttention(code, attention)');
  const end = html.indexOf('function bindDecisionControls(editable)', start);
  const source = html.slice(start, end);
  assert.match(source, /await projectDashboardApi\.setAttention\(\{ weekId, projectCode: code, attention \}\)/);
  assert.ok(source.indexOf('allWeeks[currentIdx] = result.week') > source.indexOf('await projectDashboardApi.setAttention'));
  assert.match(source, /render\(\)/);
});
