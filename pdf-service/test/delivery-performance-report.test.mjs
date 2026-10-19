import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPdfBuffer } from '../src/pdf-renderer.js';
import {
  DELIVERY_PERFORMANCE_SECTION_ID, WARNING_MESSAGES, formatWeekLabel, renderDeliveryPerformanceDocument, renderPortfolioDeliveryPerformancePages
} from '../src/delivery-performance-report.js';
import { renderOverviewReportHtml } from '../src/overview-report.js';
import { metricCard, reportPage } from '../src/report-components.js';
import { completeOverviewReportFixture } from './report-fixtures.mjs';
import { renderDeliveryTrendsPage } from '../../js/delivery-trends-view.mjs';
import {
  emptyContract, gapContract, historicalOnlyContract, noScopeFlagContract, unavailableContract, hostileContract, largeContract, longNameContract, missingMetricsContract,
  negativeContract, syntheticContract, zeroGainContract
} from '../../tests/delivery-trends-synthetic-fixtures.mjs';

const text = html => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const physicalPageCount = pdf => (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;

test.after(async () => { await renderPdfBuffer.close(); });

test('renders summary metrics, trend chart and project table from the contract', () => {
  const html = renderPortfolioDeliveryPerformancePages(syntheticContract(), { period: 'W41 2026' });
  assert.match(html, new RegExp(`data-report-section="${DELIVERY_PERFORMANCE_SECTION_ID}"`));
  assert.match(text(html), /Weekly Progress Gain \+2\.5pp 6 comparable projects/);
  assert.match(text(html), /Projects Progressed 5 of 6 comparable/);
  assert.match(text(html), /Current Completion 48\.3%/);
  assert.match(text(html), /Project Manager/);
  assert.equal((html.match(/data-pdf-split-unit/g) || []).length, 6);
  assert.match(html, /<svg class="dp-trend-svg"/);
  assert.equal((html.match(/class="dp-spark"/g) || []).length, 6);
  assert.doesNotMatch(html, />Owner</);
});

test('zero is shown only when genuinely zero; missing is N/A', () => {
  assert.match(text(renderPortfolioDeliveryPerformancePages(zeroGainContract())), /Weekly Progress Gain 0pp/);
  const missing = text(renderPortfolioDeliveryPerformancePages(missingMetricsContract()));
  assert.match(missing, /Weekly Progress Gain N\/A No comparable projects/);
  assert.match(missing, /Current Completion N\/A/);
  assert.doesNotMatch(missing, /0pp|0%/);
  assert.doesNotMatch(missing, /no progress/i);
});

test('negative progress and chart gaps are visible', () => {
  assert.match(renderPortfolioDeliveryPerformancePages(negativeContract()), /▼ -3\.4pp/);
  const gaps = renderPortfolioDeliveryPerformancePages(gapContract());
  assert.equal((gaps.match(/class="dp-gap"/g) || []).length, 2);
  assert.equal((gaps.match(/class="dp-line" d="[^"]*"/)[0].match(/ M\d/g) || []).length, 1);
});

test('only the last 6 weeks are displayed by default', () => {
  const base = syntheticContract();
  const extra = [{ weekId: 'a', label: 'OLD1', gainPp: 9, comparableCount: 6 }, { weekId: 'b', label: 'OLD2', gainPp: 9, comparableCount: 6 }];
  const html = renderPortfolioDeliveryPerformancePages({ ...base, weeklySeries: [...extra, ...base.weeklySeries] });
  assert.doesNotMatch(html, /OLD1|OLD2/);
});

test('displays up to 12 weeks when windowWeeks is 12', () => {
  const base = syntheticContract();
  const extra = [
    { weekId: 'w1', label: 'W01 2026', gainPp: 1.1, comparableCount: 6 },
    { weekId: 'w2', label: 'W02 2026', gainPp: 2.2, comparableCount: 6 },
    { weekId: 'w3', label: 'W03 2026', gainPp: 3.3, comparableCount: 6 },
    { weekId: 'w4', label: 'W04 2026', gainPp: 4.4, comparableCount: 6 },
    { weekId: 'w5', label: 'W05 2026', gainPp: 5.5, comparableCount: 6 },
    { weekId: 'w6', label: 'W06 2026', gainPp: 6.6, comparableCount: 6 }
  ];
  const html = renderPortfolioDeliveryPerformancePages({ ...base, windowWeeks: 12, weeklySeries: [...extra, ...base.weeklySeries] });
  assert.match(html, /W01 2026/);
  assert.match(html, /12-week trend/);
});

test('empty portfolio and unsupported contract render safe messages', () => {
  assert.match(text(renderPortfolioDeliveryPerformancePages(emptyContract())), /No projects are available/);
  assert.match(text(renderPortfolioDeliveryPerformancePages(null)), /unavailable for this reporting week or uses an unsupported contract version/);
});

test('synthetic provenance is disclosed; non-synthetic is not labelled', () => {
  assert.match(renderPortfolioDeliveryPerformancePages(syntheticContract()), /Synthetic data for preview only/);
  const real = syntheticContract({ provenance: { source: 'firestore', anchorWeekId: 'x', asOf: 'y', windowWeeks: 6 } });
  assert.doesNotMatch(renderPortfolioDeliveryPerformancePages(real), /Synthetic data/);
});

test('untrusted text is escaped', () => {
  const html = renderPortfolioDeliveryPerformancePages(hostileContract());
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img src=x/);
});

test('web and PDF render the same formatted figures from one contract', () => {
  for (const contract of [syntheticContract(), zeroGainContract(), negativeContract(), missingMetricsContract()]) {
    const web = text(renderDeliveryTrendsPage(contract));
    const pdf = text(renderPortfolioDeliveryPerformancePages(contract));
    const gain = contract.summary.weeklyProgressGainPp;
    const expected = gain === null ? 'N/A' : `${gain > 0 ? '+' : ''}${gain}pp`;
    assert.ok(web.includes(`Weekly Progress Gain ${expected}`), `web ${expected}`);
    assert.ok(pdf.includes(`Weekly Progress Gain ${expected}`), `pdf ${expected}`);
  }
});

test('HTML document is well formed with balanced structure', () => {
  const html = renderDeliveryPerformanceDocument(syntheticContract(), { period: 'W41 2026' });
  assert.match(html, /^<!doctype html><html>/);
  assert.equal((html.match(/<section/g) || []).length, (html.match(/<\/section>/g) || []).length);
  assert.equal((html.match(/<table/g) || []).length, (html.match(/<\/table>/g) || []).length);
  assert.equal((html.match(/<svg/g) || []).length, (html.match(/<\/svg>/g) || []).length);
  assert.equal((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length);
  assert.doesNotMatch(html, /NaN|undefined/);
  assert.match(html, /\.dp-table/);
});

test('PDF: typical 6-project portfolio fits on a single landscape page', { timeout: 60000 }, async () => {
  const pdf = await renderPdfBuffer(renderDeliveryPerformanceDocument(syntheticContract(), { period: 'W41 2026' }));
  assert.equal(physicalPageCount(pdf), 1);
});

test('PDF: 7-project portfolio stays within two pages', { timeout: 60000 }, async () => {
  const pdf = await renderPdfBuffer(renderDeliveryPerformanceDocument(largeContract(7), { period: 'W41 2026' }));
  assert.ok(physicalPageCount(pdf) <= 2, `pages=${physicalPageCount(pdf)}`);
  const real = syntheticContract({ provenance: { source: "uat", anchorWeekId: "x", asOf: "y", windowWeeks: 6 }, projects: largeContract(7).projects, warnings: Array.from({ length: 4 }, () => ({ code: "baseline-unverified", message: "baseline unverified" })) });
  const single = await renderPdfBuffer(renderDeliveryPerformanceDocument(real, { period: "W41 2026" }));
  assert.equal(physicalPageCount(single), 1, "seven projects with notes fit one page when no preview banner is shown");
});

test('PDF: 14-project portfolio continues onto extra pages without clipping rows', { timeout: 60000 }, async () => {
  const html = renderDeliveryPerformanceDocument(largeContract(14), { period: 'W41 2026' });
  const pdf = await renderPdfBuffer(html);
  const pages = physicalPageCount(pdf);
  assert.ok(pages >= 2 && pages <= 3, `pages=${pages}`);
});

test('PDF: long project and manager names do not add runaway pages', { timeout: 60000 }, async () => {
  const pdf = await renderPdfBuffer(renderDeliveryPerformanceDocument(longNameContract(), { period: 'W41 2026' }));
  assert.ok(physicalPageCount(pdf) <= 2);
});

test('PDF: empty and missing-data portfolios render one page', { timeout: 60000 }, async () => {
  for (const contract of [emptyContract(), missingMetricsContract()]) {
    const pdf = await renderPdfBuffer(renderDeliveryPerformanceDocument(contract, { period: 'W41 2026' }));
    assert.equal(physicalPageCount(pdf), 1);
  }
});

test('existing Overview report output and shared components are unaffected', () => {
  const fixture = completeOverviewReportFixture();
  const before = renderOverviewReportHtml(fixture);
  renderPortfolioDeliveryPerformancePages(syntheticContract());
  assert.equal(renderOverviewReportHtml(fixture), before);
  assert.doesNotMatch(before.replace(/<style>[\s\S]*?<\/style>/, ''), /Portfolio Delivery Performance|dp-table/);
  assert.match(metricCard('A', '1', 'd'), /^<article class="card metric-card neutral">/);
  assert.match(reportPage({ section: 's', title: 'T' }), /data-report-section="s"/);
});

test('historical-only projects are not listed as current projects', () => {
  const html = text(renderPortfolioDeliveryPerformancePages(historicalOnlyContract()));
  assert.match(html, /Synthetic Project 1/);
  assert.doesNotMatch(html, /Synthetic Historical Only/);
});

test('missing isInAnchorScope fails closed instead of listing every project', () => {
  const html = renderPortfolioDeliveryPerformancePages(noScopeFlagContract());
  assert.match(text(html), /current project list is unavailable/);
  assert.doesNotMatch(html, /Synthetic Project 1/);
  assert.equal((html.match(/data-pdf-split-unit/g) || []).length, 0);
});

test('an unavailable contract renders an explicit unavailable page, not numbers', () => {
  const html = text(renderPortfolioDeliveryPerformancePages(unavailableContract()));
  assert.match(html, /unavailable for this reporting week/);
  assert.doesNotMatch(html, /Weekly Progress Gain/);
});

test('repeated warnings become one plain-language footnote with a count', () => {
  const warnings = Array.from({ length: 12 }, (_, i) => ({ code: 'baseline-unverified', message: 'baseline unverified', weekId: `W${i}`, count: 1 }));
  const html = renderPortfolioDeliveryPerformancePages(syntheticContract({ warnings }));
  assert.doesNotMatch(text(html), /baseline unverified/);
  assert.match(html, /unverified baselines and should be interpreted with caution\. \(12 weeks\)/);
});

test('week labels and warning messages are identical to the web view', async () => {
  const web = await import('../../js/delivery-trends-view.mjs');
  assert.deepEqual({ ...WARNING_MESSAGES }, { ...web.WARNING_MESSAGES });
  for (const entry of [{ label: '2026-W37' }, { label: '2026-W7' }, { reportingPeriod: { year: 2026, week: 5 } }, { label: 'Free text' }, {}]) {
    assert.equal(formatWeekLabel(entry), web.formatWeekLabel(entry));
  }
});

test('chart axis uses W37 2026 style labels', () => {
  const html = renderPortfolioDeliveryPerformancePages(syntheticContract({ weeklySeries: [{ weekId: '2026-W36', label: '2026-W36', gainPp: 1, comparableCount: 3 }, { weekId: '2026-W37', label: '2026-W37', gainPp: 2, comparableCount: 3 }] }));
  assert.match(html, />W36 2026</);
  assert.doesNotMatch(html, />2026-W3\d</);
});

test('project health shows labelled counts with a shape and text per status', () => {
  const html = renderPortfolioDeliveryPerformancePages(syntheticContract());
  assert.match(text(html), /Project Health ● On Track 3 ▲ At Risk 2 ■ Critical 1/);
  assert.doesNotMatch(text(renderPortfolioDeliveryPerformancePages(missingMetricsContract())), /Project Health ●/);
  assert.match(text(renderPortfolioDeliveryPerformancePages(missingMetricsContract())), /Project Health N\/A/);
});
