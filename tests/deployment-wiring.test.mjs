import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const production = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const testVersion = await readFile(new URL('../team-2/index.html', import.meta.url), 'utf8');

test('v2.0 uses confirmed immutable release writes', () => {
  assert.match(
    production,
    /import \{ confirmWeekMutation, getWriteErrorMessage \} from "\.\/sync-core\.js"/
  );
  assert.match(production, /await updateDoc\(doc\(db, "weeks", id\), \{/);
  assert.match(
    production,
    /finally\s*\{\s*releaseWriteInProgress = false;\s*hideLoader\(\)/s
  );
});

test('v2.0 strategy save commits a clone after confirmation', () => {
  assert.match(production, /const savedWeek = await confirmWeekMutation\(/);
  assert.match(production, /allWeeks\[currentIdx\] = savedWeek/);
});

test('v2.0 serializes executive timeline cells for Firestore', () => {
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
    /serializeExecutiveMilestoneTimeline\(collectExecutiveMilestoneTimeline\(\)\)/
  );
});

test('v2.0T uses confirmed immutable release writes', () => {
  assert.match(
    testVersion,
    /import \{ confirmWeekMutation, getWriteErrorMessage \} from "\.\.\/sync-core\.js"/
  );
  assert.match(testVersion, /await updateDoc\(doc\(db, "weeks", id\), \{/);
  assert.match(
    testVersion,
    /finally\s*\{\s*releaseWriteInProgress = false;\s*hideLoader\(\)/s
  );
});

test('v2.0T strategy save commits a clone after confirmation', () => {
  assert.match(testVersion, /const savedWeek = await confirmWeekMutation\(/);
  assert.match(testVersion, /allWeeks\[currentIdx\] = savedWeek/);
});
