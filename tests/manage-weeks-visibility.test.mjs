// Production Pages port of the canonical main Manage Weeks capability contract (week.manage): the header Manage
// Weeks control, openWeekManagement(), saveWeekSummary() and createNewWeekFromManage() are available only when the
// effective week.manage capability is true -- raw-role Admin by default, or any other recognized role with an
// explicit per-user override. Release / Revert keeps its Admin/PM perspective contract. These tests execute the
// real Pages getDashboardRole, canCurrentUser, setupUI, initData and Manage Weeks globals in a VM against the real
// js/permission-registry.mjs resolver.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { can, normalizePermissionOverrides } from '../js/permission-registry.mjs';

const PAGES = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function sliceBody(startMarker, endMarker) {
  const start = PAGES.indexOf(startMarker);
  assert.ok(start >= 0, `Pages must define ${startMarker}`);
  const end = PAGES.indexOf(endMarker, start);
  assert.ok(end > start, `Pages must close ${startMarker}`);
  return PAGES.slice(start, end + endMarker.length);
}

const BODIES = {
  getDashboardRole: sliceBody('function getDashboardRole(', '\n}\n'),
  canCurrentUser: sliceBody('function canCurrentUser(', '\n}\n'),
  setupUI: sliceBody('function setupUI(', '\n}\n'),
  initData: sliceBody('function initData(', '\n}\n'),
  openWeekManagement: sliceBody('window.openWeekManagement = () => {', '\n};\n'),
  saveWeekSummary: sliceBody('window.saveWeekSummary = async () => {', '\n};\n'),
  createNewWeekFromManage: sliceBody('window.createNewWeekFromManage = async () => {', '\n};\n'),
};

function stubElement(classes = []) {
  return {
    style: {}, textContent: '', innerHTML: '', value: '', disabled: false, dataset: {}, className: '',
    classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, __classes: classes,
  };
}

function makeDom() {
  const elements = new Map();
  // Mirror the Pages markup classes.
  elements.set('manageWeeksBtn', stubElement(['vip-hidden']));
  elements.set('userPermissionsBtn', stubElement(['admin-only', 'vip-hidden']));
  elements.set('topPmSelect', stubElement(['vip-hidden']));
  elements.set('btnOverview', stubElement(['vip-hidden']));
  elements.set('addProjectBtn', stubElement(['admin-only']));
  elements.set('ganttTemplateSettingsBtn', stubElement(['admin-only']));
  const element = id => {
    if (!elements.has(id)) elements.set(id, stubElement());
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    createElement: () => stubElement(),
    querySelectorAll: selector => {
      const cls = selector.startsWith('.') ? selector.slice(1) : '';
      return cls ? [...elements.values()].filter(el => el.__classes.includes(cls)) : [];
    },
  };
  return { document, element };
}

function setupContext(rawRole, overrides = {}) {
  const dom = makeDom();
  const calls = { modal: [], api: [], loader: [], toast: [], queries: [] };
  const context = vm.createContext({
    window: {},
    console,
    document: dom.document,
    currentRole: 'pm',
    currentRawRole: null,
    currentPermissionOverrides: normalizePermissionOverrides(overrides),
    currentUser: { uid: 'uid', email: 'tester@example.com' },
    allWeeks: [{ weekLabel: 'W1 2026', weekDate: 'Jan 1 - Jan 5', summary: '', projects: [] }],
    currentIdx: 0,
    jumpToLatestOnNextRender: false,
    PM_LIST: [],
    isOverview: false,
    isAdminVipPreview: false,
    DASHBOARD_RELEASE: 'v2.1',
    DASHBOARD_BASE_COMMIT: 'test',
    canWithPermissions: can,
    invalidateProjectEditorSession() {}, invalidateGanttTemplateSession() {}, invalidateGanttWindowSession() {},
    loadOverviewScopeForCurrentUser() {}, getUserDisplayName: () => 'Tester', getEmailKey: user => user?.email || 'tester',
    escHtml: value => value, updateMasterDataLists() {}, refreshFxRates() {},
    setWeeklySummaryValidation() {},
    normalizeWeeklySummaryForSave: () => ({ ok: true, canonicalText: 'Summary', corrections: [] }),
    summaryProjectContext: () => ({}),
    showWeeklySummaryCorrections() {},
    getIsoWeekData: () => ({ label: 'W2 2026', dateStr: 'Jan 8 - Jan 12' }),
    updateCopilotPrompt() {},
    openAccessibleModal: overlay => calls.modal.push(overlay),
    closeModal() {},
    showLoader: text => calls.loader.push(`show:${text}`),
    hideLoader: () => calls.loader.push('hide'),
    showSaveToast: (message, options) => calls.toast.push({ message, type: options?.type || 'success' }),
    getCallableErrorMessage: (_error, fallback) => fallback,
    setTimeout: callback => callback(),
    projectDashboardApi: {
      saveWeekFields: async data => { calls.api.push(['saveWeekFields', data]); return {}; },
      createWeek: async data => { calls.api.push(['createWeek', data]); return { week: { weekLabel: data.weekLabel } }; },
    },
    weeksUnsub: null,
    authSessionGeneration: 1,
    db: {},
    collection: (_db, name) => ({ collection: name }),
    query: (ref, constraint) => ({ ...ref, constraint }),
    where: (field, operator, value) => ({ type: 'where', field, operator, value }),
    orderBy: field => ({ type: 'orderBy', field }),
    isAuthInitializationCurrent: () => true,
    onSnapshot: ref => { calls.queries.push(ref); return () => {}; },
  });
  context.window.updateWmDate = () => {};
  vm.runInContext([
    ...Object.values(BODIES),
    'this.setupUI = setupUI; this.getDashboardRole = getDashboardRole; this.canCurrentUser = canCurrentUser; this.initData = initData;',
  ].join('\n'), context);
  context.currentRole = context.getDashboardRole({ exists: () => true, data: () => ({ role: rawRole }) });
  return { context, dom, calls };
}

