import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

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

test('template config loads with fallback and saves through a revision-checked Callable', () => {
  assert.ok(dashboard.includes("doc(db, 'dashboardSettings', 'team-2-portfolio')"));
  assert.ok(dashboard.includes('await loadGanttTemplateConfig(authGeneration, user)'));
  assert.ok(dashboard.includes('resolveWorkstreamTemplateConfig('));
  assert.ok(dashboard.includes('catch (error)'));
  assert.ok(dashboard.includes('await projectDashboardApi.saveGanttTemplateSettings({'));
  assert.ok(dashboard.includes('expectedRevision: session.revision'));
  assert.ok(dashboard.includes('config: validation.config'));
  assert.ok(dashboard.includes('const savedRevision = response.revision'));
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
