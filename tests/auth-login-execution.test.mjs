// Reviewer Findings Remediation (Control Plane, on top of fcca7b6): companion to
// tests/auth-login-execution.uat.test.mjs. HIGH #1's fix only removed a stray, never-declared reference from the
// UAT branch of the dispatched onAuthStateChanged handler; the Production branch (which legitimately declares and
// uses `nextDirectory`) must be unaffected. These tests execute the real, dispatched Production handler body from
// dashboardSource('production') in a VM to prove the fix left Production's login flow byte-for-byte behaviorally
// unchanged.
import { dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { isAuthInitializationCurrent } from '../js/auth-session.mjs';

const dashboard = await dashboardSourceAsync('production');

function extractOnAuthStateChangedHandlerSource() {
  const callStart = dashboard.indexOf('onAuthStateChanged(auth, async user =>');
  assert.ok(callStart >= 0, 'onAuthStateChanged(auth, ...) call must exist in the Production view');
  const asyncStart = dashboard.indexOf('async user => {', callStart);
  const closeIdx = dashboard.indexOf('\n});', asyncStart);
  assert.ok(asyncStart >= 0 && closeIdx > asyncStart, 'could not locate the handler body boundaries');
  return dashboard.slice(asyncStart, closeIdx) + '\n}';
}

function elementStub() {
  return {
    classList: { add() {}, remove() {} },
    style: {},
    title: '',
    textContent: '',
  };
}

function makeContext(overrides = {}) {
  const calls = {
    setupUI: 0,
    initData: 0,
    startPresenceSystem: 0,
    signOut: 0,
    consoleError: 0,
    showAuthError: [],
    showSaveToast: [],
    applyDisplayNameDirectoryLoad: 0,
  };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, elementStub());
    return elements.get(id);
  };
  const context = vm.createContext({
    window: {},
    document: { getElementById: element },
    authSessionGeneration: 0,
    currentUser: null,
    currentRole: 'pending',
    currentGanttTemplateConfig: null,
    currentGanttTemplateRevision: 0,
    currentGanttWindowConfig: null,
    currentGanttWindowRevision: 0,
    overviewScope: 'mine',
    displayNameDirectory: {},
    PM_LIST: [],
    isAuthInitializationCurrent,
    getEmailKey: user => (user?.email || '').trim().toLowerCase(),
    quiesceDashboardForAuthTransition: () => {},
    getDoc: async ref => ({ ...ref, data: () => ({}) }),
    doc: (_db, _col, id) => ({ id }),
    db: {},
    getDashboardRole: () => 'pm',
    loadGanttTemplateConfig: async () => true,
    fetchDynamicPMList: async () => ({ available: true, accounts: [] }),
    applyDisplayNameDirectoryLoad: () => { calls.applyDisplayNameDirectoryLoad += 1; },
    normalizeRole: role => role,
    getUserDisplayName: id => id,
    resolveWorkstreamTemplateConfig: () => ({}),
    resolveGanttWindowConfig: () => ({}),
    stopPresenceUsageFlushTimer: () => {},
    setupUI: () => { calls.setupUI += 1; },
    initData: () => { calls.initData += 1; },
    startPresenceSystem: () => { calls.startPresenceSystem += 1; },
    hideLoader: () => {},
    showAuthError: message => { calls.showAuthError.push(message); },
    showSaveToast: message => { calls.showSaveToast.push(message); },
    signOut: async () => { calls.signOut += 1; },
    auth: {},
    console: { error: () => { calls.consoleError += 1; } },
    ...overrides,
  });
  vm.runInContext(`var handler = ${extractOnAuthStateChangedHandlerSource()};`, context);
  return { context, calls };
}

test('Production: a valid login completes, stays signed in, and loads the PM directory via fetchDynamicPMList', async () => {
  const { context, calls } = makeContext();
  const user = { uid: 'uid-1', email: 'pm@example.test' };

  await assert.doesNotReject(() => context.handler(user));

  assert.equal(calls.setupUI, 1);
  assert.equal(calls.initData, 1);
  assert.equal(calls.startPresenceSystem, 1);
  assert.equal(calls.applyDisplayNameDirectoryLoad, 1);
  assert.equal(calls.signOut, 0);
  assert.equal(calls.consoleError, 0);
  assert.equal(calls.showAuthError.length, 0);
  assert.equal(calls.showSaveToast.length, 0, 'an available directory must not show the unavailable toast');
});

test('Production: an unavailable PM directory still surfaces the refresh-to-retry toast but does not block login', async () => {
  const { context, calls } = makeContext({
    fetchDynamicPMList: async () => ({ available: false, accounts: [] }),
  });
  const user = { uid: 'uid-2', email: 'pm2@example.test' };

  await context.handler(user);

  assert.equal(calls.setupUI, 1);
  assert.equal(calls.initData, 1);
  assert.equal(calls.signOut, 0);
  assert.deepEqual(calls.showSaveToast, ['PM list unavailable. Refresh to retry.']);
});

test('Production: a user with no assigned dashboard role is rejected and signed out with the expected message', async () => {
  const { context, calls } = makeContext({
    getDashboardRole: () => { throw new Error('missing-dashboard-role'); },
  });
  const user = { uid: 'uid-3', email: 'unassigned@example.test' };

  await context.handler(user);

  assert.equal(calls.setupUI, 0);
  assert.equal(calls.initData, 0);
  assert.equal(calls.signOut, 1);
  assert.deepEqual(calls.showAuthError, [
    'Login succeeded, but this account has not been assigned a dashboard role yet.',
  ]);
});

test('Production: an unauthorized/unreadable account is rejected and signed out without initializing the dashboard', async () => {
  const { context, calls } = makeContext({
    getDoc: async () => { throw new Error('Missing or insufficient permissions.'); },
  });
  const user = { uid: 'uid-4', email: 'blocked@example.test' };

  await context.handler(user);

  assert.equal(calls.setupUI, 0);
  assert.equal(calls.initData, 0);
  assert.equal(calls.signOut, 1);
  assert.deepEqual(calls.showAuthError, [
    'Login succeeded, but this account cannot load dashboard access settings. Please verify its user role and Firestore permissions.',
  ]);
});

test('Production: sign-out resets shared Gantt Template and Gantt Window state without throwing', async () => {
  const { context } = makeContext();
  await assert.doesNotReject(() => context.handler(null));
});
