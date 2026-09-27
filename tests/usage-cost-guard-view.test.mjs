import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STATUS,
} from '../js/usage-cost-guard.mjs';
import {
  buildCapacityOutlookViewModel,
  buildFirestoreCardViewModel,
  buildSpendCapCardViewModel,
  buildTrackedDailyHistoryWindow,
  buildUsageCostGuardOverview,
  CAPACITY_OUTLOOK_GROWTH_MULTIPLIERS,
  combineOverallStatus,
  describeOverallStatus,
  describeTrackedDailyWritesUnavailability,
  deriveTrackedFirestoreWritesTotal,
} from '../js/usage-cost-guard-view.mjs';

// ---------------------------------------------------------------------------------------------
// Overall status precedence (UCG-V2-2B section 9)
// ---------------------------------------------------------------------------------------------

test('combineOverallStatus: all required metrics unknown -> overall UNKNOWN', () => {
  assert.equal(combineOverallStatus([STATUS.UNKNOWN, STATUS.UNKNOWN, STATUS.UNKNOWN]), STATUS.UNKNOWN);
});

test('combineOverallStatus: SAFE + UNKNOWN -> UNKNOWN', () => {
  assert.equal(combineOverallStatus([STATUS.SAFE, STATUS.UNKNOWN]), STATUS.UNKNOWN);
});

test('combineOverallStatus: WATCH + UNKNOWN -> WATCH', () => {
  assert.equal(combineOverallStatus([STATUS.WATCH, STATUS.UNKNOWN]), STATUS.WATCH);
});

test('combineOverallStatus: HIGH + UNKNOWN -> HIGH', () => {
  assert.equal(combineOverallStatus([STATUS.HIGH, STATUS.UNKNOWN]), STATUS.HIGH);
});

test('combineOverallStatus: LIMIT + UNKNOWN -> LIMIT', () => {
  assert.equal(combineOverallStatus([STATUS.LIMIT, STATUS.UNKNOWN]), STATUS.LIMIT);
});

test('combineOverallStatus: all SAFE -> SAFE', () => {
  assert.equal(combineOverallStatus([STATUS.SAFE, STATUS.SAFE, STATUS.SAFE]), STATUS.SAFE);
});

test('combineOverallStatus: LIMIT outranks every other status regardless of order', () => {
  assert.equal(combineOverallStatus([STATUS.SAFE, STATUS.WATCH, STATUS.HIGH, STATUS.LIMIT]), STATUS.LIMIT);
  assert.equal(combineOverallStatus([STATUS.LIMIT, STATUS.SAFE, STATUS.WATCH, STATUS.HIGH]), STATUS.LIMIT);
});

test('combineOverallStatus: HIGH outranks WATCH and UNKNOWN but not LIMIT', () => {
  assert.equal(combineOverallStatus([STATUS.HIGH, STATUS.WATCH, STATUS.UNKNOWN]), STATUS.HIGH);
  assert.equal(combineOverallStatus([STATUS.HIGH, STATUS.LIMIT]), STATUS.LIMIT);
});

test('combineOverallStatus: empty input never produces SAFE', () => {
  assert.equal(combineOverallStatus([]), STATUS.UNKNOWN);
});

test('describeOverallStatus: UNKNOWN reads as insufficient data, not a crash/error', () => {
  const text = describeOverallStatus(STATUS.UNKNOWN);
  assert.match(text, /unavailable/i);
  assert.doesNotMatch(text, /error|fail|crash/i);
});

test('describeOverallStatus: every STATUS value has a human-readable explanation', () => {
  for (const status of Object.values(STATUS)) {
    assert.equal(typeof describeOverallStatus(status), 'string');
    assert.ok(describeOverallStatus(status).length > 0);
  }
});

// ---------------------------------------------------------------------------------------------
// Firestore card: never invents exact remaining/%, never claims project-wide truth
// ---------------------------------------------------------------------------------------------

test('buildFirestoreCardViewModel: status is always UNKNOWN', () => {
  assert.equal(buildFirestoreCardViewModel().status, STATUS.UNKNOWN);
  assert.equal(buildFirestoreCardViewModel({ trackedWrites: 5000 }).status, STATUS.UNKNOWN);
});

