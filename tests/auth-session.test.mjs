import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isAuthInitializationCurrent } from '../js/auth-session.mjs';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('a delayed user A initialization cannot commit after user B becomes current', async () => {
  let generation = 0;
  let currentUser = null;
  const committed = [];
  const roleA = deferred();
  const roleB = deferred();
  const userA = { uid: 'uid-a', email: 'A@example.com' };
  const userB = { uid: 'uid-b', email: 'b@example.com' };

  const initialize = async (user, rolePromise) => {
    const expectedGeneration = ++generation;
    const expectedUid = user.uid;
    const expectedEmail = user.email.trim().toLowerCase();
    currentUser = user;
    const role = await rolePromise;
    if (!isAuthInitializationCurrent(
      generation,
      expectedGeneration,
      currentUser,
      expectedUid,
      expectedEmail,
    )) return;
    committed.push({ uid: user.uid, role });
  };

  const pendingA = initialize(userA, roleA.promise);
  const pendingB = initialize(userB, roleB.promise);
  roleB.resolve('admin');
  await pendingB;
  roleA.resolve('pm');
  await pendingA;

  assert.deepEqual(committed, [{ uid: 'uid-b', role: 'admin' }]);
});

test('dashboard gates every awaited auth initialization stage with generation and identity', () => {
  assert.match(dashboard, /import\s+\{\s*isAuthInitializationCurrent\s*\}\s+from "\.\/js\/auth-session\.mjs"/);
  assert.ok(dashboard.includes('let authSessionGeneration = 0;'));
  assert.ok(dashboard.includes('const authGeneration = ++authSessionGeneration;'));
  assert.ok(dashboard.includes('const authUid = user?.uid || \'\';'));
  assert.ok(dashboard.includes('const authEmail = getEmailKey(user);'));
  assert.ok(dashboard.includes('const logoutGeneration = ++authSessionGeneration;'));

  const authStart = dashboard.indexOf('onAuthStateChanged(auth, async user =>');
  const authEnd = dashboard.indexOf('function getUserDisplayName(', authStart);
  const source = dashboard.slice(authStart, authEnd);
  const roleAwait = source.indexOf('await getDoc(doc(db, "users", authEmail))');
  const roleGuard = source.indexOf('isCurrentAuthInitialization()', roleAwait);
  const roleCommit = source.indexOf('currentRole = getDashboardRole(userDoc)', roleAwait);
  const templateAwait = source.indexOf('await loadGanttTemplateConfig(', roleCommit);
  const templateGuard = source.indexOf('isCurrentAuthInitialization()', templateAwait);
  const pmAwait = source.indexOf('await fetchDynamicPMList()', templateGuard);
  const pmGuard = source.indexOf('isCurrentAuthInitialization()', pmAwait);
  const setupCommit = source.indexOf('PM_LIST = nextPMList', pmGuard);
  const setupUI = source.indexOf('setupUI()', setupCommit);

  assert.ok(roleAwait >= 0 && roleGuard > roleAwait && roleGuard < roleCommit);
  assert.ok(templateAwait > roleCommit && templateGuard > templateAwait);
  assert.ok(pmAwait > templateGuard && pmGuard > pmAwait);
  assert.ok(setupCommit > pmGuard && setupUI > setupCommit);
});

test('template listener setup and callbacks share the current auth generation guard', () => {
  const start = dashboard.indexOf('// GANTT TEMPLATE SETTINGS');
  const end = dashboard.indexOf('// END GANTT TEMPLATE SETTINGS', start);
  const source = dashboard.slice(start, end);
  const loadStart = source.indexOf('async function loadGanttTemplateConfig(');
  const stopCall = source.indexOf('stopGanttTemplateConfigSubscription();', loadStart);
  const initialGuard = source.indexOf('isAuthInitializationCurrent(', loadStart);
  assert.ok(initialGuard >= 0 && initialGuard < stopCall);
  assert.ok(source.includes('authGeneration === authSessionGeneration'));
  assert.ok(source.includes('isAuthInitializationCurrent('));
});

