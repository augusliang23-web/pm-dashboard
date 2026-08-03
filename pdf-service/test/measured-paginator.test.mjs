import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { paginateMeasuredFlows } from '../src/measured-paginator.js';
import { renderOverviewReportHtml } from '../src/overview-report.js';
import {
  completeOverviewReportFixture,
  legacyExecutiveSummaryFixture,
  week28DenseExecutiveSummaryFixture
} from './report-fixtures.mjs';

async function browserPage(html) {
  const browser = await puppeteer.launch({
    headless: 'shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  return { page, browser };
}

async function measuredPages(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-measured-page="executive-summary"]')].map(pageNode => ({
    blocks: pageNode.querySelectorAll('[data-pdf-flow-item]').length,
    bodyBottom: pageNode.querySelector('[data-pdf-flow-items]').getBoundingClientRect().bottom,
    footerTop: pageNode.querySelector('.report-footer').getBoundingClientRect().top,
    footerGap: pageNode.querySelector('.report-footer').getBoundingClientRect().top
      - pageNode.querySelector('[data-pdf-flow-items]').getBoundingClientRect().bottom,
    firstBlockHeight: pageNode.querySelector('[data-pdf-flow-item]')?.getBoundingClientRect().height || 0,
    title: pageNode.querySelector('.report-title').textContent.trim(),
    height: pageNode.getBoundingClientRect().height
  })));
}

function boundaryFixture() {
  const item = label => `<div data-pdf-flow-item data-flow-kind="boundary" data-page-title="Boundary" data-page-kicker="Test" data-page-section="executive-summary-brief"><span>${label}</span></div>`;
  return `<!doctype html><html><head><style>
    *{box-sizing:border-box}html,body{margin:0}.report-page{position:relative;width:297mm;min-height:210mm;padding:10mm;display:flex;flex-direction:column}.report-page-head{height:20mm}.report-body{flex:1}.report-footer{position:absolute;left:10mm;right:10mm;bottom:8mm;height:5mm}[data-pdf-flow-items]{display:grid;gap:0}[data-pdf-flow-item]{min-height:0}
  </style></head><body><div class="report-document"><section class="report-page" data-measured-flow="executive-summary"><header class="report-page-head"><div><div class="report-kicker">Test</div><h1 class="report-title">Boundary</h1></div></header><main class="report-body"><div data-pdf-flow-items>${item('A')}${item('B')}</div></main><footer class="report-footer"><span>Footer</span></footer></section></div></body></html>`;
}

function splitUnitFixture(items) {
  const rows = items.map(item => `<li data-pdf-split-unit>${item}</li>`).join('');
  return `<!doctype html><html><head><style>
    *{box-sizing:border-box}html,body{margin:0}.report-page{position:relative;width:297mm;min-height:210mm;padding:10mm;display:flex;flex-direction:column}.report-page-head{height:20mm}.report-body{flex:1;padding-top:4mm}.report-footer{position:absolute;left:10mm;right:10mm;bottom:8mm;height:5mm}[data-pdf-flow-items]{display:grid;gap:0}.split-card{border:1px solid #ccc;padding:4mm}.split-card li{min-height:34mm;padding:2mm;overflow-wrap:anywhere}
  </style></head><body><div class="report-document"><section class="report-page" data-measured-flow="split-units"><header class="report-page-head"><div><div class="report-kicker">Test</div><h1 class="report-title">Split units</h1></div></header><main class="report-body"><div data-pdf-flow-items><div data-pdf-repeat-on-page class="repeat-axis">Repeated axis</div><div data-pdf-flow-item data-page-title="Split units" data-page-kicker="Test" data-page-section="split-units" data-pdf-splittable><article class="split-card"><h2 class="pdf-continuation-label">Delivery items</h2><ul>${rows}</ul></article></div></div></main><footer class="report-footer"><span>Footer</span></footer></section></div></body></html>`;
}

async function splitUnitPages(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-measured-page="split-units"]')].map(node => {
    const body = node.querySelector('[data-pdf-flow-items]').getBoundingClientRect();
    const footer = node.querySelector('.report-footer').getBoundingClientRect();
    return {
      title: node.querySelector('.report-title').textContent.trim(),
      label: node.querySelector('.pdf-continuation-label')?.textContent.trim() || '',
      repeatCount: node.querySelectorAll('[data-pdf-repeat-on-page]').length,
      footerGap: footer.top - body.bottom
    };
  }));
}

