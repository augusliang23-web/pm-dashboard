import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await dashboardSourceAsync('uat');

test('Admin-only template settings UI is an accessible trapped dialog', () => {
  assert.match(dashboard, /id="ganttTemplateSettingsBtn"[^>]+admin-only/);
  assert.match(
    dashboard,
    /id="ganttTemplateOverlay"[^>]+role="dialog"[^>]+aria-modal="true"[^>]+aria-labelledby="ganttTemplateTitle"/,
  );
  assert.match(dashboard, /id="systemTemplateList"/);
  assert.match(dashboard, /id="hardwareModuleTemplateList"/);
  assert.match(dashboard, /aria-label="Move workstream up"/);
  assert.match(dashboard, /aria-label="Move workstream down"/);
  assert.ok(dashboard.includes('openAccessibleModal(document.getElementById(\'ganttTemplateOverlay\'))'));
  assert.ok(dashboard.includes('modalReturnFocus.focus()'));
});

test('template handlers recheck Admin role and auth-owned session', () => {
  const start = dashboard.indexOf('// GANTT TEMPLATE SETTINGS');
  const end = dashboard.indexOf('// END GANTT TEMPLATE SETTINGS', start);
  const source = dashboard.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(source.includes("currentRole !== 'admin'"));
  assert.ok(source.includes('isGanttTemplateSessionCurrent(session)'));
  assert.ok(source.includes('session.authUid === (currentUser?.uid || \'\')'));
  assert.ok(source.includes("document.getElementById('ganttTemplateOverlay').classList.contains('open')"));
  assert.ok(dashboard.includes('invalidateGanttTemplateSession();'));
});

test('template config loads with fallback and saves through a revision-checked transaction', () => {
  assert.ok(dashboard.includes("doc(db, 'dashboardSettings', 'team-2-portfolio')"));
  assert.ok(dashboard.includes('await loadGanttTemplateConfig(authGeneration, user)'));
  assert.ok(dashboard.includes('resolveWorkstreamTemplateConfig('));
  assert.ok(dashboard.includes('catch (error)'));
  assert.ok(dashboard.includes('await runTransaction(db, async transaction =>'));
  assert.ok(dashboard.includes('await transaction.get(settingsRef)'));
  assert.ok(dashboard.includes('liveRevision !== session.revision'));
  assert.ok(dashboard.includes('transaction.set(settingsRef'));
  assert.ok(dashboard.includes('updatedBy: getEmailKey(currentUser)'));
  assert.ok(dashboard.includes('updatedAt: serverTimestamp()'));
  assert.ok(dashboard.includes('revision: liveRevision + 1'));
});

test('authenticated setup subscribes to multi-session template updates before enabling the dashboard', () => {
  const start = dashboard.indexOf('// GANTT TEMPLATE SETTINGS');
  const end = dashboard.indexOf('// END GANTT TEMPLATE SETTINGS', start);
  const source = dashboard.slice(start, end);
  assert.ok(source.includes('let ganttTemplateConfigUnsub = null;'));
  assert.ok(source.includes('let ganttTemplateSubscriptionGeneration = 0;'));
  assert.ok(source.includes('ganttTemplateConfigUnsub = onSnapshot('));
  assert.ok(source.includes('applyGanttTemplateSnapshot(snapshot)'));
  assert.ok(source.includes('resolveWorkstreamTemplateConfig(snapshot.exists() ? snapshot.data() : undefined)'));
  assert.ok(source.includes('ganttTemplateSubscriptionReady = true;'));

  const authStart = dashboard.indexOf('onAuthStateChanged(auth, async user =>');
  const setupStart = dashboard.indexOf('function setupUI()', authStart);
  const authSource = dashboard.slice(authStart, setupStart);
  const quiesceStart = dashboard.indexOf('function quiesceDashboardForAuthTransition()');
  const quiesceEnd = dashboard.indexOf('// ── AUTH ──', quiesceStart);
  assert.ok(authSource.includes('quiesceDashboardForAuthTransition();'));
  assert.ok(
    dashboard.slice(quiesceStart, quiesceEnd)
      .includes('stopGanttTemplateConfigSubscription();'),
  );
  assert.ok(authSource.includes('await loadGanttTemplateConfig(authGeneration, user)'));
  assert.ok(
    authSource.indexOf('await loadGanttTemplateConfig(authGeneration, user)')
      < authSource.indexOf('setupUI();'),
  );
});