test('buildFirestoreCardViewModel: no trackedWrites supplied -> null, never defaulted to 0', () => {
  const vm = buildFirestoreCardViewModel();
  assert.equal(vm.trackedWrites, null);
});

test('buildFirestoreCardViewModel: a real observed number is shown when supplied', () => {
  const vm = buildFirestoreCardViewModel({ trackedWrites: 1234 });
  assert.equal(vm.trackedWrites, 1234);
});

test('buildFirestoreCardViewModel: invalid trackedWrites (negative/non-finite) is treated as unavailable, not shown as-is', () => {
  assert.equal(buildFirestoreCardViewModel({ trackedWrites: -5 }).trackedWrites, null);
  assert.equal(buildFirestoreCardViewModel({ trackedWrites: NaN }).trackedWrites, null);
  assert.equal(buildFirestoreCardViewModel({ trackedWrites: Infinity }).trackedWrites, null);
});

test('buildFirestoreCardViewModel: coverage is partial, project-wide total is explicitly unavailable', () => {
  const vm = buildFirestoreCardViewModel({ trackedWrites: 1234 });
  assert.equal(vm.coverage, 'partial');
  assert.equal(vm.projectWideTotalAvailable, false);
});

test('buildFirestoreCardViewModel: reference quota is the official 20,000/day figure, exposed as reference only', () => {
  const vm = buildFirestoreCardViewModel();
  assert.equal(vm.referenceQuotaWrites, 20_000);
  assert.equal(vm.referenceQuotaUnit, 'writes/day');
});

test('buildFirestoreCardViewModel: never exposes a computed remaining/percentage field', () => {
  const vm = buildFirestoreCardViewModel({ trackedWrites: 1234 });
  assert.ok(!('remaining' in vm));
  assert.ok(!('remainingPercentage' in vm));
  assert.ok(!('percentLeft' in vm));
});

// ---------------------------------------------------------------------------------------------
// Spend-cap card: missing current spend must never render as $0 / 100% LEFT / a computed remaining
// ---------------------------------------------------------------------------------------------

const CLOUD_RUN_CONFIG = { configuredCapSgd: 2, source: 'dashboard-config', trustLevel: 'manualConfig', verifiedAt: '2026-09-26' };

test('buildSpendCapCardViewModel: current spend unavailable (default) -> UNKNOWN, no remaining figure', () => {
  const vm = buildSpendCapCardViewModel({ capConfig: CLOUD_RUN_CONFIG, environment: 'prod', service: 'cloudRun' });
  assert.equal(vm.status, STATUS.UNKNOWN);
  assert.equal(vm.currentSpendAvailable, false);
  assert.equal(vm.remainingAmount, null);
  assert.equal(vm.remainingPercentage, null);
});

test('buildSpendCapCardViewModel: configured cap is still visible even when spend is unavailable', () => {
  const vm = buildSpendCapCardViewModel({ capConfig: CLOUD_RUN_CONFIG, environment: 'prod', service: 'cloudRun' });
  assert.equal(vm.configuredCapValue, 2);
  assert.equal(vm.configuredCapUnit, 'SGD');
});

test('buildSpendCapCardViewModel: source/trustLevel/verifiedAt are exposed unobtrusively but exactly', () => {
  const vm = buildSpendCapCardViewModel({ capConfig: CLOUD_RUN_CONFIG, environment: 'prod', service: 'cloudRun' });
  assert.equal(vm.source, 'dashboard-config');
  assert.equal(vm.trustLevel, 'manualConfig');
  assert.equal(vm.verifiedAt, '2026-09-26');
});

test('buildSpendCapCardViewModel: missing cap config -> configuredCapValue null, status UNKNOWN, never a fabricated cap', () => {
  const vm = buildSpendCapCardViewModel({ capConfig: null, environment: 'prod', service: 'cloudRun' });
  assert.equal(vm.configuredCapValue, null);
  assert.equal(vm.status, STATUS.UNKNOWN);
});

