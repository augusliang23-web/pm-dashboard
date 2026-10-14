import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardSource, rawDashboardSource } from './helpers/dashboard-source.mjs';
import {
  DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED, buildOverviewPdfRequest, isDeliveryPerformancePdfAvailable
} from '../js/overview-pdf-selection.mjs';

const uat = dashboardSource('uat');
const production = dashboardSource('production');

test('Production profile contains no Delivery Trends navigation, container, script or PDF option', () => {
  for (const marker of ['btnDeliveryTrends', 'deliveryTrendsView', 'toggleDeliveryTrends', 'syncDeliveryTrendsView',
    'delivery-trends-page', 'deliveryPerformanceOption', 'portfolio-delivery-performance', 'isDeliveryPerformancePdfAvailable', 'extraOverviewPrintSections =', 'renderExtraOverviewPrintPage =']) {
    assert.ok(!production.includes(marker), `production must not contain ${marker}`);
  }
});

test('UAT profile has a dedicated Delivery Trends navigation entry and container', () => {
  assert.match(uat, /id="btnDeliveryTrends"[^>]*onclick="toggleDeliveryTrends\(\)"/);
  assert.match(uat, /id="deliveryTrendsView"/);
  assert.match(uat, /class="btn-icon executive-hidden"\s+id="btnDeliveryTrends"/);
  // Runtime profile separation: the raw page hides UAT-only markup in Production through data-profile-only.
  const raw = rawDashboardSource();
  assert.match(raw, /class="btn-icon vip-hidden executive-hidden" data-profile-only="uat" id="btnDeliveryTrends"/);
  assert.match(raw, /id="deliveryTrendsView" data-profile-only="uat" hidden/);
  // Not a section inside the Overview markup.
  const overview = uat.slice(uat.indexOf('function renderExec('), uat.indexOf('function renderExec(') + 6000);
  assert.doesNotMatch(overview, /delivery-trends|deliveryTrends/i);
});

test('UAT render hooks the view without changing Overview or normal view toggling', () => {
  const start = uat.indexOf('render = () => {');
  const end = uat.indexOf('function renderNormal(', start);
  const render = uat.slice(start, end);
  assert.match(render, /syncDeliveryTrendsView\(\);\s*\};?\s*$/);
  assert.match(render, /renderNormal\(portfolioProjects\)/);
  assert.match(render, /renderExec\(overviewProjects, week\.summary, allCurrentProjects\)/);
  assert.match(uat, /window\.toggleOverview = \(\) => \{\s*if \(isExecutivePerspective\(\)\) return;\s*isOverview = !isOverview;\s*render\(\);\s*\};/);
});

test('the view is deactivated for Overview, Executive perspective and other users, and guarded by profile', () => {
  const sync = uat.slice(uat.indexOf('function syncDeliveryTrendsView()'), uat.indexOf('window.toggleDeliveryTrends'));
  assert.match(sync, /if \(!IS_UAT_PROFILE\) return;/);
  assert.match(sync, /isOverview \|\| isExecutivePerspective\(\) \|\| deliveryTrendsOwner !== deliveryTrendsUserKey\(\)/);
  assert.match(uat, /window\.toggleDeliveryTrends = \(\) => \{\s*if \(!IS_UAT_PROFILE \|\| isExecutivePerspective\(\)\) return;/);
  assert.match(uat, /if \(deliveryTrendsActive\) isOverview = false;/);
});

test('the page never calculates metrics itself and never touches data stores', () => {
  const delivery = uat.slice(uat.indexOf('let deliveryTrendsActive'), uat.indexOf('window.toggleExecutivePreview'));
  assert.ok(delivery.length > 1000);
  assert.doesNotMatch(delivery, /calculateDeliveryTrends|setDoc|updateDoc|getDocs|collection\(|runTransaction|localStorage/);
  assert.match(delivery, /import\('\.\/js\/delivery-trends-page\.mjs'\)/);
});

test('PDF dialog option is UAT-only, hidden and unchecked by default, and the browser-print path has the section', () => {
  assert.match(uat, /<label id="deliveryPerformanceOption" hidden style="display:none;"><input type="checkbox" value="portfolio-delivery-performance"> /);
  assert.doesNotMatch(uat, /value="portfolio-delivery-performance" checked/);
  assert.match(uat, /window\.extraOverviewPrintSections = \(\) => \(IS_UAT_PROFILE \? \['portfolio-delivery-performance'\] : \[\]\)/);
  assert.match(uat, /window\.renderExtraOverviewPrintPage = \(sectionId, renderPage\)/);
  // Existing sections and presets are untouched.
  assert.match(uat, /OVERVIEW_PRINT_PRESETS = \{\s*all: \['health-focus', 'weekly-trend',/);
  assert.doesNotMatch(uat.match(/const OVERVIEW_PRINT_PRESETS = \{[\s\S]*?\n\};/)[0], /delivery/i);
});

test('the PDF section is never requested while the backend is unverified', () => {
  assert.equal(DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED, false);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'uat' }), false);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'production', backendVerified: true }), false);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'uat', backendVerified: true }), true);
  const args = { sections: ['health-focus', 'portfolio-delivery-performance'], projectCodes: ['A'], overviewScope: 'all' };
  assert.deepEqual(buildOverviewPdfRequest(args).sections, ['health-focus']);
  assert.deepEqual(buildOverviewPdfRequest({ ...args, deliveryPerformanceAvailable: true }).sections, ['health-focus', 'portfolio-delivery-performance']);
  assert.throws(() => buildOverviewPdfRequest({ sections: ['portfolio-delivery-performance'], projectCodes: ['A'] }), /at least one section/);
});

test('existing request building is unchanged for current sections', () => {
  const request = buildOverviewPdfRequest({ sections: ['health-focus', 'weekly-trend'], overviewScope: 'System', projectCodes: ['A', 'B'] });
  assert.deepEqual(request, { mode: 'overview', sections: ['health-focus', 'weekly-trend'], overviewScope: 'system', projectCodes: ['A', 'B'] });
});

test('Project Manager wording from PR #49 is preserved in the new components', () => {
  assert.match(uat, /Project Manager/);
  const delivery = uat.slice(uat.indexOf('let deliveryTrendsActive'), uat.indexOf('window.toggleExecutivePreview'));
  assert.doesNotMatch(delivery, /\bOwner\b/);
});
