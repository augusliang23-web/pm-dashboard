// Usage & Cost Guard V2 -- UI view-model layer (UCG-V2-2B).
//
// Pure functions only: this module builds plain, serializable view-model objects for the
// first-screen Usage & Cost Guard cards from the approved js/usage-cost-guard.mjs foundation. It
// does not touch the DOM, fetch data, or call any Cloud API -- index.html renders these view
// models into markup. Nothing here reimplements or bypasses the foundation's status/remaining/
// spend-cap math; it only composes those functions and adds the overall-status precedence rule
// the Control Plane specified for this screen.

import {
  STATUS,
  FIRESTORE_DAILY_WRITE_QUOTA_REFERENCE,
  calculateSpendCap,
  normalizeSpendCapConfig,
  toPacificDateKey,
  calculateRollingWindow,
  forecastLinear,
} from './usage-cost-guard.mjs';

// Control Plane precedence (UCG-V2-2B section 9): a known critical condition outranks an unknown
// metric, and SAFE is only reachable when every required metric is credibly SAFE. An empty input
// (no metrics evaluated at all) is treated the same as "some metric unknown" -- UNKNOWN, never SAFE.
const STATUS_PRECEDENCE = [STATUS.LIMIT, STATUS.HIGH, STATUS.WATCH, STATUS.UNKNOWN, STATUS.SAFE];

export function combineOverallStatus(statuses = []) {
  for (const candidate of STATUS_PRECEDENCE) {
    if (statuses.includes(candidate)) return candidate;
  }
  return STATUS.UNKNOWN;
}

const OVERALL_STATUS_EXPLANATION = Object.freeze({
  [STATUS.SAFE]: 'All tracked metrics are within safe limits.',
  [STATUS.WATCH]: 'One or more metrics need attention.',
  [STATUS.HIGH]: 'One or more metrics are approaching their limit.',
  [STATUS.LIMIT]: 'One or more metrics have reached or exceeded their limit.',
  [STATUS.UNKNOWN]: 'Some current usage data is unavailable.',
});

export function describeOverallStatus(status) {
  return OVERALL_STATUS_EXPLANATION[status] ?? OVERALL_STATUS_EXPLANATION[STATUS.UNKNOWN];
}

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Firestore card view model. Status is ALWAYS UNKNOWN: we only have partial, observed, tracked
 * Presence writes, never total project Firestore usage, so this never computes (or lets a caller
 * infer) an exact remaining-writes figure, an exact % LEFT, or a project-wide SAFE state.
 * `trackedWrites` is shown only when a real observed number is supplied; it is never defaulted to
 * 0. `referenceQuotaWrites` is the official Firestore free-tier figure, disclosed as a reference
 * constant only -- this view model does not subtract trackedWrites from it.
 */
export function buildFirestoreCardViewModel({ trackedWrites = null } = {}) {
  const hasTrackedWrites = isFiniteNonNegative(trackedWrites);
  return Object.freeze({
    status: STATUS.UNKNOWN,
    trackedWrites: hasTrackedWrites ? trackedWrites : null,
    coverage: 'partial',
    referenceQuotaWrites: FIRESTORE_DAILY_WRITE_QUOTA_REFERENCE.value,
    referenceQuotaUnit: FIRESTORE_DAILY_WRITE_QUOTA_REFERENCE.unit,
    projectWideTotalAvailable: false,
  });
}

/**
 * Spend-cap card view model shared by the Cloud Run and Cloud Run Functions cards. `currentSpend`
 * defaults to null (unavailable) -- this is the explicit UCG-V2-2B current-spend model, never a
 * fabricated 0. When currentSpend is unavailable, remainingAmount/remainingPercentage stay null
 * and status is UNKNOWN (via calculateSpendCap's own contract); a caller must never render "S$0",
 * "100% LEFT", or "Remaining S$<cap>" in that case -- currentSpendAvailable: false says so plainly.
 */
