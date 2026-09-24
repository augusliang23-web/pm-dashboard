import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = dashboardSource('uat');
const client = readFileSync(new URL('../professional-pdf-client.mjs', import.meta.url), 'utf8');

test('root dashboard uses the professional direct-download client', () => {
  assert.match(root, /professional-pdf-client\.mjs/);
  assert.match(root, /downloadProfessionalPdf/);
});

test('professional PDF client sends only selection data and downloads a nonpersistent blob', () => {
  assert.match(client, /getIdToken\(\)/);
  assert.match(client, /Authorization.*Bearer/);
  assert.match(client, /URL\.createObjectURL/);
  assert.match(client, /URL\.revokeObjectURL/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|setDoc|Cloud Storage/);
});

test('both PDF dialogs stay visible with progress feedback until the download finishes', () => {
  assert.match(root, /async function confirmProjectPdfExport\(\)/);
  assert.match(root, /const downloaded = await downloadProfessionalReport\(\{ mode: 'project'/);
  assert.match(root, /if \(downloaded\) closeModal\('projectPdfSectionPicker'\)/);
  assert.match(root, /window\.confirmOverviewProjectPrint = async \(\) =>/);
  assert.match(root, /const downloaded = await downloadProfessionalReport\(request,/);
  assert.match(root, /if \(downloaded\) \{\s+closeModal\('overviewProjectPrintOverlay'\)/);
  assert.match(root, /Generating PDF/);
  assert.match(root, /aria-busy/);
});
