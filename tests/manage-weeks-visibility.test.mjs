// Manage Weeks capability contract (week.manage): the header Manage Weeks control, openWeekManagement(),
// saveWeekSummary() and createNewWeekFromManage() are available only to users whose effective week.manage
// capability is true -- raw-role Admin by default, or any other eligible role with an explicit per-user
// override. These tests execute the real profile bodies (getDashboardRole, canCurrentUser, setupUI and the
// Manage Weeks globals) in a VM against the real js/permission-registry.mjs resolver, for both profiles.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { canReadDraftWeeks, normalizeDashboardRole } from '../js/dashboard-access.mjs';
import { can, normalizePermissionOverrides } from '../js/permission-registry.mjs';
import { canUseProductionWeekSync } from '../js/uat-production-sync.mjs';
import { dashboardSource } from './helpers/dashboard-source.mjs';

const PROFILES = {
  production: dashboardSource('production'),
  uat: dashboardSource('uat'),
};

function sliceBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `source must define ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `source must close ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}

function bodies(source) {
  return {
    getDashboardRole: sliceBody(source, 'function getDashboardRole(', '\n}\n'),
    canCurrentUser: sliceBody(source, 'function canCurrentUser(', '\n}\n'),
    setupUI: sliceBody(source, 'function setupUI(', '\n}\n'),
    openWeekManagement: sliceBody(source, 'window.openWeekManagement = () => {', '\n};\n'),
    saveWeekSummary: sliceBody(source, 'window.saveWeekSummary = async () => {', '\n};\n'),
    createNewWeekFromManage: sliceBody(source, 'window.createNewWeekFromManage = async () => {', '\n};\n'),
  };
}

function stubElement(classes = []) {
  return {
    style: {},
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    dataset: {},
    className: '',
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
    __classes: classes,
  };
}