test('subscription teardown resets defaults and cannot leak callbacks across auth sessions', () => {
  const start = dashboard.indexOf('// GANTT TEMPLATE SETTINGS');
  const end = dashboard.indexOf('// END GANTT TEMPLATE SETTINGS', start);
  const source = dashboard.slice(start, end);
  const stopStart = source.indexOf('function stopGanttTemplateConfigSubscription()');
  const stopEnd = source.indexOf('async function loadGanttTemplateConfig(', stopStart);
  const stopSource = source.slice(stopStart, stopEnd);
  assert.ok(stopStart >= 0 && stopEnd > stopStart);
  assert.ok(stopSource.includes('ganttTemplateSubscriptionGeneration += 1;'));
  assert.ok(stopSource.includes('ganttTemplateConfigUnsub();'));
  assert.ok(stopSource.includes('ganttTemplateConfigUnsub = null;'));
  assert.ok(stopSource.includes('currentGanttTemplateConfig = resolveWorkstreamTemplateConfig();'));
  assert.ok(stopSource.includes('currentGanttTemplateRevision = 0;'));
  assert.ok(source.includes('generation === ganttTemplateSubscriptionGeneration'));
  assert.ok(source.includes('authGeneration === authSessionGeneration'));
  assert.ok(source.includes('isAuthInitializationCurrent('));

  const logoutStart = dashboard.indexOf('window.handleLogout = async () =>');
  const authStart = dashboard.indexOf('onAuthStateChanged(auth, async user =>', logoutStart);
  assert.ok(dashboard.slice(logoutStart, authStart).includes('stopGanttTemplateConfigSubscription();'));
});

test('remote template revisions preserve an open draft and require reopening it', () => {
  const start = dashboard.indexOf('// GANTT TEMPLATE SETTINGS');
  const end = dashboard.indexOf('// END GANTT TEMPLATE SETTINGS', start);
  const source = dashboard.slice(start, end);
  const applyStart = source.indexOf('function applyGanttTemplateSnapshot(');
  const applyEnd = source.indexOf('function stopGanttTemplateConfigSubscription()', applyStart);
  const applySource = source.slice(applyStart, applyEnd);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  assert.ok(applySource.includes('ganttTemplateSession.revision !== nextRevision'));
  assert.ok(applySource.includes('ganttTemplateSessionConflicted = true;'));
  assert.match(applySource, /another Admin session[\s\S]+close and reopen/i);
  assert.doesNotMatch(applySource, /renderGanttTemplateDraft/);

  const saveStart = source.indexOf('window.saveGanttTemplateSettings');
  const saveSource = source.slice(saveStart);
  assert.ok(saveSource.includes('if (ganttTemplateSessionConflicted)'));
});

test('failed template saves keep the draft modal open and surface an error', () => {
  const start = dashboard.indexOf('window.saveGanttTemplateSettings');
  const end = dashboard.indexOf('// END GANTT TEMPLATE SETTINGS', start);
  const source = dashboard.slice(start, end);
  const catchStart = source.indexOf('catch (error)');
  const catchSource = source.slice(catchStart);
  assert.ok(catchStart >= 0);
  assert.ok(catchSource.includes("document.getElementById('ganttTemplateError').textContent"));
  assert.doesNotMatch(catchSource, /closeModal\('ganttTemplateOverlay'\)/);
});