// Test-only fixture: exercises the "spend IS available" branch, which no production code path may
// use yet (current spend is defined as unavailable for this phase -- see UCG-V2-2B section 23).
test('buildSpendCapCardViewModel: TEST-ONLY fixture with available spend renders a real remaining figure, never fabricated', () => {
  const vm = buildSpendCapCardViewModel({ currentSpend: 0.5, capConfig: CLOUD_RUN_CONFIG, environment: 'prod', service: 'cloudRun' });
  assert.equal(vm.currentSpendAvailable, true);
  assert.equal(vm.remainingAmount, 1.5);
  assert.equal(vm.status, STATUS.SAFE);
});

// ---------------------------------------------------------------------------------------------
// Full overview: environment separation, overall status composition
// ---------------------------------------------------------------------------------------------

const PROD_USAGE_COST_GUARD_CONFIG = {
  cloudRun: { configuredCapSgd: 2, source: 'dashboard-config', trustLevel: 'manualConfig', verifiedAt: '2026-09-26' },
  cloudRunFunctions: { configuredCapSgd: 2, source: 'dashboard-config', trustLevel: 'manualConfig', verifiedAt: '2026-09-26' },
};
const UAT_USAGE_COST_GUARD_CONFIG = {
  cloudRun: { configuredCapSgd: 2, source: 'dashboard-config', trustLevel: 'manualConfig', verifiedAt: '2026-09-26' },
  cloudRunFunctions: { configuredCapSgd: 2, source: 'dashboard-config', trustLevel: 'manualConfig', verifiedAt: '2026-09-26' },
};

test('buildUsageCostGuardOverview: with real current data availability, overall status is UNKNOWN', () => {
  const overview = buildUsageCostGuardOverview({
    trackedFirestoreWrites: 1234,
    usageCostGuardConfig: PROD_USAGE_COST_GUARD_CONFIG,
    environment: 'prod',
  });
  assert.equal(overview.overallStatus, STATUS.UNKNOWN);
  assert.equal(overview.firestore.status, STATUS.UNKNOWN);
  assert.equal(overview.cloudRun.status, STATUS.UNKNOWN);
  assert.equal(overview.cloudRunFunctions.status, STATUS.UNKNOWN);
});

test('buildUsageCostGuardOverview: overallStatusExplanation matches the composed status', () => {
  const overview = buildUsageCostGuardOverview({ usageCostGuardConfig: PROD_USAGE_COST_GUARD_CONFIG, environment: 'prod' });
  assert.equal(overview.overallStatusExplanation, describeOverallStatus(STATUS.UNKNOWN));
});

test('buildUsageCostGuardOverview: no trackedFirestoreWrites input -> Firestore card shows null, not 0', () => {
  const overview = buildUsageCostGuardOverview({ usageCostGuardConfig: PROD_USAGE_COST_GUARD_CONFIG, environment: 'prod' });
  assert.equal(overview.firestore.trackedWrites, null);
});

test('buildUsageCostGuardOverview: Production and UAT configs never cross', () => {
  const prodOnly = { cloudRun: { configuredCapSgd: 2, source: 'dashboard-config', trustLevel: 'manualConfig', verifiedAt: '2026-09-26' }, cloudRunFunctions: null };
  const uatOnly = { cloudRun: null, cloudRunFunctions: { configuredCapSgd: 2, source: 'dashboard-config', trustLevel: 'manualConfig', verifiedAt: '2026-09-26' } };

  const prodOverview = buildUsageCostGuardOverview({ usageCostGuardConfig: prodOnly, environment: 'prod' });
  const uatOverview = buildUsageCostGuardOverview({ usageCostGuardConfig: uatOnly, environment: 'uat' });

  assert.equal(prodOverview.cloudRun.environment, 'prod');
  assert.equal(prodOverview.cloudRun.configuredCapValue, 2);
  assert.equal(prodOverview.cloudRunFunctions.configuredCapValue, null, 'prod fixture deliberately omits cloudRunFunctions -- must not borrow the UAT value');

  assert.equal(uatOverview.cloudRunFunctions.environment, 'uat');
  assert.equal(uatOverview.cloudRunFunctions.configuredCapValue, 2);
  assert.equal(uatOverview.cloudRun.configuredCapValue, null, 'uat fixture deliberately omits cloudRun -- must not borrow the prod value');
});

