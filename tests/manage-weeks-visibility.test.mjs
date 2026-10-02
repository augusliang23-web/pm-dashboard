// Production Manage Weeks least-privilege hotfix: the header "Manage Weeks" control (and the openWeekManagement()
// global behind it) must be available to Admin and PM only. Raw sales/bd map to the BUSINESS perspective and
// raw executive maps to VIP, and none of those may see or open it. These tests execute the real Production
// getDashboardRole, setupUI and openWeekManagement bodies in a VM, with the real canReadDraftWeeks contract.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { canReadDraftWeeks } from '../js/dashboard-access.mjs';
import { dashboardSource } from './helpers/dashboard-source.mjs';

const production = dashboardSource('production');
const uat = dashboardSource('uat');

function sliceBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `source must define ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `source must close ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}

const getDashboardRoleSource = sliceBody(production, 'function getDashboardRole(', '\n}\n');
const setupUiSource = sliceBody(production, 'function setupUI(', '\n}\n');
const openWeekManagementSource = sliceBody(production, 'window.openWeekManagement = () => {', '\n};\n');

function stubElement(classes = []) {
  const element = {
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
  return element;
}

function makeDom() {
  const elements = new Map();
  // Mirror the Production markup: the Manage Weeks button carries the vip-hidden class (index.html).
  elements.set('manageWeeksBtn', stubElement(['vip-hidden']));
  const element = id => {
    if (!elements.has(id)) elements.set(id, stubElement());
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    createElement: () => stubElement(),
    querySelectorAll: selector => {
      if (selector === '.vip-hidden') return [...elements.values()].filter(el => el.__classes.includes('vip-hidden'));
      return [];
    },
  };
  return { document, element };
}

function setupContext(currentRole) {
  const dom = makeDom();
  const modalCalls = [];
  const context = vm.createContext({
    window: {},
    document: dom.document,
    currentRole,
    currentUser: { email: 'tester@example.com' },
    allWeeks: [{ weekLabel: 'W1 2026', weekDate: 'Jan 1 - Jan 5', summary: '' }],
    currentIdx: 0,
    PM_LIST: [],
    isOverview: false,
    isAdminVipPreview: false,
    DASHBOARD_RELEASE: 'v2.1',
    DASHBOARD_BASE_COMMIT: 'test',
    canReadDraftWeeks,
    invalidateProjectEditorSession() {},
    invalidateGanttTemplateSession() {},
    invalidateGanttWindowSession() {},
    loadOverviewScopeForCurrentUser() {},
    getUserDisplayName: () => 'Tester',
    getEmailKey: () => 'tester',
    escHtml: value => value,
    updateMasterDataLists() {},
    refreshFxRates() {},
    setWeeklySummaryValidation() {},
    getIsoWeekData: () => ({ label: 'W2 2026', dateStr: 'Jan 8 - Jan 12' }),
    updateCopilotPrompt() {},
    openAccessibleModal: overlay => modalCalls.push(overlay),
  });
  context.window.updateWmDate = () => {};
  vm.runInContext(`${setupUiSource}\n${openWeekManagementSource}\nthis.setupUI = setupUI;`, context);
  return { context, dom, modalCalls };
}

function resolvePerspective(rawRole) {
  const context = vm.createContext({ currentRawRole: undefined });
  vm.runInContext(`${getDashboardRoleSource}; this.resolveRole = getDashboardRole;`, context);
  return context.resolveRole({ exists: () => true, data: () => ({ role: rawRole }) });
}

// Raw Firestore role -> expected Production perspective -> whether Manage Weeks may be shown.
const MATRIX = [
  ['admin', 'admin', true],
  ['pm', 'pm', true],
  ['sales', 'business', false],
  ['bd', 'business', false],
  ['business', 'business', false],
  ['engineering', 'engineering', false],
  ['product', 'product', false],
  ['executive', 'vip', false],
  ['vip', 'vip', false],
];

test('the Production Manage Weeks button is still part of the vip-hidden header markup', () => {
  assert.match(production, /<button id="manageWeeksBtn" class="btn-icon vip-hidden" onclick="openWeekManagement\(\)"/);
});

test('raw roles keep mapping to the intended perspective (sales/bd -> business, executive -> vip)', () => {
  for (const [raw, perspective] of MATRIX) {
    assert.equal(resolvePerspective(raw), perspective, `raw role ${raw}`);
  }
});

test('Production setupUI shows Manage Weeks to Admin and PM only', () => {
  for (const [raw, , visible] of MATRIX) {
    const perspective = resolvePerspective(raw);
    const { context, dom } = setupContext(perspective);
    context.setupUI();
    const display = dom.element('manageWeeksBtn').style.display;
    if (visible) assert.equal(display, '', `${raw} (${perspective}) must see Manage Weeks`);
    else assert.equal(display, 'none', `${raw} (${perspective}) must not see Manage Weeks`);
  }
});

test('Production setupUI re-hides Manage Weeks after a privileged session switches to a lower role', () => {
  const { context, dom } = setupContext('pm');
  context.setupUI();
  assert.equal(dom.element('manageWeeksBtn').style.display, '');
  context.currentRole = 'business';
  context.setupUI();
  assert.equal(dom.element('manageWeeksBtn').style.display, 'none');
});

test('Production openWeekManagement fails closed for every non-Admin/PM perspective without opening the modal', () => {
  for (const [raw, , allowed] of MATRIX) {
    const perspective = resolvePerspective(raw);
    const { context, dom, modalCalls } = setupContext(perspective);
    assert.doesNotThrow(() => context.window.openWeekManagement(), `${raw} direct call must not throw`);
    if (allowed) {
      assert.equal(modalCalls.length, 1, `${raw} (${perspective}) keeps the existing open behavior`);
      assert.equal(modalCalls[0], dom.element('weekManageOverlay'));
    } else {
      assert.deepEqual(modalCalls, [], `${raw} (${perspective}) must not open weekManageOverlay`);
      assert.equal(dom.element('wm_current_title').textContent, '', `${raw} must not populate the week editor`);
    }
  }
});

test('the guard sits before any week-management state is touched and adds no error dialog', () => {
  const guardIndex = openWeekManagementSource.indexOf('if (!canReadDraftWeeks(currentRole)) return;');
  assert.ok(guardIndex >= 0, 'Production openWeekManagement must check canReadDraftWeeks(currentRole)');
  assert.ok(guardIndex < openWeekManagementSource.indexOf('allWeeks[currentIdx]'));
  assert.doesNotMatch(openWeekManagementSource.slice(0, guardIndex + 80), /alert|showSaveToast|showAuthError/);
});

test('UAT keeps its existing Manage Weeks visibility contract and Production-only guard stays out of UAT', () => {
  assert.match(uat, /document\.getElementById\('manageWeeksBtn'\)\.style\.display = canReadDraftWeeks\(currentRole\) \? '' : 'none';/);
  const uatOpen = sliceBody(uat, 'window.openWeekManagement = () => {', '\n};\n');
  assert.doesNotMatch(uatOpen, /canReadDraftWeeks/);
});
