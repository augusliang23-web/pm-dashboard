// Reviewer Findings Remediation (Control Plane, on top of fcca7b6): HIGH #1 -- the UAT branch of the dispatched
// onAuthStateChanged handler referenced an undefined `nextDirectory` variable (a leftover artifact of an earlier
// Phase 2 merge/dispatch reconstruction; the true UAT a04c0c1 baseline never had it). The reference threw a
// ReferenceError inside the try block, which the surrounding catch treated as a failed login and signed the user
// back out -- so every UAT login appeared to "fail" immediately after succeeding.
//
// tests/auth-session.uat.test.mjs already asserts the *shape* of this handler's source (ordering of awaits/guards),
// but never executes it, so it could not have caught a runtime ReferenceError. These tests extract the real,
// dispatched UAT handler body from dashboardSource('uat') and run it in a VM with the real
// isAuthInitializationCurrent import, so a reintroduced undefined-variable reference fails the suite the same way
// it broke production UAT logins.
import { dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { isAuthInitializationCurrent } from '../js/auth-session.mjs';

const dashboard = await dashboardSourceAsync('uat');

// Extracts the literal `async user => { ... }` callback passed as the second argument to the dispatched UAT
// onAuthStateChanged(auth, ...) call, exactly as shipped -- not a hand-copied reconstruction.
function extractOnAuthStateChangedHandlerSource() {
  const callStart = dashboard.indexOf('onAuthStateChanged(auth, async user =>');
  assert.ok(callStart >= 0, 'onAuthStateChanged(auth, ...) call must exist in the UAT view');
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
    hideLoader: 0,
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
    isAuthInitializationCurrent,
    getEmailKey: user => (user?.email || '').trim().toLowerCase(),
    quiesceDashboardForAuthTransition: () => {},
    getDoc: async ref => ref,
    doc: (_db, _col, id) => ({ id }),
    db: {},
    getDashboardRole: () => 'pm',
    loadGanttTemplateConfig: async () => true,
    startProjectManagerSubscription: async () => {},
    resolveWorkstreamTemplateConfig: () => ({}),
    resolveGanttWindowConfig: () => ({}),
    stopPresenceUsageFlushTimer: () => {},
    setupUI: () => { calls.setupUI += 1; },
    initData: () => { calls.initData += 1; },
    startPresenceSystem: () => { calls.startPresenceSystem += 1; },
    hideLoader: () => { calls.hideLoader += 1; },
    showAuthError: message => { calls.showAuthError.push(message); },
    signOut: async () => { calls.signOut += 1; },
    auth: {},
    console: { error: () => { calls.consoleError += 1; } },
    ...overrides,
  });
  vm.runInContext(`var handler = ${extractOnAuthStateChangedHandlerSource()};`, context);
  return { context, calls };
}

test('UAT: a valid login completes, stays signed in, and initializes the PM directory via the live subscription', async () => {
  const { context, calls } = makeContext();
  const user = { uid: 'uid-1', email: 'pm@example.test' };

  // Must not throw. Before the fix, the UAT branch referenced an undefined `nextDirectory`, which threw here and
  // was swallowed by the surrounding try/catch -- this assertion is the one that the original bug violated.
  await assert.doesNotReject(() => context.handler(user));

  assert.equal(calls.setupUI, 1, 'setupUI must run for a valid login');
  assert.equal(calls.initData, 1, 'initData must run for a valid login');
  assert.equal(calls.startPresenceSystem, 1, 'presence must start for a valid login');
  assert.equal(calls.signOut, 0, 'a valid login must not be signed back out');
  assert.equal(calls.consoleError, 0, 'a valid login must not log an initialization failure');
  assert.equal(calls.showAuthError.length, 0, 'a valid login must not surface an auth error');
});

test('UAT: an initial PM-directory subscription failure is still caught, surfaced, and signs the user out', async () => {
  const { context, calls } = makeContext({
    startProjectManagerSubscription: async () => { throw new Error('permission-denied'); },
  });
  const user = { uid: 'uid-2', email: 'pm2@example.test' };

  await context.handler(user);

  // This proves the deleted `nextDirectory.available` toast was not the only signal for a broken PM directory --
  // startProjectManagerSubscription's own reject-on-first-failure path (tested directly in
  // tests/dashboard-display-names.uat.test.mjs) still reaches the catch block and reports the failure.
  assert.equal(calls.setupUI, 0);
  assert.equal(calls.initData, 0);
  assert.equal(calls.consoleError, 1);
  assert.equal(calls.showAuthError.length, 1);
  assert.equal(calls.signOut, 1);
});

test('UAT: a user with no assigned dashboard role is rejected and signed out with the expected message', async () => {
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

test('UAT: an unauthorized/unreadable account is rejected and signed out without initializing the dashboard', async () => {
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

test('UAT: sign-out resets shared Gantt Template and Gantt Window state without throwing', async () => {
  // Gantt Window became shared/common functionality during consolidation (it postdates the frozen UAT a04c0c1
  // baseline); the logout branch resets its state the same way Production's own e1f0e5c baseline does. This is not
  // a regression of HIGH #1 -- it is verified here so the shared reset path stays covered.
  const { context } = makeContext();
  await assert.doesNotReject(() => context.handler(null));
});
