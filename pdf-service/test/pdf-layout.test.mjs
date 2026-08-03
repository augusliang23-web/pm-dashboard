import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { renderPdfBuffer } from '../src/pdf-renderer.js';
import { paginateMeasuredFlows } from '../src/measured-paginator.js';
import { renderOverviewReportHtml } from '../src/overview-report.js';
import { renderProjectReportHtml } from '../src/project-report.js';
import {
  compactExecutiveSummaryFixture,
  completeOverviewReportFixture,
  completeProjectReportFixture,
  stressExecutiveSummaryFixture,
  verboseExecutiveSummaryFixture
} from './report-fixtures.mjs';

function physicalPageCount(pdf) {
  return (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
}

test.after(async () => {
  await renderPdfBuffer.close();
});

test('a nine-project budget overview fits one landscape page without a trailing page', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  const baseProject = fixture.week.projects[0];
  fixture.week.projects = Array.from({ length: 9 }, (_, index) => ({
    ...baseProject,
    name: `Project ${index + 1}`,
    code: `P-${index + 1}`
  }));
  fixture.sections = ['budget-overview'];

  const pdf = await renderPdfBuffer(renderOverviewReportHtml(fixture));
  const pageObjects = Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || [];

  assert.equal(pageObjects.length, 1);
});

test('Executive milestones and Quarterly Roadmap each fit their compact landscape page', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-milestones', 'quarterly-roadmap'];

  const pdf = await renderPdfBuffer(renderOverviewReportHtml(fixture));

  assert.equal(physicalPageCount(pdf), 2);
});

test('compact Executive Summary renders exactly two landscape pages', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = compactExecutiveSummaryFixture();

  const pdf = await renderPdfBuffer(renderOverviewReportHtml(fixture));
  const pageObjects = Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || [];

  assert.equal(pageObjects.length, 2);
});

test('verbose Executive Summary creates measured continuation pages without pre-splitting HTML', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = verboseExecutiveSummaryFixture();

  const html = renderOverviewReportHtml(fixture);
  assert.equal((html.match(/class="report-page"/g) || []).length, 1);
  assert.equal((html.match(/class="report-page-head"/g) || []).length, 1);
  assert.equal((html.match(/class="report-footer"/g) || []).length, 1);
  const pdf = await renderPdfBuffer(html);
  const pageObjects = Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || [];

  assert.ok(pageObjects.length > 1);
  assert.ok(pageObjects.length < 5);
});

test('aligns every verbose Executive Summary wrapper to its own printable page', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = verboseExecutiveSummaryFixture();
  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.setContent(renderOverviewReportHtml(fixture), { waitUntil: 'networkidle0' });
    await page.evaluate(paginateMeasuredFlows);
    const frames = await page.evaluate(() => [...document.querySelectorAll('.report-page')].map(node => {
      const pageRect = node.getBoundingClientRect();
      const headerRect = node.querySelector('.report-page-head').getBoundingClientRect();
      const footerRect = node.querySelector('.report-footer').getBoundingClientRect();
      return {
        top: pageRect.top,
        height: pageRect.height,
        headerTop: headerRect.top - pageRect.top,
        footerBottom: footerRect.bottom - pageRect.top
      };
    }));

    assert.ok(frames.length > 1);
    assert.ok(frames.length < 5);
    frames.forEach((frame, index) => {
      assert.ok(Math.abs(frame.top - index * frame.height) < 1, `page ${index + 1} must begin at a page boundary`);
      assert.ok(Math.abs(frame.height - 793.7) < 1, `page ${index + 1} must be A4 landscape height`);
      assert.ok(frame.headerTop > 20, `page ${index + 1} header must not be clipped`);
      assert.ok(frame.footerBottom < frame.height - 20, `page ${index + 1} footer must remain inside its page`);
    });
  } finally {
    await page.close();
    await browser.close();
  }
});

test('splits high-text Executive Summary cards before any wrapper exceeds A4 height', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = stressExecutiveSummaryFixture();
  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.setContent(renderOverviewReportHtml(fixture), { waitUntil: 'networkidle0' });
    await page.evaluate(paginateMeasuredFlows);
    const heights = await page.evaluate(() => [...document.querySelectorAll('.report-page')]
      .map(node => node.getBoundingClientRect().height));

    assert.ok(heights.length > 5);
    heights.forEach((height, index) => {
      assert.ok(Math.abs(height - 793.7) < 1, `stress page ${index + 1} must remain A4 height`);
    });
    const pdf = await renderPdfBuffer(renderOverviewReportHtml(fixture));
    const pageObjects = Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || [];
    assert.equal(pageObjects.length, heights.length);
  } finally {
    await page.close();
    await browser.close();
  }
});

