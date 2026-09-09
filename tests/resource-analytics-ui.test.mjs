import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Overview resource analytics shows executive KPIs and aggregated charts', () => {
  for (const label of [
    'Total Allocated FTE',
    'Allocation Coverage',
    'Overallocated People',
    'Available Capacity',
    'FTE by project level',
    'Function allocation by known capacity',
  ]) {
    assert.ok(dashboard.includes(label));
  }
  assert.ok(dashboard.includes('buildResourceAnalytics(resourceProjects)'));
  assert.ok(dashboard.includes('getResourceAnalyticsProjects(projects)'));
  assert.ok(dashboard.includes('class="resource-level-donut"'));
  assert.ok(dashboard.includes('class="resource-function-track"'));
  assert.ok(dashboard.includes('normalizeResourceFunctionRow(item)'));
  assert.ok(dashboard.includes('metrics.allocatedPeople}/${metrics.knownPeople} people'));
  assert.ok(dashboard.includes('metrics.utilizationPct'));
});

test('resource analytics never renders undefined function capacity values', () => {
  assert.ok(dashboard.includes('function normalizeResourceFunctionRow(item = {})'));
  assert.doesNotMatch(dashboard, /\$\{item\.allocatedPeople\}\/\$\{item\.knownPeople\}/);
  assert.doesNotMatch(dashboard, /\$\{item\.utilizationPct\}%/);
  assert.doesNotMatch(dashboard, /\$\{item\.totalFte\}\/\$\{item\.capacityFte\}/);
});

test('Project portfolio cards include a compact per-project resource snapshot', () => {
  assert.ok(dashboard.includes('function summarizeProjectResourceSnapshot(project = {})'));
  assert.ok(dashboard.includes('class="exec-resource-snapshot"'));
  assert.ok(dashboard.includes('Resource load'));
  assert.ok(dashboard.includes('snapshot.topRoles'));
});

test('Overview resource analytics includes pending team allocations while keeping maturity counts', () => {
  const start = dashboard.indexOf('function getResourceAnalyticsProjects(');
  const end = dashboard.indexOf('function getConfirmedBudgetPlanProjects', start);
  const source = dashboard.slice(start, end);
  assert.match(source, /teamMembers\?\.length/);
  assert.match(source, /status\.team\.noAllocationRequired/);
  assert.doesNotMatch(source, /status\.team\.state === 'confirmed'/);
  assert.ok(dashboard.includes('pending included'));
});

test('Overview resource analytics no longer renders a member-name list', () => {
  const start = dashboard.indexOf('function renderResourceBudgetOverview(');
  const end = dashboard.indexOf('\n}', start) + 2;
  const source = dashboard.slice(start, end);
  assert.doesNotMatch(source, /resources\.slice/);
  assert.doesNotMatch(source, /r\.name/);
});

test('Resource analytics and budget render after the project portfolio', () => {
  const execStart = dashboard.indexOf('function renderExec(');
  const execEnd = dashboard.indexOf('async function saveCurrentWeekQuietly()', execStart);
  const source = dashboard.slice(execStart, execEnd);
  assert.ok(source.lastIndexOf('renderResourceBudgetOverview(projs)') > source.indexOf('project-portfolio-panel'));
});
