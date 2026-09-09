import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('project PDF uses an icon-only export control', () => {
  const button = dashboard.match(/<button[^>]+id="pd_one_page_pdf"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(button, /class="btn-icon no-print"/);
  assert.match(button, /title="Export project PDF"/);
  assert.match(button, /aria-label="Export project PDF"/);
  assert.doesNotMatch(button, />\s*One-page PDF\s*</);
});

test('project PDF sends a direct professional download request', () => {
  const start = dashboard.indexOf('window.exportProjectOnePagePdf =');
  const end = dashboard.indexOf('// ── RENDER ──', start);
  const source = dashboard.slice(start, end);
  assert.match(source, /openProjectPdfSectionPicker/);
  const confirmStart = dashboard.indexOf('function confirmProjectPdfExport(');
  const confirmEnd = dashboard.indexOf('window.exportProjectOnePagePdf =', confirmStart);
  const confirmSource = dashboard.slice(confirmStart, confirmEnd);
  assert.match(confirmSource, /downloadProfessionalReport\(\{ mode: 'project'/);
  assert.doesNotMatch(confirmSource, /window\.print\(\)/);
  assert.match(dashboard, /professional-pdf-client\.mjs/);
});
