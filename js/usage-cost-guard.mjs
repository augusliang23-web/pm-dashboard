// Usage & Cost Guard V2 -- pure data-truth + calculation layer (UCG-V2-2A, remediated in
// UCG-V2-2A-R1 after independent review found the original Pacific daily aggregation implied
// exact-day reconstruction the source data cannot support -- see PRESENCE_TRACKED_WRITE_PROVENANCE
// and aggregateObservedBucketsByPacificStartDate below -- and remediated again in UCG-V2-2A-R2
// after review found the Presence adapter had no stable source-observation identity, so a
// persisted bucket read twice could double-count and malformed/inverted buckets could pass
// through unvalidated -- see the "Presence bucket source adapter" section and
// dedupeObservationsById below).
//
// This module contains ONLY pure functions: metric normalization, remaining/status math,
// spend-cap math, an identity-preserving + validating adapter from the persisted Presence bucket
// shape plus approximate Pacific-timezone bucket-to-day aggregation, rolling metrics, headroom,
// and linear forecasting. It does not fetch data, read Firestore, call any Cloud API, or render UI.
//
// Data-truth rule enforced throughout: a metric's `trustLevel` and `source` describe how
// trustworthy its *origin* is, and no function in this module is allowed to upgrade that
// trust level. Observed Presence writes stay `observed` (never become `authoritative`
// Firestore project totals); a `manualConfig` spend cap stays `manualConfig` (never becomes
// a live Google Cloud read). Missing/unavailable inputs must surface as UNKNOWN or
// `unavailable`, never silently coerced to 0 or to a false "fully safe" reading. Generic
// pure-math helpers (calculateRollingWindow, calculateHeadroom, forecastLinear) return
// trust-neutral plain numbers on their own; callers who need the result to keep carrying its
// origin's provenance attach it explicitly via attachProvenance().

export const TRUST_LEVELS = Object.freeze([
  "authoritative",
  "observed",
  "estimated",
  "hardcoded",
  "manualConfig",
  "unavailable",
]);

export const STATUS = Object.freeze({
  SAFE: "SAFE",
  WATCH: "WATCH",
  HIGH: "HIGH",
  LIMIT: "LIMIT",
  UNKNOWN: "UNKNOWN",
});

const PACIFIC_TIME_ZONE = "America/Los_Angeles";

/**
 * Provenance metadata for the tracked-Presence-write pipeline (adapter -> bucket aggregation).
 * This is intentionally the ONLY place these five values are declared together, so every
 * consumer of the Presence write pipeline gets the identical, unambiguous disclosure:
 *   - source / trustLevel: this is observed application telemetry, not a live Firestore read.
 *   - coverage: "partial" -- only Presence-tracked writes are counted, not the whole project.
 *   - isEstimate: true -- bucket-to-day attribution is an approximation (see boundaryAccuracy).
 *   - aggregationMethod / boundaryAccuracy: a 12-hour bucket is attributed to the Pacific
 *     calendar day of its bucketStart; a bucket that straddles Pacific midnight is NOT split,
 *     so day boundaries are approximate, not exact. See aggregateObservedBucketsByPacificStartDate.
 */
export const PRESENCE_TRACKED_WRITE_PROVENANCE = Object.freeze({
  source: "tracked-presence-writes",
  trustLevel: "observed",
  coverage: "partial",
  isEstimate: true,
  aggregationMethod: "bucket-start-date",
  boundaryAccuracy: "approximate",
});

/**
 * The official Firestore free-tier daily write quota, kept as a hardcoded reference constant
 * only (Control Plane decision 4.4). This is NOT a live Google Cloud read, and it must never be
 * combined with PRESENCE_TRACKED_WRITE_PROVENANCE data (or anything carrying that provenance) to
 * produce a claimed "Firestore daily quota remaining", an exact "% LEFT", or a project-level
 * SAFE status: tracked Presence writes are partial-coverage observed telemetry, not total
 * project Firestore usage, and no calculation in this module treats the two as interchangeable.
 */
export const FIRESTORE_DAILY_WRITE_QUOTA_REFERENCE = Object.freeze({
  value: 20_000,
  unit: "writes/day",
  source: "firestore-official-reference",
  trustLevel: "hardcoded",
  coverage: "project-wide-reference-only",
  isEstimate: false,
});

