import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPdfBuffer } from '../src/pdf-renderer.js';
import { renderOverviewReportHtml } from '../src/overview-report.js';
import { DELIVERY_PERFORMANCE_SECTION, OVERVIEW_SECTIONS, parseReportRequest } from '../src/report-request.js';
import { completeOverviewReportFixture } from './report-fixtures.mjs';
import { historicalOnlyContract, largeContract, noScopeFlagContract, syntheticContract } from '../../tests/delivery-trends-synthetic-fixtures.mjs';

const SECTION = 'portfolio-delivery-performance';
const physicalPageCount = pdf => (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
const body = html => html.replace(/<style>[\s\S]*?<\/style>/, '');
const request = (sections = [SECTION]) => ({ mode: 'overview', weekId: 'W41', sections, projectCodes: ['A'] });

test.after(async () => { await renderPdfBuffer.close(); });

test('request whitelist: the new section is rejected unless the target explicitly enables it', () => {
  assert.equal(DELIVERY_PERFORMANCE_SECTION, SECTION);
  assert.throws(() => parseReportRequest(request()), /Unknown report section: portfolio-delivery-performance/);
  assert.throws(() => parseReportRequest(request(), {}), /Unknown report section/);
  assert.throws(() => parseReportRequest(request(), { deliveryPerformanceSection: false }), /Unknown report section/);
  assert.throws(() => parseReportRequest(request(), { deliveryPerformanceSection: 'yes' }), /Unknown report section/);
  assert.deepEqual(parseReportRequest(request(), { deliveryPerformanceSection: true }).sections, [SECTION]);
});

test('request whitelist: every existing Overview section still parses and project mode is untouched', () => {
  for (const section of OVERVIEW_SECTIONS) assert.deepEqual(parseReportRequest(request([section])).sections, [section]);
  assert.equal(OVERVIEW_SECTIONS.has(SECTION), false);
  assert.throws(() => parseReportRequest({ mode: 'project', weekId: 'W41', projectCode: 'A', sections: [SECTION] }, { deliveryPerformanceSection: true }), /Unknown report section/);
  assert.deepEqual(parseReportRequest(request(['health-focus', SECTION]), { deliveryPerformanceSection: true }).sections, ['health-focus', SECTION]);
});

test('overview report renders the new section only when selected and keeps existing sections', () => {
  const fixture = completeOverviewReportFixture();
  const sections = ['health-focus', 'weekly-trend', 'executive-summary', 'attention-matrix', 'risk-actions', 'quarterly-roadmap', 'project-portfolio', 'resource-analytics', 'budget-overview'];
  const without = body(renderOverviewReportHtml({ ...fixture, sections }));
  const withNew = body(renderOverviewReportHtml({ ...fixture, sections: [...sections, SECTION], deliveryTrends: syntheticContract() }));
  assert.doesNotMatch(without, /Portfolio Delivery Performance/);
  assert.match(withNew, /data-report-section="portfolio-delivery-performance"/);
  for (const key of ['overview-opening', 'executive-summary-brief', 'overview-management', 'quarterly-roadmap', 'project-portfolio', 'resource-analytics', 'budget-overview']) {
    assert.ok(without.includes(`data-report-section="${key}"`), `existing ${key} stays`);
    assert.ok(withNew.includes(`data-report-section="${key}"`), `${key} preserved with the new section`);
  }
  assert.equal((withNew.match(/data-report-section="project-portfolio"/g) || []).length, (without.match(/data-report-section="project-portfolio"/g) || []).length);
});

test('without a deliveryTrends contract the PDF shows an explicit unavailable page, never numbers', () => {
  const html = body(renderOverviewReportHtml({ ...completeOverviewReportFixture(), sections: [SECTION] }));
  assert.match(html, /unavailable for this reporting week/);
  assert.doesNotMatch(html, /Weekly Progress Gain/);
});

test('the new section follows Overview scope/selection because it only renders the supplied contract', () => {
  const html = body(renderOverviewReportHtml({ ...completeOverviewReportFixture(), sections: [SECTION], deliveryTrends: historicalOnlyContract() }));
  assert.doesNotMatch(html, /Synthetic Historical Only/);
  const closed = body(renderOverviewReportHtml({ ...completeOverviewReportFixture(), sections: [SECTION], deliveryTrends: noScopeFlagContract() }));
  assert.match(closed, /current project list is unavailable/);
});

test('the new section sits after the opening page and before the executive summary', () => {
  const html = body(renderOverviewReportHtml({ ...completeOverviewReportFixture(), sections: ['health-focus', 'executive-summary', SECTION], deliveryTrends: syntheticContract() }));
  const order = ['overview-opening', 'portfolio-delivery-performance', 'executive-summary-brief'].map(key => html.indexOf(`data-report-section="${key}"`));
  assert.ok(order.every(index => index >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('a full Overview PDF with the new section renders and paginates', { timeout: 120000 }, async () => {
  const fixture = completeOverviewReportFixture();
  const pdf = await renderPdfBuffer(renderOverviewReportHtml({ ...fixture, sections: ['health-focus', 'weekly-trend', SECTION], deliveryTrends: syntheticContract() }));
  assert.ok(pdf.byteLength > 1000);
  const base = await renderPdfBuffer(renderOverviewReportHtml({ ...fixture, sections: ['health-focus', 'weekly-trend'] }));
  assert.equal(physicalPageCount(pdf) - physicalPageCount(base), 1, 'six projects add exactly one page');
});

test('a large portfolio adds a continuation page inside the Overview PDF', { timeout: 120000 }, async () => {
  const fixture = completeOverviewReportFixture();
  const base = await renderPdfBuffer(renderOverviewReportHtml({ ...fixture, sections: ['health-focus'] }));
  const html = renderOverviewReportHtml({ ...fixture, sections: ['health-focus', SECTION], deliveryTrends: largeContract(14) });
  const pdf = await renderPdfBuffer(html);
  const added = physicalPageCount(pdf) - physicalPageCount(base);
  assert.ok(added >= 2 && added <= 3, `added=${added}`);
});

test('the PDF stylesheet adds only scoped delivery rules to the shared theme', async () => {
  const { REPORT_CSS, DELIVERY_PERFORMANCE_CSS } = await import('../src/report-theme.js');
  assert.ok(REPORT_CSS.includes(DELIVERY_PERFORMANCE_CSS));
  const selectors = DELIVERY_PERFORMANCE_CSS.match(/[^{}]+(?=\{)/g).flatMap(group => group.split(',')).map(item => item.trim()).filter(Boolean);
  assert.ok(selectors.every(selector => /\.dp-/.test(selector)), selectors.filter(selector => !/\.dp-/.test(selector)).join(' | '));
});