test('a failed template read blocks every save path while preserving the legacy data path', () => {
  const start = dashboard.indexOf('// GANTT TEMPLATE SETTINGS');
  const end = dashboard.indexOf('// END GANTT TEMPLATE SETTINGS', start);
  const source = dashboard.slice(start, end);
  const failureStart = source.indexOf('function reportGanttTemplateAvailabilityFailure(');
  const failureEnd = source.indexOf('function applyGanttTemplateSnapshot(', failureStart);
  const failureSource = source.slice(failureStart, failureEnd);
  const saveStart = source.indexOf('window.saveGanttTemplateSettings');
  const saveSource = source.slice(saveStart);

  assert.ok(failureStart >= 0 && failureEnd > failureStart);
  assert.ok(failureSource.includes('ganttTemplateSubscriptionReady = false;'));
  assert.ok(failureSource.includes('ganttTemplateSessionConflicted = true;'));
  assert.ok(failureSource.includes('setGanttTemplateControlsDisabled(true);'));
  assert.ok(saveSource.includes('!ganttTemplateSubscriptionReady'));
  assert.match(source, /control\.id === 'closeGanttTemplateXBtn'[\s\S]*control\.id === 'cancelGanttTemplateBtn'/);
  assert.ok(source.includes("doc(db, 'dashboardSettings', 'team-2-portfolio')"));
  assert.doesNotMatch(source, /dashboardSettings['"],\s*['"]gantt-templates/);
});

test('a listener failure observed before transaction.set prevents the write and preserves the open draft', async () => {
  const start = dashboard.indexOf('// GANTT TEMPLATE SETTINGS');
  const end = dashboard.indexOf('// END GANTT TEMPLATE SETTINGS', start);
  const source = dashboard.slice(start, end);
  const harness = new Function(`
    const window = {};
    const controls = [
      { id: 'closeGanttTemplateXBtn', disabled: false },
      { id: 'cancelGanttTemplateBtn', disabled: false },
      { id: 'saveGanttTemplateBtn', disabled: false },
      { id: 'draftInput', disabled: false },
    ];
    const draftInputs = {
      system: [{ value: 'Draft System' }],
      hardwareModule: [{ value: 'Draft Hardware' }],
    };
    const elements = {
      ganttTemplateOverlay: {
        classList: { contains: value => value === 'open' },
        querySelectorAll: () => controls,
      },
      ganttTemplateError: { textContent: '' },
      bannerMeta: { textContent: '' },
      systemTemplateList: { querySelectorAll: () => draftInputs.system },
      hardwareModuleTemplateList: { querySelectorAll: () => draftInputs.hardwareModule },
    };
    const document = { getElementById: id => elements[id] };
    const console = { warn() {} };
    const db = {};
    const currentUser = { uid: 'admin-uid', email: 'admin@example.com' };
    const currentRole = 'admin';
    const isAdminExecutivePreview = false;
    let ganttTemplateSession = Object.freeze({
      token: 'session-1', authUid: 'admin-uid', authEmail: 'admin@example.com', role: 'admin', revision: 1,
    });
    let ganttTemplateSessionSequence = 1;
    let ganttTemplateSaveInFlight = false;
    let currentGanttTemplateConfig = {};
    let currentGanttTemplateRevision = 1;
    let writes = 0;
    let closes = 0;
    const getEmailKey = user => user.email;
    const validateWorkstreamTemplateConfig = config => ({ valid: true, config, errors: {} });
    const resolveWorkstreamTemplateConfig = config => config || { system: [], 'hardware-module': [] };
    const doc = () => ({});
    const serverTimestamp = () => 'server-time';
    const closeModal = () => { closes += 1; };
    const showSaveToast = () => {};
    const openAccessibleModal = () => {};
    const onSnapshot = () => () => {};
    const isAuthInitializationCurrent = () => true;
    const authSessionGeneration = 1;
    async function runTransaction(unusedDb, callback) {
      return callback({
        get: async () => {
          reportGanttTemplateAvailabilityFailure(new Error('listener failed'));
          return { exists: () => true, data: () => ({ revision: 1 }) };
        },
        set: () => { writes += 1; },
      });
    }
    ${source}
    ganttTemplateSubscriptionReady = true;
    return {
      save: window.saveGanttTemplateSettings,
      state: () => ({
        writes, closes, error: elements.ganttTemplateError.textContent,
        inFlight: ganttTemplateSaveInFlight,
        draft: draftInputs.system[0].value,
        controls,
      }),
    };
  `)();

  await harness.save();
  const state = harness.state();
  assert.equal(state.writes, 0);
  assert.equal(state.closes, 0);
  assert.equal(state.inFlight, false);
  assert.equal(state.draft, 'Draft System');
  assert.match(state.error, /draft is preserved/i);
  assert.equal(state.controls.find(control => control.id === 'saveGanttTemplateBtn').disabled, true);
  assert.equal(state.controls.find(control => control.id === 'closeGanttTemplateXBtn').disabled, false);
  assert.equal(state.controls.find(control => control.id === 'cancelGanttTemplateBtn').disabled, false);
});

test('Close and Cancel can dismiss the template dialog after an in-flight read failure', () => {
  const start = dashboard.indexOf('window.closeModal = (id, { force = false } = {}) => {');
  const end = dashboard.indexOf('\ndocument.addEventListener(', start);
  const closeSource = dashboard.slice(start, end);
  const close = new Function(`
    const window = {};
    let removed = false;
    const modal = {
      classList: { remove: () => { removed = true; } },
      dataset: {},
    };
    const document = { getElementById: () => modal };
    const editorHasUnsavedChanges = () => false;
    const projectMutationInFlight = false;
    const ganttTemplateSaveInFlight = true;
    const ganttTemplateSessionConflicted = true;
    let ganttTemplateSession = { token: 'session-1' };
    let modalReturnFocus = null;
    ${closeSource}
    return { close: window.closeModal, state: () => ({ removed, ganttTemplateSession }) };
  `)();

  assert.equal(close.close('ganttTemplateOverlay'), true);
  assert.equal(close.state().removed, true);
  assert.equal(close.state().ganttTemplateSession, null);
});

test('manual creation and untouched level changes use loaded templates', () => {
  assert.ok(dashboard.includes('createDefaultWorkstreams(level, currentGanttTemplateConfig)'));
  assert.ok(dashboard.includes('if (newProjectScheduleUntouched'));
  assert.ok(dashboard.includes('if (isNew && !ganttTemplateSubscriptionReady) return;'));
});

test('saving new defaults never rewrites existing project schedules', () => {
  const start = dashboard.indexOf('// GANTT TEMPLATE SETTINGS');
  const end = dashboard.indexOf('// END GANTT TEMPLATE SETTINGS', start);
  const source = dashboard.slice(start, end);
  assert.doesNotMatch(source, /\ballWeeks\b|ganttWorkstreams|collection\(db,\s*['"]weeks['"]/);
  assert.match(dashboard, /Existing project schedules are never changed\./);
});