export function buildSpendCapCardViewModel({ currentSpend = null, capConfig, environment, service } = {}) {
  const capMetric = normalizeSpendCapConfig(capConfig, { environment, service });
  const spendCap = calculateSpendCap(currentSpend, capMetric.value);
  return Object.freeze({
    status: spendCap.status,
    configuredCapValue: capMetric.value,
    configuredCapUnit: capMetric.unit,
    currentSpendAvailable: spendCap.available,
    remainingAmount: spendCap.available ? spendCap.remainingAmount : null,
    remainingPercentage: spendCap.available ? spendCap.remainingPercentage : null,
    source: capMetric.source,
    trustLevel: capMetric.trustLevel,
    verifiedAt: capMetric.freshness,
    environment: capMetric.environment,
    service: capMetric.service,
  });
}

/**
 * Full first-screen overview: Firestore card + both spend-cap cards + the combined overall
 * status. `currentCloudRunSpend`/`currentCloudRunFunctionsSpend` default to null (unavailable);
 * production index.html code must never pass anything else until a trustworthy live spend source
 * exists -- see the Control Plane's explicit "current spend = unavailable" decision.
 */
export function buildUsageCostGuardOverview({
  trackedFirestoreWrites = null,
  currentCloudRunSpend = null,
  currentCloudRunFunctionsSpend = null,
  usageCostGuardConfig = null,
  environment = null,
} = {}) {
  const firestore = buildFirestoreCardViewModel({ trackedWrites: trackedFirestoreWrites });
  const cloudRun = buildSpendCapCardViewModel({
    currentSpend: currentCloudRunSpend,
    capConfig: usageCostGuardConfig?.cloudRun,
    environment,
    service: 'cloudRun',
  });
  const cloudRunFunctions = buildSpendCapCardViewModel({
    currentSpend: currentCloudRunFunctionsSpend,
    capConfig: usageCostGuardConfig?.cloudRunFunctions,
    environment,
    service: 'cloudRunFunctions',
  });
  const overallStatus = combineOverallStatus([firestore.status, cloudRun.status, cloudRunFunctions.status]);
  return Object.freeze({
    overallStatus,
    overallStatusExplanation: describeOverallStatus(overallStatus),
    firestore,
    cloudRun,
    cloudRunFunctions,
  });
}

