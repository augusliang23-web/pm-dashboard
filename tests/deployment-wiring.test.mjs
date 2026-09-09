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
