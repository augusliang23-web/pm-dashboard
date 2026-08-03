import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const team = readFileSync(new URL('../team-2/index.html', import.meta.url), 'utf8');
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
