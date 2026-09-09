const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

test('Functions week carryover matches the active browser helper without shared references', async () => {
  let server;
  try {
    server = require('../week-carryover');
  } catch {
    server = {};
  }
  assert.equal(typeof server.copyPreviousWeekCarryover, 'function');
  const browser = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'week-carryover.mjs')).href);
  const source = {
    projects: [
      { code: 'ACTIVE', visibility: 'active', nested: { value: 1 } },
      { code: 'LEGACY', nested: { value: 2 } },
      { code: 'ARCHIVED', visibility: 'archived' },
    ],
    strategyLayer: { projectMap: { ACTIVE: { checkpoint: 'Q1' } } },
  };
  const expected = browser.copyPreviousWeekCarryover(source);
  const actual = server.copyPreviousWeekCarryover(source);
  assert.deepEqual(actual, expected);
  actual.projects[0].nested.value = 99;
  actual.strategyLayer.projectMap.ACTIVE.checkpoint = 'changed';
  assert.equal(source.projects[0].nested.value, 1);
  assert.equal(source.strategyLayer.projectMap.ACTIVE.checkpoint, 'Q1');
});
