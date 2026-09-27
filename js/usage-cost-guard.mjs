// Usage & Cost Guard V2 -- pure data-truth + calculation layer (UCG-V2-2A).
//
// This module contains ONLY pure functions: metric normalization, remaining/status math,
// spend-cap math, Pacific-timezone daily aggregation, rolling metrics, headroom, and linear
// forecasting. It does not fetch data, read Firestore, call any Cloud API, or render UI.
//
// Data-truth rule enforced throughout: a metric's `trustLevel` and `source` describe how
// trustworthy its *origin* is, and no function in this module is allowed to upgrade that
// trust level. Observed Presence writes stay `observed` (never become `authoritative`
// Firestore project totals); a `manualConfig` spend cap stays `manualConfig` (never becomes
// a live Google Cloud read). Missing/unavailable inputs must surface as UNKNOWN or
// `unavailable`, never silently coerced to 0 or to a false "fully safe" reading.

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
 * Returns the Pacific calendar date ("YYYY-MM-DD") for a given epoch-ms timestamp, using
 * Intl's IANA tz database (so PST/PDT and DST transitions are handled correctly) rather than a
 * fixed UTC offset. Independent of the host/browser's local timezone.
 */
export function toPacificDateKey(epochMs) {
  if (!isFiniteNumber(epochMs)) return null;
  // en-CA formats as YYYY-MM-DD directly.
  return pacificDateFormatter().format(new Date(epochMs));
}

/**
 * Aggregates 12-hour presence write buckets (each { bucketStart, bucketEnd, writes }, epoch ms)
 * into tracked-writes-per-Pacific-day. A bucket is attributed to the Pacific day of its
 * bucketStart. Output is sorted ascending by date and only includes days with at least one
 * bucket. This produces "tracked daily writes", never a claim of total Firestore usage.
 */
export function aggregateDailyPacificWrites(rows = []) {
  const byDate = new Map();
  for (const row of rows) {
    const bucketStart = row?.bucketStart;
    const writes = row?.writes;
    if (!isFiniteNumber(bucketStart) || !isFiniteNumber(writes)) continue;
    const dateKey = toPacificDateKey(bucketStart);
    if (!dateKey) continue;
    const existing = byDate.get(dateKey) || { date: dateKey, writes: 0, bucketCount: 0 };
    existing.writes += writes;
    existing.bucketCount += 1;
    byDate.set(dateKey, existing);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------------------------
// F. Rolling metrics
// ---------------------------------------------------------------------------------------------

/**
 * dailyRows: array of { date: "YYYY-MM-DD", writes: number }, ascending or unordered.
 * windowDays: e.g. 7 or 30.
 * `asOfDate` (optional "YYYY-MM-DD") anchors the window; defaults to the latest date present.
 *
 * Missing days inside the window are NOT silently treated as 0 -- the function reports how
 * many of the windowDays actually have observed data (`daysObserved`) alongside the average
 * computed strictly over the rows that exist, so callers can see incompleteness rather than
 * have it hidden inside an average that assumes zero-usage gaps.
 */
export function calculateRollingWindow(dailyRows = [], windowDays, asOfDate = null) {
  if (!Number.isInteger(windowDays) || windowDays <= 0) {
    return { available: false, reason: "invalid_window", daysObserved: 0, average: null, peak: null };
  }
  const sorted = [...dailyRows]
    .filter((row) => row && typeof row.date === "string" && isFiniteNumber(row.writes))
    .sort((a, b) => a.date.localeCompare(b.date));

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
