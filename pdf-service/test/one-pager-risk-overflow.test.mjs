import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { renderProjectReportHtml } from '../src/project-report.js';
import { completeProjectReportFixture } from './report-fixtures.uat.mjs';
import { completeOverviewReportFixture } from './report-fixtures.uat.mjs';
import { renderOverviewReportHtml } from '../src/overview-report.js';
import { paginateMeasuredFlows } from '../src/measured-paginator.js';

test('one-page PDF preserves both long risks and their complete mitigation actions', async () => {
  const fixture = completeProjectReportFixture();
  const pairs = [
    {
      risk: 'Several integration scenarios will be validated for the first time in the target environment during the planned test period. Unverified interactions between the controller, battery systems, and generator configuration may introduce unexpected integration issues and reduce planned test execution efficiency.',
      action: 'Prioritize validation of critical integration interfaces and establish rapid issue triage and decision-making support during the test period.',
      primary: true
    },
    {
      risk: 'Revised flowcharts and control logic updates are still being finalized. Until the revised workflows are reviewed and agreed with the engineering team, the affected software scope, development effort, and validation impact cannot be fully assessed.',
      action: 'Finalize the revised flowcharts during the test period and complete impact assessment for development estimation and quality assurance planning.',
      primary: false
    }
  ];
  fixture.project.riskActions = pairs;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(renderProjectReportHtml({ ...fixture, layout: 'one-page', sections: [] }), { waitUntil: 'networkidle0' });
    const result = await page.evaluate(() => {
      const stack = document.querySelector('.one-pager-risk-stack');
      const bottom = stack.getBoundingClientRect().bottom;
      return {
        risks: [...stack.querySelectorAll('.one-pager-risk-block p')].map(el => el.textContent),
        actions: [...stack.querySelectorAll('.one-pager-required-action p')].map(el => el.textContent),
        fits: stack.scrollHeight <= stack.clientHeight + 1,
        lastActionFits: stack.lastElementChild.querySelector('.one-pager-required-action').getBoundingClientRect().bottom <= bottom + 1
      };
    });
    assert.deepEqual(result.risks, pairs.map(pair => pair.risk));
    assert.deepEqual(result.actions, pairs.map(pair => pair.action));
    assert.ok(result.fits && result.lastActionFits, 'second mitigation action must fit inside the printable risk panel');
  } finally { await browser.close(); }
});

function longActions(prefix) {
  return Array.from({ length: 23 }, (_, index) => `${prefix}-${index + 1}: Coordinate the updated design package, review the equipment specifications, and confirm responsibilities and the committed completion date with the engineering and delivery teams.`);
}

test('an overflowing 23-item action list keeps its full ordered text on marked continuation pages', async () => {
  const fixture = completeProjectReportFixture();
  const actions = longActions('ACTION');
  fixture.project.weeklyActions = actions.join('\n');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(renderProjectReportHtml({ ...fixture, layout: 'one-page', sections: [] }), { waitUntil: 'networkidle0' });
    await page.evaluate(paginateMeasuredFlows);
    const result = await page.evaluate(() => {
      const quadrant = document.querySelector('.one-pager-quadrant.blue');
      const continued = [...document.querySelectorAll('.one-pager-continuation')];
      return {
        summaryFits: quadrant.scrollHeight <= quadrant.clientHeight + 1,
        notice: quadrant.querySelector('.one-pager-continuation-note')?.textContent,
        items: [...document.querySelectorAll('.one-pager-list.blue li,.one-pager-continuation .report-list li')].map(el => el.textContent),
        continuationCount: continued.length,
        footerFits: continued.every(el => el.querySelector('[data-pdf-flow-items]').getBoundingClientRect().bottom <= el.querySelector('.report-footer').getBoundingClientRect().top - 29)
      };
    });
    assert.ok(result.continuationCount > 0, 'overflow must create a visible continuation');
    assert.match(result.notice || '', /continuation pages/);
    assert.deepEqual(result.items, actions);
    assert.ok(result.summaryFits && result.footerFits, 'summary and continuations must fit their printable bounds');
    const pdf = await page.pdf({ format: 'A4', landscape: true, preferCSSPageSize: true });
    assert.ok((Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length > 1);
  } finally { await browser.close(); }
});

