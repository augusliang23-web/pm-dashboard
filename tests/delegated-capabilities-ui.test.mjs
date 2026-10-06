// Client side of the delegable capabilities gantt.manage, project.manage and week.release (in both profiles): the
// real index.html handlers run in a VM against the real permission registry. The server enforces the same
// capabilities (functions/test/capability-enforcement.test.cjs); these tests prove the browser shows and runs the
// controls only for effective holders, fails closed on direct calls, and that Admin's role alone is no longer the
// gate (an Admin whose capability resolves false would be denied, and a delegate with it is allowed).
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { canReadDraftWeeks, normalizeDashboardRole } from './helpers/pages-access.mjs';
import { can, normalizePermissionOverrides } from '../js/permission-registry.mjs';
import { dashboardSource } from './helpers/dashboard-source.mjs';

const PROFILES = { production: dashboardSource('production') };

function sliceBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `source must define ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `source must close ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}

class Element {
  constructor(classes = []) { Object.assign(this, { style: {}, textContent: '', innerHTML: '', value: '', disabled: false, dataset: {}, className: '', __classes: classes }); }
  get classList() { return { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  appendChild() {}
}
function makeDom() {
  const elements = new Map();
  for (const [id, classes] of [['manageWeeksBtn', ['vip-hidden']], ['userPermissionsBtn', ['admin-only', 'vip-hidden']], ['addProjectBtn', ['admin-only']],
    ['ganttTemplateSettingsBtn', ['admin-only']], ['ganttWindowSettingsBtn', ['admin-only']], ['topPmSelect', ['vip-hidden']]]) {
    elements.set(id, new Element(classes));
  }
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const document = {
    getElementById: element,
    createElement: () => new Element(),
    querySelectorAll: selector => (selector.startsWith('.') ? [...elements.values()].filter(el => el.__classes.includes(selector.slice(1))) : []),
  };
  return { document, element };
}
const capabilityFor = (rawRole, overrides) => capability => can(capability, { role: rawRole, overrides: normalizePermissionOverrides(overrides) });

function setupContext(profile, rawRole, overrides = {}) {
  const source = PROFILES[profile];
  const dom = makeDom();
  const context = vm.createContext({
    window: {}, console, document: dom.document,
    currentRole: 'pm', currentRawRole: null, currentPermissionOverrides: normalizePermissionOverrides(overrides),
    currentUser: { uid: 'uid', email: 'tester@example.com' }, PM_LIST: [], isOverview: false, isAdminVipPreview: false, isAdminExecutivePreview: false,
    DASHBOARD_RELEASE: 'v2.1', DASHBOARD_BASE_COMMIT: 'test', canWithPermissions: can, canReadDraftWeeks, normalizeDashboardRole,
    invalidateProjectEditorSession() {}, invalidateGanttTemplateSession() {}, invalidateGanttWindowSession() {}, loadOverviewScopeForCurrentUser() {},
    getUserDisplayName: () => 'Tester', getEmailKey: () => 'tester', escHtml: value => value, updateMasterDataLists() {}, refreshFxRates() {},
    syncProjectManagerFilterOptions() {}, refreshExecutivePendingCount() {},
    weeksUnsub: null, authSessionGeneration: 1, db: {}, subscribed: [],
    collection: (_db, name) => ({ collection: name }), doc: (_db, name, id) => ({ doc: `${name}/${id}` }),
    query: (ref, constraint) => ({ ...ref, constraint }), where: (field, operator, value) => ({ type: 'where', field, operator, value }),
    orderBy: field => ({ type: 'orderBy', field }), isAuthInitializationCurrent: () => true,
    executiveTimelineConfigUnsub: null, executiveLiveTimelineUnsub: null, executivePendingMilestoneUnsub: null,
  });
  context.onSnapshot = ref => { context.subscribed.push(ref); return () => {}; };
  vm.runInContext([
    sliceBody(source, 'function getDashboardRole(', '\n}\n'),
    sliceBody(source, 'function canCurrentUser(', '\n}\n'),
    sliceBody(source, 'function setupUI(', '\n}\n'),
    sliceBody(source, 'function initData(', '\n}\n'),
    'this.setupUI = setupUI; this.getDashboardRole = getDashboardRole; this.initData = initData;',
  ].join('\n'), context);
  context.currentRole = context.getDashboardRole({ exists: () => true, data: () => ({ role: rawRole }) });
  return { context, dom };
}

// [raw role, overrides, gantt.manage, project.manage]
const MATRIX = [
  ['admin', {}, true, true],
  ['admin', { 'gantt.manage': false, 'project.manage': false }, true, true],
  ['pm', {}, false, false],
  ['pm', { 'gantt.manage': true }, true, false],
  ['pm', { 'project.manage': true }, false, true],
  ['pm', { 'gantt.manage': true, 'project.manage': true }, true, true],
  ['pm', { 'week.manage': true, 'week.release': true }, false, false],
  ['engineering', { 'gantt.manage': true, 'project.manage': true }, true, false],
  ['business', { 'gantt.manage': true }, true, false],
  ['sales', { 'project.manage': true }, false, false],
  ['vip', {}, false, false],
  ['vip', { 'gantt.manage': true, 'project.manage': true }, true, false],
  ['executive', { 'gantt.manage': true, 'project.manage': true }, true, false],
];
const label = (profile, role, overrides) => `${profile} ${role} ${JSON.stringify(overrides)}`;

test('setupUI shows the Gantt settings buttons and Add Project only for effective capability holders', () => {
  for (const profile of Object.keys(PROFILES)) {
    for (const [role, overrides, gantt, project] of MATRIX) {
      const { context, dom } = setupContext(profile, role, overrides);
      context.setupUI();
      const shown = id => dom.element(id).style.display !== 'none';
      assert.equal(shown('ganttTemplateSettingsBtn'), gantt, `${label(profile, role, overrides)} template button`);
      assert.equal(shown('ganttWindowSettingsBtn'), gantt, `${label(profile, role, overrides)} window button`);
      assert.equal(shown('addProjectBtn'), project, `${label(profile, role, overrides)} Add Project`);
      assert.equal(dom.element('userPermissionsBtn').style.display, role === 'admin' ? 'inline-flex' : 'none', 'permissions page stays raw-role Admin only');
    }
  }
});

test('setupUI re-hides delegated controls when the next session lacks the override', () => {
  for (const profile of Object.keys(PROFILES)) {
    const { context, dom } = setupContext(profile, 'pm', { 'gantt.manage': true, 'project.manage': true });
    context.setupUI();
    assert.notEqual(dom.element('ganttWindowSettingsBtn').style.display, 'none');
    context.currentPermissionOverrides = {};
    context.setupUI();
    for (const id of ['ganttTemplateSettingsBtn', 'ganttWindowSettingsBtn', 'addProjectBtn']) assert.equal(dom.element(id).style.display, 'none', `${profile} ${id}`);
  }
});

// ── Gantt handlers: with the capability OFF every handler returns before touching the DOM, the API or any session.
const GANTT_HANDLERS = [
  ['function isGanttTemplateSessionCurrent(', '\n}\n', 'isGanttTemplateSessionCurrent'],
  ['window.openGanttTemplateSettings = () => {', '\n};\n', 'window.openGanttTemplateSettings'],
  ['window.addGanttTemplateRow = level => {', '\n};\n', 'window.addGanttTemplateRow'],
  ['window.moveGanttTemplateRow = (button, direction) => {', '\n};\n', 'window.moveGanttTemplateRow'],
  ['window.deleteGanttTemplateRow = button => {', '\n};\n', 'window.deleteGanttTemplateRow'],
  ['window.saveGanttTemplateSettings = async () => {', '\n};\n', 'window.saveGanttTemplateSettings'],
  ['function isGanttWindowSessionCurrent(', '\n}\n', 'isGanttWindowSessionCurrent'],
  ['window.openGanttWindowSettings = () => {', '\n};\n', 'window.openGanttWindowSettings'],
  ['window.addGanttWindowOverrideRow = () => {', '\n};\n', 'window.addGanttWindowOverrideRow'],
  ['window.removeGanttWindowOverrideRow = button => {', '\n};\n', 'window.removeGanttWindowOverrideRow'],
  ['window.saveGanttWindowSettings = async () => {', '\n};\n', 'window.saveGanttWindowSettings'],
  ['window.previewGanttWindowSettings = async () => {', '\n};\n', 'window.previewGanttWindowSettings'],
];

function ganttContext(profile, { rawRole, overrides = {}, currentRole = 'admin' }) {
  const source = PROFILES[profile];
  const touched = [];
  const trap = name => () => { touched.push(name); throw new Error(`${name} must not be reached`); };
  const session = Object.freeze({ token: 's-1', authUid: 'uid', authEmail: 'tester', role: currentRole, revision: 1 });
  const context = vm.createContext({
    window: {}, console, currentRole, isAdminVipPreview: false, isAdminExecutivePreview: false, currentUser: { uid: 'uid', email: 'tester' },
    getEmailKey: () => 'tester', canCurrentUser: capability => capability === 'gantt.manage' && capabilityFor(rawRole, overrides)(capability),
    ganttTemplateSession: session, ganttWindowSession: session, ganttTemplateSaveInFlight: false, ganttWindowSaveInFlight: false,
    ganttWindowPreviewInFlight: false, ganttTemplateSubscriptionReady: true, ganttTemplateSessionSequence: 0, ganttWindowSessionSequence: 0,
    ganttTemplateSessionConflicted: false, ganttWindowSessionConflicted: false, currentGanttTemplateRevision: 1, currentGanttWindowRevision: 1,
    currentGanttTemplateConfig: {}, currentGanttWindowConfig: {},
    document: { getElementById: trap('document.getElementById') },
    projectDashboardApi: { saveGanttTemplateSettings: trap('saveGanttTemplateSettings'), saveGanttWindowSettings: trap('saveGanttWindowSettings') },
    openAccessibleModal: trap('openAccessibleModal'), renderGanttTemplateDraft: trap('renderGanttTemplateDraft'), renderGanttWindowDraft: trap('renderGanttWindowDraft'),
    fetchOnePagerPreviewHtml: trap('fetchOnePagerPreviewHtml'), ganttTemplateListId: trap('ganttTemplateListId'), renderGanttWindowOverrideRow: trap('renderGanttWindowOverrideRow'),
  });
  for (const [start, end] of GANTT_HANDLERS) vm.runInContext(sliceBody(source, start, end), context);
  return { context, touched };
}

test('with gantt.manage OFF every Gantt handler fails closed in both profiles, even for a raw Admin role', async () => {
  for (const profile of Object.keys(PROFILES)) {
    for (const [rawRole, overrides, currentRole] of [['admin', { 'gantt.manage': false }, 'admin'], ['pm', {}, 'pm'], ['engineering', { 'week.manage': true }, 'engineering'], ['vip', {}, 'vip']]) {
      // A raw Admin whose capability is forced off by the stub proves the role no longer gates the handlers.
      const { context, touched } = ganttContext(profile, { rawRole: rawRole === 'admin' ? 'pm' : rawRole, overrides, currentRole });
      for (const [, , name] of GANTT_HANDLERS) {
        const handler = name.startsWith('window.') ? context.window[name.slice(7)] : vm.runInContext(name, context);
        const args = name.includes('moveGanttTemplateRow') ? [{ closest: () => null }, 1] : [name.includes('TemplateRow') ? { closest: () => null } : 'system'];
        const result = name.startsWith('isGantt') ? handler(context.ganttTemplateSession) : handler(...args);
        if (name.startsWith('isGantt')) assert.equal(result, false, `${profile} ${rawRole} ${name}`);
        else assert.equal(await Promise.resolve(result), undefined, `${profile} ${rawRole} ${name}`);
      }
      assert.deepEqual(touched, [], `${profile} ${rawRole}: no DOM/API/modal access`);
    }
  }
});

test('with gantt.manage ON the open handlers run for a non-Admin delegate in both profiles', () => {
  for (const profile of Object.keys(PROFILES)) {
    for (const [rawRole, currentRole] of [['pm', 'pm'], ['engineering', 'engineering'], ['vip', 'vip'], ['executive', 'vip']]) {
      const { context } = ganttContext(profile, { rawRole, overrides: { 'gantt.manage': true }, currentRole });
      const opened = [];
      Object.assign(context, {
        openAccessibleModal: element => opened.push(element.id), renderGanttTemplateDraft() {}, renderGanttWindowDraft() {},
        document: { getElementById: id => ({ id, textContent: '', classList: { contains: () => true } }) },
      });
      context.window.openGanttTemplateSettings();
      context.window.openGanttWindowSettings();
      assert.deepEqual(opened, ['ganttTemplateOverlay', 'ganttWindowOverlay'], `${profile} ${rawRole}`);
    }
  }
});

test('Admin previewing as VIP/Executive cannot open Gantt settings, even though the capability is on', () => {
  for (const profile of Object.keys(PROFILES)) {
    const { context } = ganttContext(profile, { rawRole: 'admin', overrides: {}, currentRole: 'admin' });
    Object.assign(context, { isAdminVipPreview: true, isAdminExecutivePreview: true, openAccessibleModal: () => assert.fail('must not open') });
    context.canCurrentUser = () => true;
    context.window.openGanttTemplateSettings();
    context.window.openGanttWindowSettings();
  }
});

test('no Gantt handler still gates on a raw Admin role', () => {
  for (const [profile, source] of Object.entries(PROFILES)) {
    for (const [start, end, name] of GANTT_HANDLERS) {
      const body = sliceBody(source, start, end);
      assert.doesNotMatch(body, /currentRole [!=]== 'admin'/, `${profile} ${name}`);
      assert.match(body, /canCurrentUser\('gantt\.manage'\)/, `${profile} ${name}`);
    }
  }
});

// ── Projects: Add, delete-only editor mode, visibility stays Admin-only, normal editing unchanged.
function openProjEditGuard(profile, { rawRole, overrides = {}, isNew, canEdit, released = false, ready = true }) {
  const source = PROFILES[profile];
  // The real guard prefix of openProjEdit, closed right where the editor starts to populate its fields.
  const guardFunction = sliceBody(source, 'window.openProjEdit = (code, isNew = false) => {', 'isCreatingNew = isNew;')
    .replace(/isCreatingNew = isNew;$/, 'return { opened: true, manageOnly };\n};\n');
  const context = vm.createContext({
    window: {}, allWeeks: [{ projects: [{ code: 'ALPHA' }] }], currentIdx: 0, ganttTemplateSubscriptionReady: ready,
    isWeekReleased: () => released, canEditProject: () => canEdit, canCurrentUser: capabilityFor(rawRole, overrides),
  });
  vm.runInContext(guardFunction, context);
  return context.window.openProjEdit(isNew ? '' : 'ALPHA', isNew);
}

test('Add New Project opens only for project.manage holders and the Admin role alone no longer decides it', () => {
  for (const profile of Object.keys(PROFILES)) {
    for (const [role, overrides, , project] of MATRIX) {
      const result = openProjEditGuard(profile, { rawRole: role, overrides, isNew: true, canEdit: false });
      assert.equal(Boolean(result?.opened), project, label(profile, role, overrides));
    }
    assert.equal(openProjEditGuard(profile, { rawRole: 'pm', overrides: { 'project.manage': true }, isNew: true, canEdit: false, released: true }), undefined, 'released weeks stay locked');
    assert.equal(openProjEditGuard(profile, { rawRole: 'pm', overrides: { 'project.manage': true }, isNew: true, canEdit: false, ready: false }), undefined, 'templates must be loaded');
  }
});

test('editing an existing project: owners and Admin edit normally; a project.manage holder who may not edit gets the delete-only editor', () => {
  for (const profile of Object.keys(PROFILES)) {
    // Owner/Admin (canEditProject true): full editor, with or without the capability.
    assert.deepEqual({ ...openProjEditGuard(profile, { rawRole: 'pm', isNew: false, canEdit: true }) }, { opened: true, manageOnly: false });
    assert.deepEqual({ ...openProjEditGuard(profile, { rawRole: 'pm', overrides: { 'project.manage': false }, isNew: false, canEdit: true }) }, { opened: true, manageOnly: false });
    // Non-owner with the capability: delete-only.
    assert.deepEqual({ ...openProjEditGuard(profile, { rawRole: 'pm', overrides: { 'project.manage': true }, isNew: false, canEdit: false }) }, { opened: true, manageOnly: true });
    // Non-owner without it: nothing opens.
    assert.equal(openProjEditGuard(profile, { rawRole: 'pm', isNew: false, canEdit: false }), undefined);
    assert.equal(openProjEditGuard(profile, { rawRole: 'engineering', overrides: { 'project.manage': true }, isNew: false, canEdit: false }), undefined, 'only PM can be granted it');
    assert.equal(openProjEditGuard(profile, { rawRole: 'vip', overrides: { 'project.manage': true }, isNew: false, canEdit: false }), undefined, 'VIP cannot be granted it');
  }
});

function actionBlock(profile, { rawRole, overrides = {}, currentRole, isNew, manageOnly }) {
  const source = PROFILES[profile];
  const start = source.indexOf("const actionDiv = document.getElementById('adminProjActions');");
  const end = source.indexOf('projectEditorSession = Object.freeze({', start);
  assert.ok(start >= 0 && end > start);
  const dom = makeDom();
  const visibilityLabel = new Element();
  const actionDiv = Object.assign(new Element(), { querySelector: selector => (selector.includes('pe_visibility') ? visibilityLabel : null) });
  dom.document.getElementById = id => ({ adminProjActions: actionDiv }[id] || dom.element(id));
  const context = vm.createContext({ document: dom.document, currentRole, canCurrentUser: capabilityFor(rawRole, overrides), isNew, manageOnly });
  vm.runInContext(sliceBody(source, "const actionDiv = document.getElementById('adminProjActions');", 'projectEditorSession = Object.freeze({').replace('projectEditorSession = Object.freeze({', ''), context);
  return { dom, actionDiv, visibilityLabel };
}

test('the editor shows Delete for project.manage holders, keeps Project visibility Admin-only, and hides Save in delete-only mode', () => {
  for (const profile of Object.keys(PROFILES)) {
    const admin = actionBlock(profile, { rawRole: 'admin', currentRole: 'admin', isNew: false, manageOnly: false });
    assert.equal(admin.actionDiv.style.display, 'block');
    assert.equal(admin.dom.element('pe_btn_delete').style.display, 'inline-block');
    assert.equal(admin.dom.element('pe_visibility').style.display, '');
    assert.equal(admin.dom.element('pe_btn_save').style.display, '');

    const delegate = actionBlock(profile, { rawRole: 'pm', overrides: { 'project.manage': true }, currentRole: 'pm', isNew: false, manageOnly: true });
    assert.equal(delegate.actionDiv.style.display, 'block');
    assert.equal(delegate.dom.element('pe_btn_delete').style.display, 'inline-block');
    assert.equal(delegate.dom.element('pe_visibility').style.display, 'none', 'visibility stays an Admin-only editor control');
    assert.equal(delegate.visibilityLabel.style.display, 'none');
    assert.equal(delegate.dom.element('pe_btn_save').style.display, 'none');
    assert.equal(delegate.dom.element('pe_manage_only_note').style.display, 'block');

    const owner = actionBlock(profile, { rawRole: 'pm', currentRole: 'pm', isNew: false, manageOnly: false });
    assert.equal(owner.actionDiv.style.display, 'none', 'an ordinary owner sees no admin actions');
    assert.equal(owner.dom.element('pe_btn_delete').style.display, 'none');
    assert.equal(owner.dom.element('pe_btn_save').style.display, '');

    const created = actionBlock(profile, { rawRole: 'pm', overrides: { 'project.manage': true }, currentRole: 'pm', isNew: true, manageOnly: false });
    assert.equal(created.dom.element('pe_btn_delete').style.display, 'none', 'a new project has nothing to delete yet');
  }
});

test('deleteProject and saveProjEdit honor the capability and the delete-only mode on direct calls', async () => {
  for (const profile of Object.keys(PROFILES)) {
    const source = PROFILES[profile];
    const run = async (rawRole, overrides, session) => {
      const calls = { confirm: 0, collect: 0 };
      const context = vm.createContext({
        window: {}, projectMutationInFlight: false, projectEditorSession: session, isProjectEditorSessionCurrent: () => true,
        showProjectMutationError() {}, confirm: () => { calls.confirm += 1; return false; },
        collectEditorResources: () => { calls.collect += 1; return null; }, canCurrentUser: capabilityFor(rawRole, overrides),
      });
      vm.runInContext(`${sliceBody(source, 'window.deleteProject = async () => {', '\n};\n')}\n${sliceBody(source, 'window.saveProjEdit = async () => {', '\n};\n')}`, context);
      await context.window.deleteProject();
      await context.window.saveProjEdit();
      return calls;
    };
    // Capability OFF: delete never reaches the confirmation.
    assert.equal((await run('pm', {}, { manageOnly: false, role: 'pm' })).confirm, 0, `${profile} pm without project.manage`);
    assert.equal((await run('admin', { 'project.manage': false }, { manageOnly: false, role: 'admin' })).confirm, 1, `${profile} Admin keeps delete (role default, locked)`);
    assert.equal((await run('pm', { 'project.manage': true }, { manageOnly: true, role: 'pm' })).confirm, 1, `${profile} PM delegate may delete`);
    assert.equal((await run('engineering', { 'project.manage': true }, { manageOnly: false, role: 'engineering' })).confirm, 0, `${profile} only PM can be granted it`);
    assert.equal((await run('vip', { 'project.manage': true }, { manageOnly: false, role: 'vip' })).confirm, 0, `${profile} VIP cannot be granted it`);
    // Delete-only mode: Save never reaches the editor collection.
    assert.equal((await run('pm', { 'project.manage': true }, { manageOnly: true })).collect, 0, `${profile} delete-only blocks save`);
    assert.equal((await run('pm', {}, { manageOnly: false })).collect, 1, `${profile} normal editing reaches the save flow`);
  }
});

test('normal weekly project editing keeps its ownership contract and the card edit icon follows capability or ownership', () => {
  for (const [profile, source] of Object.entries(PROFILES)) {
    assert.match(source, /const canEdit = canEditProject\(p\) \|\| canCurrentUser\('project\.manage'\);/, `${profile} card edit icon`);
    assert.match(source, /if \(!p \|\| !canEditProject\(p\)\) return;/, `${profile} inline editing keeps canEditProject`);
    assert.doesNotMatch(sliceBody(source, 'window.deleteProject = async () => {', '\n};\n'), /role !== 'admin'/);
  }
});

// ── Draft-week reads: week.release / project.manage never widen the weeks query (no new draft visibility).
function weekQuery(profile, rawRole, overrides) {
  const { context } = setupContext(profile, rawRole, overrides);
  context.initData(1, context.currentUser);
  return context.subscribed.find(ref => ref.collection === 'weeks').constraint;
}

test('week.release and project.manage overrides never widen the weeks query, and baselines stay unchanged', () => {
  const ALL = { type: 'orderBy', field: 'weekLabel' };
  const RELEASED = { type: 'where', field: 'isReleased', operator: '==', value: true };
  const cases = [
    ['production', 'engineering', {}, ALL],
    ['production', 'vip', { 'week.release': true }, RELEASED],
  ];
  for (const [profile, role, overrides, expected] of cases) {
    assert.deepEqual(weekQuery(profile, role, overrides), expected, label(profile, role, overrides));
  }
});