function makeDom() {
  const elements = new Map();
  // Mirror the markup: the Manage Weeks button carries both vip-hidden and executive-hidden (index.html).
  elements.set('manageWeeksBtn', stubElement(['vip-hidden', 'executive-hidden']));
  elements.set('productionWeekSyncPanel', stubElement(['admin-only']));
  elements.set('topPmSelect', stubElement(['vip-hidden', 'executive-hidden']));
  elements.set('btnOverview', stubElement(['vip-hidden', 'executive-hidden']));
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

function setupContext(profile, rawRole, overrides = {}) {
  const source = PROFILES[profile];
  const body = bodies(source);
  const dom = makeDom();
  const calls = { modal: [], api: [], loader: [], toast: [], sync: 0 };
  const context = vm.createContext({
    window: {},
    console,
    document: dom.document,
    currentRole: 'pending',
    currentRawRole: null,
    currentPermissionOverrides: normalizePermissionOverrides(overrides),
    currentUser: { email: 'tester@example.com' },
    allWeeks: [{ weekLabel: 'W1 2026', weekDate: 'Jan 1 - Jan 5', summary: '', projects: [] }],
    currentIdx: 0,
    jumpToLatestOnNextRender: false,
    PM_LIST: [],
    isOverview: false,
    isAdminVipPreview: false,
    isAdminExecutivePreview: false,
    DASHBOARD_RELEASE: 'v2.1',
    DASHBOARD_BASE_COMMIT: 'test',
    canReadDraftWeeks,
    normalizeDashboardRole,
    canWithPermissions: can,
    canUseProductionWeekSync,
    uatProductionSyncController: { open() { calls.sync += 1; } },
    invalidateProjectEditorSession() {},
    invalidateGanttTemplateSession() {},
    invalidateGanttWindowSession() {},
    loadOverviewScopeForCurrentUser() {},
    getUserDisplayName: () => 'Tester',
    getEmailKey: () => 'tester',
    escHtml: value => value,
    updateMasterDataLists() {},
    refreshFxRates() {},
    syncProjectManagerFilterOptions() {},
    refreshExecutivePendingCount() {},
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
  });
  context.window.updateWmDate = () => {};
  vm.runInContext([
    body.getDashboardRole, body.canCurrentUser, body.setupUI,
    body.openWeekManagement, body.saveWeekSummary, body.createNewWeekFromManage,
    'this.setupUI = setupUI; this.getDashboardRole = getDashboardRole; this.canCurrentUser = canCurrentUser;',
  ].join('\n'), context);
  context.currentRole = context.getDashboardRole({ exists: () => true, data: () => ({ role: rawRole }) });
  return { context, dom, calls };
}

// [raw Firestore role, overrides, expected effective week.manage]. Admin keeps week.manage even when stale or
// malformed data says false; every other recognized role -- including VIP and Executive Owner -- needs an
// explicit boolean true.
const PRODUCTION_MATRIX = [
  ['admin', {}, true],
  ['admin', { 'week.manage': false }, true],
  ['pm', {}, false],
  ['pm', { 'week.manage': false }, false],
  ['pm', { 'week.manage': true }, true],
  ['engineering', {}, false],
  ['engineering', { 'week.manage': true }, true],
  ['sales', {}, false],
  ['sales', { 'week.manage': true }, true],
  ['bd', {}, false],
  ['bd', { 'week.manage': true }, true],
  ['business', {}, false],
  ['business', { 'week.manage': true }, true],
  ['product', {}, false],
  ['product', { 'week.manage': true }, true],
  ['pm', { 'week.manage': 'true' }, false],
  ['executive', {}, false],
  ['executive', { 'week.manage': true }, true],
  ['executive', { 'week.manage': 1 }, false],
  ['vip', {}, false],
  ['vip', { 'week.manage': true }, true],
  ['vip', { 'week.manage': false }, false],
];
// Both profiles support every recognized raw dashboard role.
const UAT_MATRIX = PRODUCTION_MATRIX;
const MATRIX = { production: PRODUCTION_MATRIX, uat: UAT_MATRIX };
const label = (profile, role, overrides) => `${profile} ${role} ${JSON.stringify(overrides)}`;

test('the Manage Weeks button keeps its profile hide class (Production vip-hidden, UAT executive-hidden)', () => {
  assert.match(PROFILES.production, /<button id="manageWeeksBtn" class="btn-icon vip-hidden" onclick="openWeekManagement\(\)"/);
  assert.match(PROFILES.uat, /<button id="manageWeeksBtn" class="btn-icon executive-hidden" onclick="openWeekManagement\(\)"/);
});

test('setupUI shows Manage Weeks only for effective week.manage in both profiles', () => {
  for (const profile of Object.keys(PROFILES)) {
    for (const [role, overrides, allowed] of MATRIX[profile]) {
      const { context, dom } = setupContext(profile, role, overrides);
      context.setupUI();
      assert.equal(dom.element('manageWeeksBtn').style.display, allowed ? '' : 'none', label(profile, role, overrides));
    }
  }
});

test('setupUI re-hides Manage Weeks when a delegated session is replaced by one without the override', () => {
  for (const profile of Object.keys(PROFILES)) {
    const { context, dom } = setupContext(profile, 'pm', { 'week.manage': true });
    context.setupUI();
    assert.equal(dom.element('manageWeeksBtn').style.display, '');
    context.currentPermissionOverrides = {};
    context.setupUI();
    assert.equal(dom.element('manageWeeksBtn').style.display, 'none', `${profile}: stale override must not survive`);
  }
});

test('no signed-in user resolves no capability, even with a stale Admin raw role', () => {
  for (const profile of Object.keys(PROFILES)) {
    const { context } = setupContext(profile, 'admin');
    context.currentUser = null;
    assert.equal(context.canCurrentUser('week.manage'), false);
    assert.equal(context.canCurrentUser('permissions.manage'), false);
  }
});

test('openWeekManagement opens the modal only for effective week.manage and fails closed otherwise', () => {
  for (const profile of Object.keys(PROFILES)) {
    for (const [role, overrides, allowed] of MATRIX[profile]) {
      const { context, dom, calls } = setupContext(profile, role, overrides);
      assert.doesNotThrow(() => context.window.openWeekManagement(), label(profile, role, overrides));
      if (allowed) {
        assert.deepEqual(calls.modal, [dom.element('weekManageOverlay')], label(profile, role, overrides));
      } else {
        assert.deepEqual(calls.modal, [], label(profile, role, overrides));
        assert.equal(dom.element('wm_current_title').textContent, '', `${label(profile, role, overrides)} must not populate the editor`);
      }
    }
  }
});

test('saveWeekSummary and createNewWeekFromManage fail closed on direct calls without week.manage', async () => {
  for (const profile of Object.keys(PROFILES)) {
    for (const [role, overrides, allowed] of MATRIX[profile]) {
      const { context, dom, calls } = setupContext(profile, role, overrides);
      dom.element('wm_nw_label').value = 'W2 2026';
      await context.window.saveWeekSummary();
      await context.window.createNewWeekFromManage();
      const apiNames = calls.api.map(([name]) => name);
      if (allowed) {
        assert.deepEqual(apiNames, ['saveWeekFields', 'createWeek'], label(profile, role, overrides));
      } else {
        assert.deepEqual(apiNames, [], label(profile, role, overrides));
        assert.deepEqual(calls.loader, [], `${label(profile, role, overrides)} must not show a loader`);
        assert.deepEqual(calls.toast, [], `${label(profile, role, overrides)} must not toast`);
        assert.equal(context.jumpToLatestOnNextRender, false);
      }
    }
  }
});

test('each Manage Weeks entry point checks week.manage before touching any state', () => {
  for (const [profile, source] of Object.entries(PROFILES)) {
    const body = bodies(source);
    for (const name of ['openWeekManagement', 'saveWeekSummary', 'createNewWeekFromManage']) {
      const lines = body[name].split('\n');
      assert.equal(lines[1].trim(), "if (!canCurrentUser('week.manage')) return;", `${profile} ${name} guard must be the first statement`);
      assert.doesNotMatch(body[name], /canReadDraftWeeks/, `${profile} ${name} must not use the draft-read role check`);
    }
    assert.match(body.setupUI, /document\.getElementById\('manageWeeksBtn'\)\.style\.display = canCurrentUser\('week\.manage'\) \? '' : 'none';/);
  }
});

test('UAT Production Data Sync stays raw-role Admin only inside Week Management', () => {
  for (const [role, overrides, expectedSync] of [
    ['admin', {}, 1],
    ['pm', { 'week.manage': true }, 0],
    ['engineering', { 'week.manage': true }, 0],
    ['sales', { 'week.manage': true }, 0],
    ['business', { 'week.manage': true }, 0],
  ]) {
    const { context, dom, calls } = setupContext('uat', role, overrides);
    context.setupUI();
    context.window.openWeekManagement();
    assert.equal(calls.modal.length, 1, `${role} with week.manage opens Week Management`);
    assert.equal(calls.sync, expectedSync, `${role}: Production sync controller`);
    assert.equal(dom.element('productionWeekSyncPanel').style.display, role === 'admin' ? '' : 'none', `${role}: sync panel`);
  }
});

test('week release controls follow their own week.release capability and are not folded into week.manage', () => {
  const production = PROFILES.production;
  const prodToggle = sliceBody(production, 'window.toggleReleaseWeek = async () => {', '\n};\n');
  assert.match(prodToggle, /if \(!canCurrentUser\('week\.release'\)\) return;/);
  assert.doesNotMatch(prodToggle, /week\.manage/);
  assert.match(production, /\$\{canCurrentUser\('week\.release'\) \? '<button class="btn btn-primary" onclick="toggleReleaseWeek\(\)"/);
  assert.match(PROFILES.uat, /\$\{canManageWeekRelease\(\) \? '<button class="btn btn-primary" onclick="toggleReleaseWeek\(\)"/);
  const uatToggle = sliceBody(PROFILES.uat, 'window.toggleReleaseWeek = async () => {', '\n};\n');
  assert.match(uatToggle, /!canManageWeekRelease\(\)/);
  assert.doesNotMatch(uatToggle, /week\.manage/);
});

test('both rendered profiles declare the permission state, helpers and registry import at module scope', () => {
  // VM harnesses predefine these names, so assert the real module views declare them (an undeclared
  // assignment would throw in the strict-mode module script at login).
  for (const [profile, source] of Object.entries(PROFILES)) {
    for (const declaration of [
      /^let currentRawRole = null;$/m,
      /^let currentPermissionOverrides = \{\};$/m,
      /^function canCurrentUser\(capability\) \{$/m,
      /^function resetCurrentUserPermissions\(\) \{$/m,
      /^async function loadCurrentUserPermissionOverrides\(email\) \{$/m,
      /^import \{ can as canWithPermissions, normalizePermissionOverrides \} from "\.\/js\/permission-registry\.mjs";$/m,
    ]) {
      assert.match(source, declaration, `${profile} must declare ${declaration}`);
    }
    assert.equal(source.split('resetCurrentUserPermissions();').length - 1, 1, `${profile}: one auth handler resets permissions`);
    assert.equal(source.split('currentPermissionOverrides = permissionOverrides;').length - 1, 1, `${profile}: one auth handler applies overrides`);
  }
});

test('a delegated VIP/Executive sees Manage Weeks but keeps its normal perspective and no Admin controls', async () => {
  const cases = [
    ['production', 'vip', 'vip'],
    ['production', 'executive', 'vip'],
    ['uat', 'executive', 'executive'],
    ['uat', 'vip', 'vip'],
  ];
  for (const [profile, rawRole, perspective] of cases) {
    for (const granted of [true, false]) {
      const { context, dom, calls } = setupContext(profile, rawRole, granted ? { 'week.manage': true } : {});
      const name = `${profile} ${rawRole} granted=${granted}`;
      assert.equal(context.currentRole, perspective, name);
      context.setupUI();
      assert.equal(dom.element('manageWeeksBtn').style.display, granted ? '' : 'none', name);
      for (const id of ['addProjectBtn', 'ganttTemplateSettingsBtn', 'productionWeekSyncPanel', 'presenceUsageBtn']) {
        assert.equal(dom.element(id).style.display, 'none', `${name}: ${id} stays hidden`);
      }
      if (profile === 'production') {
        // Normal VIP presentation is unchanged: Overview, no PM selector, no normal view.
        assert.equal(context.isOverview, true, name);
        assert.equal(dom.element('normalView').style.display, 'none', name);
        assert.equal(dom.element('execView').style.display, 'block', name);
        assert.equal(dom.element('topPmSelect').style.display, 'none', `${name}: other vip-hidden controls stay hidden`);
        assert.equal(dom.element('btnOverview').style.display, 'none', name);
      }
      context.window.openWeekManagement();
      dom.element('wm_nw_label').value = 'W2 2026';
      await context.window.saveWeekSummary();
      await context.window.createNewWeekFromManage();
      assert.equal(calls.modal.length, granted ? 1 : 0, `${name}: modal`);
      assert.deepEqual(calls.api.map(([api]) => api), granted ? ['saveWeekFields', 'createWeek'] : [], `${name}: callables`);
      assert.equal(calls.sync, 0, `${name}: never opens Production sync`);
    }
  }
});

function weeksQueryFor(profile, rawRole, overrides = {}) {
  const source = PROFILES[profile];
  const context = vm.createContext({
    currentRole: 'pending',
    currentRawRole: null,
    currentPermissionOverrides: overrides,
    currentUser: { uid: 'uid', email: 'tester@example.com' },
    canWithPermissions: can,
    canReadDraftWeeks,
    normalizeDashboardRole,
    weeksUnsub: null,
    executiveTimelineConfigUnsub: null,
    executiveLiveTimelineUnsub: null,
    executivePendingMilestoneUnsub: null,
    authSessionGeneration: 1,
    db: {},
    collection: (_db, name) => ({ collection: name }),
    doc: (_db, name, id) => ({ doc: `${name}/${id}` }),
    query: (ref, constraint) => ({ ...ref, constraint }),
    where: (field, operator, value) => ({ type: 'where', field, operator, value }),
    orderBy: field => ({ type: 'orderBy', field }),
    getEmailKey: user => user.email,
    isAuthInitializationCurrent: () => true,
    subscribed: [],
  });
  context.onSnapshot = ref => { context.subscribed.push(ref); return () => {}; };
  vm.runInContext([
    sliceBody(source, 'function getDashboardRole(', '\n}\n'),
    sliceBody(source, 'function canCurrentUser(', '\n}\n'),
    sliceBody(source, 'function initData(', '\n}\n'),
    'this.getDashboardRole = getDashboardRole; this.initData = initData;',
  ].join('\n'), context);
  context.currentRole = context.getDashboardRole({ exists: () => true, data: () => ({ role: rawRole }) });
  context.initData(1, context.currentUser);
  return context.subscribed.find(ref => ref.collection === 'weeks').constraint;
}

test('effective week.manage loads the draft weeks Manage Weeks needs, in both profiles', () => {
  const ALL = { type: 'orderBy', field: 'weekLabel' };
  const RELEASED = { type: 'where', field: 'isReleased', operator: '==', value: true };
  for (const profile of Object.keys(PROFILES)) {
    for (const [role, overrides, allowed] of MATRIX[profile]) {
      const constraint = weeksQueryFor(profile, role, overrides);
      // Baseline draft visibility is preserved: UAT Admin/PM; Production every non-VIP perspective.
      const baseline = profile === 'uat'
        ? ['admin', 'pm'].includes(role)
        : !['vip', 'executive'].includes(role);
      assert.deepEqual(constraint, baseline || allowed ? ALL : RELEASED, label(profile, role, overrides));
    }
  }
});
