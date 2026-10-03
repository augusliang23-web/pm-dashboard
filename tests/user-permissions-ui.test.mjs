// Production Pages port of the Admin User Permissions page: executes the real Pages index.html block (plus
// canCurrentUser and setupUI) in a VM, against a small fake DOM, a fake client Firestore and a stubbed callable.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { can } from '../js/permission-registry.mjs';
import * as permissionsModel from '../js/user-permissions-admin.mjs';
import { getCallableErrorMessage } from '../sync-core.js';
import { readFileSync } from 'node:fs';
const PAGES = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const PROFILES = { pages: PAGES };

function sliceBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `source must define ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `source must close ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}

class FakeElement {
  constructor(tag = 'div', { id = '', classes = [] } = {}) {
    Object.assign(this, { tagName: tag.toUpperCase(), id, children: [], style: {}, dataset: {}, attributes: {}, listeners: {} });
    Object.assign(this, { textContent: '', value: '', hidden: false, disabled: false, checked: false, type: '', className: classes.join(' ') });
    const element = this;
    this.classList = {
      add: name => { if (!element.classList.contains(name)) element.className = `${element.className} ${name}`.trim(); },
      remove: name => { element.className = element.className.split(/\s+/).filter(entry => entry && entry !== name).join(' '); },
      toggle: (name, force) => ((force ?? !element.classList.contains(name)) ? element.classList.add(name) : element.classList.remove(name)),
      contains: name => element.className.split(/\s+/).includes(name),
    };
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  fire(type) { (this.listeners[type] || []).forEach(listener => listener()); }
  get innerHTML() { return ''; }
  set innerHTML(_value) { this.children = []; }
  all() { return this.children.flatMap(child => [child, ...(child.all ? child.all() : [])]); }
  text() { return [this.textContent, ...this.children.map(child => child.text())].filter(Boolean).join(' '); }
}

function makeDom() {
  const elements = new Map();
  const declare = (id, classes = []) => elements.set(id, new FakeElement('div', { id, classes }));
  declare('manageWeeksBtn', ['vip-hidden', 'executive-hidden']);
  declare('userPermissionsBtn', ['admin-only', 'vip-hidden', 'executive-hidden']);
  declare('addProjectBtn', ['admin-only']);
  declare('userPermissionsDetail');
  elements.get('userPermissionsDetail').hidden = true;
  const element = id => {
    if (!elements.has(id)) declare(id);
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    createElement: tag => new FakeElement(tag),
    querySelectorAll: selector => {
      const cls = selector.startsWith('.') ? selector.slice(1) : '';
      return cls ? [...elements.values()].filter(el => el.classList.contains(cls)) : [];
    },
  };
  return { document, element };
}

const USERS = [
  { id: 'admin@example.test', role: 'admin', displayName: 'Admin' },
  { id: 'bonnie@example.test', role: 'pm', displayName: 'Bonnie', password: 'never shown' },
  { id: 'eng@example.test', role: 'engineering', displayName: 'Eng' },
  { id: 'vip@example.test', role: 'vip', displayName: 'Vera' },
];

function makeContext(profile, { rawRole = 'admin', overrides = {}, permissions = {}, audit = [], setOverrides } = {}) {
  const source = PROFILES[profile];
  const dom = makeDom();
  const calls = { modal: [], toast: [], api: [], reads: [], console: [] };
  const store = { permissions: structuredClone(permissions), audit: [...audit] };
  const snapshot = (id, data) => ({ id, exists: () => data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)) });
  const context = vm.createContext({
    window: {},
    console: { error: (...args) => calls.console.push(args), warn() {} },
    Promise, Date, structuredClone,
    document: dom.document,
    currentRole: 'pending',
    currentRawRole: null,
    currentPermissionOverrides: overrides,
    currentUser: { uid: 'admin-uid', email: 'admin@example.test' },
    isAdminVipPreview: false,
    isAdminExecutivePreview: false,
    isOverview: false,
    PM_LIST: [],
    DASHBOARD_RELEASE: 'v2.1',
    DASHBOARD_BASE_COMMIT: 'test',
    canWithPermissions: can,
    ...permissionsModel,
    getCallableErrorMessage,
    getUserDisplayName: email => `Directory ${email}`,
    getEmailKey: () => 'admin@example.test',
    escHtml: value => value,
    invalidateProjectEditorSession() {}, invalidateGanttTemplateSession() {}, invalidateGanttWindowSession() {},
    loadOverviewScopeForCurrentUser() {}, updateMasterDataLists() {}, refreshFxRates() {},
    syncProjectManagerFilterOptions() {}, refreshExecutivePendingCount() {},
    openAccessibleModal: overlay => { calls.modal.push(overlay.id); overlay.classList.add('open'); },
    showSaveToast: (message, options) => calls.toast.push({ message, type: options?.type || 'success' }),
    db: {},
    collection: (_db, name) => ({ collection: name }),
    doc: (_db, name, id) => ({ collection: name, id }),
    where: (field, operator, value) => ({ field, operator, value }),
    query: (ref, constraint) => ({ ...ref, constraint }),
    getDocs: async ref => {
      calls.reads.push(ref.collection);
      if (ref.collection === 'users') return { docs: USERS.map(user => snapshot(user.id, user)) };
      if (ref.collection === 'userPermissionAudit') {
        assert.deepEqual(ref.constraint, { field: 'targetEmail', operator: '==', value: ref.constraint.value });
        return { docs: store.audit.filter(entry => entry.targetEmail === ref.constraint.value).map((entry, i) => snapshot(`a${i}`, entry)) };
      }
      throw new Error(`unexpected getDocs ${ref.collection}`);
    },
    getDoc: async ref => {
      calls.reads.push(`${ref.collection}/${ref.id}`);
      assert.equal(ref.collection, 'userPermissions');
      return snapshot(ref.id, store.permissions[ref.id]);
    },
    userPermissionsApi: {
      setOverrides: async data => {
        calls.api.push(structuredClone(data));
        return setOverrides(data, store);
      },
    },
  });
  vm.runInContext([
    sliceBody(source, 'function getDashboardRole(', '\n}\n'),
    sliceBody(source, 'function canCurrentUser(', '\n}\n'),
    sliceBody(source, 'function setupUI(', '\n}\n'),
    sliceBody(source, '// ── USER PERMISSIONS (Admin only) ──', '// ── WEEK MANAGEMENT COMBINED LOGIC ──'),
    'this.setupUI = setupUI; this.getDashboardRole = getDashboardRole;',
  ].join('\n'), context);
  context.currentRole = context.getDashboardRole({ exists: () => true, data: () => ({ role: rawRole }) });
  return { context, dom, calls, store };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const rowFor = dom => dom.element('userPermissionsRows').children[0];