test('splits generic list units in order with continuation context', { timeout: 60000 }, async () => {
  const markers = Array.from({ length: 6 }, (_, index) => `UNIT-${index + 1}`);
  const { page, browser } = await browserPage(splitUnitFixture(markers));

  try {
    await page.evaluate(paginateMeasuredFlows);
    const actual = await page.$$eval('[data-pdf-split-unit]', nodes => nodes.map(node => node.textContent.trim()));
    const pages = await splitUnitPages(page);

    assert.deepEqual(actual, markers);
    assert.ok(pages.length > 1);
    assert.ok(pages.slice(1).every(item => /Continued$/.test(item.title)));
    assert.ok(pages.slice(1).every(item => /Continued$/.test(item.label)));
    assert.ok(pages.every(item => item.repeatCount === 1));
    assert.ok(pages.every(item => item.footerGap >= 8 * 96 / 25.4 - 1));
  } finally {
    await page.close();
    await browser.close();
  }
});

test('splits one oversized generic unit at word and character boundaries', { timeout: 60000 }, async () => {
  for (const value of [
    `WORD-START ${'oversized unit content '.repeat(800)} WORD-END`,
    `TOKEN-START-${'Z'.repeat(18000)}-TOKEN-END`
  ]) {
    const { page, browser } = await browserPage(splitUnitFixture([value]));
    try {
      await page.evaluate(paginateMeasuredFlows);
      const text = await page.$eval('body', node => node.textContent);
      const pages = await splitUnitPages(page);
      assert.match(text, /(?:WORD|TOKEN)-START/);
      assert.match(text, /(?:WORD|TOKEN)-END/);
      assert.ok(pages.length > 1);
      assert.ok(pages.every(item => item.footerGap >= 8 * 96 / 25.4 - 1));
    } finally {
      await page.close();
      await browser.close();
    }
  }
});

async function sizeBoundaryItems(page, overflowPx) {
  await page.evaluate(extra => {
    const source = document.querySelector('[data-measured-flow]');
    source.style.height = '210mm';
    source.style.overflow = 'hidden';
    const container = source.querySelector('[data-pdf-flow-items]');
    const footer = source.querySelector('.report-footer');
    const available = footer.getBoundingClientRect().top - (8 * 96 / 25.4) - container.getBoundingClientRect().top;
    const items = [...container.children];
    items[0].style.height = `${available / 2}px`;
    items[1].style.height = `${available / 2 + extra}px`;
  }, overflowPx);
}

test('fills remaining page space before creating a continuation page', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = legacyExecutiveSummaryFixture();
  const { page, browser } = await browserPage(renderOverviewReportHtml(fixture));

  try {
    assert.equal(await page.$$eval('.report-page', nodes => nodes.length), 1);
    const summary = await page.evaluate(paginateMeasuredFlows);
    const pages = await measuredPages(page);

    assert.equal(summary.flows, 1);
    assert.equal(summary.pages, pages.length);
    assert.ok(pages.length < 23);
    assert.ok(pages.some(result => result.blocks >= 3));
    pages.forEach((result, index) => {
      assert.ok(result.bodyBottom <= result.footerTop - 29, `page ${index + 1} must keep an 8 mm footer gap`);
      assert.ok(Math.abs(result.height - 793.7) < 1, `page ${index + 1} must remain A4 landscape height`);
    });
  } finally {
    await page.close();
    await browser.close();
  }
});

test('keeps an exact-boundary block and moves only a just-over-boundary block', { timeout: 60000 }, async () => {
  for (const [overflowPx, expectedPages] of [[0, 1], [2, 2]]) {
    const { page, browser } = await browserPage(boundaryFixture());
    try {
      await sizeBoundaryItems(page, overflowPx);
      await page.evaluate(paginateMeasuredFlows);
      const pages = await measuredPages(page);
      assert.equal(pages.length, expectedPages);
      assert.deepEqual(pages.map(result => result.blocks), expectedPages === 1 ? [2] : [1, 1]);
    } finally {
      await page.close();
      await browser.close();
    }
  }
});

test('keeps every generated page in source order and marks continuations', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = legacyExecutiveSummaryFixture();
  const { page, browser } = await browserPage(renderOverviewReportHtml(fixture));

  try {
    await page.evaluate(paginateMeasuredFlows);
    const kinds = await page.$$eval('[data-pdf-flow-item]', nodes => nodes.map(node => node.dataset.flowKind));
    const pages = await measuredPages(page);

    assert.deepEqual(kinds, [
      'portfolio-summary',
      'priority-project', 'priority-project',
      'management-decision', 'management-decision', 'management-decision', 'management-decision',
      'project-context', 'project-context', 'project-context', 'project-context', 'project-context', 'project-context'
    ]);
    assert.ok(pages.slice(1).some(result => /Continued$/.test(result.title)));
  } finally {
    await page.close();
    await browser.close();
  }
});

