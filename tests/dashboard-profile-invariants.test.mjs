import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dashboardSource, environmentFor, functionInventory, rawDashboardSource } from './helpers/dashboard-source.mjs';
import { renderEnvConfig } from '../scripts/env-config.mjs';

const baselines = JSON.parse(readFileSync(new URL('./fixtures/dashboard-baselines.json', import.meta.url), 'utf8'));
const literalCount = (source, literal) => source.split(literal).length - 1;

function assertModuleParses(profile) {
  const source = dashboardSource(profile);
  const module = source.match(/<script type="module">\n([\s\S]*)\n<\/script>/)?.[1];
  assert.ok(module, `${profile} view has a module script`);
  const dir = mkdtempSync(join(tmpdir(), 'profile-view-'));
  try {
    const file = join(dir, `${profile}.mjs`);
    writeFileSync(file, module);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Named, reviewed exceptions to the byte-for-byte guarantee below. Each entry needs a Control Plane remediation
// reference and a companion test elsewhere in this file proving Production's *behavior* -- not just its source
// text -- is unaffected. Anything else that drifts from the e1f0e5c baseline still fails the test below; adding a
// name here is a deliberate, auditable act, not a way to silence an unexpected difference.
// UAT PDF picker UI remediation (project-brief/project-update section picker restored as UAT-profile-only).
// Both functions now read the shared #projectPdfSectionPicker markup, which grew two UAT-only checkboxes; they
// gained an isProfileVisible() filter so Production's *checked/submitted* set is unchanged (see 'the two
// deliberate Production exceptions never check or submit project-brief/project-update' below, and the
// dedicated VM-level tests in tests/project-pdf-sections.uat.test.mjs).
const PDF_SECTION_PICKER_EXCEPTIONS = new Set(['openProjectPdfSectionPicker', 'confirmProjectPdfExport']);

// UCG-V2-2B: Usage & Cost Guard first-screen safety cards. openPresenceUsage now renders the cards
// immediately (refreshUsageCostGuardOverview(null)) before its existing Firestore historical
// summary and Presence load; loadPresenceUsageStats now also computes a tracked-write total
// (calculateTrackedFirestoreWrites, reusing the approved js/usage-cost-guard.mjs adapter/
// aggregation) and refreshes the cards with it. Both functions' pre-existing behavior -- fetching,
// aggregating and rendering the legacy Presence diagnostics -- is otherwise unchanged; see
// tests/usage-cost-guard-view.test.mjs and tests/usage-cost-guard-runtime-config.test.mjs for the
// new behavior's own coverage.
const USAGE_COST_GUARD_EXCEPTIONS = new Set(['loadPresenceUsageStats', 'openPresenceUsage']);

// UCG-V2-2B-R1: legacy quota-truth cleanup. Independent review found these three functions still
// presented a misleading cumulative/per-bucket Firestore quota interpretation (a 42-day
// "840,000 free quota" gap/percentage, and per-bucket "quota used %"/"remaining" figures derived
// by summing totalPresenceWrites -- an activity/event tick count -- together with
// counterFlushWrites -- the actual tracked Firestore write count). All three functions' actual
// data-fetching/aggregation/session-history behavior is unchanged; only the removed quota
// interpretation and its labels changed (see 'UCG-V2-2B-R1: no misleading cumulative/per-bucket
// Firestore quota interpretation remains in Production' below for the behavior proof).
const LEGACY_QUOTA_CLEANUP_EXCEPTIONS = new Set(['renderFirestoreHistoricalSummary', 'renderPresenceUsageStats', 'renderPresenceUsageChart']);

// Named, reviewed exceptions to the byte-for-byte guarantee below. Each entry needs a Control Plane remediation
// reference and a companion test elsewhere in this file proving Production's *behavior* -- not just its source
// text -- is unaffected. Anything else that drifts from the e1f0e5c baseline still fails the test below; adding a
// name here is a deliberate, auditable act, not a way to silence an unexpected difference.
const DELIBERATE_PRODUCTION_EXCEPTIONS = new Set([
  ...PDF_SECTION_PICKER_EXCEPTIONS, ...USAGE_COST_GUARD_EXCEPTIONS, ...LEGACY_QUOTA_CLEANUP_EXCEPTIONS,
]);

test('the Production profile runs every Production e1f0e5c function byte-for-byte, except the named deliberate exceptions', () => {
  const productionSource = dashboardSource('production');
  const overviewRiskHeading = '<div class="exec-eyebrow">Risk &amp; Mitigation Actions</div>';
  assert.equal((productionSource.match(/<div class="exec-eyebrow">Risk &amp; Mitigation Actions<\/div>/g) || []).length, 1);
  // Normalize only the approved Overview copy change before checking the function's existing behavior hash.
  let normalizedProductionSource = productionSource.replace(overviewRiskHeading, '<div class="exec-eyebrow">Risk Action Table</div>');
  const newRiskTableRow = '<table class="risk-action-table"><thead><tr><th>Project</th><th>Risk / Blockers</th><th>Why Escalated</th><th>Owner</th><th>Mitigation Actions</th><th>Checkpoint</th></tr></thead><tbody>';
  const oldRiskTableRow = '<table class="risk-action-table"><thead><tr><th>Project</th><th>Risk / Blockers</th><th>Why Escalated</th><th>Owner</th><th>Required Action</th><th>Checkpoint</th></tr></thead><tbody>';
  assert.equal(literalCount(normalizedProductionSource, newRiskTableRow), 1);
  normalizedProductionSource = normalizedProductionSource.replace(newRiskTableRow, oldRiskTableRow);

  const approvedRowLabelPairs = [
    ['data-list-label="Mitigation Actions"', 'data-list-label="Required Action"'],
    ['placeholder="Mitigation Actions shown in Overview"', 'placeholder="Required Action shown in Overview"'],
    ['aria-label="Mitigation actions"', 'aria-label="Required action"']
  ];
  for (const [newLiteral, baselineLiteral] of approvedRowLabelPairs) {
    assert.equal(literalCount(normalizedProductionSource, newLiteral), 1);
    normalizedProductionSource = normalizedProductionSource.replace(newLiteral, baselineLiteral);
  }

  const view = functionInventory(normalizedProductionSource);
  const changed = Object.entries(baselines.productionFunctions)
    .filter(([name, hash]) => view[name] !== hash)
    .map(([name]) => name);
  assert.deepEqual(changed.filter(name => !DELIBERATE_PRODUCTION_EXCEPTIONS.has(name)), [],
    'Production functions must be identical to the e1f0e5c baseline unless explicitly named in DELIBERATE_PRODUCTION_EXCEPTIONS');
  assert.deepEqual(changed.sort(), [...DELIBERATE_PRODUCTION_EXCEPTIONS].sort(),
    'every named exception must actually differ from the baseline -- an unused entry means the exception is stale and should be removed');
  assert.equal(Object.keys(baselines.productionFunctions).length, 389);
});

test('the two deliberate Production exceptions never check or submit project-brief/project-update', () => {
  const production = dashboardSource('production');
  for (const name of PDF_SECTION_PICKER_EXCEPTIONS) {
    const start = production.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} must exist in the Production view`);
    const bodyStart = production.slice(Math.max(0, start - 6), start) === 'async ' ? start - 6 : start;
    const end = production.indexOf('\n}\n', bodyStart) + 3;
    const body = production.slice(bodyStart, end);
    // The Production source still contains the literal strings "project-brief"/"project-update" (the shared
    // markup and PROJECT_PDF_SECTIONS constant are unchanged, unconditional common code), but neither function
    // body may unconditionally check or read them -- every reference must go through isProfileVisible().
    assert.match(body, /isProfileVisible/, `${name} must gate through isProfileVisible()`);
  }
});

test('the two Usage & Cost Guard exceptions still do their pre-existing job unconditionally, alongside the new cards', () => {
  const production = dashboardSource('production');
  const openBody = production.slice(production.indexOf('window.openPresenceUsage = async () => {'));
  assert.match(openBody, /refreshUsageCostGuardOverview\(null\)/, 'openPresenceUsage must render the first-screen cards immediately');
  assert.match(openBody, /renderFirestoreHistoricalSummary\(\)/, 'openPresenceUsage must still render the pre-existing historical summary');
  assert.match(openBody, /await loadPresenceUsageStats\(\)/, 'openPresenceUsage must still load Presence usage stats');

  const loadBody = production.slice(
    production.indexOf('window.loadPresenceUsageStats = async () => {'),
    production.indexOf('window.openPresenceUsage'),
  );
  assert.match(loadBody, /getDocs\(collection\(db, "presence"\)\)/, 'loadPresenceUsageStats must still fetch presence docs');
  assert.match(loadBody, /refreshUsageCostGuardOverview\(calculateTrackedFirestoreWrites\(presenceDocs\)\)/, 'loadPresenceUsageStats must refresh the cards with a real tracked-write total');
  assert.match(loadBody, /renderPresenceUsageStats\(rows, sessions, rangeDays, estimatedActivities, lastSeenActivities\)/, 'loadPresenceUsageStats must still render the pre-existing legacy diagnostics');
});

test('UCG-V2-2B-R1: no misleading cumulative/per-bucket Firestore quota interpretation remains in Production', () => {
  const production = dashboardSource('production');

  // The retired 42-day cumulative quota model must be gone entirely.
  assert.doesNotMatch(production, /840[,_]?000/, 'the retired 42x20,000 cumulative quota figure must not appear');
  assert.doesNotMatch(production, /42\s*\*\s*FIRESTORE_FREE_WRITES_PER_DAY/, 'no cumulative multi-day quota calculation may remain');
  assert.doesNotMatch(production, /freeWriteQuota/i, 'the cumulative free-write-quota field must be removed');
  assert.doesNotMatch(production, /Free writes used/i);
  assert.doesNotMatch(production, /Free quota gap/i);
  assert.doesNotMatch(production, /Aggregate writes remaining across 42 days/i);
  assert.doesNotMatch(production, /Free quota used/i);

  // Historical writes/reads remain, clearly framed as historical, not a quota fraction.
  assert.match(production, /Past 6 weeks writes/);
  assert.match(production, /Past 6 weeks reads/);

  const historicalBody = production.slice(
    production.indexOf('function renderFirestoreHistoricalSummary()'),
    production.indexOf('function renderFirestoreHistoricalSummary()') + 1500,
  );
  assert.doesNotMatch(historicalBody, /usedPct|freeWriteQuota/i, 'no percentage-of-quota or quota-gap calculation may remain');

  // Bucket-level and summary-card quota interpretation must be gone; the underlying tracked-flush
  // and activity-event figures must still be present and separately labeled.
  const presenceStatsBody = production.slice(
    production.indexOf('function renderPresenceUsageStats('),
    production.indexOf('window.loadPresenceUsageStats'),
  );
  assert.doesNotMatch(presenceStatsBody, /Quota Used|<th>Remaining<\/th>/);
  assert.doesNotMatch(presenceStatsBody, /usedPct|remaining\s*=\s*Math\.max\(0, quota/);
  assert.match(presenceStatsBody, /Activity events/);
  assert.match(presenceStatsBody, /Tracked flush writes/);
  assert.match(presenceStatsBody, /Tracked Flush Writes/, 'the bucket table column must still expose tracked flush writes');
  assert.match(presenceStatsBody, /totals\.flush/, 'the tracked-flush total must still be computed and shown');
  assert.match(presenceStatsBody, /totals\.presence/, 'the activity-event total must still be computed and shown');

  // The daily chart must chart tracked flush writes only (never totalPresenceWrites summed with
  // counterFlushWrites) and must never claim a "% of quota" for a single bucket.
  const chartBody = production.slice(
    production.indexOf('function renderPresenceUsageChart('),
    production.indexOf('function renderPresenceUsageChart(') + 3500,
  );
  assert.doesNotMatch(chartBody, /totalPresenceWrites.*\+.*counterFlushWrites|counterFlushWrites.*\+.*totalPresenceWrites/,
    'the chart must not sum activity events with tracked flush writes');
  assert.match(chartBody, /writes:\s*Number\(row\.counterFlushWrites \|\| 0\)/);
  assert.doesNotMatch(chartBody, /% of quota/i);
});

test('the UAT profile still exposes every UAT a04c0c1 function name', () => {
  const view = functionInventory(dashboardSource('uat'));
  const missing = baselines.uatFunctionNames.filter(name => !(name in view));
  assert.deepEqual(missing, []);
});

test('both profile views are valid modules with no unresolved variant or marker text', () => {
  for (const profile of ['production', 'uat']) {
    const view = dashboardSource(profile);
    assert.deepEqual([...new Set(view.match(/\b\w+__(?:prod|uat)\b/g) || [])], [], `${profile}: leftover variant names`);
    assert.doesNotMatch(view, /@profile-|@uat-only|@prod-only/, `${profile}: leftover markers`);
    assertModuleParses(profile);
  }
});

test('the committed env-config.js is exactly the Production rendering of env/prod.json', () => {
  const committed = readFileSync(new URL('../env-config.js', import.meta.url), 'utf8');
  assert.equal(committed, renderEnvConfig(environmentFor('production')));
  assert.equal(environmentFor('production').dashboardProfile, 'production');
  assert.equal(environmentFor('uat').dashboardProfile, 'uat');
});

test('index.html fails closed when the environment configuration is missing or unknown', () => {
  const raw = rawDashboardSource();
  assert.match(raw, /<script src="\.\/env-config\.js"><\/script>/);
  assert.match(raw, /\['production', 'uat'\]\.includes\(PM_ENV\.dashboardProfile\)/);
  assert.match(raw, /throw new Error\('Dashboard environment configuration is missing or invalid; refusing to start\.'\)/);
  assert.doesNotMatch(raw, /const FIREBASE_CONFIG = \{/, 'Firebase configuration must come from the environment file');
});

test('the environments name different Firebase projects and neither leaks into the other view', () => {
  const production = dashboardSource('production');
  const uat = dashboardSource('uat');
  assert.match(production, /projectId: "project-manager-dashboar-a067f"/);
  assert.doesNotMatch(production, /pm-dashboard-uat-20260820-a7f3/);
  assert.match(uat, /projectId: "pm-dashboard-uat-20260820-a7f3"/);
  assert.doesNotMatch(uat, /project-manager-dashboar-a067f/);
});

test('UAT-only capabilities are unreachable from the Production profile', () => {
  const production = dashboardSource('production');
  for (const forbidden of [/executiveApi\.\w+\(/, /uatProductionSyncController\.(open|run|start)\(/, /startProjectManagerSubscription\(isCurrentAuthInitialization\)/]) {
    assert.doesNotMatch(production.replace(/\/\/ @uat-only[\s\S]*?\/\/ @uat-only end[^\n]*\n/g, ''), forbidden, `${forbidden} must not run in Production`);
  }
});