// TEST-ONLY: exercises the "all SAFE" branch of the precedence rule end-to-end; no production code
// path may pass a non-null current spend yet.
test('buildUsageCostGuardOverview: TEST-ONLY all-available-and-safe fixture composes to overall SAFE', () => {
  const overview = buildUsageCostGuardOverview({
    trackedFirestoreWrites: 1234, // Firestore stays UNKNOWN regardless -- it is never a SAFE-eligible metric here.
    currentCloudRunSpend: 0.1,
    currentCloudRunFunctionsSpend: 0.1,
    usageCostGuardConfig: PROD_USAGE_COST_GUARD_CONFIG,
    environment: 'prod',
  });
  // Firestore's permanent UNKNOWN correctly keeps the OVERALL status from ever reaching SAFE while
  // that card exists, which is the desired real-world behavior; this test isolates the precedence
  // math itself instead, directly, to prove all-SAFE composes to SAFE.
  assert.equal(combineOverallStatus([overview.cloudRun.status, overview.cloudRunFunctions.status]), STATUS.SAFE);
  assert.equal(overview.overallStatus, STATUS.UNKNOWN, 'Firestore UNKNOWN must still keep the real overall status UNKNOWN, never SAFE');
});

// ---------------------------------------------------------------------------------------------
// Tracked Daily Writes history window (UCG-V2-2C-R1): anchored to the CURRENT Pacific date,
// never to the latest observed row -- stale data must never masquerade as "today".
// ---------------------------------------------------------------------------------------------

const ROWS_ENDING_STALE = [
  { date: '2026-08-01', writes: 10, observationCount: 1 },
  { date: '2026-08-02', writes: 20, observationCount: 1 },
  { date: '2026-08-03', writes: 30, observationCount: 1 }, // stalest/latest observed row
];

test('buildTrackedDailyHistoryWindow anchors to `now`, not the latest observed row', () => {
  // `now` is three weeks after the latest observation -- if the window anchored to the latest
  // row (2026-08-03) instead of `now`, all three rows would incorrectly appear inside a "last 30
  // days" window dated as if they were recent.
  const now = Date.parse('2026-08-24T12:00:00-07:00'); // noon Pacific, well past the last row
  const result = buildTrackedDailyHistoryWindow(ROWS_ENDING_STALE, { days: 30, now });
  assert.equal(result.anchorDateKey, '2026-08-24');
  assert.equal(result.windowStartDateKey, '2026-07-26');
  // All three stale rows still fall inside a 30-day lookback from 2026-08-24, so they remain
  // visible, but critically dated against the window boundary the UI actually shows the admin
  // ("Last 30 days" ending 2026-08-24), not silently against the stale data's own end date.
  assert.deepEqual(result.rows.map(r => r.date), ['2026-08-01', '2026-08-02', '2026-08-03']);
});

test('buildTrackedDailyHistoryWindow excludes rows older than the current-date window even when they are the only data', () => {
  // `now` is far enough past the data that a 30-day window anchored correctly to `now` excludes
  // every row -- this is the exact regression the R1 fix targets: an implementation that
  // (incorrectly) anchors to the latest observed row would instead show all three rows as if
  // they were within the last 30 days of "today".
  const now = Date.parse('2026-12-01T12:00:00-08:00');
  const result = buildTrackedDailyHistoryWindow(ROWS_ENDING_STALE, { days: 30, now });
  assert.equal(result.anchorDateKey, '2026-12-01');
  assert.deepEqual(result.rows, []);
});

test('buildTrackedDailyHistoryWindow: 60-day window uses America/Los_Angeles, not a fixed UTC offset', () => {
  // 2026-01-15 12:00 UTC is 2026-01-15 04:00 PST (UTC-8) -- a fixed UTC-8 offset and the real
  // IANA tz both agree here, so this pins the anchor to the correct Pacific date under standard
  // time specifically (a DST-naive UTC-7 assumption would misdate it).
  const now = Date.parse('2026-01-15T12:00:00Z');
  const result = buildTrackedDailyHistoryWindow([], { days: 60, now });
  assert.equal(result.anchorDateKey, '2026-01-15');
  assert.equal(result.windowStartDateKey, '2025-11-17');
});

