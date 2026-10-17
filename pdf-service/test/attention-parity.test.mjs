import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import puppeteer from 'puppeteer';
import { normalizeProjectForReport, buildOverviewReportModel } from '../src/report-model.js';
import { renderOverviewReportHtml } from '../src/overview-report.js';
import { renderPdfBuffer } from '../src/pdf-renderer.js';

// Execute the actual Overview classifier, rather than duplicating its logic.
const dashboard = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const attentionMap = dashboard.match(/const ATTENTION_MAP = (\{[\s\S]*?\n\});/)[0];
const classifier = dashboard.match(/function getProjectAttention\(p\) \{[\s\S]*?\n\}/)[0];
const overviewAttention = vm.runInNewContext(`${attentionMap}\n${classifier}\ngetProjectAttention`);
const categories = ['action', 'monitor', 'strategy', 'watch'];
const labels = { action: 'Executive Action', monitor: 'Monitor Closely', strategy: 'Strategic Watch', watch: 'Keep Watching' };

for (const [status, attention] of [['green', 'monitor'], ['yellow', 'watch'], ['red', 'strategy']]) {
  test(`manual boolean preserves explicit ${status}/${attention}`, () => {
    const project = { status, attention, attentionManual: true };
    assert.equal(normalizeProjectForReport(project).attention, attention);
    assert.equal(normalizeProjectForReport(project).attention, overviewAttention(project));
  });
}
for (const attention of categories) {
  for (const attentionManual of [true, false, undefined]) {
    test(`Overview/PDF category parity: ${attention}, manual=${attentionManual}`, () => {
      const project = { code: 'PARITY', status: 'green', attention, attentionManual };
      assert.equal(normalizeProjectForReport(project).attention, overviewAttention(project));
      assert.equal(normalizeProjectForReport(project).attention, attention);
    });
  }
}
for (const [status, expected] of [['red', 'action'], ['yellow', 'monitor'], ['green', 'watch']]) {
  test(`missing or invalid explicit attention falls back for ${status}`, () => {
    for (const attention of [undefined, null, '', 'invalid', 'MONITOR', true]) {
      const project = { status, attention, attentionManual: true };
      assert.equal(normalizeProjectForReport(project).attention, expected);
      assert.equal(normalizeProjectForReport(project).attention, overviewAttention(project));
    }
  });
}
test('retains the PDF legacy string override only when no valid attention exists', () => {
  // Existing PDF resolver accepted category strings here; current writers use booleans.
  for (const attentionManual of categories) {
    assert.equal(normalizeProjectForReport({ status: 'green', attentionManual }).attention, attentionManual);
    assert.equal(normalizeProjectForReport({ status: 'red', attention: 'watch', attentionManual }).attention, 'watch');
  }
  for (const attentionManual of [true, false, 'true', 'invalid', {}]) {
    assert.equal(normalizeProjectForReport({ status: 'yellow', attentionManual }).attention, 'monitor');
  }
});
test('normalization does not mutate the original project or unrelated fields', () => {
  const project = { code: 'UAT54-R2-OWN', name: 'UAT54 R2 Existing Project', status: 'green', attention: 'monitor', attentionManual: true, progress: 41, owner: 'UAT54 Test PM', visibility: 'active', projectLevel: 'system' };
  const before = structuredClone(project);
  Object.freeze(project);
  const normalized = normalizeProjectForReport(project);
  assert.deepEqual(project, before);
  for (const key of Object.keys(project)) assert.deepEqual(normalized[key], project[key]);
});
test('actual Overview PDF render keeps each category, identity and week in its quadrant', { timeout: 60000 }, async () => {
  const projects = categories.map((attention, i) => ({ code: `SYN-${i}`, name: `Synthetic ${attention}`, owner: 'Synthetic PM', status: 'green', attention, attentionManual: true, progress: 41, visibility: 'active', projectLevel: 'system' }));
  const request = { week: { weekLabel: 'W1 2000', projects }, sections: ['attention-matrix'], overviewScope: 'system' };
  const before = structuredClone(request);
  const model = buildOverviewReportModel(request);
  for (const project of projects) assert.equal(model.attention[overviewAttention(project)][0].code, project.code);
  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(renderOverviewReportHtml(request), { waitUntil: 'networkidle0' });
    for (const [i, attention] of categories.entries()) {
      const text = await page.$eval(`.attention-quadrant.${attention}`, element => element.innerText);
      assert.ok(text.includes(`SYN-${i}`));
      assert.ok(text.includes(labels[attention]));
    }
    assert.ok((await page.evaluate(() => document.body.innerText)).includes('W1 2000'));
    const pdf = await renderPdfBuffer(renderOverviewReportHtml(request));
    assert.ok(pdf.byteLength > 1000);
    assert.deepEqual(request, before);
  } finally {
    await browser.close();
    await renderPdfBuffer.close();
  }
});
