import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('executive timeline normalizes legacy text into structured outcome rows', () => {
  assert.match(dashboard, /normalizeExecutiveOutcome/);
  assert.match(dashboard, /class="exec-outcome-row"/);
  assert.match(dashboard, /class="fi etm-outcome-text"/);
  assert.match(dashboard, /class="etm-manual-health" type="hidden"/);
  assert.match(dashboard, /class="ft etm-status-reason"/);
  assert.match(dashboard, /class="fs etm-source-select"/);
  assert.match(dashboard, /if \(sourceRows\.length >= 3\) return/);
  assert.match(dashboard, /data-original-health=/);
});

test('executive outcome editor collects at most three evidence links', () => {
  assert.match(dashboard, /function collectExecutiveOutcomeRows\(/);
  assert.match(dashboard, /querySelectorAll\('\.etm-source-select'\)/);
  assert.match(dashboard, /\.slice\(0, 3\)/);
  assert.match(dashboard, /manualProgress:/);
  assert.match(dashboard, /manualHealth:/);
  assert.match(dashboard, /statusReason/);
  assert.match(dashboard, /Executive milestone status changes require a reason/);
});

test('portfolio timeline displays RAG status and relink warnings', () => {
  assert.match(dashboard, /function renderExecutiveOutcomeDisplay\(/);
  assert.match(dashboard, /calculateExecutiveOutcome\(outcome, catalog\.lookup\)/);
  assert.match(dashboard, /class="exec-outcome-rag/);
  assert.match(dashboard, /class="exec-outcome-reason"/);
  assert.match(dashboard, /Needs relink/);
  assert.doesNotMatch(dashboard, /result\.mode === 'auto' \? 'Auto' : 'Manual'/);
  assert.match(dashboard, /Last reporting week/);
});

test('evidence catalog links stable project and quarterly milestone identities', () => {
  assert.match(dashboard, /function buildExecutiveEvidenceCatalog\(/);
  assert.match(dashboard, /type: 'milestone'/);
  assert.match(dashboard, /type: 'quarterly'/);
  assert.match(dashboard, /ensureStableEditorRowId/);
  assert.match(dashboard, /executiveSourceKey/);
});

test('executive editor uses category summaries and four visible quarterly lanes', () => {
  assert.match(dashboard, /class="exec-category-summary-grid"/);
  assert.match(dashboard, /class="exec-category-editor"/);
  assert.match(dashboard, /class="fs etm-row-audience"/);
  assert.match(dashboard, /class="exec-quarter-lane-grid"/);
  assert.match(dashboard, /class="exec-quarter-lane"/);
  assert.match(dashboard, /class="exec-evidence-details"/);
  assert.match(dashboard, /function collectExecutiveCategoryOverrides\(/);
});

test('portfolio editor keeps all quarters visible and expands outcome details in place', () => {
  const start = dashboard.indexOf('function renderExecutiveMilestoneEditor');
  const end = dashboard.indexOf('function toggleExecutiveOutcomeEditor', start);
  const source = dashboard.slice(start, end);

  assert.match(source, /class="exec-quarter-lane-grid"/);
  assert.match(source, /class="exec-quarter-lane"/);
  assert.match(source, /data-quarter-index="\$\{index\}"/);
  assert.match(source, /renderExecutiveTimelineCell\(row\.cells\[index\] \|\| \[\]\)/);
  assert.doesNotMatch(source, /class="exec-quarter-tabs"/);
  assert.doesNotMatch(source, /setExecutiveEditorQuarter/);
  assert.doesNotMatch(source, /Edit Â· \$\{escHtml\(row\.label\)\}/);
});

test('executive timeline uses RAG labels instead of percentage bars', () => {
  assert.match(dashboard, /function executiveRagLabel\(/);
  assert.match(dashboard, /executiveRagLabel\(result\.health\)/);
  assert.match(dashboard, /\.exec-outcome-rag::before/);
  assert.match(dashboard, /\.dcdc-quarter-rag::before/);
  assert.doesNotMatch(dashboard, /class="exec-outcome-progress"/);
});

test('executive timeline removes noisy manual labels and shows quarterly RAG status', () => {
  const start = dashboard.indexOf('function renderExecutiveQuarterMilestones(');
  const end = dashboard.indexOf('function renderProjectQuarterItems(', start);
  const source = dashboard.slice(start, end);
  assert.match(dashboard, /function renderExecutiveOutcomeLegacy\(/);
  assert.match(source, /class="dcdc-title"/);
  assert.doesNotMatch(source, /renderExecutiveCategorySummaries\(/);
  assert.doesNotMatch(source, /class="dcdc-quarter-rag/);
  assert.doesNotMatch(dashboard, /Leadership-level DCDC milestone timeline, separated from PM project milestone input\./);
  assert.doesNotMatch(dashboard, /Manual<\/span>/);
  assert.match(dashboard, /function calculateExecutiveQuarterSummary\(/);
  assert.match(dashboard, /function calculateExecutiveQuarterRag\(/);
});

test('executive outcomes use compact rows with one inline detail disclosure', () => {
  assert.match(dashboard, /class="exec-outcome-summary"/);
  assert.match(dashboard, /class="exec-outcome-detail"/);
  assert.match(dashboard, /function toggleExecutiveOutcomeEditor\(/);
  assert.match(dashboard, /querySelectorAll\('\.exec-outcome-row\.open'\)/);
  assert.match(dashboard, /class="exec-category-settings"/);
  assert.match(dashboard, /Section settings/);
});

test('status reason is exposed and required only when RAG changes', () => {
  assert.match(dashboard, /function syncExecutiveOutcomeReason\(/);
  assert.match(dashboard, /reasonWrap\.hidden = !changed/);
  assert.match(dashboard, /reason\.required = changed/);
  assert.match(dashboard, /Executive milestone status changes require a reason/);
});

test('executive outcome deletion requires confirmation', () => {
  assert.match(dashboard, /function deleteExecutiveOutcome\(/);
  assert.match(dashboard, /confirm\('Delete this executive outcome\?'\)/);
});

test('hybrid editor includes executive summaries and the active section cue', () => {
  assert.match(dashboard, /class="exec-editor-summary"/);
  assert.match(dashboard, /Edit · \$\{escHtml\(row\.label\)\}/);
  assert.match(dashboard, /const healthLabel = `● \$\{executiveRagLabel\(healthClass\)\}`/);
});