const checkboxFor = dom => rowFor(dom).all().find(node => node.type === 'checkbox');
const badgeFor = dom => rowFor(dom).all().find(node => node.classList?.contains('permission-badge'));
const resetFor = dom => rowFor(dom).all().find(node => node.textContent === 'Reset');

async function openAndSelect(context, email) {
  await context.window.openUserPermissions();
  await context.window.selectUserPermissionsUser(email);
  await settle();
}

function successfulCallable(data, store) {
  const current = store.permissions[data.targetEmail] || { overrides: {}, revision: 0 };
  assert.equal(data.expectedRevision, current.revision ?? 0);
  const overrides = { ...current.overrides };
  for (const [key, value] of Object.entries(data.changes)) {
    if (value === null) delete overrides[key];
    else overrides[key] = value;
  }
  const revision = (current.revision ?? 0) + 1;
  store.permissions[data.targetEmail] = { overrides, revision };
  store.audit.push({ targetEmail: data.targetEmail, actorEmail: 'admin@example.test', at: new Date(Date.UTC(2026, 9, 3, 12, revision)),
    changes: Object.entries(data.changes).map(([capability, after]) => ({ capability, before: null, after })) });
  return { targetEmail: data.targetEmail, role: 'pm', revision, overrides, changed: true };
}