// ---------------------------------------------------------------------------------------------
// A. Metric normalization
// ---------------------------------------------------------------------------------------------

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Builds a normalized metric object. `value` may be a finite number or null/undefined to
 * represent "unavailable" -- in that case trustLevel is forced to "unavailable" regardless of
 * what was passed in, so a caller cannot claim trust for data it does not have.
 */
export function createMetric({
  value = null,
  unit = null,
  source,
  freshness = null,
  trustLevel,
  environment,
  service = null,
  isEstimate = false,
} = {}) {
  if (!TRUST_LEVELS.includes(trustLevel)) {
    throw new Error(`createMetric: invalid trustLevel "${trustLevel}"`);
  }
  const hasValue = isFiniteNumber(value);
  return Object.freeze({
    value: hasValue ? value : null,
    unit,
    source: source ?? null,
    freshness,
    trustLevel: hasValue ? trustLevel : "unavailable",
    environment: environment ?? null,
    service,
    isEstimate: Boolean(isEstimate),
    isAvailable: hasValue,
  });
}

export function isMetricAvailable(metric) {
  return Boolean(metric && metric.isAvailable && isFiniteNumber(metric.value));
}

export function isMetricTrustworthy(metric, allowedTrustLevels) {
  if (!isMetricAvailable(metric)) return false;
  return allowedTrustLevels.includes(metric.trustLevel);
}

/**
 * Deliberately merges provenance (source/trustLevel/coverage/isEstimate/...) onto the plain
 * numeric result of a generic pure-math helper (calculateRollingWindow, calculateHeadroom,
 * forecastLinear, ...). Those helpers stay trust-neutral on their own -- they never claim a
 * trust level for numbers they didn't originate -- so a caller who WANTS the result to keep
 * carrying its origin's provenance must attach it explicitly here. This function only copies
 * the given provenance fields onto the result; it never invents, upgrades, or infers a
 * trustLevel (e.g. it will not turn "observed" into "authoritative" no matter what math ran).
 */
export function attachProvenance(result, provenance) {
  if (!provenance) return result;
  const { source = null, trustLevel = "unavailable", coverage = null, isEstimate = false } = provenance;
  return Object.freeze({ ...result, source, trustLevel, coverage, isEstimate });
}

// ---------------------------------------------------------------------------------------------
// B. Remaining calculation
// ---------------------------------------------------------------------------------------------

/**
 * Computes used/remaining/remainingPercentage for a metric with a current value and a limit.
 * Accepts raw numbers or metric-shaped objects ({value, ...}); missing/invalid inputs never
 * produce a fabricated "normal" percentage -- they return available: false.
 */
export function calculateRemaining(current, limit) {
  const currentValue = extractNumericValue(current);
  const limitValue = extractNumericValue(limit);

  if (currentValue === null || limitValue === null) {
    return {
      available: false,
      reason: currentValue === null ? "missing_current" : "missing_limit",
      used: null,
      remaining: null,
      remainingPercentage: null,
    };
  }
  if (!(limitValue > 0)) {
    return {
      available: false,
      reason: "invalid_limit",
      used: null,
      remaining: null,
      remainingPercentage: null,
    };
  }
  if (currentValue < 0) {
    return {
      available: false,
      reason: "invalid_current",
      used: null,
      remaining: null,
      remainingPercentage: null,
    };
  }

  const used = currentValue;
  const remaining = limitValue - currentValue;
  const remainingPercentage = (remaining / limitValue) * 100;

  return {
    available: true,
    reason: null,
    used,
    remaining,
    remainingPercentage,
  };
}

