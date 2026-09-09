const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = readFileSync(path.resolve(__dirname, '..', 'project-dashboard-writes.js'), 'utf8');

test('releasing a week captures the current live Executive timeline in the same transaction', () => {
  assert.match(source, /liveTimelineRef\(database\(\)\)/);
  assert.match(source, /transaction\.get\(liveRef\)/);
  assert.match(source, /Executive milestones have not been initialized/);
  assert.match(source, /strategyLayer\.executiveMilestoneTimelineSnapshot/);
  assert.match(source, /snapshotFromLiveTimeline/);
});
