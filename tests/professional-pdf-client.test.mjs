import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = dashboardSource('production');
const team = dashboardSource('production');
const client = readFileSync(new URL('../professional-pdf-client.mjs', import.meta.url), 'utf8');

test('both dashboard entry points use the professional direct-download client', () => {
  assert.match(root, /professional-pdf-client\.mjs/);
  assert.match(team, /professional-pdf-client\.mjs/);
  assert.match(root, /downloadProfessionalPdf/);
  assert.match(team, /downloadProfessionalPdf/);
});

test('professional PDF client sends only selection data and downloads a nonpersistent blob', () => {
  assert.match(client, /getIdToken\(\)/);
  assert.match(client, /Authorization.*Bearer/);
  assert.match(client, /URL\.createObjectURL/);
  assert.match(client, /URL\.revokeObjectURL/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|setDoc|Cloud Storage/);
});

test('the one-pager preview client fetches HTML with the same bearer-token auth, without any download side effect', () => {
  assert.match(client, /export async function fetchOnePagerPreviewHtml/);
  const start = client.indexOf('export async function fetchOnePagerPreviewHtml');
  const end = client.indexOf('export async function downloadProfessionalPdf', start);
  const fn = client.slice(start, end);
  assert.match(fn, /getIdToken\(\)/);
  assert.match(fn, /Authorization.*Bearer/);
  assert.match(fn, /one-pager-preview/);
  assert.match(fn, /text\/html/);
  assert.doesNotMatch(fn, /URL\.createObjectURL|\.click\(\)/);
});

test('both PDF dialogs stay visible with progress feedback until the download finishes', () => {
  for (const dashboard of [root, team]) {
    assert.match(dashboard, /async function confirmProjectPdfExport\(\)/);
    assert.match(dashboard, /const downloaded = await downloadProfessionalReport\(\{ mode: 'project'/);
    assert.match(dashboard, /if \(downloaded\) closeModal\('projectPdfSectionPicker'\)/);
    assert.match(dashboard, /window\.confirmOverviewProjectPrint = async \(\) =>/);
    assert.match(dashboard, /const downloaded = await downloadProfessionalReport\(request,/);
    assert.match(dashboard, /if \(downloaded\) \{\s+closeModal\('overviewProjectPrintOverlay'\)/);
    assert.match(dashboard, /Generating PDF/);
    assert.match(dashboard, /aria-busy/);
  }
});

// Tests carried over from the UAT lineage (consolidation).
{
test('root dashboard uses the professional direct-download client', () => {
  assert.match(root, /professional-pdf-client\.mjs/);
  assert.match(root, /downloadProfessionalPdf/);
});
}