test('buildTrackedDailyHistoryWindow: window boundary shifts correctly across a DST transition', () => {
  // 2026-03-08 is the US spring-forward DST transition (PST -> PDT). A window anchored the day
  // after must still walk back exactly `days` Pacific calendar dates, not `days` fixed 24h steps
  // miscounted by the missing hour.
  const now = Date.parse('2026-03-09T12:00:00-07:00'); // noon PDT
  const result = buildTrackedDailyHistoryWindow([], { days: 10, now });
  assert.equal(result.anchorDateKey, '2026-03-09');
  assert.equal(result.windowStartDateKey, '2026-02-28');
});

test('buildTrackedDailyHistoryWindow: invalid `now` or `days` fails closed instead of guessing', () => {
  assert.deepEqual(buildTrackedDailyHistoryWindow(ROWS_ENDING_STALE, { days: 30, now: NaN }),
    { anchorDateKey: null, windowStartDateKey: null, rows: [] });
  assert.deepEqual(buildTrackedDailyHistoryWindow(ROWS_ENDING_STALE, { days: 0, now: Date.now() }),
    { anchorDateKey: null, windowStartDateKey: null, rows: [] });
  assert.deepEqual(buildTrackedDailyHistoryWindow(ROWS_ENDING_STALE, { days: -5, now: Date.now() }),
    { anchorDateKey: null, windowStartDateKey: null, rows: [] });
});

test('buildTrackedDailyHistoryWindow: a row with a malformed date is dropped, never crashes the window filter', () => {
  const now = Date.parse('2026-08-24T12:00:00-07:00');
  const result = buildTrackedDailyHistoryWindow(
    [...ROWS_ENDING_STALE, { date: 'not-a-date', writes: 5, observationCount: 1 }, { date: null, writes: 5, observationCount: 1 }],
    { days: 30, now },
  );
  assert.deepEqual(result.rows.map(r => r.date), ['2026-08-01', '2026-08-02', '2026-08-03']);
});

// ---------------------------------------------------------------------------------------------
// Capacity Outlook + Growth Scenario (UCG-V2-2D): forecast/planning aid, never authoritative
// capacity, missing days never treated as zero, anchored to the CURRENT Pacific date.
// ---------------------------------------------------------------------------------------------

// 18 observed days inside the window (all other days in the 30-day window are gaps, not zero).
// 17 days at 100 writes + 1 day at 500 writes -> average (17*100+500)/18, peak 500.
const CAPACITY_ROWS_18_OBSERVED = [
  ...Array.from({ length: 17 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    writes: 100,
  })),
  { date: '2026-08-18', writes: 500 },
];
const CAPACITY_NOW = Date.parse('2026-08-24T12:00:00-07:00'); // noon Pacific

test('buildCapacityOutlookViewModel: averages/peaks over observed days only, denominator is daysObserved not windowDays', () => {
  const vm = buildCapacityOutlookViewModel(CAPACITY_ROWS_18_OBSERVED, { multiplier: 1, windowDays: 30, now: CAPACITY_NOW });
  assert.equal(vm.available, true);
  assert.equal(vm.daysObserved, 18);
  assert.equal(vm.observedAverage, (17 * 100 + 500) / 18);
  assert.equal(vm.observedPeak, 500);
});

test('buildCapacityOutlookViewModel: growth scenario is a straight linear multiplier of the observed baseline', () => {
  const vm = buildCapacityOutlookViewModel(CAPACITY_ROWS_18_OBSERVED, { multiplier: 5, windowDays: 30, now: CAPACITY_NOW });
  assert.equal(vm.multiplier, 5);
  assert.equal(vm.projectedAverage, vm.observedAverage * 5);
  assert.equal(vm.projectedPeak, vm.observedPeak * 5);
});

test('buildCapacityOutlookViewModel: 1x scenario projects to exactly the observed baseline', () => {
  const vm = buildCapacityOutlookViewModel(CAPACITY_ROWS_18_OBSERVED, { multiplier: 1, windowDays: 30, now: CAPACITY_NOW });
  assert.equal(vm.projectedAverage, vm.observedAverage);
  assert.equal(vm.projectedPeak, vm.observedPeak);
});