test('dense project portfolio keeps project context and footer clearance on continuations', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  const project = fixture.week.projects[0];
  project.name = 'Dense Project';
  project.code = 'DENSE-1';
  project.highlight = Array.from({ length: 6 }, (_, index) => `Dense highlight ${index + 1}`).join('\n');
  project.riskActions = Array.from({ length: 6 }, (_, index) => ({
    risk: `Dense risk ${index + 1} ${'risk detail '.repeat(8)}`,
    action: `Dense action ${index + 1} ${'action detail '.repeat(8)}`,
    primary: index === 0
  }));
  project.ganttWorkstreams = Array.from({ length: 12 }, (_, index) => ({
    name: `Dense workstream ${index + 1}`,
    startDate: `2026-07-${String(index + 1).padStart(2, '0')}`,
    endDate: `2026-07-${String(index + 3).padStart(2, '0')}`,
    status: 'in-progress',
    progress: index * 5
  }));
  fixture.week.projects = [project];
  fixture.sections = ['project-portfolio'];
  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.setContent(renderOverviewReportHtml(fixture), { waitUntil: 'networkidle0' });
    await page.evaluate(paginateMeasuredFlows);
    const pages = await page.evaluate(() => [...document.querySelectorAll('[data-measured-page="project-portfolio-DENSE-1"]')].map(node => {
      const body = node.querySelector('[data-pdf-flow-items]').getBoundingClientRect();
      const footer = node.querySelector('.report-footer').getBoundingClientRect();
      return {
        context: node.querySelector('.report-page-context')?.textContent.trim(),
        title: node.querySelector('.report-title')?.textContent.trim(),
        background: getComputedStyle(node).backgroundColor,
        footerGap: footer.top - body.bottom
      };
    }));

    assert.ok(pages.length > 1);
    assert.ok(pages.every(item => item.context === 'Dense Project'));
    assert.ok(pages.slice(1).every(item => /Continued$/.test(item.title)));
    assert.ok(pages.every(item => item.background === 'rgb(255, 255, 255)'));
    assert.ok(pages.every(item => item.footerGap >= 8 * 96 / 25.4 - 1));
  } finally {
    await page.close();
    await browser.close();
  }
});

test('dense management attention and risk actions use titled measured pages', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  const baseProject = fixture.week.projects[0];
  fixture.week.projects = Array.from({ length: 14 }, (_, index) => ({
    ...baseProject,
    name: `MANAGEMENT-PROJECT-${index + 1}`,
    code: `MGT-${index + 1}`,
    attention: index < 2 ? 'monitor' : 'watch',
    risk: `MANAGEMENT-RISK-${index + 1} ${'risk detail '.repeat(5)}`,
    weeklyActions: `MANAGEMENT-ACTION-${index + 1} ${'action detail '.repeat(5)}`,
    riskActions: [{
      risk: `MANAGEMENT-RISK-${index + 1} ${'risk detail '.repeat(5)}`,
      action: `MANAGEMENT-ACTION-${index + 1} ${'action detail '.repeat(5)}`,
      primary: true
    }]
  }));
  fixture.sections = ['attention-matrix', 'risk-actions'];
  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.setContent(renderOverviewReportHtml(fixture), { waitUntil: 'networkidle0' });
    await page.evaluate(paginateMeasuredFlows);
    const pages = await page.evaluate(() => [...document.querySelectorAll('[data-measured-page="management-attention"]')].map(node => {
      const body = node.querySelector('[data-pdf-flow-items]').getBoundingClientRect();
      const footer = node.querySelector('.report-footer').getBoundingClientRect();
      return {
        title: node.querySelector('.report-title').textContent.trim(),
        blocks: node.querySelectorAll('[data-pdf-flow-item]').length,
        riskRows: node.querySelectorAll('.risk-action-table tbody tr').length,
        riskHeaders: node.querySelectorAll('.risk-action-table thead').length,
        footerGap: footer.top - body.bottom
      };
    }));
    const riskRows = await page.$$eval('.risk-action-table tbody tr', rows => rows.map(row => row.cells[0].textContent.trim()));

    assert.ok(pages.length > 1);
    assert.ok(pages.every(item => item.blocks > 0));
    assert.ok(pages.every(item => item.title.startsWith('Management Attention')));
    assert.ok(pages.slice(1).every(item => /Continued$/.test(item.title)));
    assert.ok(pages.every(item => item.footerGap >= 8 * 96 / 25.4 - 1));
    assert.ok(pages.filter(item => item.riskRows > 0).every(item => item.riskHeaders === 1));
    assert.equal(riskRows.length, 14);
  } finally {
    await page.close();
    await browser.close();
  }
});

