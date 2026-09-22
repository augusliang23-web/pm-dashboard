// MEDIUM #4 (Control Plane remediation on top of fcca7b6): three UAT tests here asserted the retired front-end
// client-side transaction Gantt template path (a direct `runTransaction(db, ...)` in the browser). They were
// skipped in 37e8408 with only a general note; re-verified now against the current index.html, all three of their
// literal assertions do fail (confirmed by temporarily un-skipping each against the current source), so the
// architecture genuinely changed and equivalent replacement coverage -- exercising the real current code, not just
// restoring the old assertions -- is required. Below, for each retired test: OLD TEST / ORIGINAL BEHAVIOR
// GUARANTEE / NEW IMPLEMENTATION / REPLACEMENT TEST / RESULT.
//
// 1) OLD TEST: 'template config loads with fallback and saves through a revision-checked transaction' -- asserted
//    the client called `runTransaction(db, ...)`, read `transaction.get(settingsRef)`, compared
//    `liveRevision !== session.revision`, and wrote `transaction.set(settingsRef, {..., updatedBy, updatedAt,
//    revision: liveRevision + 1})` directly from the browser.
//    ORIGINAL BEHAVIOR GUARANTEE: a save is rejected if the live revision moved since the draft was opened
//    (optimistic concurrency), and a successful save always carries a server-trustworthy updatedBy/updatedAt and
//    an incremented revision.
//    NEW IMPLEMENTATION: the client now sends one Callable request, `projectDashboardApi.saveGanttTemplateSettings
//    ({expectedRevision, config})` -> Cloud Function `saveDashboardGanttTemplateSettings` (functions/project-
//    dashboard-writes.js) -> `buildGanttTemplateSettingsPatch`, which runs the *same* comparison
//    (`data.expectedRevision !== liveRevision` -> 'conflict') and sets `updatedBy`/`revision`/`updatedAt` --
//    but now inside the function's own `database().runTransaction(...)`, authoritatively on the server rather
//    than trusting the browser to read-then-write.
//    REPLACEMENT TEST: 'a successful save threads the open session's revision and the validated draft through the
//    Callable, and applies exactly what the server returns' (below) executes the real, current
//    `window.saveGanttTemplateSettings` UAT handler in a VM against a mocked Callable, proving the client-side half
//    of the contract. The server-side revision-check/conflict/authoritative-fields half already has direct,
//    passing coverage in functions/test/dashboard-gantt-settings-security.test.cjs ('UAT Gantt template settings
//    require Admin, a live revision, and valid templates'), which is the authoritative test for that logic and is
//    not duplicated here.
//    RESULT: replaced by the two tests above (one already existing, one added here).
//
// 2) OLD TEST: 'a listener failure observed before transaction.set prevents the write and preserves the open
//    draft' -- simulated the live-settings Firestore listener reporting a failure while the save's own
//    `transaction.get()` was still in flight (a race specific to doing the read and the write together on the
//    client), and asserted the write never happened and the draft stayed open with an error shown.
//    ORIGINAL BEHAVIOR GUARANTEE: staleness discovered mid-save must abort the write and preserve the admin's
//    draft, rather than saving over data the admin never saw.
//    NEW IMPLEMENTATION: the client no longer performs its own read; the single Callable request either succeeds
//    or is rejected by the server's own atomic revision check. That check catches *every* cause of staleness --
//    a listener race, another admin's concurrent save, or anything else -- not only the one specific client-side
//    race the old test simulated, which makes this a strictly broader guarantee than before. The client's existing
//    catch block (unchanged in spirit by this remediation) resets `ganttTemplateSaveInFlight`, shows the error, and
//    never calls `closeModal`, so the draft is preserved exactly as before.
//    REPLACEMENT TEST: 'a server-detected conflict prevents the write and preserves the open draft' (below) mocks
//    the Callable to reject the way the server does on a stale expectedRevision, and proves the real save handler
//    performs no client-side state mutation, keeps the draft open, shows the error, and re-enables the controls.
//    RESULT: replaced below.
//
// 3) OLD TEST: 'Close and Cancel can dismiss the template dialog after an in-flight read failure' -- asserted Close
//    succeeded even with `ganttTemplateSaveInFlight` artificially set to true in the harness.
//    ORIGINAL BEHAVIOR GUARANTEE: after a failure, the admin is never stuck unable to close the dialog.
//    NEW IMPLEMENTATION: `closeModal` now deliberately blocks closing the Gantt Template overlay while
//    `ganttTemplateSaveInFlight` is true (`if (id === 'ganttTemplateOverlay' && ganttTemplateSaveInFlight)
//    return;`) -- a real request must not be silently abandoned. That guard is compatible with the guarantee
//    above only because the real failure handler (see #2) always clears `ganttTemplateSaveInFlight` to false
//    *before* returning control to the admin, so the dialog is never left both failed and stuck; the old test's
//    harness set both flags in a combination ('read failure' AND still-in-flight) the real handler never produces.
//    REPLACEMENT TEST: two tests below cover both halves of this directly against the real, current `closeModal`:
//    'closeModal blocks closing the Gantt Template dialog while a save is genuinely in flight' and 'closeModal
//    dismisses the Gantt Template dialog once a save has failed and released the in-flight flag'.
//    RESULT: replaced below by two tests, together proving the admin is never stuck.
import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const dashboard = await dashboardSourceAsync('uat');