for (const profile of Object.keys(PROFILES)) {
  test(`${profile}: only a raw-role Admin sees User Permissions; overrides never grant it`, () => {
    for (const [rawRole, overrides, visible] of [
      ['admin', {}, true],
      ['pm', {}, false],
      ['pm', { 'permissions.manage': true, 'week.manage': true }, false],
      ['engineering', { 'permissions.manage': true }, false],
      ['vip', { 'permissions.manage': true }, false],
      ['executive', { 'permissions.manage': true }, false],
    ]) {
      const { context, dom } = makeContext(profile, { rawRole, overrides });
      context.setupUI();
      assert.equal(dom.element('userPermissionsBtn').style.display, visible ? 'inline-flex' : 'none', `${rawRole} ${JSON.stringify(overrides)}`);
    }
  });

  test(`${profile}: direct opens by non-Admins, signed-out sessions and Admin previews fail closed`, async () => {
    for (const setup of [
      { rawRole: 'pm', overrides: { 'permissions.manage': true } },
      { rawRole: 'vip', overrides: { 'week.manage': true } },
      { rawRole: 'admin', preview: true },
      { rawRole: 'admin', signedOut: true },
    ]) {
      const { context, calls } = makeContext(profile, setup);
      if (setup.preview) { context.isAdminVipPreview = true; context.isAdminExecutivePreview = true; }
      if (setup.signedOut) context.currentUser = null;
      await context.window.openUserPermissions();
      await context.window.selectUserPermissionsUser('bonnie@example.test');
      await context.window.saveUserPermissions();
      assert.deepEqual(calls.modal, [], JSON.stringify(setup));
      assert.deepEqual(calls.reads, [], `${JSON.stringify(setup)} must not read user data`);
      assert.deepEqual(calls.api, []);
    }
  });

  test(`${profile}: the selector lists users with name, email and role only`, async () => {
    const { context, dom, calls } = makeContext(profile);
    await context.window.openUserPermissions();
    assert.deepEqual(calls.modal, ['userPermissionsOverlay']);
    const options = dom.element('userPermissionsUserSelect').children.map(option => option.textContent);
    assert.deepEqual(options, [
      'Select a user…',
      'Admin · admin@example.test · Admin',
      'Bonnie · bonnie@example.test · PM',
      'Eng · eng@example.test · Engineering',
      'Vera · vip@example.test · VIP',
    ]);
    assert.doesNotMatch(options.join(' '), /never shown/);
  });

  test(`${profile}: role default, custom enabled and custom disabled render distinctly`, async () => {
    for (const [stored, checked, badge, resettable] of [
      [undefined, false, 'Role default', false],
      [{ overrides: { 'week.manage': true }, revision: 2 }, true, 'Custom enabled', true],
      [{ overrides: { 'week.manage': false }, revision: 1 }, false, 'Custom disabled', true],
    ]) {
      const { context, dom } = makeContext(profile, { permissions: stored ? { 'bonnie@example.test': stored } : {} });
      await openAndSelect(context, 'bonnie@example.test');
      assert.equal(dom.element('userPermissionsDetail').hidden, false);
      assert.equal(dom.element('userPermissionsName').textContent, 'Bonnie');
      assert.equal(dom.element('userPermissionsEmail').textContent, 'bonnie@example.test');
      assert.equal(dom.element('userPermissionsRole').textContent, 'PM');
      assert.equal(checkboxFor(dom).checked, checked);
      assert.equal(checkboxFor(dom).disabled, false);
      assert.equal(badgeFor(dom).textContent, badge);
      assert.match(rowFor(dom).text(), /Manage Weeks/);
      assert.match(rowFor(dom).text(), /Role default: Off/);
      assert.equal(Boolean(resetFor(dom)), resettable);
      assert.equal(dom.element('userPermissionsSaveBtn').disabled, true, 'nothing to save yet');
    }
  });

  test(`${profile}: an Admin target is shown enabled and locked`, async () => {
    const { context, dom } = makeContext(profile, { permissions: { 'admin@example.test': { overrides: { 'week.manage': false }, revision: 1 } } });
    await openAndSelect(context, 'admin@example.test');
    assert.equal(checkboxFor(dom).checked, true);
    assert.equal(checkboxFor(dom).disabled, true);
    assert.match(rowFor(dom).text(), /Role default: On/);
    assert.match(rowFor(dom).text(), /Locked for Admin/);
    assert.equal(resetFor(dom), undefined);
    assert.equal(dom.element('userPermissionsResetAllBtn').disabled, true);
    context.window.toggleUserPermission('week.manage', false);
    context.window.resetAllUserPermissions();
    await context.window.saveUserPermissions();
    assert.equal(checkboxFor(dom).checked, true);
    assert.equal(dom.element('userPermissionsSaveBtn').disabled, true);
  });

  test(`${profile}: Save sends the minimal change with expectedRevision and renders the authoritative result`, async () => {
    const { context, dom, calls } = makeContext(profile, {
      permissions: { 'bonnie@example.test': { overrides: {}, revision: 3 } },
      setOverrides: successfulCallable,
    });
    await openAndSelect(context, 'bonnie@example.test');
    checkboxFor(dom).checked = true;
    checkboxFor(dom).fire('change');
    assert.equal(badgeFor(dom).textContent, 'Custom enabled · unsaved');
    assert.equal(dom.element('userPermissionsSaveBtn').disabled, false);
    await context.window.saveUserPermissions();
    await settle();
    assert.deepEqual(calls.api, [{ targetEmail: 'bonnie@example.test', expectedRevision: 3, changes: { 'week.manage': true } }]);
    assert.equal(badgeFor(dom).textContent, 'Custom enabled');
    assert.equal(checkboxFor(dom).checked, true);
    assert.equal(dom.element('userPermissionsSaveBtn').disabled, true);
    assert.match(dom.element('userPermissionsMessage').textContent, /Permissions saved/);
    assert.deepEqual(calls.toast, [{ message: 'User permissions saved', type: 'success' }]);
    assert.match(dom.element('userPermissionsAudit').text(), /Manage Weeks: Role default → Enabled/);
    // The next save uses the returned revision.
    resetFor(dom).fire('click');
    assert.equal(badgeFor(dom).textContent, 'Role default · unsaved');
    await context.window.saveUserPermissions();
    assert.deepEqual(calls.api[1], { targetEmail: 'bonnie@example.test', expectedRevision: 4, changes: { 'week.manage': null } });
    assert.equal(badgeFor(dom).textContent, 'Role default');
  });

  test(`${profile}: changes are not applied before the server succeeds, and failures keep the draft`, async () => {
    const { context, dom } = makeContext(profile, {
      setOverrides: async () => { throw Object.assign(new Error('Only administrators can change user permissions.'), { code: 'functions/permission-denied', details: { reason: 'admin-role-required' } }); },
    });
    await openAndSelect(context, 'eng@example.test');
    checkboxFor(dom).checked = true;
    checkboxFor(dom).fire('change');
    await context.window.saveUserPermissions();
    assert.equal(dom.element('userPermissionsMessage').textContent, 'Only administrators can change user permissions.');
    assert.ok(dom.element('userPermissionsMessage').classList.contains('error'));
    assert.equal(badgeFor(dom).textContent, 'Custom enabled · unsaved', 'the stored state is unchanged; the draft is kept for review');
  });

  test(`${profile}: a revision conflict reloads the latest state and discards stale edits`, async () => {
    const { context, dom, calls, store } = makeContext(profile, {
      permissions: { 'bonnie@example.test': { overrides: {}, revision: 1 } },
      setOverrides: async (_data, liveStore) => {
        liveStore.permissions['bonnie@example.test'] = { overrides: { 'week.manage': false }, revision: 2 };
        throw Object.assign(new Error('conflict'), { code: 'functions/aborted', details: { reason: 'permission-revision-conflict' } });
      },
    });
    await openAndSelect(context, 'bonnie@example.test');
    checkboxFor(dom).checked = true;
    checkboxFor(dom).fire('change');
    await context.window.saveUserPermissions();
    await settle();
    assert.equal(calls.api.length, 1, 'no automatic retry');
    assert.equal(badgeFor(dom).textContent, 'Custom disabled', 'shows the other Admin\'s stored value');
    assert.equal(checkboxFor(dom).checked, false);
    assert.equal(dom.element('userPermissionsSaveBtn').disabled, true, 'stale edits were discarded');
    assert.match(dom.element('userPermissionsMessage').textContent, /changed by another Admin\. The latest settings have been reloaded/);
    assert.equal(store.permissions['bonnie@example.test'].revision, 2);
  });

  test(`${profile}: per-row Reset and Reset to role defaults send null`, async () => {
    for (const action of ['row', 'all']) {
      const { context, dom, calls } = makeContext(profile, {
        permissions: { 'vip@example.test': { overrides: { 'week.manage': true }, revision: 5 } },
        setOverrides: successfulCallable,
      });
      await openAndSelect(context, 'vip@example.test');
      assert.equal(badgeFor(dom).textContent, 'Custom enabled');
      if (action === 'row') resetFor(dom).fire('click');
      else context.window.resetAllUserPermissions();
      assert.equal(checkboxFor(dom).checked, false);
      assert.equal(badgeFor(dom).textContent, 'Role default · unsaved');
      await context.window.saveUserPermissions();
      assert.deepEqual(calls.api, [{ targetEmail: 'vip@example.test', expectedRevision: 5, changes: { 'week.manage': null } }], action);
    }
  });

  test(`${profile}: an auth transition invalidates an open permissions session`, async () => {
    const source = PROFILES[profile];
    assert.match(sliceBody(source, 'function resetCurrentUserPermissions() {', '\n}\n'), /invalidateUserPermissionsSession\(\);/);
    const { context, dom, calls } = makeContext(profile, { setOverrides: successfulCallable });
    await openAndSelect(context, 'bonnie@example.test');
    checkboxFor(dom).checked = true;
    checkboxFor(dom).fire('change');
    vm.runInContext('invalidateUserPermissionsSession();', context);
    await context.window.saveUserPermissions();
    assert.deepEqual(calls.api, []);
    assert.equal(dom.element('userPermissionsOverlay').classList.contains('open'), false);
  });
}

