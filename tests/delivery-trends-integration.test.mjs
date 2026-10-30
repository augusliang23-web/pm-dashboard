import {normalizeProdS02ForBaseline} from './helpers/prod-s02-source-baseline.mjs';
import {normalizeDraftWorkspaceForBaseline} from './helpers/draft-workspace-source-baseline.mjs';
import {normalizeSprintEditorForBaseline} from './helpers/sprint-editor-source-baseline.mjs';
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

test('Production profile contains no standalone Delivery Trends navigation, container, or standalone view hooks', () => {
  for (const marker of ['btnDeliveryTrends', 'deliveryTrendsView', 'toggleDeliveryTrends', 'syncDeliveryTrendsView']) {
    assert.ok(!production.includes(marker), `production must not contain ${marker}`);
  }
});

test('UAT profile has no redundant standalone Delivery Trends button and retains container and Overview trends', () => {
  assert.equal(uat.includes('id="btnDeliveryTrends"'), false, 'btnDeliveryTrends must not exist in UAT');
  assert.match(uat, /id="deliveryTrendsView"/);
  // Runtime profile separation: the raw page hides UAT-only markup in Production through data-profile-only.
  const raw = rawDashboardSource();
  assert.equal(raw.includes('id="btnDeliveryTrends"'), false, 'btnDeliveryTrends must not exist in raw source');
  assert.match(raw, /id="deliveryTrendsView" data-profile-only="uat" hidden/);
  // Overview integrates weekly trend panel (V2.3.1-A).
  const overview = uat.slice(uat.indexOf('function renderExec('), uat.indexOf('function renderExec(') + 6000);
  assert.match(overview, /renderWeeklyTrendPanel\(projs\)/);
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

test('PDF dialog option is profile-neutral, hidden and unchecked by default; browser print is deferred', () => {
  assert.match(uat, /<label id="deliveryPerformanceOption" hidden style="display:none;"><input type="checkbox" value="portfolio-delivery-performance"> /);
  assert.doesNotMatch(uat, /value="portfolio-delivery-performance" checked/);
  assert.match(production, /<label id="deliveryPerformanceOption" hidden style="display:none;"><input type="checkbox" value="portfolio-delivery-performance"> /);
  assert.doesNotMatch(production, /value="portfolio-delivery-performance" checked/);
  // Browser-print integration is deferred: the shared Production print function must stay untouched.
  assert.doesNotMatch(uat, /extraOverviewPrintSections|renderExtraOverviewPrintPage/);
  assert.doesNotMatch(production, /extraOverviewPrintSections|renderExtraOverviewPrintPage/);
  // Existing sections and presets are untouched.
  assert.match(uat, /OVERVIEW_PRINT_PRESETS = \{\s*all: \['health-focus', 'weekly-trend',/);
  assert.doesNotMatch(uat.match(/const OVERVIEW_PRINT_PRESETS = \{[\s\S]*?\n\};/)[0], /delivery/i);
});

test('Production Release Candidate: frontend flag is on for both UAT and Production profiles', () => {
  assert.equal(DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED, true);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'uat' }), true);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'production' }), true);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'production', backendVerified: true }), true);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'production', backendVerified: false }), false, 'switching flag off disables it in production');
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: undefined }), false);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'uat', backendVerified: false }), false, 'switching the flag off disables it in uat');
  const args = { sections: ['health-focus', 'portfolio-delivery-performance'], projectCodes: ['A'], overviewScope: 'all' };
  const original = globalThis.PM_DASHBOARD_ENV;
  try {
    // The request builder reads the page's own profile (window.PM_DASHBOARD_ENV), never request data or a hostname.
    globalThis.PM_DASHBOARD_ENV = { dashboardProfile: 'production' };
    assert.deepEqual(buildOverviewPdfRequest(args).sections, ['health-focus', 'portfolio-delivery-performance'], 'Production sends the section when available');
    globalThis.PM_DASHBOARD_ENV = undefined;
    assert.deepEqual(buildOverviewPdfRequest(args).sections, ['health-focus'], 'unknown profile never sends the section');
    globalThis.PM_DASHBOARD_ENV = { dashboardProfile: 'uat' };
    assert.deepEqual(buildOverviewPdfRequest(args).sections, ['health-focus', 'portfolio-delivery-performance']);
    assert.deepEqual(buildOverviewPdfRequest({ ...args, sections: ['health-focus'] }).sections, ['health-focus'], 'not selected -> not sent');
    assert.throws(() => buildOverviewPdfRequest({ sections: ['portfolio-delivery-performance'], projectCodes: ['A'], deliveryPerformanceAvailable: false }), /at least one section/);
  } finally { globalThis.PM_DASHBOARD_ENV = original; }
});

