import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dashboardSource, environmentFor, normalizeProjectManagerLabelsForBaseline, rawDashboardSource, renderProfile } from './helpers/dashboard-source.mjs';
import {
  DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED, buildOverviewPdfRequest, isDeliveryPerformancePdfAvailable
} from '../js/overview-pdf-selection.mjs';

const uat = dashboardSource('uat');
const production = dashboardSource('production');

test('Production profile contains no Delivery Trends navigation, container, script or PDF option', () => {
  for (const marker of ['btnDeliveryTrends', 'deliveryTrendsView', 'toggleDeliveryTrends', 'syncDeliveryTrendsView',
    'delivery-trends-page', 'deliveryPerformanceOption', 'portfolio-delivery-performance', 'isDeliveryPerformancePdfAvailable', ]) {
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

test('PDF dialog option is UAT-only, hidden and unchecked by default; browser print is deferred', () => {
  assert.match(uat, /<label id="deliveryPerformanceOption" hidden style="display:none;"><input type="checkbox" value="portfolio-delivery-performance"> /);
  assert.doesNotMatch(uat, /value="portfolio-delivery-performance" checked/);
  // Browser-print integration is deferred: the shared Production print function must stay untouched.
  assert.doesNotMatch(uat, /extraOverviewPrintSections|renderExtraOverviewPrintPage/);
  assert.doesNotMatch(production, /extraOverviewPrintSections|renderExtraOverviewPrintPage/);
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

test('navigation entry is understandable and accessible', () => {
  const raw = rawDashboardSource();
  const button = raw.match(/<button[^>]*id="btnDeliveryTrends"[\s\S]*?<\/button>/)[0];
  assert.match(button, /aria-label="Delivery Trends"/);
  assert.match(button, /aria-pressed="false"/);
  assert.match(button, /title="Delivery Trends"/);
  assert.match(button, /<svg aria-hidden="true"/);
  assert.match(button, /<span class="dt-nav-label" aria-hidden="true">Trends<\/span>/);
  assert.match(raw, /@media \(max-width:700px\) \{ #btnDeliveryTrends \.dt-nav-label \{ display:none; \}/);
  assert.match(uat, /setAttribute\('aria-pressed', 'true'\)/);
});

test('Production inventory has no new exception: the shared print function equals the foundation byte-for-byte', () => {
  const functionSource = (text, name) => text.slice(text.indexOf(`function ${name}(`), text.indexOf('\n}\n', text.indexOf(`function ${name}(`)) + 3);
  const foundation = execFileSync('git', ['show', '83a56b1f8f93fafcf23eda4b8395cca991556777:index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  for (const name of ['renderOverviewPrintReport', 'cloneOverviewSectionForPrint', 'confirmOverviewProjectPrint'.replace('confirm', 'confirm')]) {
    const current = functionSource(rawDashboardSource(), name);
    if (current) assert.equal(current, functionSource(foundation, name), name);
  }
});

test('the UAT frozen-hash change is exactly the Delivery Trends feature', () => {
  // Strip every Delivery Trends UAT-only addition and the single render hook, then the frozen UAT hash from before
  // this feature (tests/role-contract.test.mjs history) must be reproduced exactly.
  let raw = rawDashboardSource();
  for (const tag of ['deliveryTrendsButton', 'deliveryTrendsContainer', 'deliveryPerformanceOption', 'deliveryTrendsView']) {
    raw = raw.replace(new RegExp(`^[ \\t]*(?:\\/\\/|<!--) @uat-only begin ${tag}[^\\n]*\\n[\\s\\S]*?^[ \\t]*(?:\\/\\/|<!--) @uat-only end ${tag}[^\\n]*\\n?`, 'm'), '');
  }
  assert.ok(raw.includes('  syncDeliveryTrendsView();\n'));
  raw = raw.replace('  syncDeliveryTrendsView();\n', '');
  assert.doesNotMatch(raw, /DeliveryTrends|deliveryTrends/);
  const stripped = renderProfile(raw, 'uat', environmentFor('uat'));
  const hash = createHash('sha256').update(normalizeProjectManagerLabelsForBaseline(stripped)).digest('hex');
  assert.equal(hash, 'e83cb180ae5888fe33b4f93a642bb9a612decd30897007d2f07f85415b0c4479');
});
