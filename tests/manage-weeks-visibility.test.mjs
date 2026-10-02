// Production Pages least-privilege hotfix (port of canonical main PR #29): the header "Manage Weeks" control and
// the openWeekManagement() global behind it must be available to the Admin and PM perspectives only. Raw sales/bd
// map to BUSINESS and raw executive maps to VIP; none of those may see or open it. These tests execute the real
// Pages getDashboardRole, setupUI, canReadDraftWeeks and openWeekManagement source in a VM.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const pages = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function functionSource(name) {
  const start = pages.indexOf(`function ${name}(`);
  const end = pages.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, `Pages must define ${name}`);
  return pages.slice(start, end + 2);
}

function openWeekManagementSource() {
  const start = pages.indexOf('window.openWeekManagement = () => {');
  const end = pages.indexOf('\n};\n', start);
  assert.ok(start >= 0 && end > start, 'Pages must define window.openWeekManagement');
  return pages.slice(start, end + 3);
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
  // Mirror the Pages markup: the Manage Weeks button carries the vip-hidden class (index.html).
  elements.set('manageWeeksBtn', stubElement(['vip-hidden']));
  const element = id => {
    if (!elements.has(id)) elements.set(id, stubElement());
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    createElement: () => stubElement(),
    querySelectorAll: selector => (selector === '.vip-hidden'
      ? [...elements.values()].filter(el => el.__classes.includes('vip-hidden'))
      : []),
  };
  return { document, element };
}

function pagesContext(currentRole) {
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
    DASHBOARD_RELEASE: 'test',
    DASHBOARD_BASE_COMMIT: 'test',
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
  vm.runInContext(`${functionSource('canReadDraftWeeks')}\n${functionSource('setupUI')}\n${openWeekManagementSource()}\nthis.setupUI = setupUI; this.canReadDraftWeeks = canReadDraftWeeks;`, context);
  return { context, dom, modalCalls };
}

function resolvePerspective(rawRole) {
  const context = vm.createContext({});
  const rawRoleState = pages.match(/^let currentRawRole = [^\n]+;$/m)?.[0] || '';
  vm.runInContext(`${rawRoleState}\n${functionSource('normalizeRole')}\n${functionSource('getDashboardRole')}\nthis.resolveRole = getDashboardRole;`, context);
  return context.resolveRole({ exists: () => true, data: () => ({ role: rawRole }) });
}

// Raw Firestore role -> expected Pages perspective -> whether Manage Weeks may be shown/opened.
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

test('the Pages Manage Weeks button is addressable and still part of the vip-hidden header markup', () => {
  assert.match(pages, /<button id="manageWeeksBtn" class="btn-icon vip-hidden" onclick="openWeekManagement\(\)" title="Manage Weeks">/);
});

test('Pages raw roles keep mapping to the intended perspective (sales/bd -> business, executive -> vip)', () => {
  for (const [raw, perspective] of MATRIX) {
    assert.equal(resolvePerspective(raw), perspective, `raw role ${raw}`);
  }
});

test('canReadDraftWeeks allows only the admin and pm perspectives and fails closed otherwise', () => {
  const { context } = pagesContext('pm');
  for (const [raw, perspective, allowed] of MATRIX) {
    assert.equal(context.canReadDraftWeeks(perspective), allowed, `${raw} (${perspective})`);
  }
  for (const role of ['pending', '', undefined, null, 'sales', 'bd', 'executive', 'PM', ' admin ']) {
    assert.equal(context.canReadDraftWeeks(role), false, `${JSON.stringify(role)} must not read draft weeks`);
  }
});

test('Pages setupUI shows Manage Weeks to Admin and PM only', () => {
  for (const [raw, , visible] of MATRIX) {
    const perspective = resolvePerspective(raw);
    const { context, dom } = pagesContext(perspective);
    context.setupUI();
    const display = dom.element('manageWeeksBtn').style.display;
    if (visible) assert.equal(display, '', `${raw} (${perspective}) must see Manage Weeks`);
    else assert.equal(display, 'none', `${raw} (${perspective}) must not see Manage Weeks`);
  }
});

test('Pages setupUI re-hides Manage Weeks after a privileged session switches to a lower role', () => {
  const { context, dom } = pagesContext('pm');
  context.setupUI();
  assert.equal(dom.element('manageWeeksBtn').style.display, '');
  context.currentRole = 'business';
  context.setupUI();
  assert.equal(dom.element('manageWeeksBtn').style.display, 'none');
});

test('Pages openWeekManagement fails closed for every non-Admin/PM perspective without opening the modal', () => {
  for (const [raw, , allowed] of MATRIX) {
    const perspective = resolvePerspective(raw);
    const { context, dom, modalCalls } = pagesContext(perspective);
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

test('openWeekManagement is also closed while the session is pending or signed out of a role', () => {
  const { context, modalCalls } = pagesContext('pending');
  context.window.openWeekManagement();
  assert.deepEqual(modalCalls, []);
});

test('the guard is the first statement, precedes any week-state access and adds no error flow', () => {
  const source = openWeekManagementSource();
  const guard = 'if (!canReadDraftWeeks(currentRole)) return;';
  const guardIndex = source.indexOf(guard);
  assert.ok(guardIndex >= 0, 'openWeekManagement must check canReadDraftWeeks(currentRole)');
  assert.equal(source.slice(0, guardIndex).replace(/window\.openWeekManagement = \(\) => \{\s*/, ''), '', 'guard must be the first statement');
  assert.ok(guardIndex < source.indexOf('allWeeks[currentIdx]'));
  assert.doesNotMatch(source.slice(0, guardIndex + guard.length), /alert|showSaveToast|showAuthError/);
});

test('only Admin can re-show the button through the VIP preview toggle', () => {
  const start = pages.indexOf('window.toggleVipPreview = () => {');
  assert.ok(start >= 0, 'Pages must define toggleVipPreview');
  assert.match(pages.slice(start, start + 120), /if \(currentRole !== 'admin'\) return;/);
});
