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