function extractNumericValue(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return isFiniteNumber(input) ? input : null;
  if (typeof input === "object" && "value" in input) {
    if (input.isAvailable === false) return null;
    return isFiniteNumber(input.value) ? input.value : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// C. Status selection
// ---------------------------------------------------------------------------------------------

/**
 * Maps a remainingPercentage (0-100, may exceed 100 or go negative for over-limit cases) to a
 * V2 status. Anything not a finite number yields UNKNOWN -- this is the single chokepoint that
 * keeps "no trustworthy numerator/denominator" from ever being displayed as SAFE.
 */
export function selectStatus(remainingPercentage) {
  if (!isFiniteNumber(remainingPercentage)) return STATUS.UNKNOWN;
  if (remainingPercentage <= 0) return STATUS.LIMIT;
  if (remainingPercentage <= 20) return STATUS.HIGH;
  if (remainingPercentage <= 50) return STATUS.WATCH;
  return STATUS.SAFE;
}

/**
 * Convenience wrapper: status for a generic quota/cap given current + limit, reusing
 * calculateRemaining so both share exactly one remaining/percentage implementation.
 */
export function calculateQuotaStatus(current, limit) {
  const remaining = calculateRemaining(current, limit);
  return {
    ...remaining,
    status: remaining.available ? selectStatus(remaining.remainingPercentage) : STATUS.UNKNOWN,
  };
}

// ---------------------------------------------------------------------------------------------
// D. Spend-cap calculation
// ---------------------------------------------------------------------------------------------

/**
 * currentSpend: number | metric-shaped object | null/undefined (unavailable).
 * configuredCap: number | metric-shaped object | null/undefined.
 *
 * Missing current spend is NEVER treated as spend = 0. It always yields
 * remainingAmount/remainingPercentage = null and status UNKNOWN, even when a cap is configured.
 */
export function calculateSpendCap(currentSpend, configuredCap) {
  const spendValue = extractNumericValue(currentSpend);
  const capValue = extractNumericValue(configuredCap);

  if (spendValue === null) {
    return {
      available: false,
      reason: "spend_unavailable",
      remainingAmount: null,
      remainingPercentage: null,
      status: STATUS.UNKNOWN,
    };
  }
  if (capValue === null || !(capValue > 0)) {
    return {
      available: false,
      reason: capValue === null ? "missing_cap" : "invalid_cap",
      remainingAmount: null,
      remainingPercentage: null,
      status: STATUS.UNKNOWN,
    };
  }
  if (spendValue < 0) {
    return {
      available: false,
      reason: "invalid_spend",
      remainingAmount: null,
      remainingPercentage: null,
      status: STATUS.UNKNOWN,
    };
  }

  const remainingAmount = capValue - spendValue;
  const remainingPercentage = (remainingAmount / capValue) * 100;

  return {
    available: true,
    reason: null,
    remainingAmount,
    remainingPercentage,
    status: selectStatus(remainingPercentage),
  };
}

/**
 * Builds a normalized spend-cap config metric from an env/<name>.json-style declaration, e.g.
 * { configuredCapSgd: 2, source: "dashboard-config", trustLevel: "manualConfig", verifiedAt: "2026-09-26" }.
 * This never invents a currentSpend; it only describes the cap itself.
 */
export function normalizeSpendCapConfig(config, { environment, service } = {}) {
  if (!config || !isFiniteNumber(config.configuredCapSgd)) {
    return createMetric({
      value: null,
      unit: "SGD",
      source: config?.source ?? null,
      trustLevel: "unavailable",
      environment,
      service,
    });
  }
  return createMetric({
    value: config.configuredCapSgd,
    unit: "SGD",
    source: config.source ?? "dashboard-config",
    freshness: config.verifiedAt ?? null,
    trustLevel: "manualConfig",
    environment,
    service,
    isEstimate: false,
  });
}

// ---------------------------------------------------------------------------------------------
// E. Pacific daily aggregation
// ---------------------------------------------------------------------------------------------

const pacificDateFormatterCache = new Map();

function pacificDateFormatter() {
  const cached = pacificDateFormatterCache.get(PACIFIC_TIME_ZONE);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  pacificDateFormatterCache.set(PACIFIC_TIME_ZONE, formatter);
  return formatter;
}

/**
 * Returns the Pacific calendar date ("YYYY-MM-DD") for a single epoch-ms POINT IN TIME, using
 * Intl's IANA tz database (so PST/PDT and DST transitions are handled correctly) rather than a
 * fixed UTC offset. Independent of the host/browser's local timezone. This conversion itself is
 * exact for a single instant; the approximation problem below comes from attributing an entire
 * 12-hour RANGE (a bucket) to one such date, not from this function.
 */
export function toPacificDateKey(epochMs) {
  if (!isFiniteNumber(epochMs)) return null;
  // en-CA formats as YYYY-MM-DD directly.
  return pacificDateFormatter().format(new Date(epochMs));
}

// ---------------------------------------------------------------------------------------------
// Presence bucket source adapter (R2: identity-preserving + validating)
// ---------------------------------------------------------------------------------------------
//
// Source identity, verified against index.html rather than assumed:
//   - The Presence doc id IS the user identity: `doc(db, "presence", getEmailKey(owner))`
//     (index.html:4432, 4150, 4180, ...), where getEmailKey (index.html:4248-4251) normalizes an
//     email to a lowercase, trimmed string. One Firestore doc per user; its doc id is stable.
//   - One `usageBuckets` entry is identified by its `bucketId` (e.g. "2026-06-01-H1", built by
//     getPresenceUsageBucket at index.html:4390-4397 and written back as the row's own
//     `bucketId` field at index.html:4433 as well as the outer map key). bucketId is a function
//     of DATE + HALF only -- it carries no user information.
//   - Consequently bucketId is NOT globally unique: two different users' Presence docs
//     legitimately produce the identical bucketId for the same 12-hour period (confirmed by
//     index.html's own admin aggregation at index.html:4944-4965, which groups usageBuckets
//     ACROSS all users by bucketId to build a global totals view -- i.e. the existing code
//     already relies on multiple users sharing one bucketId and summing their counters).
//   - Therefore a stable, non-colliding observation identity requires BOTH the owning Presence
//     doc id and the bucketId: `${sourceDocumentId}::${sourceBucketId}`. bucketId alone is not
//     safe to dedupe by (it would incorrectly collapse two different users' distinct writes);
//     date/bucketStart/bucketEnd alone is even less safe, for the same reason.
//   - The bucketId is available on the row itself once usageBuckets is flattened (see
//     index.html:4945-4947, `row.bucketId`), but the owning doc id is only available from the
//     outer loop over `presence` collection docs (`presenceDoc.id`) -- it is NOT part of the row.
//     The adapter therefore requires sourceDocumentId to be supplied by the caller; it never
//     invents one, and fails closed (returns null) when it is missing.
//
// Counter semantics (unchanged from R1, still correct on re-inspection):
//   - activeWrites / idleWrites / logoutWrites: client-side activity ticks.
//   - totalPresenceWrites: activeWrites + idleWrites + logoutWrites -- an APPLICATION ACTIVITY
//     count, not a Firestore document-write count.
//   - counterFlushWrites: incremented by exactly 1 inside flushDuePresenceUsage's single
//     updateDoc() call per flush (index.html:4441) -- exactly one Firestore document-write
//     operation per increment. This is the metric this module treats as "tracked Firestore
//     writes" for a bucket. totalPresenceWrites and counterFlushWrites are never summed.
//
// Bucket validity (verified, not assumed):
//   - PRESENCE_USAGE_FLUSH_MS is 12 hours exactly (index.html:4107), and getPresenceUsageBucket
//     always derives bucketEnd as bucketStart + PRESENCE_USAGE_FLUSH_MS (index.html:4391-4392),
//     so every genuinely persisted bucket has bucketEnd - bucketStart === PRESENCE_BUCKET_DURATION_MS
//     exactly. A different duration (including an inverted or zero-length interval) cannot come
//     from this write path and is rejected as malformed.
//   - flushDuePresenceUsage only ever calls updateDoc (the only place counterFlushWrites is
//     written) when `item.totalPresenceWrites > 0` (index.html:4427); every write of
//     counterFlushWrites is paired with `increment(1)` (index.html:4441) in that same call. A
//     genuinely persisted bucket document can therefore never have been written with
//     counterFlushWrites: 0 -- the first (and every) flush that creates/updates it adds at least
//     1. counterFlushWrites: 0 is accordingly rejected here as not a reachable persisted state,
//     not merely "unlikely". (Negative, fractional, NaN, and infinite counts are separately and
//     always invalid regardless of this decision.)
export const PRESENCE_BUCKET_DURATION_MS = 12 * 60 * 60 * 1000;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Builds a stable, non-colliding observation identity for one persisted Presence bucket. Needs
 * BOTH the owning Presence doc id (sourceDocumentId) and the bucket's own id (sourceBucketId),
 * since bucketId alone can collide across different users' documents (see notes above). Returns
 * null -- never a manufactured identity -- when either half is not a usable, non-empty string.
 */
function buildObservationId(sourceDocumentId, sourceBucketId) {
  if (!isNonEmptyString(sourceDocumentId) || !isNonEmptyString(sourceBucketId)) return null;
  return `${sourceDocumentId}::${sourceBucketId}`;
}

/**
 * Adapts one persisted Presence bucket row into a UCG observation carrying a stable source
 * identity (observationId/sourceDocumentId/sourceBucketId), so that (a) the exact same persisted
 * bucket can never be double-counted just because it appears twice in a calculation input, and
 * (b) two different users' distinct observations for the same UTC interval are never mistaken
 * for the same thing.
 *
 * `context.sourceDocumentId` MUST be supplied by the caller (the owning Presence doc id -- see
 * notes above for why it cannot be derived from the row itself); `context.sourceBucketId`
 * defaults to `bucket.bucketId`, which the real persisted row shape always carries. Returns null
 * -- never a best-effort guess -- for any missing identity or any bucket that fails validation:
 *   - bucketStart / bucketEnd must be finite numbers, with bucketEnd - bucketStart exactly
 *     PRESENCE_BUCKET_DURATION_MS (see "Bucket validity" above; this alone also rejects any
 *     inverted or zero-length interval).
 *   - writes (from counterFlushWrites) must be a finite integer >= 1 (see "Bucket validity"
 *     above for why 0 is rejected as an unreachable persisted state; negative/fractional/
 *     non-finite are always invalid).
 */
export function adaptPresenceBucketToObservedWrite(bucket, context = {}) {
  const sourceDocumentId = context.sourceDocumentId ?? null;
  const sourceBucketId = context.sourceBucketId ?? bucket?.bucketId ?? null;
  const observationId = buildObservationId(sourceDocumentId, sourceBucketId);
  if (!observationId) return null;

  const bucketStart = bucket?.bucketStart;
  const bucketEnd = bucket?.bucketEnd;
  const writes = bucket?.counterFlushWrites;

  if (!isFiniteNumber(bucketStart) || !isFiniteNumber(bucketEnd)) return null;
  if (bucketEnd - bucketStart !== PRESENCE_BUCKET_DURATION_MS) return null;
  if (!isFiniteNumber(writes) || !Number.isInteger(writes) || writes < 1) return null;

  return Object.freeze({
    observationId,
    sourceDocumentId,
    sourceBucketId,
    bucketStart,
    bucketEnd,
    writes,
    ...PRESENCE_TRACKED_WRITE_PROVENANCE,
  });
}

/**
 * Deduplicates adapted observations (see adaptPresenceBucketToObservedWrite) by observationId.
 * Three cases:
 *   - A single observationId appearing once: kept as-is.
 *   - The exact same observationId appearing more than once with IDENTICAL content (same
 *     writes/bucketStart/bucketEnd): treated as the same observation seen twice (e.g. the same
 *     Firestore doc read twice into one calculation input) and counted ONCE, never summed.
 *   - The same observationId appearing more than once with DIFFERING content (different writes
 *     and/or interval): this is a data-integrity conflict, not a legitimate duplicate or two
 *     independent observations, so this fails closed with `available: false,
 *     reason: "conflicting_duplicate_observation"` rather than silently summing or guessing
 *     which copy is correct.
 * Distinct observationIds (different users, or the same user's different buckets) are never
 * merged here -- they are legitimately independent and are summed only later, by attributed
 * date, in aggregateObservedBucketsByPacificStartDate.
 */
export function dedupeObservationsById(observations = []) {
  const byId = new Map();
  for (const obs of observations) {
    if (!obs || !isNonEmptyString(obs.observationId)) continue;
    const existing = byId.get(obs.observationId);
    if (!existing) {
      byId.set(obs.observationId, obs);
      continue;
    }
    const identical =
      existing.writes === obs.writes &&
      existing.bucketStart === obs.bucketStart &&
      existing.bucketEnd === obs.bucketEnd;
    if (!identical) {
      return { available: false, reason: "conflicting_duplicate_observation", observationId: obs.observationId, observations: null };
    }
    // Identical repeat of the same observation: drop the copy, count once.
  }
  return { available: true, reason: null, observationId: null, observations: [...byId.values()] };
}

/**
 * Aggregates adapted, identity-bearing Presence write observations (see
 * adaptPresenceBucketToObservedWrite) into an APPROXIMATE, bucket-attributed count per Pacific
 * calendar day. The pipeline is: dedupe by observation identity FIRST (see
 * dedupeObservationsById -- the exact same persisted bucket can never be double-counted, and a
 * conflicting duplicate identity fails the whole call closed), THEN sum the remaining, genuinely
 * distinct observations by their attributed Pacific date (different users' or different buckets'
 * observations covering the same date are legitimately independent and are summed).
 *
 * IMPORTANT -- this is deliberately NOT named/advertised as exact Pacific daily usage: the
 * source data is a 12-hour aggregate counter, not per-write timestamps, so a bucket that spans
 * Pacific midnight (which happens for both the PST and PDT halves of the day, since the bucket
 * boundaries are fixed UTC 00:00/12:00, not Pacific-aligned) cannot be split across the two
 * Pacific days it actually covers. This function attributes the WHOLE bucket to the Pacific
 * calendar day of its bucketStart, which is a bucket-attributed approximation, not a
 * reconstruction of exact per-day usage. Every row this function returns carries
 * PRESENCE_TRACKED_WRITE_PROVENANCE (source/trustLevel/coverage/isEstimate/aggregationMethod/
 * boundaryAccuracy) so downstream code can tell it apart from an authoritative, exact daily
 * Firestore total. It must never be used to compute an exact "Firestore daily quota remaining".
 *
 * Returns `{ available: false, reason: "conflicting_duplicate_observation", observationId, rows:
 * [] }` when dedupe fails closed; otherwise `{ available: true, reason: null, observationId:
 * null, rows: [...] }`.
 */
export function aggregateObservedBucketsByPacificStartDate(observations = []) {
  const deduped = dedupeObservationsById(observations);
  if (!deduped.available) {
    return { available: false, reason: deduped.reason, observationId: deduped.observationId, rows: [] };
  }

  const dateRows = deduped.observations
    .map((obs) => {
      const dateKey = toPacificDateKey(obs.bucketStart);
      return dateKey ? { date: dateKey, writes: obs.writes } : null;
    })
    .filter(Boolean);

  const rows = aggregateRowsByDate(dateRows).map((row) => ({ ...row, ...PRESENCE_TRACKED_WRITE_PROVENANCE }));
  return { available: true, reason: null, observationId: null, rows };
}

// ---------------------------------------------------------------------------------------------
// F. Rolling metrics
// ---------------------------------------------------------------------------------------------

/**
 * Aggregates dailyRows that share the same `date` key by summing their `writes`, counting how
 * many distinct rows contributed to that date (`observationCount`). This does NOT perform
 * source-identity deduplication (see dedupeObservationsById for that, which must run first in
 * the Presence pipeline) -- it assumes its input rows are already-distinct observations, and its
 * job is only to combine multiple genuinely distinct observations that share one attributed
 * calendar day (e.g. different users', or different buckets', writes landing on the same Pacific
 * date) into a single day-level total. Unrecognized/invalid rows (missing date, non-finite
 * writes) are dropped rather than guessed at. Returned rows are sorted ascending by date; each
 * unique date appears exactly once.
 */
export function aggregateRowsByDate(dailyRows = []) {
  const byDate = new Map();
  for (const row of dailyRows) {
    if (!row || typeof row.date !== "string" || !isFiniteNumber(row.writes)) continue;
    const existing = byDate.get(row.date);
    if (existing) {
      existing.writes += row.writes;
      existing.observationCount += 1;
    } else {
      byDate.set(row.date, { date: row.date, writes: row.writes, observationCount: 1 });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * dailyRows: array of { date: "YYYY-MM-DD", writes: number }, ascending or unordered. Rows
 * sharing the same date are combined (via aggregateRowsByDate) before anything else runs, so a
 * repeated date label can never inflate `daysObserved` or silently skew the average/peak by being
 * counted as two separate days -- this is date-level combination of distinct observations, not
 * source-identity deduplication (that already happened upstream for Presence data; see
 * dedupeObservationsById).
 * windowDays: e.g. 7 or 30.
 * `asOfDate` (optional "YYYY-MM-DD") anchors the window; defaults to the latest date present.
 *
 * Missing days inside the window are NOT silently treated as 0 -- the function reports how
 * many of the windowDays actually have observed data (`daysObserved`) alongside the average
 * computed strictly over the rows that exist, so callers can see incompleteness rather than
 * have it hidden inside an average that assumes zero-usage gaps. A day that explicitly reports
 * writes: 0 IS counted as observed (it is real data, not a gap); a day with no row at all is not.
 */
export function calculateRollingWindow(dailyRows = [], windowDays, asOfDate = null) {
  if (!Number.isInteger(windowDays) || windowDays <= 0) {
    return { available: false, reason: "invalid_window", daysObserved: 0, average: null, peak: null };
  }
  const sorted = aggregateRowsByDate(dailyRows);

  if (sorted.length === 0) {
    return { available: false, reason: "no_data", daysObserved: 0, average: null, peak: null };
  }

  const anchor = asOfDate ?? sorted[sorted.length - 1].date;
  const anchorMs = Date.parse(`${anchor}T00:00:00Z`);
  const windowStartMs = anchorMs - (windowDays - 1) * 86_400_000;

  const inWindow = sorted.filter((row) => {
    const ms = Date.parse(`${row.date}T00:00:00Z`);
    return ms >= windowStartMs && ms <= anchorMs;
  });

  if (inWindow.length === 0) {
    return { available: false, reason: "no_data_in_window", daysObserved: 0, average: null, peak: null };
  }

  const total = inWindow.reduce((sum, row) => sum + row.writes, 0);
  const peak = inWindow.reduce((max, row) => Math.max(max, row.writes), -Infinity);

  return {
    available: true,
    reason: null,
    windowDays,
    daysObserved: inWindow.length,
    isPartial: inWindow.length < windowDays,
    average: total / inWindow.length,
    peak,
  };
}

export function calculateRollingAverage(dailyRows, windowDays, asOfDate = null) {
  return calculateRollingWindow(dailyRows, windowDays, asOfDate);
}

export function calculateRollingPeak(dailyRows, windowDays, asOfDate = null) {
  return calculateRollingWindow(dailyRows, windowDays, asOfDate);
}

// ---------------------------------------------------------------------------------------------
// G. Headroom helper
// ---------------------------------------------------------------------------------------------

/**
 * Pure math: how much headroom remains between `usage` and `quota`. This function makes no
 * claim about what `usage` represents -- callers/metadata are responsible for not presenting
 * an observed, partial-coverage usage figure (e.g. tracked Presence writes) as if it measured
 * an authoritative capacity (e.g. total Firestore project writes).
 */
export function calculateHeadroom(usage, quota) {
  const usageValue = extractNumericValue(usage);
  const quotaValue = extractNumericValue(quota);

  if (usageValue === null || quotaValue === null) {
    return { available: false, reason: usageValue === null ? "missing_usage" : "missing_quota", headroom: null, headroomPercentage: null, exceeded: null };
  }
  if (!(quotaValue > 0)) {
    return { available: false, reason: "invalid_quota", headroom: null, headroomPercentage: null, exceeded: null };
  }
  if (usageValue < 0) {
    return { available: false, reason: "invalid_usage", headroom: null, headroomPercentage: null, exceeded: null };
  }

  const headroom = quotaValue - usageValue;
  return {
    available: true,
    reason: null,
    headroom,
    headroomPercentage: (headroom / quotaValue) * 100,
    exceeded: usageValue > quotaValue,
  };
}

// ---------------------------------------------------------------------------------------------
// H. Simple forecast
// ---------------------------------------------------------------------------------------------

/**
 * Linear forecast of observed daily writes under a workload multiplier (1x, 2x, 5x, 10x, or any
 * positive fraction). Always marked isEstimate: true. Not a predictive model -- straight
 * multiplication of an observed baseline.
 */
export function forecastLinear(observedDailyAverage, multiplier) {
  const baseline = extractNumericValue(observedDailyAverage);
  if (baseline === null) {
    return { available: false, reason: "no_data", forecastedDailyWrites: null, isEstimate: true };
  }
  if (baseline < 0) {
    return { available: false, reason: "invalid_baseline", forecastedDailyWrites: null, isEstimate: true };
  }
  if (!isFiniteNumber(multiplier) || multiplier <= 0) {
    return { available: false, reason: "invalid_multiplier", forecastedDailyWrites: null, isEstimate: true };
  }
  return {
    available: true,
    reason: null,
    multiplier,
    forecastedDailyWrites: baseline * multiplier,
    isEstimate: true,
  };
}
