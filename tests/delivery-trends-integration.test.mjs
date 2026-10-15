import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dashboardSource, environmentFor, functionInventory, normalizeProjectManagerLabelsForBaseline, rawDashboardSource, renderProfile } from './helpers/dashboard-source.mjs';
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
  assert.match(sync, /isOverview \|\| isDeliveryTrendsExecutive\(\) \|\| deliveryTrendsOwner !== deliveryTrendsUserKey\(\)/);
  assert.match(uat, /window\.toggleDeliveryTrends = \(\) => \{\s*if \(!IS_UAT_PROFILE \|\| isDeliveryTrendsExecutive\(\)\) return;/);
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

test('UAT release candidate: the frontend flag is on, but only the UAT profile can offer or send the section', () => {
  assert.equal(DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED, true);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'uat' }), true);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'production' }), false);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'production', backendVerified: true }), false);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: undefined }), false);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'uat', backendVerified: false }), false, 'switching the flag off disables it');
  const args = { sections: ['health-focus', 'portfolio-delivery-performance'], projectCodes: ['A'], overviewScope: 'all' };
  const original = globalThis.PM_DASHBOARD_ENV;
  try {
    // The request builder reads the page's own profile (window.PM_DASHBOARD_ENV), never request data or a hostname.
    globalThis.PM_DASHBOARD_ENV = { dashboardProfile: 'production' };
    assert.deepEqual(buildOverviewPdfRequest(args).sections, ['health-focus'], 'Production never sends the section');
    globalThis.PM_DASHBOARD_ENV = undefined;
    assert.deepEqual(buildOverviewPdfRequest(args).sections, ['health-focus'], 'unknown profile never sends the section');
    globalThis.PM_DASHBOARD_ENV = { dashboardProfile: 'uat' };
    assert.deepEqual(buildOverviewPdfRequest(args).sections, ['health-focus', 'portfolio-delivery-performance']);
    assert.deepEqual(buildOverviewPdfRequest({ ...args, sections: ['health-focus'] }).sections, ['health-focus'], 'not selected -> not sent');
    assert.throws(() => buildOverviewPdfRequest({ sections: ['portfolio-delivery-performance'], projectCodes: ['A'], deliveryPerformanceAvailable: false }), /at least one section/);
  } finally { globalThis.PM_DASHBOARD_ENV = original; }
});

