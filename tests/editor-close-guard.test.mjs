import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboards = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../team-2/index.html', import.meta.url), 'utf8'),
]);

test('protects PM editor overlays from accidental close with unsaved changes', () => {
  const editorIds = [
    'changePwdOverlay',
    'projEditOverlay',
    'weekManageOverlay',
    'strategyOverlay',
    'ganttTemplateOverlay',
  ];

  for (const dashboard of dashboards) {
    for (const id of editorIds) {
      assert.match(dashboard, new RegExp(`id="${id}"[^>]*data-editor-overlay`));
    }
    assert.match(dashboard, /id="unsavedChangesOverlay"/);
    assert.match(dashboard, /function serializeEditorState\(overlay\)/);
    assert.match(dashboard, /function captureEditorBaseline\(overlay\)/);
    assert.match(dashboard, /function editorHasUnsavedChanges\(overlay\)/);
    assert.match(dashboard, /window\.requestCloseModal = id => closeModal\(id\)/);
    assert.match(dashboard, /if \(!force && editorHasUnsavedChanges\(modal\)\)/);
    assert.match(dashboard, /function keepEditing|window\.keepEditing/);
    assert.match(dashboard, /function confirmDiscardEditorChanges|window\.confirmDiscardEditorChanges/);
    assert.match(dashboard, /captureEditorBaseline\(modal\)/);
    for (const id of ['projEditOverlay', 'weekManageOverlay', 'strategyOverlay']) {
      assert.match(
        dashboard,
        new RegExp(`openAccessibleModal\\(document\\.getElementById\\('${id}'\\)\\)`),
        `${id} must capture its baseline when it opens`,
      );
    }
    for (const id of editorIds) {
      assert.match(dashboard, new RegExp(`closeModal\\('${id}', \\{ force: true \\}\\)`));
    }
    assert.doesNotMatch(dashboard, /id="projDetailOverlay"[^>]*data-editor-overlay/);
  }
});