// [raw Firestore role, overrides, expected effective week.manage]. Admin keeps week.manage even with stale false;
// every other recognized role -- including VIP and Executive Owner -- needs an explicit boolean true.
const MATRIX = [
  ['admin', {}, true],
  ['admin', { 'week.manage': false }, true],
  ['ADMIN', {}, true],
  ['pm', {}, false],
  ['pm', { 'week.manage': false }, false],
  ['pm', { 'week.manage': true }, true],
  ['pm', { 'week.manage': 'true' }, false],
  ['engineering', {}, false],
  ['engineering', { 'week.manage': true }, true],
  ['sales', {}, false],
  ['sales', { 'week.manage': true }, true],
  ['bd', { 'week.manage': true }, true],
  ['business', {}, false],
  ['business', { 'week.manage': true }, true],
  ['product', { 'week.manage': true }, true],
  ['vip', {}, false],
  ['vip', { 'week.manage': true }, true],
  ['executive', {}, false],
  ['executive', { 'week.manage': true }, true],
];
const label = (role, overrides) => `pages ${role} ${JSON.stringify(overrides)}`;

test('the Pages Manage Weeks button keeps its vip-hidden header markup', () => {
  assert.match(PAGES, /<button id="manageWeeksBtn" class="btn-icon vip-hidden" onclick="openWeekManagement\(\)"/);
});

test('Pages setupUI shows Manage Weeks only for effective week.manage', () => {
  for (const [role, overrides, allowed] of MATRIX) {
    const { context, dom } = setupContext(role, overrides);
    context.setupUI();
    assert.equal(dom.element('manageWeeksBtn').style.display, allowed ? '' : 'none', label(role, overrides));
  }
});

test('Pages setupUI re-hides Manage Weeks when a delegated session is replaced by one without the override', () => {
  const { context, dom } = setupContext('pm', { 'week.manage': true });
  context.setupUI();
  assert.equal(dom.element('manageWeeksBtn').style.display, '');
  context.currentPermissionOverrides = {};
  context.setupUI();
  assert.equal(dom.element('manageWeeksBtn').style.display, 'none');
});

test('no signed-in user resolves no capability, even with a stale Admin raw role', () => {
  const { context } = setupContext('admin');
  context.currentUser = null;
  assert.equal(context.canCurrentUser('week.manage'), false);
  assert.equal(context.canCurrentUser('permissions.manage'), false);
});