test('Production source is unchanged by the frontend activation: it contains no activation code', () => {
  for (const marker of ['isDeliveryPerformancePdfAvailable', 'deliveryPerformanceOption', 'portfolio-delivery-performance']) assert.ok(!production.includes(marker), marker);
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

test('Production inventory has no new exception: the shared print functions equal the approved baseline', () => {
  // Uses the committed baseline fixture (no Git history needed, so it also runs on a shallow CI checkout).
  const baselines = JSON.parse(readFileSync(new URL('./fixtures/dashboard-baselines.json', import.meta.url), 'utf8'));
  const view = functionInventory(normalizeProjectManagerLabelsForBaseline(production));
  for (const name of ['renderOverviewPrintReport', 'cloneOverviewSectionForPrint', 'renderPresentationReportPage', 'finalizePresentationReport']) {
    assert.ok(name in baselines.productionFunctions, `${name} must exist in the approved baseline fixture`);
    assert.ok(name in view, `${name} must exist in the Production view`);
    assert.equal(view[name], baselines.productionFunctions[name], `${name} must match the approved Production baseline`);
  }
});

// The chronological week ordering (UAT-only) is a separate, narrowly scoped change; reverting it must give back the
// previously accepted source exactly.
function revertWeekOrdering(raw) {
  for (const tag of ['weekOrderImport', 'deliveryPdfImport', 'deliveryTrendsLogoutReset']) {
    const block = new RegExp(`^[ \\t]*\\/\\/ @uat-only begin ${tag}\\n[\\s\\S]*?^[ \\t]*\\/\\/ @uat-only end ${tag}\\n`, 'm');
    assert.match(raw, block);
    raw = raw.replace(block, '');
  }
  // Executive-like detection (a real-browser finding): remove the helper and the explicit hide, restore the original calls.
  const hide = /  \/\/ The shared \.executive-hidden class does not hide[\s\S]*?\n  if \(button\) button\.style\.display = isDeliveryTrendsExecutive\(\) \? 'none' : '';\n/;
  const helper = /\/\/ In the UAT profile isVipPerspective\(\) is true only for an Admin previewing as Executive;[\s\S]*?\nfunction isDeliveryTrendsExecutive\(\) \{\n[\s\S]*?\n\}\n\n/;
  assert.match(raw, hide);
  assert.match(raw, helper);
  const selection = `    const previouslySelectedWeekId = allWeeks[currentIdx]?.__documentId;
    allWeeks = sortWeeksChronologically(fetchedWeeks);
    
    if (currentIdx < 0 || jumpToLatestOnNextRender) {
      // Default to the latest VALID ISO week; invalid labels are kept (last) but are never the default selection.
      const latestValid = latestValidWeekIndex(allWeeks);
      currentIdx = latestValid >= 0 ? latestValid : allWeeks.length - 1;
      jumpToLatestOnNextRender = false;
    } else if (previouslySelectedWeekId) {
      // Keep the user's selected stored week across snapshot refreshes (the array index can shift).
      const keptIdx = allWeeks.findIndex(week => week.__documentId === previouslySelectedWeekId);
      if (keptIdx >= 0) currentIdx = keptIdx;
    }
`;
  assert.ok(raw.includes(selection));
  raw = raw.replace(selection, `    allWeeks = sortWeeksChronologically(fetchedWeeks);
    
    if (currentIdx < 0 || jumpToLatestOnNextRender) {
      currentIdx = allWeeks.length - 1;
      jumpToLatestOnNextRender = false;
    }
`);
  return raw.replace(hide, '').replace(helper, '').replaceAll('isDeliveryTrendsExecutive()', 'isVipPerspective()').replace('allWeeks = sortWeeksChronologically(fetchedWeeks);', 'allWeeks = sortWeeksByLabel(fetchedWeeks);');
}

test('the UAT hash equals the accepted Gate 2 candidate (PR #56) hash once the Phase 2C change set is reverted', () => {
  let raw = revertWeekOrdering(rawDashboardSource());
  assert.doesNotMatch(raw, /sortWeeksChronologically|week-order\.mjs/);
  const hash = createHash('sha256').update(normalizeProjectManagerLabelsForBaseline(renderProfile(raw, 'uat', environmentFor('uat')))).digest('hex');
  assert.equal(hash, 'f248c88710f3589bacb2d6fc73135393ef106aa97a0a62621e901b492dfa29a5');
});

test('the UAT frozen-hash change is exactly the Delivery Trends feature', () => {
  // Strip every Delivery Trends UAT-only addition and the single render hook, then the frozen UAT hash from before
  // this feature (tests/role-contract.test.mjs history) must be reproduced exactly.
  let raw = revertWeekOrdering(rawDashboardSource());
  for (const tag of ['deliveryTrendsButton', 'deliveryTrendsContainer', 'deliveryPerformanceOption', 'deliveryTrendsView', 'deliveryTrendsRawHistoryReset', 'deliveryTrendsRawHistorySnapshot', 'deliveryTrendsRawHistoryError', 'deliveryTrendsErrorCleanup', 'deliveryTrendsAuthCleanup']) {
    raw = raw.replace(new RegExp(`^[ \\t]*(?:\\/\\/|<!--) @uat-only begin ${tag}[^\\n]*\\n[\\s\\S]*?^[ \\t]*(?:\\/\\/|<!--) @uat-only end ${tag}[^\\n]*\\n?`, 'm'), '');
  }
  assert.ok(raw.includes('  syncDeliveryTrendsView();\n'));
  raw = raw.replace('  syncDeliveryTrendsView();\n', '');
  assert.equal((raw.match(/onSnapshot\(weeksQuery, \{ includeMetadataChanges: true \}, snap =>/g) || []).length, 1);
  raw = raw.replace('onSnapshot(weeksQuery, { includeMetadataChanges: true }, snap =>', 'onSnapshot(weeksQuery, snap =>');
  assert.doesNotMatch(raw, /DeliveryTrends|deliveryTrends/);
  const stripped = renderProfile(raw, 'uat', environmentFor('uat'));
  const hash = createHash('sha256').update(normalizeProjectManagerLabelsForBaseline(stripped)).digest('hex');
  assert.equal(hash, 'e83cb180ae5888fe33b4f93a642bb9a612decd30897007d2f07f85415b0c4479');
});
