import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { buildProjectManagerList } from '../js/dashboard-access.mjs';
import { createDisplayNameDirectory } from '../js/display-name-directory.mjs';

const dashboard = await dashboardSourceAsync('uat');

function functionSource(name, nextName) {
  const start = dashboard.indexOf(`function ${name}(`);
  const end = dashboard.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} function must exist before ${nextName}`);
  return dashboard.slice(start, end);
}

function sourceBetween(startText, endText) {
  const start = dashboard.indexOf(startText);
  const end = dashboard.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing dashboard section: ${startText}`);
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

test('a later user-directory read error drops cached names and PM options', async () => {
  const directory = createDisplayNameDirectory();
  let snapshotCallback;
  let errorCallback;
  const context = vm.createContext({
    displayNameDirectory: directory,
    PM_LIST: [],
    allWeeks: [],
    db: {},
    collection: () => ({}),
    onSnapshot: (_ref, onNext, onError) => {
      snapshotCallback = onNext;
      errorCallback = onError;
      return () => {};
    },
    buildProjectManagerList,
    stopProjectManagerSubscription: () => {},
    syncProjectManagerFilterOptions: () => {},
    render: () => {},
    console: { warn: () => {} },
  });
  vm.runInContext(functionSource('getUserDisplayName', 'sectionUpdateLabel'), context);
  vm.runInContext(functionSource('startProjectManagerSubscription', 'setupUI'), context);

  const pending = context.startProjectManagerSubscription(() => true);
  snapshotCallback({ docs: [
    { id: 'robin.lee@example.test', data: () => ({ role: 'pm', displayName: 'Project Lead' }) },
  ] });
  await pending;
  assert.equal(context.getUserDisplayName('robin.lee@example.test'), 'Project Lead');

  errorCallback(new Error('permission revoked'));
  assert.deepEqual(Array.from(context.PM_LIST), []);
  assert.equal(context.getUserDisplayName('robin.lee@example.test'), 'Robin');
});

test('authenticated header renders the stored directory display name', () => {
  const directory = createDisplayNameDirectory();
  directory.replace([
    { id: 'robin.lee@example.test', displayName: 'Project Lead' },
  ]);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        classList: { add() {}, remove() {} },
        className: '',
        disabled: false,
        innerHTML: '',
        style: {},
        textContent: '',
      });
    }
    return elements.get(id);
  };
  const context = vm.createContext({
    displayNameDirectory: directory,
    document: { getElementById: element, querySelectorAll: () => [] },
    currentUser: { email: 'robin.lee@example.test' },
    currentRole: 'pm',
    DASHBOARD_RELEASE: 'test',
    DASHBOARD_BASE_COMMIT: 'test',
    getEmailKey: user => typeof user === 'string' ? user.toLowerCase() : user.email.toLowerCase(),
    canReadDraftWeeks: () => true,
    invalidateProjectEditorSession: () => {},
    invalidateGanttTemplateSession: () => {},
    loadOverviewScopeForCurrentUser: () => {},
    syncProjectManagerFilterOptions: () => {},
    updateMasterDataLists: () => {},
    refreshExecutivePendingCount: () => {},
    refreshFxRates: () => {},
  });
  vm.runInContext(functionSource('getUserDisplayName', 'sectionUpdateLabel'), context);
  vm.runInContext(sourceBetween('function setupUI()', '// ── DATA ──'), context);

  context.setupUI();

  assert.equal(element('displayUser').textContent, 'Project Lead');
});
