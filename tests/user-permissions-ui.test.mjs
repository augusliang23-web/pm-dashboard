// Admin User Permissions page: executes the real index.html block (plus canCurrentUser and setupUI) from both
// rendered profiles in a VM, against a small fake DOM, a fake client Firestore and a stubbed callable.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { canReadDraftWeeks, normalizeDashboardRole } from './helpers/pages-access.mjs';
import { can } from '../js/permission-registry.mjs';
import * as permissionsModel from '../js/user-permissions-admin.mjs';
import { getCallableErrorMessage } from '../sync-core.js';
import { dashboardSource } from './helpers/dashboard-source.mjs';

const PROFILES = { production: dashboardSource('production') };

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
    canReadDraftWeeks, normalizeDashboardRole,
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
const rowOf = (dom, capability) => dom.element('userPermissionsRows').children.find(row => row.dataset.capability === capability);
const switchOf = (dom, capability) => rowOf(dom, capability).all().find(node => node.type === 'checkbox');
const stateOf = (dom, capability) => rowOf(dom, capability).all().find(node => node.classList?.contains('permission-state')).textContent;
const flip = (dom, capability, checked) => { const input = switchOf(dom, capability); input.checked = checked; input.fire('change'); };
const KEYS = ['week.manage', 'week.release', 'gantt.manage', 'project.manage'];

async function openAndSelect(context, email) {
  await context.window.openUserPermissions();
  await context.window.selectUserPermissionsUser(email);
  await settle();
}

// A faithful stand-in for the callable: optimistic revision check, null removes the key, one audit entry per change.
function successfulCallable(data, store) {
  const current = store.permissions[data.targetEmail] || { overrides: {}, revision: 0 };
  if (data.expectedRevision !== (current.revision ?? 0)) {
    throw Object.assign(new Error('conflict'), { code: 'functions/aborted', details: { reason: 'permission-revision-conflict' } });
  }
  const overrides = { ...current.overrides };
  const entries = [];
  for (const [key, value] of Object.entries(data.changes)) {
    entries.push({ capability: key, before: key in overrides ? overrides[key] : null, after: value });
    if (value === null) delete overrides[key];
    else overrides[key] = value;
  }
  const revision = (current.revision ?? 0) + 1;
  store.permissions[data.targetEmail] = { overrides, revision };
  store.audit.push({ targetEmail: data.targetEmail, actorEmail: 'admin@example.test', at: new Date(Date.UTC(2026, 9, 4, 12, revision)),
    roleAtChange: USERS.find(user => user.id === data.targetEmail).role, changes: entries });
  return { targetEmail: data.targetEmail, role: USERS.find(user => user.id === data.targetEmail).role, revision, overrides, changed: true };
}