test('each portfolio project keeps its continuation pages before the next project', async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['project-portfolio'];
  fixture.week.projects = fixture.week.projects.map((project, index) => ({ ...project,
    name: `Project ${index + 1}`, weeklyActions: longActions(`PROJECT-${index + 1}`).join('\n') }));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(renderOverviewReportHtml({ ...fixture, projectPortfolioLayout: 'one-page' }), { waitUntil: 'networkidle0' });
    await page.evaluate(paginateMeasuredFlows);
    const projects = await page.evaluate(() => [...document.querySelectorAll('.report-document > section')].map(el => ({
      name: el.querySelector('h1')?.textContent,
      continued: el.classList.contains('one-pager-continuation')
    })));
    assert.equal(projects.filter(p => !p.continued).length, 2);
    assert.ok(projects.some(p => p.continued));
    const nextProject = projects.findIndex(p => p.name === 'Project 2' && !p.continued);
    assert.ok(nextProject > 1);
    assert.ok(projects.slice(0, nextProject).every(p => p.name.startsWith('Project 1')));
    assert.ok(projects.slice(nextProject).every(p => p.name.startsWith('Project 2')));
  } finally { await browser.close(); }
});

test('a long unbroken action token wraps without horizontal clipping or lost characters', async () => {
  const fixture = completeProjectReportFixture();
  const action = `TOKEN-START-${'Z'.repeat(5000)}-TOKEN-END`;
  fixture.project.weeklyActions = action;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(renderProjectReportHtml({ ...fixture, layout: 'one-page', sections: [] }), { waitUntil: 'domcontentloaded' });
    await page.evaluate(paginateMeasuredFlows);
    const result = await page.evaluate(() => ({
      continued: document.querySelectorAll('.one-pager-continuation').length,
      text: [...document.querySelectorAll('.one-pager-list.blue li,.one-pager-continuation .report-list li')].map(el => el.textContent).join(''),
      fits: [...document.querySelectorAll('.one-pager-quadrant.blue,.one-pager-continuation')].every(el => el.scrollWidth <= el.clientWidth + 1)
    }));
    assert.ok(result.continued > 0, 'oversized token needs continuation pages');
    assert.equal(result.text, action);
    assert.ok(result.fits, 'no horizontal clipping');
  } finally { await browser.close(); }
});

test('an oversized risk preserves separate labelled risk and mitigation fields across pages', async () => {
  const fixture = completeProjectReportFixture();
  const risk = `RISK-START ${'risk clause repeated '.repeat(800)}RISK-END`;
  const action = 'ACTION-START Complete the verification and confirm the recovery date. ACTION-END';
  fixture.project.riskActions = [{ risk, action, primary: true }];
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(renderProjectReportHtml({ ...fixture, layout: 'one-page', sections: [] }), { waitUntil: 'domcontentloaded' });
    await page.evaluate(paginateMeasuredFlows);
    const result = await page.evaluate(() => ({
      risk: [...document.querySelectorAll('.one-pager-risk-block p')].map(el => el.textContent).join(' '),
      actions: [...document.querySelectorAll('.one-pager-required-action p')].map(el => el.textContent),
      labels: [...document.querySelectorAll('.one-pager-continuation [data-pdf-field] strong,.one-pager-continuation [data-pdf-field] .one-pager-risk-label')].map(el => el.textContent),
      pairs: [...document.querySelectorAll('.one-pager-continuation [data-pdf-field]')].map(el => el.dataset.pdfPairIndex)
    }));
    assert.equal(result.risk, risk.trim());
    assert.deepEqual(result.actions, [action]);
    assert.ok(result.labels.length > 1 && result.labels.every(label => label.includes('Pair 1')));
    assert.ok(result.pairs.every(pair => pair === '1'));
  } finally { await browser.close(); }
});
