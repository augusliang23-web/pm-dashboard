import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await dashboardSourceAsync('uat');

const editingOverlays = [
  'executiveItemDrawerOverlay',
  'executiveChangeRequestOverlay',
  'executiveApprovalInboxOverlay',
  'executiveRagOverrideOverlay',
  'executiveTimelineSettingsOverlay',
  'changePwdOverlay',
  'projEditOverlay',
  'weekManageOverlay',
  'strategyOverlay',
  'ganttTemplateOverlay',
];

test('marks every v2.2T editor and excludes read-only or export overlays', () => {
  for (const id of editingOverlays) {
    assert.match(dashboard, new RegExp(`<div[^>]*id="${id}"[^>]*data-editor-overlay`), id);
  }
  for (const id of ['projDetailOverlay', 'onePageStatusModal', 'overviewPrintOverlay', 'projectPdfSectionPicker', 'presenceUsageOverlay']) {
    const tag = dashboard.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))?.[0] || '';
    assert.ok(tag, `expected ${id}`);
    assert.doesNotMatch(tag, /data-editor-overlay/, id);
  }
});

test('uses one normalized dirty-state guard for close button, Cancel, backdrop, and Escape paths', () => {
  assert.match(dashboard, /function serializeEditorState\(overlay\)/);
  assert.match(dashboard, /function captureEditorBaseline\(overlay\)/);
  assert.match(dashboard, /function editorHasUnsavedChanges\(overlay\)/);
  assert.match(dashboard, /window\.requestCloseModal = id =>/);
  assert.match(dashboard, /window\.closeModal = \(id, \{ force = false \} = \{\}\) =>/);
  assert.match(dashboard, /if \(!force && editorHasUnsavedChanges\(modal\)\)/);
  assert.match(dashboard, /event\.target !== event\.currentTarget[\s\S]{0,120}?requestCloseModal\(event\.currentTarget\.id\)/);
  assert.match(dashboard, /event\.key === 'Escape'[\s\S]{0,140}?requestCloseModal\(modal\.id\)/);
});

test('shows a focused discard confirmation and preserves programmatic save closes', () => {
  assert.match(dashboard, /id="unsavedChangesOverlay"/);
  assert.match(dashboard, />Keep editing<\/button>/);
  assert.match(dashboard, />Discard changes<\/button>/);
  assert.match(dashboard, /window\.keepEditing =/);
  assert.match(dashboard, /window\.confirmDiscardEditorChanges =/);
  assert.match(dashboard, /openAccessibleModal\(document\.getElementById\('unsavedChangesOverlay'\)\)/);
  assert.match(dashboard, /closeModal\('projEditOverlay', \{ force: true \}\)/);
  assert.match(dashboard, /closeModal\('strategyOverlay', \{ force: true \}\)/);
  assert.match(dashboard, /closeModal\('weekManageOverlay', \{ force: true \}\)/);
  assert.match(dashboard, /closeModal\('ganttTemplateOverlay', \{ force: true \}\)/);
  assert.match(dashboard, /closeModal\('executiveItemDrawerOverlay', \{ force: true \}\)/);
});

test('captures editor state through the shared accessible opening path', () => {
  assert.match(dashboard, /function openAccessibleModal\(modal\)[\s\S]{0,260}?captureEditorBaseline\(modal\)/);
  for (const id of ['changePwdOverlay', 'strategyOverlay', 'projEditOverlay', 'weekManageOverlay']) {
    assert.match(dashboard, new RegExp(`openAccessibleModal\\(document\\.getElementById\\('${id}'\\)\\)`), id);
  }
});