test('buildCapacityOutlookViewModel: reference is the 20,000 writes/day Firestore constant, exposed as reference only', () => {
  const vm = buildCapacityOutlookViewModel(CAPACITY_ROWS_18_OBSERVED, { multiplier: 1, windowDays: 30, now: CAPACITY_NOW });
  assert.equal(vm.referenceQuotaWrites, 20_000);
  assert.equal(vm.referenceQuotaUnit, 'writes/day');
  assert.equal(vm.coverage, 'partial');
  assert.equal(vm.isEstimate, true);
});

test('buildCapacityOutlookViewModel: no observed rows in the window -> available: false, never a fabricated 0', () => {
  const vm = buildCapacityOutlookViewModel([], { multiplier: 1, windowDays: 30, now: CAPACITY_NOW });
  assert.equal(vm.available, false);
  assert.equal(vm.observedAverage, null);
  assert.equal(vm.observedPeak, null);
  assert.equal(vm.projectedAverage, null);
  assert.equal(vm.projectedPeak, null);
  assert.equal(vm.daysObserved, 0);
});

test('buildCapacityOutlookViewModel: rows entirely outside the current-date window are excluded, never counted as recent', () => {
  // Anchored far in the future relative to the fixture rows -- a correct implementation excludes
  // all of them from the 30-day window (same regression class as buildTrackedDailyHistoryWindow's
  // R1 fix: never let stale data masquerade as "today").
  const farFuture = Date.parse('2027-06-01T12:00:00-07:00');
  const vm = buildCapacityOutlookViewModel(CAPACITY_ROWS_18_OBSERVED, { multiplier: 1, windowDays: 30, now: farFuture });
  assert.equal(vm.available, false);
});

test('buildCapacityOutlookViewModel: exposes CAPACITY_OUTLOOK_GROWTH_MULTIPLIERS as exactly 1x/2x/5x/10x, default 1x', () => {
  assert.deepEqual(CAPACITY_OUTLOOK_GROWTH_MULTIPLIERS, [1, 2, 5, 10]);
  const vm = buildCapacityOutlookViewModel(CAPACITY_ROWS_18_OBSERVED, { windowDays: 30, now: CAPACITY_NOW });
  assert.equal(vm.multiplier, 1, 'multiplier must default to 1x Current when not supplied');
});

test('buildCapacityOutlookViewModel: never exposes a quota-remaining/percentage/status field', () => {
  const vm = buildCapacityOutlookViewModel(CAPACITY_ROWS_18_OBSERVED, { multiplier: 1, windowDays: 30, now: CAPACITY_NOW });
  assert.ok(!('remaining' in vm));
  assert.ok(!('remainingPercentage' in vm));
  assert.ok(!('status' in vm));
});

// ---------------------------------------------------------------------------------------------
// UCG-V2-3-R1 Finding A: no valid observations -> first-screen tracked writes is `Unavailable`,
// never a fabricated 0. deriveTrackedFirestoreWritesTotal is the single, shared, unit-tested rule
// index.html's calculateTrackedFirestoreWrites wraps -- see tests/usage-cost-guard-daily-history.
// test.mjs for the index.html wiring check.
// ---------------------------------------------------------------------------------------------

test('deriveTrackedFirestoreWritesTotal: no valid observations at all (empty rows) -> null, never 0', () => {
  assert.equal(deriveTrackedFirestoreWritesTotal({ available: true, reason: null, rows: [] }), null);
});

test('deriveTrackedFirestoreWritesTotal: conflicting-observation failure -> null, never 0', () => {
  assert.equal(
    deriveTrackedFirestoreWritesTotal({ available: false, reason: 'conflicting_duplicate_observation', observationId: 'x', rows: [] }),
    null,
  );
});

