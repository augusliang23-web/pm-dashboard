import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const production = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Production uses confirmed release state with a protected Callable write', () => {
  assert.match(
    production,
    /import \{ confirmWeekMutation, getWriteErrorMessage \} from "\.\/sync-core\.js"/
  );
  assert.match(production, /await projectDashboardApi\.setWeekRelease\(\{ weekId: id, isReleased: newStatus \}\)/);
  assert.match(
    production,
    /finally\s*\{\s*releaseWriteInProgress = false;\s*hideLoader\(\)/s
  );
});

test('Production strategy save commits the server-returned week', () => {
  assert.match(production, /await projectDashboardApi\.saveWeekFields\(\{ weekId, fields: \{ strategyLayer \} \}\)/);
  assert.match(production, /allWeeks\[currentIdx\] = savedWeek/);
});

test('v2.1 serializes executive timeline cells for Firestore without discarding saved outcome metadata', () => {
  assert.match(
    production,
    /import \{ getExecutiveTimelineCell, serializeExecutiveMilestoneTimeline \} from "\.\/executive-timeline-core\.js"/
  );
  assert.match(
    production,
    /const cell = getExecutiveTimelineCell\(row\.cells, index\)/
  );
  assert.match(
    production,
    /serializeExecutiveMilestoneTimeline\(\s*collectExecutiveMilestoneTimeline\(\),\s*base\.executiveMilestoneTimeline\s*\)/
  );
});

test('Overview PDF picker wires Executive milestones before Quarterly Roadmap', () => {
  assert.ok(
    production.indexOf('value="executive-milestones"') < production.indexOf('value="quarterly-roadmap"')
  );
  assert.match(production, /id="executiveMilestoneAudienceView"/);
  assert.match(production, /executiveAudienceView/);
});

// Tests carried over from the UAT lineage (consolidation).
test('root dashboard exposes the v2.2T release identity', () => {
  assert.match(production, /const DASHBOARD_RELEASE = 'v2\.2T';/);
  assert.match(production, /const DASHBOARD_BASE_COMMIT = '[0-9a-f]+';/);
  assert.match(production, /id="dashboardVersion"/);
  assert.match(production, /environment: 'v2\.2T'/);
});

test('v2.2T uses confirmed protected release writes', () => {
  assert.match(
    production,
    /import \{ confirmWeekMutation, getWriteErrorMessage \} from "\.\/sync-core\.js"/
  );
  assert.match(production, /await projectDashboardApi\.setWeekRelease\(\{ weekId: id, isReleased: newStatus \}\)/);
  assert.doesNotMatch(production, /await updateDoc\(doc\(db, "weeks", id\), \{/);
  assert.match(
    production,
    /finally\s*\{\s*releaseWriteInProgress = false;\s*hideLoader\(\)/s
  );
});

test('v2.0 strategy save commits a clone after confirmation', () => {
  assert.match(production, /const savedWeek = await confirmWeekMutation\(/);
  assert.match(production, /allWeeks\[currentIdx\] = savedWeek/);
});

test('v2.2T keeps Executive timeline cells out of the legacy strategy save path', () => {
  assert.match(
    production,
    /import \{ getExecutiveTimelineCell \} from "\.\/executive-timeline-core\.js"/
  );
  assert.match(
    production,
    /const cell = getExecutiveTimelineCell\(row\.cells, index\)/
  );
  assert.match(
    production,
    /const strategyLayer = \{\s*\.\.\.\(week\.strategyLayer \|\| \{\}\),\s*projectMap\s*\}/
  );
});
