import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('root Project Editor sends the protected callable contract for existing projects', () => {
  const saveStart = dashboard.indexOf('window.saveProjEdit = async () =>');
  const requestStart = dashboard.indexOf('const response = await projectDashboardApi.saveProject({', saveStart);
  const requestEnd = dashboard.indexOf('    });', requestStart);
  const request = dashboard.slice(requestStart, requestEnd);

  assert.ok(requestStart > saveStart);
  assert.match(request, /\.\.\.\(session\.isNew \? \{\} : \{ expectedRevision: session\.revisionFingerprint \}\)/);
  assert.doesNotMatch(request, /editorName:/);
  assert.doesNotMatch(request, /savedAt:/);
});

test('root Project Editor compares the raw Firestore revision after normalizing projects for display', () => {
  assert.match(
    dashboard,
    /const normalizedProject = normalizeProject\(project\);\s*Object\.defineProperty\(normalizedProject, '__revisionFingerprint', \{\s*value: projectRevisionFingerprint\(project\),\s*enumerable: false,\s*\}\);/,
  );
  assert.match(
    dashboard,
    /revisionFingerprint: existingProject\.__revisionFingerprint \|\| projectRevisionFingerprint\(existingProject\)/,
  );
});