// Extracts a `window.<name> = <expression> => { ... }` assignment by counting braces from the opening one, rather
// than guessing a closing-line pattern -- both saveGanttTemplateSettings and closeModal have nested `if (...) {`
// blocks, so a naive "next line that looks like a close" search is not reliable.
function extractHandlerBody(marker) {
  const start = dashboard.indexOf(marker);
  assert.ok(start >= 0, `could not find ${JSON.stringify(marker)} in the UAT view`);
  let depth = 0;
  let end = -1;
  for (let i = start + marker.length - 1; i < dashboard.length; i += 1) {
    const ch = dashboard[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.ok(end > start, `could not find the matching closing brace for ${JSON.stringify(marker)}`);
  return dashboard.slice(start, end + 1);
}

function elementStub() {
  return { textContent: '', classList: { contains: () => false }, dataset: {} };
}

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

// Replaces the skipped 'template config loads with fallback and saves through a revision-checked transaction'.
function saveHandlerContext(overrides = {}) {
  const calls = { saveGanttTemplateSettings: [], closeModal: [], showSaveToast: [], setControlsDisabled: [] };
  const elements = { ganttTemplateError: elementStub() };
  const context = vm.createContext({
    window: {},
    document: { getElementById: id => (elements[id] ??= elementStub()) },
    currentRole: 'admin',
    ganttTemplateSession: Object.freeze({ token: 's-1', authUid: 'admin-uid', authEmail: 'admin@example.test', role: 'admin', revision: 4 }),
    ganttTemplateSaveInFlight: false,
    ganttTemplateSubscriptionReady: true,
    ganttTemplateSessionConflicted: false,
    ganttTemplateAvailabilityStatus: null,
    currentGanttTemplateConfig: null,
    currentGanttTemplateRevision: 0,
    isGanttTemplateSessionCurrent: session => session === context.ganttTemplateSession,
    validateWorkstreamTemplateConfig: () => ({ valid: true, config: { system: ['Plan'], 'hardware-module': ['Design'] }, errors: {} }),
    collectGanttTemplateDraft: () => ({ system: ['Plan'], 'hardware-module': ['Design'] }),
    resolveWorkstreamTemplateConfig: config => config,
    setGanttTemplateControlsDisabled: value => { calls.setControlsDisabled.push(value); },
    // The second argument object (e.g. { force: true }) is a literal constructed by code running inside the vm
    // context, so it carries that context's own Object.prototype; re-wrap it in a plain outer-realm object here so
    // callers can deepEqual against an ordinary literal.
    closeModal: (id, opts) => { calls.closeModal.push([id, opts ? { ...opts } : opts]); },
    showSaveToast: message => { calls.showSaveToast.push(message); },
    projectDashboardApi: {
      saveGanttTemplateSettings: async payload => {
        calls.saveGanttTemplateSettings.push(payload);
        // The real handler tests `error instanceof Error`; that only passes for an Error constructed with this
        // vm context's own Error (a rejection built with the outer realm's Error would silently take the
        // handler's generic fallback message instead, which is not what a same-realm Callable rejection does in
        // the real browser).
        return overrides.callableResult
          // vm.createContext's sandbox object does not itself expose the context's built-ins as own properties
          // (context.Error is undefined even after code has run); vm.runInContext('Error', context) is what
          // actually returns that realm's Error constructor.
          ? overrides.callableResult(payload, vm.runInContext('Error', context))
          : { config: payload.config, revision: payload.expectedRevision + 1 };
      },
    },
    ...overrides.context,
  });
  vm.runInContext(`var handler = ${extractHandlerBody('window.saveGanttTemplateSettings = async () => {')};`, context);
  return { context, calls };
}

test('a successful save threads the open session\'s revision and the validated draft through the Callable, and applies exactly what the server returns', async () => {
  const { context, calls } = saveHandlerContext();
  await context.handler();

  // The argument object is constructed by code executing inside the vm context, so it carries that context's own
  // Object.prototype; re-wrap it in a plain outer-realm object before deepEqual (node:assert/strict's deepEqual is
  // deepStrictEqual, which checks prototype identity too -- see tests/dashboard-display-names.uat.test.mjs for the
  // same established pattern).
  assert.deepEqual(calls.saveGanttTemplateSettings.map(({ expectedRevision, config }) => ({ expectedRevision, config })), [
    { expectedRevision: 4, config: { system: ['Plan'], 'hardware-module': ['Design'] } },
  ]);
  assert.deepEqual(context.currentGanttTemplateConfig, { system: ['Plan'], 'hardware-module': ['Design'] });
  assert.equal(context.currentGanttTemplateRevision, 5, 'must apply exactly the revision the server returned, not compute its own');
  assert.equal(context.ganttTemplateSession, null, 'the session must be released after a successful save');
  assert.equal(calls.closeModal.length, 1);
  assert.deepEqual(calls.closeModal[0], ['ganttTemplateOverlay', { force: true }]);
  assert.equal(calls.showSaveToast.length, 1);
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

// Replaces the skipped 'a listener failure observed before transaction.set prevents the write and preserves the
// open draft'. The client no longer runs its own transaction, so there is nothing to observe "before
// transaction.set" client-side; the server's atomic revision check subsumes that race (see the file-header note).
test('a server-detected conflict prevents the write and preserves the open draft', async () => {
  const { context, calls } = saveHandlerContext({
    callableResult: (payload, ContextError) => { throw Object.assign(new ContextError('The live defaults changed in another Admin session.'), { code: 'conflict' }); },
  });
  const sessionBefore = context.ganttTemplateSession;

  await context.handler();

  assert.equal(calls.saveGanttTemplateSettings.length, 1, 'the Callable must still be attempted with the draft');
  assert.equal(context.currentGanttTemplateConfig, null, 'no local config write may happen on a rejected save');
  assert.equal(context.currentGanttTemplateRevision, 0);
  assert.equal(context.ganttTemplateSession, sessionBefore, 'the draft session must be preserved, not released');
  assert.equal(calls.closeModal.length, 0, 'the dialog must not close on a failed save');
  assert.match(context.document.getElementById('ganttTemplateError').textContent, /live defaults changed.*draft is preserved and still open/);
  assert.equal(context.ganttTemplateSaveInFlight, false, 'the in-flight flag must be released so the admin can retry or close');
  assert.deepEqual(calls.setControlsDisabled, [true, false], 'controls are disabled for the attempt and re-enabled after it fails');
});

// Replaces the skipped 'Close and Cancel can dismiss the template dialog after an in-flight read failure' with the
// two real behaviors that together give the same guarantee (see the file-header note): a genuinely in-flight save
// blocks Close/Cancel, and the real failure handler above always releases that flag before returning control, so
// Close/Cancel becomes available again immediately after any failure.
function closeModalContext(overrides = {}) {
  const removedIds = [];
  const modal = { classList: { remove: () => { removedIds.push('ganttTemplateOverlay'); } }, dataset: {} };
  const context = vm.createContext({
    window: {},
    document: { getElementById: () => modal },
    editorHasUnsavedChanges: () => false,
    projectMutationInFlight: false,
    ganttTemplateSaveInFlight: false,
    ganttWindowSaveInFlight: false,
    ganttTemplateSession: { token: 's-1' },
    ganttWindowSession: null,
    modalReturnFocus: null,
    executiveUpdateHistoryUnsub: null,
    executiveApprovalInboxUnsub: null,
    executiveChangeSession: null,
    executiveRagOverrideSession: null,
    executiveTimelineSettingsSession: null,
    projectEditorSession: null,
    editingProjCode: null,
    isCreatingNew: false,
    clearProjectMutationError: () => {},
    pendingDiscardEditorId: null,
    openAccessibleModal: () => {},
    restoreProjectDetailModalState: () => {},
    ...overrides,
  });
  vm.runInContext(`var handler = ${extractHandlerBody("window.closeModal = (id, { force = false } = {}) => {")};`, context);
  return { context, removedIds };
}

test('closeModal blocks closing the Gantt Template dialog while a save is genuinely in flight', () => {
  const { context, removedIds } = closeModalContext({ ganttTemplateSaveInFlight: true });
  const result = context.handler('ganttTemplateOverlay');
  assert.equal(result, undefined, 'must refuse to close (no return value), never resolve to true');
  assert.deepEqual(removedIds, []);
  assert.notEqual(context.ganttTemplateSession, null, 'the open draft session must not be discarded either');
});

test('closeModal dismisses the Gantt Template dialog once a save has failed and released the in-flight flag', () => {
  // This is exactly the state the real save handler leaves behind after a rejected save (see the conflict test
  // above: ganttTemplateSaveInFlight is always reset to false in the catch block before control returns).
  const { context, removedIds } = closeModalContext({ ganttTemplateSaveInFlight: false });
  const result = context.handler('ganttTemplateOverlay');
  assert.equal(result, true);
  assert.deepEqual(removedIds, ['ganttTemplateOverlay']);
  assert.equal(context.ganttTemplateSession, null, 'closing releases the draft session');
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