test('Project Update continuations preserve every list item and safe page spacing', { timeout: 60000 }, async () => {
  const fixture = completeProjectReportFixture();
  fixture.sections = ['project-brief', 'project-update'];
  fixture.project.name = 'Long Project Update';
  const highlights = Array.from({ length: 18 }, (_, index) => `H-${index + 1} highlight detail ${'delivery '.repeat(5)}`);
  const risks = Array.from({ length: 14 }, (_, index) => `R-${index + 1} risk detail ${'blocker '.repeat(5)}`);
  const actions = Array.from({ length: 16 }, (_, index) => `A-${index + 1} action detail ${'follow-up '.repeat(5)}`);
  fixture.project.highlight = highlights.join('\n');
  fixture.project.risk = risks.join('\n');
  fixture.project.weeklyActions = actions.join('\n');
  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.setContent(renderProjectReportHtml(fixture), { waitUntil: 'networkidle0' });
    await page.evaluate(paginateMeasuredFlows);
    const layout = await page.evaluate(() => [...document.querySelectorAll('[data-measured-page="project-summary"]')].map(node => {
      const pageRect = node.getBoundingClientRect();
      const headerRect = node.querySelector('.report-page-head').getBoundingClientRect();
      const footerRect = node.querySelector('.report-footer').getBoundingClientRect();
      const firstContent = node.querySelector('[data-pdf-flow-item]')?.getBoundingClientRect();
      const cards = [...node.querySelectorAll('.project-update-card,.project-brief-grid')]
        .map(card => card.getBoundingClientRect());
      return {
        title: node.querySelector('.report-title')?.textContent.trim(),
        headerGap: firstContent ? firstContent.top - headerRect.bottom : 0,
        updateUnits: node.querySelectorAll('.project-update-card [data-pdf-split-unit]').length,
        cardsInside: cards.every(card => card.top >= pageRect.top && card.bottom <= footerRect.top - 8 * 96 / 25.4 + 1)
      };
    }));
    const text = await page.$$eval('[data-pdf-split-unit]', nodes => nodes.map(node => node.textContent.trim()));

    assert.ok(layout.length > 1);
    assert.ok(layout[0].updateUnits > 0, 'Project Update should use the remaining space after Project brief');
    assert.ok(layout.every(item => item.title.startsWith('Long Project Update')));
    assert.ok(layout.slice(1).every(item => /Continued$/.test(item.title)));
    assert.ok(layout.every(item => item.headerGap >= 3 * 96 / 25.4 - 1));
    assert.ok(layout.every(item => item.cardsInside));
    for (const marker of [...highlights, ...risks, ...actions]) {
      assert.equal(text.filter(item => item === marker.trim()).length, 1, `${marker} must appear once`);
    }
  } finally {
    await page.close();
    await browser.close();
  }
});

test('long resource tables repeat headers and keep every row inside measured pages', { timeout: 60000 }, async () => {
  const fixture = completeProjectReportFixture();
  fixture.sections = ['team-allocation', 'resources'];
  fixture.project.teamMembers = Array.from({ length: 24 }, (_, index) => ({
    name: `RESOURCE-MEMBER-${index + 1}`,
    roleName: `RESOURCE-ROLE-${index + 1}`,
    effortPct: 50
  }));
  fixture.project.resources = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [
    `role_${index + 1}`,
    { role: `RESOURCE-ROLE-${index + 1}`, estimated: 120, actual: 60 }
  ]));
  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.setContent(renderProjectReportHtml(fixture), { waitUntil: 'networkidle0' });
    await page.evaluate(paginateMeasuredFlows);
    const pages = await page.evaluate(() => [...document.querySelectorAll('[data-measured-page="resource"]')].map(node => {
      const body = node.querySelector('[data-pdf-flow-items]').getBoundingClientRect();
      const footer = node.querySelector('.report-footer').getBoundingClientRect();
      return {
        blocks: node.querySelectorAll('[data-pdf-flow-item]').length,
        tableHeaders: node.querySelectorAll('thead').length,
        footerGap: footer.top - body.bottom,
        title: node.querySelector('.report-title').textContent.trim()
      };
    }));
    const names = await page.$$eval('.team-allocation-table tbody tr', rows => rows.map(row => row.cells[0].textContent.trim()));
    const roles = await page.$$eval('.discipline-hours-table tbody tr', rows => rows.map(row => row.cells[0].textContent.trim()));

    assert.ok(pages.length > 1);
    assert.ok(pages.every(item => item.blocks > 0 && item.tableHeaders > 0));
    assert.ok(pages.slice(1).every(item => /Continued$/.test(item.title)));
    assert.ok(pages.every(item => item.footerGap >= 8 * 96 / 25.4 - 1));
    assert.deepEqual(names, Array.from({ length: 24 }, (_, index) => `RESOURCE-MEMBER-${index + 1}`));
    assert.deepEqual(roles, Array.from({ length: 24 }, (_, index) => `RESOURCE-ROLE-${index + 1}`));
  } finally {
    await page.close();
    await browser.close();
  }
});