function oversizedSummaryFixture() {
  const long = label => `${label} ${'measured pagination content '.repeat(180)}`;
  return `WEEKLY MOVEMENT
Portfolio Summary: Oversized-card verification.
- Project: Oversized Project
  Movement: ${long('MOVEMENT-MARKER')}
  Blocker: ${long('BLOCKER-MARKER')}
  Next step: ${long('NEXT-STEP-MARKER')}
MANAGEMENT ASK
- Project: Oversized Project
  Decision / Support needed: ${long('DECISION-MARKER')}
  Business impact: ${long('IMPACT-MARKER')}`;
}

function oversizedFieldSummaryFixture() {
  return `WEEKLY MOVEMENT
Portfolio Summary: Oversized-field verification.
- Project: One Field Project
  Movement: FIELD-START ${'single field continuation text '.repeat(500)} FIELD-END
  Blocker: None
  Next step: Confirm completion.
MANAGEMENT ASK`;
}

test('splits an oversized card between labelled fields without losing text', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = oversizedSummaryFixture();
  const { page, browser } = await browserPage(renderOverviewReportHtml(fixture));

  try {
    await page.evaluate(paginateMeasuredFlows);
    const text = await page.$eval('.report-document', node => node.textContent.replace(/\s+/g, ' ').trim());
    ['MOVEMENT-MARKER', 'BLOCKER-MARKER', 'NEXT-STEP-MARKER', 'DECISION-MARKER', 'IMPACT-MARKER']
      .forEach(token => assert.match(text, new RegExp(token)));
    const pages = await measuredPages(page);
    assert.ok(pages.length > 1);
    pages.forEach((result, index) => {
      assert.ok(result.bodyBottom <= result.footerTop - 29, `oversized page ${index + 1} must fit`);
    });
  } finally {
    await page.close();
    await browser.close();
  }
});

test('splits one oversized field at a word boundary', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = oversizedFieldSummaryFixture();
  const { page, browser } = await browserPage(renderOverviewReportHtml(fixture));

  try {
    await page.evaluate(paginateMeasuredFlows);
    assert.ok(await page.$$eval('[data-pdf-field]', nodes => nodes.length > 1));
    const text = await page.$eval('body', node => node.textContent);
    assert.match(text, /Movement · Continued/);
    assert.match(text, /FIELD-START/);
    assert.match(text, /FIELD-END/);
  } finally {
    await page.close();
    await browser.close();
  }
});

test('packs the dense Week 28 legacy summary without empty or prematurely split pages', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = week28DenseExecutiveSummaryFixture();
  const { page, browser } = await browserPage(renderOverviewReportHtml(fixture));

  try {
    await page.evaluate(paginateMeasuredFlows);
    const pages = await measuredPages(page);

    assert.ok(pages.length < 23);
    assert.ok(pages.every(result => result.blocks > 0));
    assert.ok(pages.some(result => result.blocks >= 3));
    pages.forEach((result, index) => {
      assert.ok(result.footerGap >= 29, `dense page ${index + 1} must keep the footer gap`);
      if (index < pages.length - 1) {
        assert.ok(
          result.footerGap < pages[index + 1].firstBlockHeight + 13,
          `dense page ${index + 1} must not leave enough room for the next whole block`
        );
      }
    });
  } finally {
    await page.close();
    await browser.close();
  }
});

test('splits an unbroken token without clipping or entering an infinite loop', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = `WEEKLY MOVEMENT
Portfolio Summary: Long-token verification.
- Project: Token Project
  Movement: TOKEN-START-${'X'.repeat(20000)}-TOKEN-END
  Blocker: None
  Next step: Confirm output.
MANAGEMENT ASK`;
  const { page, browser } = await browserPage(renderOverviewReportHtml(fixture));

  try {
    await page.evaluate(paginateMeasuredFlows);
    const pages = await measuredPages(page);
    const text = await page.$eval('body', node => node.textContent);

    assert.match(text, /TOKEN-START/);
    assert.match(text, /TOKEN-END/);
    assert.ok(pages.length > 1);
    pages.forEach((result, index) => assert.ok(result.footerGap >= 29, `token page ${index + 1} must fit`));
  } finally {
    await page.close();
    await browser.close();
  }
});