test('Pages Manage Weeks entry points open or write only with effective week.manage and fail closed otherwise', async () => {
  for (const [role, overrides, allowed] of MATRIX) {
    const { context, dom, calls } = setupContext(role, overrides);
    assert.doesNotThrow(() => context.window.openWeekManagement());
    dom.element('wm_nw_label').value = 'W2 2026';
    await context.window.saveWeekSummary();
    await context.window.createNewWeekFromManage();
    if (allowed) {
      assert.equal(calls.modal.length, 1, label(role, overrides));
      assert.deepEqual(calls.api.map(([name]) => name), ['saveWeekFields', 'createWeek'], label(role, overrides));
    } else {
      assert.deepEqual(calls.modal, [], label(role, overrides));
      assert.deepEqual(calls.api, [], label(role, overrides));
      assert.deepEqual(calls.loader, [], `${label(role, overrides)} must not show a loader`);
      assert.equal(dom.element('wm_current_title').textContent, '', `${label(role, overrides)} must not populate the editor`);
      assert.equal(context.jumpToLatestOnNextRender, false);
    }
  }
});

test('each Pages Manage Weeks entry point checks week.manage before touching any state', () => {
  for (const name of ['openWeekManagement', 'saveWeekSummary', 'createNewWeekFromManage']) {
    const lines = BODIES[name].split('\n');
    assert.equal(lines[1].trim(), "if (!canCurrentUser('week.manage')) return;", `${name} guard must be the first statement`);
    assert.doesNotMatch(BODIES[name], /canReadDraftWeeks/);
  }
  assert.match(BODIES.setupUI, /document\.getElementById\('manageWeeksBtn'\)\.style\.display = canCurrentUser\('week\.manage'\) \? '' : 'none';/);
});

test('a delegated VIP/Executive sees Manage Weeks but keeps the VIP perspective and no Admin controls', () => {
  for (const role of ['vip', 'executive']) {
    for (const granted of [true, false]) {
      const { context, dom } = setupContext(role, granted ? { 'week.manage': true } : {});
      context.setupUI();
      const name = `${role} granted=${granted}`;
      assert.equal(context.currentRole, 'vip', name);
      assert.equal(dom.element('manageWeeksBtn').style.display, granted ? '' : 'none', name);
      for (const id of ['addProjectBtn', 'ganttTemplateSettingsBtn', 'userPermissionsBtn', 'presenceUsageBtn']) {
        assert.equal(dom.element(id).style.display, 'none', `${name}: ${id} stays hidden`);
      }
      assert.equal(context.isOverview, true, name);
      assert.equal(dom.element('normalView').style.display, 'none', name);
      assert.equal(dom.element('execView').style.display, 'block', name);
      assert.equal(dom.element('topPmSelect').style.display, 'none', `${name}: other vip-hidden controls stay hidden`);
    }
  }
});

test('Pages week query keeps the legacy all-weeks baseline and adds drafts only for a delegated VIP perspective', () => {
  const ALL = { type: 'orderBy', field: 'weekLabel' };
  const RELEASED = { type: 'where', field: 'isReleased', operator: '==', value: true };
  for (const [role, overrides, allowed] of MATRIX) {
    const { context, calls } = setupContext(role, overrides);
    context.initData(1, context.currentUser);
    const baseline = !['vip', 'executive'].includes(role);
    assert.deepEqual(calls.queries.find(ref => ref.collection === 'weeks').constraint, baseline || allowed ? ALL : RELEASED, label(role, overrides));
  }
});

test('Release / Revert keeps the Admin/PM perspective contract and is not folded into week.manage', () => {
  const toggle = sliceBody('window.toggleReleaseWeek = async () => {', '\n};\n');
  assert.equal(toggle.split('\n')[1].trim(), 'if (!canReadDraftWeeks(currentRole)) return;');
  assert.doesNotMatch(toggle, /week\.manage/);
  assert.match(PAGES, /\$\{canReadDraftWeeks\(currentRole\) \? '<button class="btn btn-primary" onclick="toggleReleaseWeek\(\)"/);
  assert.match(sliceBody('function canReadDraftWeeks(', '\n}\n'), /return role === 'admin' \|\| role === 'pm';/);
});

test('Pages declares the permission state, helpers and registry import at module scope', () => {
  for (const declaration of [
    /^let currentRawRole = null;$/m,
    /^let currentPermissionOverrides = \{\};$/m,
    /^function canCurrentUser\(capability\) \{$/m,
    /^function resetCurrentUserPermissions\(\) \{$/m,
    /^async function loadCurrentUserPermissionOverrides\(email\) \{$/m,
    /^import \{ can as canWithPermissions, normalizePermissionOverrides \} from "\.\/js\/permission-registry\.mjs";$/m,
  ]) {
    assert.match(PAGES, declaration);
  }
  assert.equal(PAGES.split('resetCurrentUserPermissions();').length - 1, 1);
  assert.equal(PAGES.split('currentPermissionOverrides = permissionOverrides;').length - 1, 1);
});
