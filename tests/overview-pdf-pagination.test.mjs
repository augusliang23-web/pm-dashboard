import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const productionDashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const printStart = dashboard.indexOf('@media print {');
const printCss = dashboard.slice(printStart, dashboard.indexOf('</style>', printStart));

test('Overview PDF lets oversized roadmap and summary containers flow across pages', () => {
  assert.match(printCss, /\.executive-milestone-block\s*\{[^}]*break-inside:\s*auto[^}]*page-break-inside:\s*auto/);
  assert.match(printCss, /\.exec-summary-grid\s*\{[^}]*break-inside:\s*auto[^}]*page-break-inside:\s*auto/);
});

test('Overview PDF keeps roadmap and summary reading units intact', () => {
  assert.match(printCss, /\.dcdc-cell\s*\{[^}]*break-inside:\s*avoid-page[^}]*page-break-inside:\s*avoid/);
  assert.match(printCss, /\.exec-summary-section\s*\{[^}]*break-inside:\s*avoid-page[^}]*page-break-inside:\s*avoid/);
  assert.match(printCss, /\.portfolio-roadmap-head\s*\{[^}]*break-after:\s*avoid-page[^}]*page-break-after:\s*avoid/);
});

test('all PDF reports use landscape A4 and portfolio resource load has its own print column', () => {
  assert.match(dashboard, /@page\s*\{\s*size:\s*A4 landscape;/);

  const portfolioStart = dashboard.indexOf('<section class="project-portfolio-panel"');
  const portfolioEnd = dashboard.indexOf('${renderResourceBudgetOverview(projs)}', portfolioStart);
  const portfolio = dashboard.slice(portfolioStart, portfolioEnd);
  assert.match(portfolio, /<\/div>\s*<div class="exec-resource-snapshot">/);

  const printRule = printCss.match(/\.project-portfolio-grid \.exec-project-top\s*\{[^}]*\}/)?.[0] || '';
  assert.equal((printRule.match(/minmax\(/g) || []).length, 4);
});

test('portfolio PDF fills its horizontal summary row with an optional budget snapshot', () => {
  const portfolioStart = dashboard.indexOf('<section class="project-portfolio-panel"');
  const portfolioEnd = dashboard.indexOf('${renderResourceBudgetOverview(projs)}', portfolioStart);
  const portfolio = dashboard.slice(portfolioStart, portfolioEnd);
  assert.match(portfolio, /const budget = projectBudgetTotals\(p, overviewCurrency\)/);
  assert.match(portfolio, /class="exec-budget-snapshot"/);
  assert.match(printCss, /\.project-portfolio-grid \.exec-project-signals\s*\{[^}]*grid-column:\s*1 \/ -1/);
});

test('roadmap PDF keeps the v2.0 DCDC title and table units together', () => {
  assert.match(dashboard, /class="dcdc-title"/);
  assert.match(printCss, /\.dcdc-title\s*\{[^}]*break-after:\s*avoid-page[^}]*page-break-after:\s*avoid/);
  assert.match(printCss, /\.dcdc-cell\s*\{[^}]*break-inside:\s*avoid-page[^}]*page-break-inside:\s*avoid/);
});

test('PDF reports start later logical sections without a trailing blank-page break', () => {
  assert.match(dashboard, /id="printReportRoot"/);
  assert.match(printCss, /body\.print-presentation-report #printReportRoot\s*\{[^}]*display:\s*block/);
  for (const source of [dashboard, productionDashboard]) {
    const start = source.indexOf('@media print {');
    const css = source.slice(start, source.indexOf('</style>', start));
    assert.match(css, /\.print-report-page\s*\{[^}]*break-after:\s*auto[^}]*page-break-after:\s*auto/);
    assert.match(css, /\.print-report-page \+ \.print-report-page\s*\{[^}]*break-before:\s*page[^}]*page-break-before:\s*always/);
    assert.match(css, /\.print-report-footer\s*\{[^}]*break-before:\s*avoid-page[^}]*page-break-before:\s*avoid/);
  }
  assert.match(printCss, /\.print-report-unit\s*\{[^}]*break-inside:\s*avoid-page[^}]*page-break-inside:\s*avoid/);
});

test('Overview report never marks an entire cloned section as an unbreakable print unit', () => {
  const start = dashboard.indexOf('function cloneOverviewSectionForPrint(');
  const end = dashboard.indexOf('function renderOverviewPortfolioReportPages(', start);
  const source = dashboard.slice(start, end);
  assert.match(source, /clone\.classList\.add\('print-report-flow'\)/);
  assert.doesNotMatch(source, /clone\.classList\.add\('print-report-unit'\)/);
  assert.match(printCss, /\.print-report-flow\s*\{[^}]*break-inside:\s*auto[^}]*page-break-inside:\s*auto/);
});
