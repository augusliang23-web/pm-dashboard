import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { renderOverviewReportHtml } from '../src/overview-report.js';
import { completeOverviewReportFixture } from './report-fixtures.uat.mjs';

test('risk PDF keeps the Project Manager heading readable beside long risk text', async () => {
  const fixture = completeOverviewReportFixture();
  const project = fixture.week.projects[0];
  fixture.week.projects = [{ ...project, riskActions: [{
    risk: 'BMS installation and commissioning readiness remains unverified against previously reported resource and schedule gaps, creating potential delivery delays.',
    action: 'Secure written confirmation of installation resources, responsibilities, mobilization dates, and a committed recovery schedule from all relevant subcontractors.',
    primary: true
  }] }];
  fixture.sections = ['risk-actions'];
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(renderOverviewReportHtml(fixture), { waitUntil: 'networkidle0' });
    const layout = await page.evaluate(() => {
      const table = document.querySelector('.risk-action-table');
      const heading = table.querySelector('th:nth-child(4)');
      const range = document.createRange();
      range.selectNodeContents(heading);
      const rects = [...range.getClientRects()];
      const tableBounds = table.getBoundingClientRect();
      return { text: heading.textContent, lines: rects.length,
        headingFits: rects.every(rect => rect.left >= tableBounds.left && rect.right <= tableBounds.right),
        tableFits: table.scrollWidth <= table.clientWidth + 1 };
    });
    assert.equal(layout.text, 'Project Manager');
    assert.equal(layout.lines, 1, 'Project Manager must not split into letter fragments');
    assert.ok(layout.headingFits && layout.tableFits, 'heading and columns must fit the table');
  } finally { await browser.close(); }
});
