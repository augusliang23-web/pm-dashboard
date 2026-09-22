import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('v2.2T uses role-safe week queries and a live PM-only list', () => {
  assert.match(dashboard, /canReadDraftWeeks\(currentRole\)\s*\?\s*query\(weeksRef, orderBy\('weekLabel'\)\)\s*:\s*query\(weeksRef, where\('isReleased', '==', true\)\)/);
  assert.match(dashboard, /projectManagerUnsub\s*=\s*onSnapshot\(collection\(db, 'users'\)/);
  assert.match(dashboard, /PM_LIST\s*=\s*buildProjectManagerList\(/);
  assert.match(dashboard, /currentPMFilter\s*=\s*reconcileProjectManagerFilter\(currentPMFilter, PM_LIST\)/);
});

test('only Admin and PM can edit a project and Executive retains portfolio navigation', () => {
  const editStart = dashboard.indexOf('function canEditProject(');
  const editEnd = dashboard.indexOf('const RELEASED_WEEK_PROJECT_EDIT_MESSAGE', editStart);
  const editSource = dashboard.slice(editStart, editEnd);

  assert.match(editSource, /if \(currentRole !== 'pm'\) return false/);
  assert.match(dashboard, /const isExecutivePerspective = \(\) => currentRole === 'admin' && isAdminExecutivePreview;/);
});

test('only PM and Admin receive a release control and it uses the protected callable', () => {
  assert.match(dashboard, /let currentRole = 'pending';/);
  assert.match(dashboard, /function canManageWeekRelease\(\)\s*\{\s*return \['admin', 'pm'\]\.includes\(currentRole\);\s*\}/);
  assert.match(dashboard, /\$\{canManageWeekRelease\(\) \? [\s\S]*toggleReleaseWeek\(\)/);
  assert.match(dashboard, /if \(!week \|\| !currentUser \|\| releaseWriteInProgress \|\| !canManageWeekRelease\(\)\) return;/);
  assert.match(dashboard, /projectDashboardApi\.setWeekRelease\(/);
});