// ---------------------------------------------------------------------------------------------
// Tracked Daily Writes history window (UCG-V2-2C-R1)
// ---------------------------------------------------------------------------------------------
//
// UCG-V2-2C-R1 remediation: the "Last 30 days" / "Available history (up to 60 days)" window
// must be anchored to the CURRENT America/Los_Angeles calendar date, never to the latest
// observed row's date -- anchoring to the latest observation lets stale data masquerade as
// current (e.g. a dashboard left unopened for a week would show its most recent tracked day as
// "today"). `now` is deliberately an explicit parameter (a Date or epoch-ms number, defaulting
// to Date.now() only at the call site) rather than a hidden Date.now() call buried in this pure
// function, so the window boundary is deterministic and testable.
//
// Reuses toPacificDateKey (the same Intl/IANA-timezone-aware America/Los_Angeles conversion the
// foundation already uses for aggregateObservedBucketsByPacificStartDate) for the anchor, and the
// same UTC-midnight-of-a-date-key arithmetic calculateRollingWindow already uses for the day-count
// walk-back -- this is calendar-date arithmetic on already-Pacific-attributed date keys, not a
// second, inconsistent timezone model.
export function buildTrackedDailyHistoryWindow(rows = [], { days = 30, now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const anchorDateKey = toPacificDateKey(nowMs);
  if (!anchorDateKey || !Number.isInteger(days) || days <= 0) {
    return { anchorDateKey: null, windowStartDateKey: null, rows: [] };
  }
  const anchorMs = Date.parse(`${anchorDateKey}T00:00:00Z`);
  const windowStartMs = anchorMs - (days - 1) * 86_400_000;
  const windowed = rows.filter((row) => {
    const ms = Date.parse(`${row?.date}T00:00:00Z`);
    return Number.isFinite(ms) && ms >= windowStartMs && ms <= anchorMs;
  });
  // windowStartMs was built by subtracting whole 24h steps from anchorMs (itself a UTC-midnight
  // instant, per the `${anchorDateKey}T00:00:00Z` parse above) -- it is already the UTC-midnight
  // instant of the correct calendar date. Re-running it through toPacificDateKey (a timezone
  // CONVERSION) here would be wrong: it would interpret this UTC-midnight instant as a moment in
  // Pacific time, which lands on the *previous* calendar day (Pacific is behind UTC), shifting
  // the reported window start back by one day. Format it directly as the UTC calendar date it
  // already represents instead.
  const windowStartDateKey = new Date(windowStartMs).toISOString().slice(0, 10);
  return {
    anchorDateKey,
    windowStartDateKey,
    rows: windowed,
  };
}

// ---------------------------------------------------------------------------------------------
// Capacity Outlook + Growth Scenario (UCG-V2-2D)
// ---------------------------------------------------------------------------------------------
//
// Forecast / planning aid ONLY -- this is explicitly not, and must never be presented as, an
// authoritative Firestore project capacity figure. It answers "if observed usage grew Nx, how
// far off is the 20,000 writes/day reference" using nothing but the already-approved Tracked
// Presence write pipeline (js/usage-cost-guard.mjs's calculateRollingWindow/forecastLinear) --
// no new Firestore query and no second aggregation pipeline.
//
// Continues the UCG-V2-2C-R1 data-truth rules this module already enforces elsewhere:
//   - The 30-day window is anchored to the CURRENT America/Los_Angeles calendar date (via
//     toPacificDateKey), never to the latest observed row -- see buildTrackedDailyHistoryWindow's
//     rationale above, which applies identically here.
//   - Missing days are never treated as zero: calculateRollingWindow's average/peak divide by
//     `daysObserved` (the count of days that actually have a row), not by `windowDays`.
//   - No valid observed rows in the window -> `available: false` (rendered as "Unavailable" by
//     the caller), never a fabricated 0.
export const CAPACITY_OUTLOOK_GROWTH_MULTIPLIERS = Object.freeze([1, 2, 5, 10]);

export function buildCapacityOutlookViewModel(rows = [], { multiplier = 1, windowDays = 30, now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const anchorDateKey = toPacificDateKey(nowMs);
  const rolling = anchorDateKey ? calculateRollingWindow(rows, windowDays, anchorDateKey) : { available: false };

  if (!rolling.available) {
    return Object.freeze({
      available: false,
      windowDays,
      multiplier,
      daysObserved: 0,
      observedAverage: null,
      observedPeak: null,
      projectedAverage: null,
      projectedPeak: null,
      referenceQuotaWrites: FIRESTORE_DAILY_WRITE_QUOTA_REFERENCE.value,
      referenceQuotaUnit: FIRESTORE_DAILY_WRITE_QUOTA_REFERENCE.unit,
      coverage: 'partial',
      isEstimate: true,
    });
  }

  const projectedAverage = forecastLinear(rolling.average, multiplier);
  const projectedPeak = forecastLinear(rolling.peak, multiplier);

  return Object.freeze({
    available: true,
    windowDays,
    multiplier,
    daysObserved: rolling.daysObserved,
    observedAverage: rolling.average,
    observedPeak: rolling.peak,
    // forecastLinear itself fails closed (available: false) on an invalid multiplier/baseline;
    // this only ever happens here if `multiplier` is not a positive finite number, which the UI
    // never passes (it is always one of CAPACITY_OUTLOOK_GROWTH_MULTIPLIERS) -- still, null (not
    // a silently-wrong number) is the correct fallback rather than assuming it always succeeds.
    projectedAverage: projectedAverage.available ? projectedAverage.forecastedDailyWrites : null,
    projectedPeak: projectedPeak.available ? projectedPeak.forecastedDailyWrites : null,
    referenceQuotaWrites: FIRESTORE_DAILY_WRITE_QUOTA_REFERENCE.value,
    referenceQuotaUnit: FIRESTORE_DAILY_WRITE_QUOTA_REFERENCE.unit,
    coverage: 'partial',
    isEstimate: true,
  });
}