for (const profile of Object.keys(PROFILES)) {
  test(`${profile}: only a raw-role Admin sees User Permissions; overrides never grant it`, () => {
    for (const [rawRole, overrides, visible] of [
      ['admin', {}, true],
      ['pm', {}, false],
      ['pm', { 'permissions.manage': true, 'week.manage': true, 'week.release': true, 'gantt.manage': true, 'project.manage': true }, false],
      ['engineering', { 'permissions.manage': true }, false],
      ['vip', { 'permissions.manage': true }, false],
      ['executive', { 'permissions.manage': true }, false],
    ]) {
      const { context, dom } = makeContext(profile, { rawRole, overrides });
      context.setupUI();
      assert.equal(dom.element('userPermissionsBtn').style.display, visible ? 'inline-flex' : 'none', `${rawRole} ${JSON.stringify(overrides)}`);
    }
  });

  test(`${profile}: direct opens and switch changes by non-Admins, signed-out sessions and Admin previews fail closed`, async () => {
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
      await context.window.setUserPermissionSwitch('week.manage', true);
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

  test(`${profile}: each user shows four plain ON/OFF switches, with the PM release default ON`, async () => {
    const { context, dom } = makeContext(profile, { permissions: { 'bonnie@example.test': { overrides: { 'week.manage': true }, revision: 4 } } });
    await openAndSelect(context, 'bonnie@example.test');
    assert.equal(dom.element('userPermissionsDetail').hidden, false);
    assert.equal(dom.element('userPermissionsName').textContent, 'Bonnie');
    assert.equal(dom.element('userPermissionsRole').textContent, 'PM');
    assert.deepEqual(dom.element('userPermissionsRows').children.map(row => row.dataset.capability), KEYS);
    assert.equal(stateOf(dom, 'week.manage'), 'ON');
    assert.equal(stateOf(dom, 'week.release'), 'ON', 'a PM keeps Release by role default');
    assert.equal(stateOf(dom, 'gantt.manage'), 'OFF');
    assert.equal(stateOf(dom, 'project.manage'), 'OFF');
    for (const key of KEYS) {
      assert.equal(switchOf(dom, key).getAttribute('role'), 'switch');
      assert.ok(switchOf(dom, key).getAttribute('aria-labelledby'));
      assert.equal(switchOf(dom, key).disabled, false);
    }
  });

  test(`${profile}: the page shows no internal permission-state vocabulary, Save, Reset or revision`, async () => {
    const { context, dom } = makeContext(profile, { permissions: { 'bonnie@example.test': { overrides: { 'week.manage': true, 'week.release': false }, revision: 9 } } });
    await openAndSelect(context, 'bonnie@example.test');
    const text = [dom.element('userPermissionsRows').text(), dom.element('userPermissionsMessage').textContent].join(' ');
    assert.doesNotMatch(text, /Role default|Custom|Reset|override|revision|Save changes|unsaved/i);
    const markup = PROFILES[profile].slice(PROFILES[profile].indexOf('id="userPermissionsOverlay"'), PROFILES[profile].indexOf('<script src="./professional-pdf-config.js">'));
    assert.doesNotMatch(markup, /Reset|Save changes|userPermissionsSaveBtn|userPermissionsResetAllBtn|Role default|Custom enabled/);
    assert.match(markup, /<details class="permission-history">/);
  });

  test(`${profile}: an Admin target shows every switch ON and locked, and cannot be changed`, async () => {
    const { context, dom, calls } = makeContext(profile, { permissions: { 'admin@example.test': { overrides: { 'week.manage': false }, revision: 1 } } });
    await openAndSelect(context, 'admin@example.test');
    for (const key of KEYS) {
      assert.equal(stateOf(dom, key), 'ON 🔒', key);
      assert.equal(switchOf(dom, key).disabled, true, key);
      assert.equal(switchOf(dom, key).checked, true, key);
      await context.window.setUserPermissionSwitch(key, false);
    }
    assert.deepEqual(calls.api, []);
  });

  test(`${profile}: roles that cannot receive a capability show it unavailable instead of an inert switch`, async () => {
    const { context, dom, calls } = makeContext(profile);
    await openAndSelect(context, 'vip@example.test');
    for (const key of ['week.release', 'project.manage']) {
      assert.equal(switchOf(dom, key).disabled, true, key);
      assert.equal(stateOf(dom, key), 'OFF', key);
      assert.match(rowOf(dom, key).text(), /Not available for this role/, key);
      await context.window.setUserPermissionSwitch(key, true);
    }
    for (const key of ['week.manage', 'gantt.manage']) assert.equal(switchOf(dom, key).disabled, false, key);
    assert.deepEqual(calls.api, []);
  });

  test(`${profile}: turning a switch ON saves immediately with the current revision and follows the server answer`, async () => {
    const { context, dom, calls } = makeContext(profile, {
      permissions: { 'eng@example.test': { overrides: {}, revision: 3 } },
      setOverrides: successfulCallable,
    });
    await openAndSelect(context, 'eng@example.test');
    assert.equal(stateOf(dom, 'gantt.manage'), 'OFF');
    const pending = flip(dom, 'gantt.manage', true);
    // While the callable is in flight the switch shows the request, says Saving, and every switch is locked.
    assert.equal(stateOf(dom, 'gantt.manage'), 'Saving…');
    assert.equal(switchOf(dom, 'gantt.manage').checked, true);
    for (const key of KEYS) assert.equal(switchOf(dom, key).disabled, true, `${key} locked while saving`);
    assert.equal(dom.element('userPermissionsMessage').textContent, 'Saving…');
    await settle();
    void pending;
    assert.deepEqual(calls.api, [{ targetEmail: 'eng@example.test', expectedRevision: 3, changes: { 'gantt.manage': true } }]);
    assert.equal(stateOf(dom, 'gantt.manage'), 'ON');
    assert.equal(switchOf(dom, 'gantt.manage').disabled, false);
    assert.match(dom.element('userPermissionsMessage').textContent, /^Saved\./);
    assert.ok(dom.element('userPermissionsMessage').classList.contains('success'));
    assert.match(dom.element('userPermissionsAudit').text(), /Manage Gantt: Off → On/);
    // The next change uses the revision the server returned (4).
    flip(dom, 'week.manage', true);
    await settle();
    assert.deepEqual(calls.api[1], { targetEmail: 'eng@example.test', expectedRevision: 4, changes: { 'week.manage': true } });
  });

  test(`${profile}: switching back to the role default sends null, and a PM release switch-off sends false`, async () => {
    const { context, dom, calls } = makeContext(profile, {
      permissions: { 'bonnie@example.test': { overrides: { 'week.manage': true }, revision: 1 } },
      setOverrides: successfulCallable,
    });
    await openAndSelect(context, 'bonnie@example.test');
    flip(dom, 'week.manage', false);
    await settle();
    flip(dom, 'week.release', false);
    await settle();
    flip(dom, 'week.release', true);
    await settle();
    assert.deepEqual(calls.api.map(call => call.changes), [{ 'week.manage': null }, { 'week.release': false }, { 'week.release': null }]);
    assert.deepEqual(calls.api.map(call => call.expectedRevision), [1, 2, 3]);
    assert.equal(stateOf(dom, 'week.manage'), 'OFF');
    assert.equal(stateOf(dom, 'week.release'), 'ON');
    assert.match(dom.element('userPermissionsAudit').text(), /Release Week: Off → On/);
    assert.match(dom.element('userPermissionsAudit').text(), /Release Week: On → Off/);
  });

  test(`${profile}: a failed save puts the switch back and explains the problem`, async () => {
    const { context, dom } = makeContext(profile, {
      setOverrides: async () => { throw Object.assign(new Error('Release Week cannot be granted to this role.'), { code: 'functions/failed-precondition', details: { reason: 'role-not-grantable' } }); },
    });
    await openAndSelect(context, 'eng@example.test');
    flip(dom, 'week.manage', true);
    await settle();
    assert.equal(stateOf(dom, 'week.manage'), 'OFF', 'reverted to the previous effective value');
    assert.equal(switchOf(dom, 'week.manage').checked, false);
    assert.equal(switchOf(dom, 'week.manage').disabled, false, 'the Admin can try again');
    assert.equal(dom.element('userPermissionsMessage').textContent, 'Release Week cannot be granted to this role.');
    assert.ok(dom.element('userPermissionsMessage').classList.contains('error'));
  });

  test(`${profile}: an unexpected failure reverts the switch with a plain message`, async () => {
    const { context, dom } = makeContext(profile, { setOverrides: async () => { throw new TypeError('Failed to fetch'); } });
    await openAndSelect(context, 'eng@example.test');
    flip(dom, 'gantt.manage', true);
    await settle();
    assert.equal(stateOf(dom, 'gantt.manage'), 'OFF');
    assert.equal(dom.element('userPermissionsMessage').textContent, 'Unable to save this change. The switch was put back.');
  });

  test(`${profile}: a revision conflict reloads the latest settings and shows them, without retrying`, async () => {
    const { context, dom, calls, store } = makeContext(profile, {
      permissions: { 'eng@example.test': { overrides: {}, revision: 1 } },
      setOverrides: async (_data, liveStore) => {
        liveStore.permissions['eng@example.test'] = { overrides: { 'week.manage': true }, revision: 2 };
        throw Object.assign(new Error('conflict'), { code: 'functions/aborted', details: { reason: 'permission-revision-conflict' } });
      },
    });
    await openAndSelect(context, 'eng@example.test');
    flip(dom, 'gantt.manage', true);
    await settle();
    assert.equal(calls.api.length, 1, 'no automatic retry');
    assert.equal(stateOf(dom, 'week.manage'), 'ON', 'shows the other Admin\'s change');
    assert.equal(stateOf(dom, 'gantt.manage'), 'OFF', 'the stale request was not applied');
    assert.match(dom.element('userPermissionsMessage').textContent, /changed by someone else\. The latest settings are shown/);
    assert.ok(dom.element('userPermissionsMessage').classList.contains('error'));
    assert.equal(store.permissions['eng@example.test'].revision, 2);
    // The next change uses the reloaded revision.
    context.userPermissionsApi.setOverrides = async data => { calls.api.push(structuredClone(data)); return successfulCallable(data, store); };
    flip(dom, 'gantt.manage', true);
    await settle();
    assert.equal(calls.api[1].expectedRevision, 2);
  });

  test(`${profile}: a second change cannot start while one is saving`, async () => {
    const { context, dom, calls } = makeContext(profile, { setOverrides: successfulCallable });
    await openAndSelect(context, 'eng@example.test');
    flip(dom, 'gantt.manage', true);
    await context.window.setUserPermissionSwitch('project.manage', true);
    await settle();
    assert.equal(calls.api.length, 1);
    assert.equal(stateOf(dom, 'project.manage'), 'OFF');
  });

  test(`${profile}: an auth transition invalidates an open permissions session and ignores late answers`, async () => {
    const source = PROFILES[profile];
    assert.match(sliceBody(source, 'function resetCurrentUserPermissions() {', '\n}\n'), /invalidateUserPermissionsSession\(\);/);
    let release;
    const { context, dom, calls } = makeContext(profile, {
      setOverrides: (data, store) => new Promise(resolve => { release = () => resolve(successfulCallable(data, store)); }),
    });
    await openAndSelect(context, 'bonnie@example.test');
    flip(dom, 'gantt.manage', true);
    vm.runInContext('invalidateUserPermissionsSession();', context);
    release();
    await settle();
    assert.equal(dom.element('userPermissionsOverlay').classList.contains('open'), false);
    assert.equal(calls.toast.length, 0);
    await context.window.setUserPermissionSwitch('week.manage', true);
    assert.equal(calls.api.length, 1, 'no further change once the session is invalid');
  });
}

test('Production Pages renders the User Permissions entry point and overlay', () => {
  for (const source of Object.values(PROFILES)) {
    assert.match(source, /<button id="userPermissionsBtn" class="btn-icon admin-only[^"]*" style="display:none;" onclick="openUserPermissions\(\)" title="User Permissions"/);
    assert.match(source, /<div class="overlay" id="userPermissionsOverlay" role="dialog" aria-modal="true" aria-labelledby="userPermissionsTitle">/);
    assert.equal(source.split('// ── USER PERMISSIONS (Admin only) ──').length - 1, 1);
    assert.doesNotMatch(sliceBody(source, '// ── USER PERMISSIONS (Admin only) ──', '// ── WEEK MANAGEMENT COMBINED LOGIC ──'),
      /setDoc|updateDoc|deleteDoc|runTransaction|innerHTML/, 'all writes go through the callable and rendering uses text nodes');
  }
});

// ── Target-selection race: the selector and the displayed/saved target can never diverge, even mid-save.
const selectorOf = dom => dom.element('userPermissionsUserSelect');
const detailEmail = dom => dom.element('userPermissionsEmail').textContent;
// Whenever the detail panel is visible, the selector must show exactly the target it describes.
function assertTargetIdentity(dom, expectedEmail, label) {
  assert.equal(dom.element('userPermissionsDetail').hidden, false, `${label}: detail visible`);
  assert.equal(selectorOf(dom).value, expectedEmail, `${label}: selector value`);
  assert.equal(detailEmail(dom), expectedEmail, `${label}: detail email`);
}
// The browser changes a native select's value before firing its change handler; mimic that.
const chooseInBrowser = (dom, context, email) => { selectorOf(dom).value = email; return context.window.selectUserPermissionsUser(email); };

for (const profile of Object.keys(PROFILES)) {
  test(`${profile}: race - selecting another user while a save is pending is blocked, the selector stays on the saved user, and selecting works afterwards`, async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { context, dom, calls } = makeContext(profile, {
      permissions: { 'bonnie@example.test': { overrides: {}, revision: 1 } },
      setOverrides: async (data, store) => { await gate; return successfulCallable(data, store); },
    });
    await openAndSelect(context, 'bonnie@example.test');
    assertTargetIdentity(dom, 'bonnie@example.test', 'loaded');
    assert.equal(selectorOf(dom).disabled, false);

    flip(dom, 'gantt.manage', true);
    await settle();
    assert.equal(selectorOf(dom).disabled, true, 'the selector is locked while saving');
    assert.equal(switchOf(dom, 'week.manage').disabled, true, 'switches stay locked');
    const readsBefore = calls.reads.length;

    // The native select is disabled, but a programmatic change event must also fail closed.
    await chooseInBrowser(dom, context, 'eng@example.test');
    await settle();
    assertTargetIdentity(dom, 'bonnie@example.test', 'after attempted switch');
    assert.equal(calls.reads.length, readsBefore, 'no Engineering permission load began');
    assert.match(dom.element('userPermissionsMessage').textContent, /Finish saving this change before selecting another user\./);
    // A second switch cannot reach the wrong user either.
    flip(dom, 'week.manage', true);
    await settle();
    assert.equal(calls.api.length, 1, 'only the pending save was sent');
    assert.equal(calls.api[0].targetEmail, 'bonnie@example.test');

    release();
    await settle();
    assert.equal(selectorOf(dom).disabled, false, 'the selector is usable again');
    assertTargetIdentity(dom, 'bonnie@example.test', 'after save');
    assert.equal(stateOf(dom, 'gantt.manage'), 'ON');
    assert.equal(calls.api.length, 1);
    assert.match(dom.element('userPermissionsMessage').textContent, /^Saved\. The permission change applies immediately\.$/);
    flip(dom, 'week.manage', true);
    await settle();
    assert.equal(calls.api[1].targetEmail, 'bonnie@example.test', 'the next switch still targets the displayed user');

    await chooseInBrowser(dom, context, 'eng@example.test');
    await settle();
    assertTargetIdentity(dom, 'eng@example.test', 'after manual selection');
    flip(dom, 'gantt.manage', true);
    await settle();
    assert.equal(calls.api.at(-1).targetEmail, 'eng@example.test');
  });

  test(`${profile}: race - a rejected save re-enables the selector and keeps selector and detail on the original user`, async () => {
    let reject;
    const gate = new Promise((_, fail) => { reject = fail; });
    const { context, dom, calls } = makeContext(profile, { setOverrides: async () => { await gate; } });
    await openAndSelect(context, 'bonnie@example.test');
    flip(dom, 'gantt.manage', true);
    await settle();
    assert.equal(selectorOf(dom).disabled, true);
    await chooseInBrowser(dom, context, 'eng@example.test');
    await settle();
    assertTargetIdentity(dom, 'bonnie@example.test', 'pending, attempted switch');
    reject(new TypeError('Failed to fetch'));
    await settle();
    assert.equal(selectorOf(dom).disabled, false);
    assertTargetIdentity(dom, 'bonnie@example.test', 'after rejected save');
    assert.equal(stateOf(dom, 'gantt.manage'), 'OFF', 'the switch was put back');
    assert.equal(calls.api.length, 1);
  });

  test(`${profile}: race - the selector always follows the loaded target, including after a revision conflict reload`, async () => {
    const { context, dom } = makeContext(profile, {
      permissions: { 'bonnie@example.test': { overrides: {}, revision: 1 } },
      setOverrides: async () => { throw Object.assign(new Error('conflict'), { code: 'functions/aborted', details: { reason: 'permission-revision-conflict' } }); },
    });
    await openAndSelect(context, 'bonnie@example.test');
    flip(dom, 'gantt.manage', true);
    await settle();
    assert.equal(selectorOf(dom).disabled, false);
    assertTargetIdentity(dom, 'bonnie@example.test', 'after conflict reload');
  });

  // ── Captured-target regression. Each user gets a distinct stored revision, so a callable payload that ever reached
  // another user would show up in the email AND the revision.
  const TARGET_PERMISSIONS = {
    'bonnie@example.test': { overrides: {}, revision: 3 },
    'eng@example.test': { overrides: {}, revision: 7 },
    'vip@example.test': { overrides: {}, revision: 11 },
  };
  const untouched = (store, email) => JSON.stringify(store.permissions[email]) === JSON.stringify(TARGET_PERMISSIONS[email]);

  test(`${profile}: race - the saved target is the one captured at click time, even if the selector already shows another user`, async () => {
    const { context, dom, calls, store } = makeContext(profile, { permissions: TARGET_PERMISSIONS, setOverrides: successfulCallable });
    await openAndSelect(context, 'bonnie@example.test');
    assertTargetIdentity(dom, 'bonnie@example.test', 'loaded');
    // The selector value drifts to another user without the change handler having run (programmatic / out-of-order event).
    selectorOf(dom).value = 'eng@example.test';
    flip(dom, 'gantt.manage', true);
    await settle();
    assert.equal(calls.api.length, 1, 'exactly one callable call');
    assert.equal(calls.api[0].targetEmail, 'bonnie@example.test', 'the payload targets the displayed/captured user');
    assert.equal(calls.api[0].expectedRevision, 3, 'with that user\'s revision, not the drifted selection\'s');
    assert.ok(untouched(store, 'eng@example.test'), 'the drifted-to user was never written');
    assert.equal(store.permissions['bonnie@example.test'].overrides['gantt.manage'], true);
    assertTargetIdentity(dom, 'bonnie@example.test', 'after save: the selector is reconciled to the saved target');
  });

  test(`${profile}: race - the callable payload is built only from the target captured at click time, never from the selector or later state`, () => {
    const body = sliceBody(PROFILES[profile], 'window.setUserPermissionSwitch = async', '\n};\n');
    // renderUserPermissionsTarget() reconciles a drifted selector before the payload is read, so a payload built from the
    // selector would be indistinguishable in behavior; this pins the construction itself.
    assert.match(body, /const target = userPermissionsTarget;\n/, 'the target is captured once, before anything else');
    const beforeSend = body.slice(0, body.indexOf('await userPermissionsApi.setOverrides('));
    assert.ok(beforeSend.length > 0 && body.includes('await userPermissionsApi.setOverrides('), 'the send is located');
    assert.doesNotMatch(beforeSend, /userPermissionsUserSelect|userPermissionsUsers/, 'nothing before the send consults the selector or the user list');
    const send = body.match(/await userPermissionsApi\.setOverrides\(\{([^}]*)\}\)/)?.[1];
    assert.equal(send?.replace(/\s+/g, ' ').trim(), 'targetEmail: target.email, expectedRevision: target.revision, changes: change');
    // Everything applied after the answer is tied to the same captured target and the session sequence.
    assert.match(body, /userPermissionsTarget = \{\n\s+\.\.\.target, role: result\?\.role \|\| target\.role/);
    assert.match(body, /await loadUserPermissionsAudit\(target\.email\)/);
  });

  for (const outcome of ['resolves', 'rejects']) {
    test(`${profile}: race - while a save for User A is pending nothing is sent or queued for User B, and the save ${outcome}`, async () => {
      let finish;
      const gate = new Promise(resolve => { finish = resolve; });
      const { context, dom, calls, store } = makeContext(profile, {
        permissions: TARGET_PERMISSIONS,
        setOverrides: async (data, liveStore) => {
          await gate;
          if (outcome === 'rejects') throw new TypeError('Failed to fetch');
          return successfulCallable(data, liveStore);
        },
      });
      await openAndSelect(context, 'bonnie@example.test');
      flip(dom, 'gantt.manage', true);
      await settle();
      assert.equal(calls.api.length, 1);
      const readsBefore = calls.reads.length;

      // Every way of reaching for User B while A is in flight: direct call, browser-order change, rapid alternation,
      // and a programmatic switch change after the selector value was moved.
      await context.window.selectUserPermissionsUser('eng@example.test');
      await chooseInBrowser(dom, context, 'eng@example.test');
      for (const email of ['vip@example.test', 'eng@example.test', 'vip@example.test', 'eng@example.test', 'eng@example.test']) {
        await context.window.selectUserPermissionsUser(email);
      }
      selectorOf(dom).value = 'eng@example.test';
      await context.window.setUserPermissionSwitch('week.manage', true);
      await context.window.setUserPermissionSwitch('project.manage', true);
      flip(dom, 'week.manage', true);
      await settle();
      assert.equal(calls.api.length, 1, 'only User A\'s pending save exists');
      assert.equal(calls.reads.length, readsBefore, 'no permission load began for User B');

      finish();
      await settle();
      await new Promise(resolve => setTimeout(resolve, 25)); // a deferred retry or queued operation would surface here
      await settle();
      assert.equal(calls.api.length, 1, 'no queued or retried call appeared after the save settled');
      assert.equal(calls.api[0].targetEmail, 'bonnie@example.test');
      assert.equal(calls.api[0].expectedRevision, 3);
      for (const other of ['eng@example.test', 'vip@example.test']) {
        assert.ok(untouched(store, other), `${other} was never written`);
        assert.equal(calls.reads.includes(`userPermissions/${other}`), false, `${other}'s permissions were never even loaded`);
      }
      assertTargetIdentity(dom, 'bonnie@example.test', `after the save ${outcome}`);
      assert.equal(selectorOf(dom).disabled, false);
      assert.equal(stateOf(dom, 'gantt.manage'), outcome === 'resolves' ? 'ON' : 'OFF');
      assert.equal(stateOf(dom, 'week.manage'), 'OFF', 'the attempted out-of-turn switch changes were not applied either');
      // Selecting User B deliberately afterwards works, and targets B with B's own revision.
      await chooseInBrowser(dom, context, 'eng@example.test');
      await settle();
      assertTargetIdentity(dom, 'eng@example.test', 'after deliberate selection');
      context.userPermissionsApi.setOverrides = async data => { calls.api.push(structuredClone(data)); return successfulCallable(data, store); };
      flip(dom, 'gantt.manage', true);
      await settle();
      assert.equal(calls.api.length, 2);
      assert.deepEqual([calls.api[1].targetEmail, calls.api[1].expectedRevision], ['eng@example.test', 7]);
    });
  }

  test(`${profile}: a conflict whose reload fails never claims fresh settings, fails closed and lets the same user be selected again`, async () => {
    const { context, dom, calls, store } = makeContext(profile, {
      permissions: TARGET_PERMISSIONS,
      setOverrides: async () => { throw Object.assign(new Error('conflict'), { code: 'functions/aborted', details: { reason: 'permission-revision-conflict' } }); },
    });
    await openAndSelect(context, 'bonnie@example.test');
    const realGetDoc = context.getDoc;
    context.getDoc = async () => { throw new Error('offline'); }; // the authoritative reload itself fails
    flip(dom, 'gantt.manage', true);
    await settle();
    const message = dom.element('userPermissionsMessage');
    assert.doesNotMatch(message.textContent, /latest settings are shown/, 'must not claim settings that were not loaded');
    assert.match(message.textContent, /changed by someone else, and the latest settings could not be loaded\. Select the user again/);
    assert.ok(message.classList.contains('error'));
    assert.equal(dom.element('userPermissionsDetail').hidden, true, 'nothing stale is displayed');
    assert.equal(selectorOf(dom).value, '', 'selector returns to its placeholder so the same user can be picked again');
    assert.equal(selectorOf(dom).disabled, false);
    assert.equal(calls.api.length, 1, 'no automatic retry');
    assert.ok(untouched(store, 'bonnie@example.test'), 'and nothing was written');
    // Recovery: selecting the same user again loads authoritative state and clears the message.
    context.getDoc = realGetDoc;
    await chooseInBrowser(dom, context, 'bonnie@example.test');
    await settle();
    assertTargetIdentity(dom, 'bonnie@example.test', 'after re-selecting the same user');
    assert.equal(message.textContent, '');
  });

  test(`${profile}: a conflict whose reload succeeds still shows the latest settings and says so`, async () => {
    const { context, dom } = makeContext(profile, {
      permissions: TARGET_PERMISSIONS,
      setOverrides: async (_data, liveStore) => {
        liveStore.permissions['bonnie@example.test'] = { overrides: { 'project.manage': true }, revision: 4 };
        throw Object.assign(new Error('conflict'), { code: 'functions/aborted', details: { reason: 'permission-revision-conflict' } });
      },
    });
    await openAndSelect(context, 'bonnie@example.test');
    flip(dom, 'gantt.manage', true);
    await settle();
    assert.match(dom.element('userPermissionsMessage').textContent, /changed by someone else\. The latest settings are shown/);
    assertTargetIdentity(dom, 'bonnie@example.test', 'after a successful reload');
    assert.equal(stateOf(dom, 'project.manage'), 'ON');
  });
}