test('long milestone and Gantt sections retain rows, axes, titles, and footer clearance', { timeout: 60000 }, async () => {
  const fixture = completeProjectReportFixture();
  fixture.sections = ['milestone', 'gantt'];
  fixture.project.name = 'Dense Delivery Plan';
  fixture.project.milestones = Array.from({ length: 18 }, (_, index) => ({
    name: `MILESTONE-LONG-${index + 1}`,
    date: `2026-${String(Math.floor(index / 3) + 1).padStart(2, '0')}-15`,
    status: index % 4 === 0 ? 'at-risk' : 'planned'
  }));
  fixture.project.ganttWorkstreams = Array.from({ length: 22 }, (_, index) => ({
    name: `GANTT-LONG-${index + 1}`,
    startDate: index === 20 ? 'invalid' : '2026-01-01',
    endDate: index === 21 ? '' : '2026-12-31',
    status: index % 3 === 0 ? 'at-risk' : 'in-progress',
    progress: index * 4
  }));
  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.setContent(renderProjectReportHtml(fixture), { waitUntil: 'networkidle0' });
    await page.evaluate(paginateMeasuredFlows);
    const layout = await page.evaluate(() => [...document.querySelectorAll('[data-measured-page="milestone"],[data-measured-page="gantt"]')].map(node => {
      const body = node.querySelector('[data-pdf-flow-items]').getBoundingClientRect();
      const footer = node.querySelector('.report-footer').getBoundingClientRect();
      return {
        flow: node.dataset.measuredPage,
        title: node.querySelector('.report-title').textContent.trim(),
        axis: node.querySelectorAll('[data-pdf-repeat-on-page]').length,
        footerGap: footer.top - body.bottom
      };
    }));
    const milestones = await page.$$eval('.milestone-row strong', nodes => nodes.map(node => node.textContent.trim()));
    const workstreams = await page.$$eval('.gantt-label strong', nodes => nodes.map(node => node.textContent.trim()));

    assert.ok(layout.filter(item => item.flow === 'milestone').length > 1);
    assert.ok(layout.filter(item => item.flow === 'gantt').length > 1);
    assert.ok(layout.filter(item => item.flow === 'gantt').every(item => item.axis === 1));
    assert.ok(layout.every(item => item.title.startsWith('Dense Delivery Plan')));
    assert.ok(layout.every(item => item.footerGap >= 8 * 96 / 25.4 - 1));
    assert.deepEqual(milestones, Array.from({ length: 18 }, (_, index) => `MILESTONE-LONG-${index + 1}`));
    assert.deepEqual(workstreams, Array.from({ length: 22 }, (_, index) => `GANTT-LONG-${index + 1}`));
  } finally {
    await page.close();
    await browser.close();
  }
});

test('full Overview and Project PDFs preserve explicit page parity and period metadata', { timeout: 60000 }, async () => {
  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const cases = [
    ['Overview', renderOverviewReportHtml(completeOverviewReportFixture())],
    ['Project', renderProjectReportHtml(completeProjectReportFixture())]
  ];

  try {
    for (const [label, html] of cases) {
      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'networkidle0' });
        await page.evaluate(paginateMeasuredFlows);
        const layout = await page.evaluate(() => ({
          explicitPages: document.querySelectorAll('.report-page').length,
          emptyMeasuredPages: [...document.querySelectorAll('[data-measured-page]')]
            .filter(node => !node.querySelector('[data-pdf-flow-item]')).length,
          periods: [...document.querySelectorAll('.report-page')].map(node => ({
            header: node.querySelector('.report-meta')?.textContent || '',
            footer: node.querySelector('.report-footer span:last-child')?.textContent || ''
          }))
        }));
        const pdf = await renderPdfBuffer(html);

        assert.equal(physicalPageCount(pdf), layout.explicitPages, `${label} physical pages must match HTML pages`);
        assert.equal(layout.emptyMeasuredPages, 0, `${label} must not contain an empty measured page`);
        layout.periods.forEach((period, index) => {
          assert.match(period.header, /W28 2026/,
            `${label} page ${index + 1} header must show the reporting week`);
          assert.match(period.header, /Jul 6/, `${label} page ${index + 1} header must show the date range`);
          assert.equal(period.footer, period.header, `${label} page ${index + 1} footer must repeat the period`);
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
