import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Admin-only Gantt window settings UI is an accessible trapped dialog', () => {
  assert.match(dashboard, /id="ganttWindowSettingsBtn"[^>]+admin-only/);
  assert.match(
    dashboard,
    /id="ganttWindowOverlay"[^>]+role="dialog"[^>]+aria-modal="true"[^>]+aria-labelledby="ganttWindowTitle"/,
  );
  assert.match(dashboard, /id="ganttWindowDefaultMonths"/);
  assert.match(dashboard, /id="ganttWindowOverrideList"/);
  assert.match(dashboard, /id="ganttWindowAddProjectSelect"/);
  assert.ok(dashboard.includes('openAccessibleModal(document.getElementById(\'ganttWindowOverlay\'))'));
});

test('window handlers recheck Admin role and auth-owned session', () => {
  const start = dashboard.indexOf('// GANTT WINDOW SETTINGS');
  const end = dashboard.indexOf('// END GANTT WINDOW SETTINGS', start);
  const source = dashboard.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(source.includes("currentRole !== 'admin'"));
  assert.ok(source.includes('isGanttWindowSessionCurrent(session)'));
  assert.ok(source.includes('session.authUid === (currentUser?.uid || \'\')'));
  assert.ok(source.includes("document.getElementById('ganttWindowOverlay').classList.contains('open')"));
  assert.ok(dashboard.includes('invalidateGanttWindowSession();'));
});

test('window settings load from the same dashboardSettings document as Gantt templates', () => {
  assert.ok(dashboard.includes("await projectDashboardApi.saveGanttWindowSettings({"));
  assert.ok(dashboard.includes('expectedRevision: session.revision'));
  assert.ok(dashboard.includes('const response = await projectDashboardApi.saveGanttWindowSettings'));
  const start = dashboard.indexOf('function applyGanttTemplateSnapshot(');
  const end = dashboard.indexOf('function stopGanttTemplateConfigSubscription()', start);
  const source = dashboard.slice(start, end);
  assert.ok(source.includes('resolveGanttWindowConfig(data)'));
  assert.ok(source.includes('currentGanttWindowConfig = nextWindowConfig'));
  assert.ok(source.includes('currentGanttWindowRevision = nextWindowRevision'));
});

test('the project override picker sources this week\'s active projects, not all-time codes', () => {
  const start = dashboard.indexOf('// GANTT WINDOW SETTINGS');
  const end = dashboard.indexOf('// END GANTT WINDOW SETTINGS', start);
  const source = dashboard.slice(start, end);
  assert.ok(source.includes('function ganttWindowOverridableProjects()'));
  assert.ok(source.includes('allWeeks[currentIdx]'));
  assert.ok(source.includes("!p.visibility || p.visibility === 'active'"));
});

test('validation rejects an out-of-range default or override before saving', () => {
  const start = dashboard.indexOf('window.saveGanttWindowSettings');
  const end = dashboard.indexOf('// END GANTT WINDOW SETTINGS', start);
  const source = dashboard.slice(start, end);
  assert.ok(source.includes('validateGanttWindowConfig(collectGanttWindowDraft())'));
  assert.ok(source.includes('if (!validation.valid)'));
});

test('failed window settings saves keep the draft modal open and surface an error', () => {
  const start = dashboard.indexOf('window.saveGanttWindowSettings');
  const end = dashboard.indexOf('// END GANTT WINDOW SETTINGS', start);
  const source = dashboard.slice(start, end);
  const catchStart = source.indexOf('catch (error)');
  const catchSource = source.slice(catchStart);
  assert.ok(catchStart >= 0);
  assert.ok(catchSource.includes("document.getElementById('ganttWindowError').textContent"));
  assert.doesNotMatch(catchSource, /closeModal\('ganttWindowOverlay'\)/);
});

test('remote window setting revisions preserve an open draft and require reopening it', () => {
  const start = dashboard.indexOf('function applyGanttTemplateSnapshot(');
  const end = dashboard.indexOf('function stopGanttTemplateConfigSubscription()', start);
  const source = dashboard.slice(start, end);
  assert.ok(source.includes('ganttWindowSession.revision !== nextWindowRevision'));
  assert.ok(source.includes('ganttWindowSessionConflicted = true;'));

  const saveStart = dashboard.indexOf('window.saveGanttWindowSettings');
  const saveSource = dashboard.slice(saveStart);
  assert.ok(saveSource.includes('if (ganttWindowSessionConflicted)'));
});

test('the window settings modal is torn down on logout, auth transition, and VIP preview', () => {
  assert.equal(
    (dashboard.match(/invalidateGanttWindowSession\(\);/g) || []).length,
    4,
  );
  const vipStart = dashboard.indexOf('window.toggleVipPreview');
  const vipEnd = dashboard.indexOf('};', dashboard.indexOf('const button = document.getElementById(\'vipPreviewBtn\')', vipStart));
  assert.ok(dashboard.slice(vipStart, vipEnd).includes('if (isAdminVipPreview) invalidateGanttWindowSession();'));
});
