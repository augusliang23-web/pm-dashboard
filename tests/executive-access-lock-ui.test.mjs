import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('dashboard roles include engineering, business, and product access groups', () => {
  assert.match(dashboard, /engineering/);
  assert.match(dashboard, /business/);
  assert.match(dashboard, /product/);
  assert.match(dashboard, /function canViewExecutiveSection\(/);
  assert.match(dashboard, /audience/);
  assert.match(dashboard, /sectionId/);
});

test('executive milestone display is RAG based instead of percentage based', () => {
  assert.match(dashboard, /function executiveRagLabel\(/);
  assert.match(dashboard, /function calculateExecutiveQuarterRag\(/);
  assert.match(dashboard, /class="exec-outcome-rag/);
  assert.doesNotMatch(dashboard, /class="exec-outcome-progress"/);
  assert.doesNotMatch(dashboard, /class="dcdc-quarter-progress"/);
});

test('executive outcome status changes require a reason', () => {
  assert.match(dashboard, /data-original-health=/);
  assert.match(dashboard, /class="ft etm-status-reason"/);
  assert.match(dashboard, /Executive milestone status changes require a reason/);
  assert.match(dashboard, /statusReason:/);
});

test('released weeks block content mutations at every write entry point', () => {
  assert.match(dashboard, /function assertCurrentWeekEditable\(/);
  assert.match(dashboard, /assertCurrentWeekEditable\(week\)/);
  assert.match(dashboard, /if \(isWeekReleased\(week\)\) return/);
  assert.match(dashboard, /projectDashboardApi\.saveProject\(\{/);
  assert.match(dashboard, /projectDashboardApi\.saveWeekFields\(\{/);
  assert.match(dashboard, /projectDashboardApi\.setAttention\(\{/);
});

test('single project detail exposes one-page PDF export from the card header', () => {
  assert.match(dashboard, /id="pd_one_page_pdf"/);
  assert.match(dashboard, /exportProjectOnePagePdf/);
  assert.match(dashboard, /downloadProfessionalPdf/);
});

// Tests carried over from the UAT lineage (consolidation).
test('dashboard roles use Executive Owner, Sales, BD, and Product access groups', () => {
  assert.match(dashboard, /executive/);
  assert.match(dashboard, /engineering/);
  assert.match(dashboard, /sales/);
  assert.match(dashboard, /bd/);
  assert.match(dashboard, /product/);
  assert.match(dashboard, /normalizeExecutiveRole/);
  assert.match(dashboard, /function canViewExecutiveSection\(/);
  assert.match(dashboard, /sectionId/);
});

test('released weeks remain protected by the root callable write path', () => {
  assert.match(dashboard, /function assertCurrentWeekEditable\(/);
  assert.match(dashboard, /assertCurrentWeekEditable\(week\)/);
  assert.match(dashboard, /projectDashboardApi\.saveProject\(\{/);
  assert.match(dashboard, /projectDashboardApi\.setAttention\(\{/);
  assert.doesNotMatch(dashboard, /updateDoc\(doc\(db, ['"]weeks['"]/);
});
