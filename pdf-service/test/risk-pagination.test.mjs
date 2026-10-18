import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { paginateMeasuredFlows } from '../src/measured-paginator.js';
import { renderOverviewReportHtml } from '../src/overview-report.js';
import { completeOverviewReportFixture } from './report-fixtures.mjs';

for (const [name, count, words] of [['empty', 0, 0], ['short', 2, 3], ['dense', 14, 5], ['multiple pages', 38, 8], ['long wrapping', 12, 55]]) {
  test(`risk table ${name}: ordered rows and one continuation header per page`, { timeout: 60000 }, async () => {
    const fixture = completeOverviewReportFixture();
    const base = fixture.week.projects[0];
    fixture.week.projects = Array.from({ length: count }, (_, index) => ({
      ...base, code: `RISK-${index}`, name: `Synthetic risk project ${index}`,
      attention: index < 2 ? 'monitor' : 'watch',
      riskActions: [{ risk: `RISK-TEXT-${index} ${'risk detail '.repeat(words)}`, action: `ACTION-TEXT-${index} ${'action detail '.repeat(words)}`, primary: true }]
    }));
    fixture.sections = ['attention-matrix', 'risk-actions'];
    const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(renderOverviewReportHtml(fixture), { waitUntil: 'networkidle0' });
      await page.evaluate(paginateMeasuredFlows);
      const result = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('.risk-action-table tbody tr')].map(row => ({ code: row.cells[0].textContent, risk: row.cells[1].textContent, action: row.cells[4].textContent })),
        pages: [...document.querySelectorAll('[data-measured-page="management-attention"]')].filter(node => node.querySelector('.risk-action-table')).map(node => ({
          headers: node.querySelectorAll('.risk-action-table thead').length,
          label: node.querySelector('.risk-actions .pdf-continuation-label')?.textContent || '',
          headings: node.querySelectorAll('[data-flow-kind="risk-actions"] .pdf-continuation-label').length,
          gap: node.querySelector('.report-footer').getBoundingClientRect().top - node.querySelector('[data-pdf-flow-items]').getBoundingClientRect().bottom,
          widthOverflow: [...node.querySelectorAll('td')].some(cell => cell.scrollWidth > cell.clientWidth + 1)
        }))
      }));
      assert.equal(result.rows.length, count);
      result.rows.forEach((row, index) => {
        assert.ok(row.code.includes(`RISK-${index}`));
        assert.equal(row.risk.trim(), fixture.week.projects[index].riskActions[0].risk.trim());
        assert.equal(row.action.trim(), fixture.week.projects[index].riskActions[0].action.trim());
      });
      assert.ok(result.pages.every(p => p.headers === 1 && p.headings === 1));
      assert.ok(result.pages.slice(1).every(p => /Continued$/.test(p.label)));
      assert.ok(result.pages.every(p => p.gap >= 8 * 96 / 25.4 - 1));
      assert.ok(result.pages.every(p => !p.widthOverflow));
      if (count >= 14 || words > 50) assert.ok(result.pages.length > 1);
    } finally { await browser.close(); }
  });
}