test('Pages renders the User Permissions entry point and overlay with Production-only bindings', () => {
  assert.match(PAGES, /<button id="userPermissionsBtn" class="btn-icon admin-only vip-hidden" style="display:none;" onclick="openUserPermissions\(\)" title="User Permissions"/);
  assert.match(PAGES, /<div class="overlay" id="userPermissionsOverlay" role="dialog" aria-modal="true" aria-labelledby="userPermissionsTitle">/);
  assert.equal(PAGES.split('// ── USER PERMISSIONS (Admin only) ──').length - 1, 1);
  assert.doesNotMatch(sliceBody(PAGES, '// ── USER PERMISSIONS (Admin only) ──', '// ── WEEK MANAGEMENT COMBINED LOGIC ──'),
    /setDoc|updateDoc|deleteDoc|runTransaction|innerHTML/, 'all writes go through the callable and rendering uses text nodes');
  assert.doesNotMatch(PAGES, /pm-dashboard-uat-20260820-a7f3|pm-dashboard-uat-pdf|executive-hidden|IS_UAT_PROFILE/);
  assert.match(PAGES, /projectId: "project-manager-dashboar-a067f"/);
});

test('the Pages User Permissions block is byte-identical to the reviewed canonical main implementation', () => {
  const block = sliceBody(PAGES, '// ── USER PERMISSIONS (Admin only) ──', '// ── WEEK MANAGEMENT COMBINED LOGIC ──');
  assert.match(block, /function canManageUserPermissions\(\) \{\n  return canCurrentUser\('permissions\.manage'\) && !isAdminVipPreview;\n\}/);
  assert.match(block, /userPermissionsApi\.setOverrides\(\{ targetEmail: target\.email, expectedRevision: target\.revision, changes \}\)/);
});