test('deriveTrackedFirestoreWritesTotal: missing/malformed input -> null, never a crash or a fabricated 0', () => {
  assert.equal(deriveTrackedFirestoreWritesTotal(null), null);
  assert.equal(deriveTrackedFirestoreWritesTotal(undefined), null);
  assert.equal(deriveTrackedFirestoreWritesTotal({ available: true, reason: null, rows: null }), null);
});

test('deriveTrackedFirestoreWritesTotal: genuine observed data still renders normally (sums real rows)', () => {
  const aggregated = {
    available: true,
    reason: null,
    rows: [
      { date: '2026-08-01', writes: 120, observationCount: 1 },
      { date: '2026-08-02', writes: 340, observationCount: 2 },
    ],
  };
  assert.equal(deriveTrackedFirestoreWritesTotal(aggregated), 460);
});

test('deriveTrackedFirestoreWritesTotal: a single genuinely observed row of real (non-zero) writes is never mistaken for "no data"', () => {
  assert.equal(
    deriveTrackedFirestoreWritesTotal({ available: true, reason: null, rows: [{ date: '2026-08-01', writes: 7, observationCount: 1 }] }),
    7,
  );
});

test('Finding A end-to-end: buildFirestoreCardViewModel(null) reads as Unavailable, status stays UNKNOWN, Observed/Partial preserved', () => {
  const noObservationsTotal = deriveTrackedFirestoreWritesTotal({ available: true, reason: null, rows: [] });
  const vm = buildFirestoreCardViewModel({ trackedWrites: noObservationsTotal });
  assert.equal(vm.trackedWrites, null, 'no observations must render as unavailable (null), never 0');
  assert.equal(vm.status, STATUS.UNKNOWN);
  assert.equal(vm.coverage, 'partial');
});

test('Finding A end-to-end: overall status stays UNKNOWN when tracked writes are unavailable, exactly as with any other unavailable metric', () => {
  const noObservationsTotal = deriveTrackedFirestoreWritesTotal({ available: true, reason: null, rows: [] });
  const overview = buildUsageCostGuardOverview({
    trackedFirestoreWrites: noObservationsTotal,
    usageCostGuardConfig: { cloudRun: null, cloudRunFunctions: null },
    environment: 'prod',
  });
  assert.equal(overview.firestore.trackedWrites, null);
  assert.equal(overview.overallStatus, STATUS.UNKNOWN);
});

// ---------------------------------------------------------------------------------------------
// UCG-V2-3-R1 Finding B: the shared reason-message helper Daily History and Capacity Outlook both
// call when unavailable. Truthfully distinguishes a genuine data conflict from an in-flight/
// failed load, so a failed refresh can never read (or look) like a stale successful result.
// ---------------------------------------------------------------------------------------------

test('describeTrackedDailyWritesUnavailability: a failed reload reads as a failed refresh, not a data-integrity conflict', () => {
  const message = describeTrackedDailyWritesUnavailability('load_failed');
  assert.match(message, /refresh failed/);
  assert.doesNotMatch(message, /conflicting/);
});

test('describeTrackedDailyWritesUnavailability: an in-flight load reads as refreshing, not a stale result or a conflict', () => {
  const message = describeTrackedDailyWritesUnavailability('loading');
  assert.match(message, /refreshing/i);
  assert.doesNotMatch(message, /conflicting/);
});

test('describeTrackedDailyWritesUnavailability: a genuine data-integrity conflict keeps its original wording', () => {
  assert.match(describeTrackedDailyWritesUnavailability('conflicting_duplicate_observation'), /conflicting observations were found/);
});

test('describeTrackedDailyWritesUnavailability: an unknown/missing reason falls back to the conflict wording rather than throwing', () => {
  assert.match(describeTrackedDailyWritesUnavailability(undefined), /conflicting observations were found/);
  assert.match(describeTrackedDailyWritesUnavailability(null), /conflicting observations were found/);
});

test('describeTrackedDailyWritesUnavailability: the three reasons are all distinct strings (no accidental collapse)', () => {
  const messages = new Set([
    describeTrackedDailyWritesUnavailability('conflicting_duplicate_observation'),
    describeTrackedDailyWritesUnavailability('loading'),
    describeTrackedDailyWritesUnavailability('load_failed'),
  ]);
  assert.equal(messages.size, 3);
});