test('an initialized user is quiesced before a replacement user waits for access', () => {
  const authStart = dashboard.indexOf('onAuthStateChanged(auth, async user =>');
  const authEnd = dashboard.indexOf('function getUserDisplayName(', authStart);
  const source = dashboard.slice(authStart, authEnd);
  const generation = source.indexOf('const authGeneration = ++authSessionGeneration;');
  const quiesce = source.indexOf('quiesceDashboardForAuthTransition();');
  const assignUser = source.indexOf('currentUser = user;');
  const roleAwait = source.indexOf('await getDoc(doc(db, "users", authEmail))');

  assert.ok(generation >= 0 && quiesce > generation);
  assert.ok(quiesce < assignUser && assignUser < roleAwait);

  const quiesceStart = dashboard.indexOf('function quiesceDashboardForAuthTransition()');
  const quiesceEnd = dashboard.indexOf('// ── AUTH ──', quiesceStart);
  const quiesceSource = dashboard.slice(quiesceStart, quiesceEnd);
  assert.ok(quiesceSource.includes('stopPresenceSystem();'));
  assert.ok(quiesceSource.includes('weeksUnsub();'));
  assert.ok(quiesceSource.includes('stopGanttTemplateConfigSubscription();'));
  assert.ok(quiesceSource.includes('invalidateProjectEditorSession();'));
  assert.ok(quiesceSource.includes('invalidateGanttTemplateSession();'));
  assert.ok(quiesceSource.includes("currentRole = 'pending';"));
  assert.ok(quiesceSource.includes('setDashboardAccessPending();'));
});

test('replacement auth owns the only new weeks and presence callbacks', () => {
  const dataStart = dashboard.indexOf('function initData(');
  const dataEnd = dashboard.indexOf('function canEditProject(', dataStart);
  const dataSource = dashboard.slice(dataStart, dataEnd);
  assert.ok(dataSource.includes('authGeneration'));
  assert.ok(dataSource.includes('isAuthInitializationCurrent('));
  assert.ok(dataSource.includes('if (!isCurrentDataSession()) return;'));

  const presenceStart = dashboard.indexOf('function startPresenceSystem(');
  const presenceEnd = dashboard.indexOf('function stopPresenceSystem()', presenceStart);
  const presenceSource = dashboard.slice(presenceStart, presenceEnd);
  assert.ok(presenceSource.includes('authGeneration'));
  assert.ok(presenceSource.includes('isAuthInitializationCurrent('));
  assert.ok(presenceSource.includes('if (!isCurrentPresenceSession()) return;'));

  const authStart = dashboard.indexOf('onAuthStateChanged(auth, async user =>');
  const authEnd = dashboard.indexOf('function getUserDisplayName(', authStart);
  const authSource = dashboard.slice(authStart, authEnd);
  assert.equal(
    authSource.match(/initData\(authGeneration, user\);/g)?.length,
    1,
  );
  assert.equal(
    authSource.match(/startPresenceSystem\(authGeneration, user\);/g)?.length,
    1,
  );
});

test('a pending auth transition cancels an older delayed loader hide', () => {
  const helpersStart = dashboard.indexOf('// ── UI HELPERS ──');
  const helpersEnd = dashboard.indexOf('// ── ROLE LOOKUP ──', helpersStart);
  const source = dashboard.slice(helpersStart, helpersEnd);
  assert.ok(source.includes('let hideLoaderTimer = null;'));
  assert.ok(source.includes('if (hideLoaderTimer) clearTimeout(hideLoaderTimer);'));
  assert.ok(source.includes('hideLoaderTimer = setTimeout('));
});

test('startup watchdog prevents the secure-system loader from hanging forever', () => {
  assert.match(dashboard, /__dashboardBootStarted/);
  assert.match(dashboard, /__dashboardAuthObserved/);
  assert.match(dashboard, /Dashboard is still waiting for secure access/);
});

test('an older session cannot render after its FX refresh resolves', () => {
  const start = dashboard.indexOf('async function refreshFxRates(');
  const end = dashboard.indexOf('function convertCurrency(', start);
  const source = dashboard.slice(start, end);
  const fetchAwait = source.indexOf('await fetch(');
  const fetchGuard = source.indexOf('isCurrentFxSession()', fetchAwait);
  const jsonAwait = source.indexOf('await res.json()');
  const jsonGuard = source.indexOf('isCurrentFxSession()', jsonAwait);
  const render = source.indexOf('render();');
  assert.ok(source.includes('isAuthInitializationCurrent('));
  assert.ok(fetchAwait >= 0 && fetchGuard > fetchAwait && fetchGuard < jsonAwait);
  assert.ok(jsonGuard > jsonAwait && jsonGuard < render);
});
