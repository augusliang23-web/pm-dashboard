import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { buildProjectManagerList } from '../js/dashboard-access.mjs';
import { createDisplayNameDirectory } from '../js/display-name-directory.mjs';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = dashboard.indexOf(`function ${name}(`);
  const end = dashboard.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} function must exist before ${nextName}`);
  return dashboard.slice(start, end);
}

test('authorized user snapshot supplies PM labels and email lookup without a public alias list', async () => {
  const directory = createDisplayNameDirectory();
  let snapshotCallback;
  const context = vm.createContext({
    displayNameDirectory: directory,
    PM_LIST: [],
    allWeeks: [],
    db: {},
    collection: () => ({}),
    onSnapshot: (_ref, callback) => {
      snapshotCallback = callback;
      return () => {};
    },
    buildProjectManagerList,
    stopProjectManagerSubscription: () => {},
    syncProjectManagerFilterOptions: () => {},
    render: () => {},
  });
  vm.runInContext(functionSource('getUserDisplayName', 'sectionUpdateLabel'), context);
  vm.runInContext(functionSource('startProjectManagerSubscription', 'setupUI'), context);

  const pending = context.startProjectManagerSubscription(() => true);
  snapshotCallback({ docs: [
    { id: 'robin.lee@example.test', data: () => ({ role: 'pm', displayName: 'Project Lead' }) },
    { id: 'kai.lin@example.test', data: () => ({ role: 'pm', displayName: 'Delivery Lead' }) },
  ] });
  await pending;

  assert.deepEqual(Array.from(context.PM_LIST), ['Delivery Lead', 'Project Lead']);
  assert.equal(context.getUserDisplayName('robin.lee@example.test'), 'Project Lead');
});
