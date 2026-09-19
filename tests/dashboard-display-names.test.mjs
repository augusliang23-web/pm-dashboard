import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { createDisplayNameDirectory } from '../js/display-name-directory.mjs';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function sourceBetween(startText, endText) {
  const start = dashboard.indexOf(startText);
  const end = dashboard.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing dashboard section: ${startText}`);
  return dashboard.slice(start, end);
}

test('directory read returns authorized records and never invents a fixed PM list on failure', async () => {
  const directory = createDisplayNameDirectory();
  let readFails = false;
  const context = vm.createContext({
    displayNameDirectory: directory,
    db: {},
    collection: () => ({}),
    getDocs: async () => {
      if (readFails) throw new Error('offline');
      return { docs: [{ id: 'robin.lee@example.test', data: () => ({ role: 'pm', displayName: 'Project Lead' }) }] };
    },
    normalizeRole: role => String(role).toLowerCase(),
    console: { warn: () => {} },
  });
  vm.runInContext(sourceBetween('function getUserDisplayName(', 'function sectionUpdateLabel('), context);
  vm.runInContext(sourceBetween('async function fetchDynamicPMList(', 'function setupUI('), context);

  const loaded = await context.fetchDynamicPMList();
  assert.equal(loaded.available, true);
  assert.equal(loaded.accounts[0].displayName, 'Project Lead');
  directory.replace(loaded.accounts);
  assert.equal(context.getUserDisplayName('robin.lee@example.test'), 'Project Lead');

  readFails = true;
  const unavailable = await context.fetchDynamicPMList();
  assert.equal(unavailable.available, false);
  assert.deepEqual(Array.from(unavailable.accounts), []);
});

test('presence names are escaped before entering HTML', () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element },
    escHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  });
  vm.runInContext(sourceBetween('function renderOnlineUsers(', "window.addEventListener('beforeunload'"), context);

  context.renderOnlineUsers([{ name: '<img src=x>', idle: false }]);
  assert.doesNotMatch(element('onlineUsersList').innerHTML, /<img/);
  assert.match(element('onlineUsersList').innerHTML, /&lt;img src=x&gt;/);
});

test('PM selector treats a stored label as text in both value and caption', () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element, querySelectorAll: () => [] },
    currentUser: { email: 'robin@example.test' },
    currentRole: 'pm',
    PM_LIST: ['<img src=x>'],
    DASHBOARD_RELEASE: 'test',
    DASHBOARD_BASE_COMMIT: 'test',
    getEmailKey: user => user.email,
    getUserDisplayName: email => String(email).split('@')[0],
    invalidateProjectEditorSession: () => {},
    invalidateGanttTemplateSession: () => {},
    loadOverviewScopeForCurrentUser: () => {},
    updateMasterDataLists: () => {},
    refreshFxRates: () => {},
    escHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  });
  vm.runInContext(sourceBetween('function setupUI(', '// ── DATA ──'), context);

  context.setupUI();
  assert.doesNotMatch(element('topPmSelect').innerHTML, /<img/);
  assert.match(element('topPmSelect').innerHTML, /&lt;img src=x&gt;/);
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
    PM_LIST: [],
    DASHBOARD_RELEASE: 'test',
    DASHBOARD_BASE_COMMIT: 'test',
    getEmailKey: user => typeof user === 'string' ? user.toLowerCase() : user.email.toLowerCase(),
    invalidateProjectEditorSession: () => {},
    invalidateGanttTemplateSession: () => {},
    loadOverviewScopeForCurrentUser: () => {},
    updateMasterDataLists: () => {},
    refreshFxRates: () => {},
    escHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  });
  vm.runInContext(sourceBetween('function getUserDisplayName(', 'function sectionUpdateLabel('), context);
  vm.runInContext(sourceBetween('function setupUI(', '// ── DATA ──'), context);

  context.setupUI();

  assert.equal(element('displayUser').textContent, 'Project Lead');
});