test('Production profile includes Delivery Performance Overview panel and PDF option', () => {
  for (const marker of ['isDeliveryPerformancePdfAvailable', 'deliveryPerformanceOption', 'portfolio-delivery-performance']) {
    assert.ok(production.includes(marker), `production must contain ${marker}`);
  }
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

test('redundant standalone navigation entry is removed from UAT', () => {
  const raw = rawDashboardSource();
  assert.equal(raw.includes('id="btnDeliveryTrends"'), false, 'btnDeliveryTrends is not in raw source');
  assert.equal(uat.includes('id="btnDeliveryTrends"'), false, 'btnDeliveryTrends is not in rendered UAT');
});

test('Production inventory has no new exception: the shared print functions equal the approved baseline', () => {
  // Uses the committed baseline fixture (no Git history needed, so it also runs on a shallow CI checkout).
  const baselines = JSON.parse(readFileSync(new URL('./fixtures/dashboard-baselines.json', import.meta.url), 'utf8'));
  const view = functionInventory(normalizeProjectManagerLabelsForBaseline(renderProfile(normalizeProdS02ForBaseline(rawDashboardSource()), 'production', environmentFor('production'))));
  for (const name of ['renderOverviewPrintReport', 'cloneOverviewSectionForPrint', 'renderPresentationReportPage', 'finalizePresentationReport']) {
    assert.ok(name in baselines.productionFunctions, `${name} must exist in the approved baseline fixture`);
    assert.ok(name in view, `${name} must exist in the Production view`);
    assert.equal(view[name], baselines.productionFunctions[name], `${name} must match the approved Production baseline`);
  }
});

// The chronological week ordering (UAT-only) is a separate, narrowly scoped change; reverting it must give back the
function revertV231(raw) {
  raw = raw.replace('import * as deliveryTrendsPageModule from "./js/delivery-trends-page.mjs";\n', '');
  raw = raw.replace('import { isDeliveryPerformancePdfAvailable } from "./js/overview-pdf-selection.mjs";\n', '');
  const trendGroup = /\/\/ @profile-group begin fn renderWeeklyTrendPanel\n\/\/ @profile-variant prod\n([\s\S]*?)\n\/\/ @profile-variant uat\n[\s\S]*?\n\/\/ @profile-dispatcher\n[^\n]*\n\/\/ @profile-group end renderWeeklyTrendPanel/;
  const trendMatch = raw.match(trendGroup);
  if (trendMatch) {
    const legacyProd = `function renderWeeklyTrendPanel(projects) {
  const weeks = getTrendWeeks();
  const points = weeklyTrendPoints(weeks, projects);
  if (points.length < 2) return '';
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const riskDelta = latest.riskPressure - previous.riskPressure;
  const progressDelta = latest.avgProgress - previous.avgProgress;
  return \`<div class="exec-decision-panel weekly-trend-panel">
    <div class="exec-decision-head">
      <div>
        <div class="exec-eyebrow">Weekly Portfolio Trend</div>
        <div class="exec-decision-title">Trend signals from accumulated weekly updates</div>
      </div>
      <div class="exec-panel-note">Last \${points.length} weeks</div>
    </div>
    <div class="weekly-trend-grid">
      <section class="weekly-trend-card">
        <div class="weekly-trend-head">
          <div><div class="weekly-trend-title">Risk pressure</div><div class="weekly-trend-sub">Total risk entries across projects; Critical risk entries count 1.5x</div></div>
          <div class="weekly-trend-value">\${latest.riskPressure}<span class="exec-panel-note"> \${riskDelta >= 0 ? '+' : ''}\${riskDelta}</span></div>
        </div>
        \${renderTrendSvg(points, 'riskPressure', 'risk')}
      </section>
      <section class="weekly-trend-card">
        <div class="weekly-trend-head">
          <div><div class="weekly-trend-title">Average progress</div><div class="weekly-trend-sub">Portfolio delivery progress across active projects</div></div>
          <div class="weekly-trend-value">\${latest.avgProgress}%<span class="exec-panel-note"> \${progressDelta >= 0 ? '+' : ''}\${progressDelta}%</span></div>
        </div>
        \${renderTrendSvg(points, 'avgProgress')}
      </section>
    </div>
  </div>\`;
}`;
    raw = raw.replace(trendGroup, legacyProd);
  }
  
  const printGroup = /\/\/ @profile-group begin win confirmOverviewProjectPrint\n\/\/ @profile-variant prod\n([\s\S]*?)\n\/\/ @profile-variant uat\n[\s\S]*?\n\/\/ @profile-dispatcher\n[^\n]*\n\/\/ @profile-group end confirmOverviewProjectPrint/;
  const printMatch = raw.match(printGroup);
  if (printMatch) raw = raw.replace(printGroup, printMatch[1].replace('const confirmOverviewProjectPrint__prod =', 'window.confirmOverviewProjectPrint =').replace(/\n\s*windowWeeks:[^\n]*,/, ''));

  raw = raw.replaceAll('getCallableErrorMessage(err, getWriteErrorMessage(err))', 'getWriteErrorMessage(err)');
  raw = raw.replaceAll('deliveryTrendsRawWeeks = sortWeeksChronologically(snap.docs.map(d => ({ ...d.data(), weekId: d.id })));', 'deliveryTrendsRawWeeks = snap.docs.map(d => ({ ...d.data(), weekId: d.id }));');
  raw = raw.replace(`  if (isOverview) render();
  // @uat-only begin deliveryTrendsSyncFallback
  else syncDeliveryTrendsView();
  // @uat-only end deliveryTrendsSyncFallback`, '  syncDeliveryTrendsView();');
  raw = raw.replace(`let deliveryTrendsModule = typeof deliveryTrendsPageModule !== 'undefined' ? deliveryTrendsPageModule : null;\nlet deliveryTrendsLoading = null;

function loadDeliveryTrendsModule() {
  if (deliveryTrendsModule) return Promise.resolve(deliveryTrendsModule);
  if (typeof deliveryTrendsPageModule !== 'undefined') {
    deliveryTrendsModule = deliveryTrendsPageModule;
    return Promise.resolve(deliveryTrendsModule);
  }`, `let deliveryTrendsModule = null;\nlet deliveryTrendsLoading = null;

function loadDeliveryTrendsModule() {
  if (deliveryTrendsModule) return Promise.resolve(deliveryTrendsModule);`);
  return raw;
}

// Unified release baseline: retains approved server capability, Draft and Archive changes while reverting only the historical Delivery Trends change.
function revertWeekOrdering(raw) {
  raw = revertV231(raw);
  // Archive Recovery now shares the exact week-order import in both profiles.
  assert.equal(raw.split('import { latestValidWeekIndex, sortWeeksChronologically } from "./js/week-order.mjs";').length - 1, 1);
  raw = raw.replace('import { latestValidWeekIndex, sortWeeksChronologically } from "./js/week-order.mjs";\n', '');
  for (const tag of ['deliveryTrendsLogoutReset']) {
    const block = new RegExp(`^[ \\t]*\\/\\/ @uat-only begin ${tag}\\n[\\s\\S]*?^[ \\t]*\\/\\/ @uat-only end ${tag}\\n`, 'm');
    assert.match(raw, block);
    raw = raw.replace(block, '');
  }
  // Executive-like detection (a real-browser finding): remove the helper and the explicit hide, restore the original calls.
  const hide = /  \/\/ The shared \.executive-hidden class does not hide[\s\S]*?\n  if \(button\) button\.style\.display = isDeliveryTrendsExecutive\(\) \? 'none' : '';\n/;
  const helper = /\/\/ In the UAT profile isVipPerspective\(\) is true only for an Admin previewing as Executive;[\s\S]*?\nfunction isDeliveryTrendsExecutive\(\) \{\n[\s\S]*?\n\}\n\n/;
  assert.match(raw, hide);
  assert.match(raw, helper);
  const selection = `    const previouslySelectedWeekId = allWeeks?.[currentIdx]?.__documentId;
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

test('the UAT hash equals the composite pre-2C candidate hash once the Phase 2C change set is reverted', () => {
  // Reverting Phase 2C week ordering on the composite candidate (historical PR #56 baseline was f248c88710f3589bacb2d6fc73135393ef106aa97a0a62621e901b492dfa29a5 before PR #54 integration).
  let raw = revertWeekOrdering(normalizeSprintEditorForBaseline(normalizeDraftWorkspaceForBaseline(rawDashboardSource())));
  assert.doesNotMatch(raw, /sortWeeksChronologically|week-order\.mjs/);
  const hash = createHash('sha256').update(normalizeProjectManagerLabelsForBaseline(renderProfile(raw, 'uat', environmentFor('uat')))).digest('hex');
  assert.equal(hash, '64600743fd97c00b8165302e0341911fb79e647d43a63d6b8cd25ff2ca38d2f5');
});

test('the UAT frozen-hash change is exactly the Delivery Trends feature', () => {
  // Strip every Delivery Trends UAT-only addition and the single render hook.
  // Historical clean main baseline was e83cb180ae5888fe33b4f93a642bb9a612decd30897007d2f07f85415b0c4479 before PR #54 and PR #63.
  // On the composite candidate containing PR #54 Draft/Publish without implicit prototype fallback, the stripped hash is reproduced exactly.
  let raw = revertWeekOrdering(normalizeSprintEditorForBaseline(normalizeDraftWorkspaceForBaseline(rawDashboardSource())));
  for (const tag of ['deliveryTrendsButton', 'deliveryTrendsContainer', 'deliveryPerformanceOption', 'deliveryTrendsView', 'deliveryTrendsRawHistoryReset', 'deliveryTrendsRawHistorySnapshot', 'deliveryTrendsRawHistoryError', 'deliveryTrendsErrorCleanup', 'deliveryTrendsAuthCleanup']) {
    raw = raw.replace(new RegExp(`^[ \\t]*(?:\\/\\/|<!--) @uat-only begin ${tag}[^\\n]*\\n[\\s\\S]*?^[ \\t]*(?:\\/\\/|<!--) @uat-only end ${tag}[^\\n]*\\n?`, 'm'), '');
  }
  raw = raw.replace(/\n\s*<label id="deliveryPerformanceOption"[^>]*>[\s\S]*?<\/label>/, '');
  const deliveryTrendsBlock = /\/\/ Delivery Trends: an independent[\s\S]*?if \(IS_UAT_PROFILE\) loadDeliveryTrendsModule\(\)\.catch\(\(\) => \{\}\);\n/;
  raw = raw.replace(deliveryTrendsBlock, '');
  raw = raw.replace(/\n\s*deliveryTrendsRawWeeks = \[\];\n\s*deliveryTrendsHistoryState = \{ source: null, complete: false \};/, '');
  raw = raw.replace(/\n\s*const isFromCache = Boolean\(snap\.metadata\?\.fromCache\);[\s\S]*?(?=\n\s*let fetchedWeeks =)/, '');
  raw = raw.replace(/\n\s*deliveryTrendsRawWeeks = \[\];\n\s*deliveryTrendsHistoryState = \{ source: 'production', complete: false, asOf: new Date\(\)\.toISOString\(\) \};/, '');

  assert.ok(raw.includes('  syncDeliveryTrendsView();\n'));
  raw = raw.replace('  syncDeliveryTrendsView();\n', '');
  assert.equal((raw.match(/onSnapshot\(weeksQuery, \{ includeMetadataChanges: true \}, snap =>/g) || []).length, 2);
  raw = raw.replaceAll('onSnapshot(weeksQuery, { includeMetadataChanges: true }, snap =>', 'onSnapshot(weeksQuery, snap =>');
  assert.doesNotMatch(raw, /DeliveryTrends|deliveryTrends/);
  const stripped = renderProfile(raw, 'uat', environmentFor('uat'));
  const hash = createHash('sha256').update(normalizeProjectManagerLabelsForBaseline(stripped)).digest('hex');
  assert.equal(hash, 'd2b7cc05725db3e1c6eece636a6b3acd95892fbfc03c21ceb76eab206b4c9516');
});
