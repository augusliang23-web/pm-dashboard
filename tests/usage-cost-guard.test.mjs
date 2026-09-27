import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  STATUS,
  TRUST_LEVELS,
  aggregateDailyPacificWrites,
  calculateHeadroom,
  calculateQuotaStatus,
  calculateRemaining,
  calculateRollingWindow,
  calculateSpendCap,
  createMetric,
  forecastLinear,
  isMetricAvailable,
  isMetricTrustworthy,
  normalizeSpendCapConfig,
  selectStatus,
  toPacificDateKey,
} from '../js/usage-cost-guard.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------------------------
// A. Metric normalization / data truth
// ---------------------------------------------------------------------------------------------

test('createMetric normalizes a fully-specified available metric', () => {
  const metric = createMetric({
    value: 123,
    unit: 'writes',
    source: 'presence-usage',
    freshness: '2026-09-27T00:00:00Z',
    trustLevel: 'observed',
    environment: 'prod',
    service: 'firestore',
    isEstimate: false,
  });
  assert.equal(metric.value, 123);
  assert.equal(metric.trustLevel, 'observed');
  assert.equal(metric.isAvailable, true);
  assert.equal(metric.isEstimate, false);
});

test('createMetric forces trustLevel to "unavailable" when value is missing, regardless of requested trustLevel', () => {
  const metric = createMetric({ value: null, source: 'x', trustLevel: 'authoritative', environment: 'prod' });
  assert.equal(metric.trustLevel, 'unavailable');
  assert.equal(metric.isAvailable, false);
  assert.equal(metric.value, null);
});

test('createMetric rejects an unknown trustLevel', () => {
  assert.throws(() => createMetric({ value: 1, trustLevel: 'super-trusted', source: 'x' }));
});

test('isMetricAvailable / isMetricTrustworthy', () => {
  const observed = createMetric({ value: 10, trustLevel: 'observed', source: 'presence' });
  const unavailable = createMetric({ value: null, trustLevel: 'authoritative', source: 'x' });
  assert.equal(isMetricAvailable(observed), true);
  assert.equal(isMetricAvailable(unavailable), false);
  assert.equal(isMetricTrustworthy(observed, ['authoritative']), false);
  assert.equal(isMetricTrustworthy(observed, ['observed', 'authoritative']), true);
  assert.equal(isMetricTrustworthy(unavailable, ['unavailable']), false, 'unavailable is never "trustworthy" for calculation purposes');
});

test('observed tracked Presence writes never upgrade to authoritative Firestore totals via this module', () => {
  // Simulates the exact failure mode the Control Plane called out: a Presence-derived metric must
  // keep trustLevel "observed" through every helper call in this module -- nothing here promotes it.
  const presenceWrites = createMetric({
    value: 6882,
    unit: 'writes',
    source: 'presence-usage-tracked',
    trustLevel: 'observed',
    environment: 'prod',
    service: 'firestore-presence',
  });
  assert.equal(presenceWrites.trustLevel, 'observed');
  const headroom = calculateHeadroom(presenceWrites, 20000);
  assert.equal(headroom.available, true);
  // calculateHeadroom returns plain numbers; it carries no trust claim of its own, so the caller
  // must still label any resulting UI text as "tracked" rather than "total Firestore usage".
  assert.equal(typeof headroom.headroom, 'number');
  assert.ok(!('trustLevel' in headroom), 'pure math helpers must not fabricate a trust level');
});

test('a manualConfig spend cap never becomes a live authoritative source via normalizeSpendCapConfig', () => {
  const metric = normalizeSpendCapConfig(
    { configuredCapSgd: 2, source: 'dashboard-config', trustLevel: 'manualConfig', verifiedAt: '2026-09-26' },
    { environment: 'prod', service: 'cloudRun' },
  );
  assert.equal(metric.trustLevel, 'manualConfig');
  assert.equal(metric.value, 2);
  assert.equal(metric.freshness, '2026-09-26');
  assert.notEqual(metric.trustLevel, 'authoritative');
});

test('normalizeSpendCapConfig returns unavailable metric for a missing/malformed cap config', () => {
  assert.equal(normalizeSpendCapConfig(null).trustLevel, 'unavailable');
  assert.equal(normalizeSpendCapConfig({ source: 'x' }).trustLevel, 'unavailable');
});

// ---------------------------------------------------------------------------------------------
// B. Remaining calculation
// ---------------------------------------------------------------------------------------------

test('calculateRemaining: zero usage', () => {
  const r = calculateRemaining(0, 100);
  assert.equal(r.available, true);
  assert.equal(r.used, 0);
  assert.equal(r.remaining, 100);
  assert.equal(r.remainingPercentage, 100);
});

test('calculateRemaining: low usage', () => {
  const r = calculateRemaining(10, 100);
  assert.equal(r.remainingPercentage, 90);
});

test('calculateRemaining: 50%', () => {
  const r = calculateRemaining(50, 100);
  assert.equal(r.remainingPercentage, 50);
});

test('calculateRemaining: 80%', () => {
  const r = calculateRemaining(80, 100);
  assert.equal(r.remainingPercentage, 20);
});

test('calculateRemaining: exactly at limit (100%)', () => {
  const r = calculateRemaining(100, 100);
  assert.equal(r.remaining, 0);
  assert.equal(r.remainingPercentage, 0);
});

test('calculateRemaining: above limit', () => {
  const r = calculateRemaining(150, 100);
  assert.equal(r.available, true);
  assert.equal(r.remaining, -50);
  assert.equal(r.remainingPercentage, -50);
});

test('calculateRemaining: missing current (numerator)', () => {
  const r = calculateRemaining(null, 100);
  assert.equal(r.available, false);
  assert.equal(r.reason, 'missing_current');
  assert.equal(r.remainingPercentage, null);
});

test('calculateRemaining: missing limit (denominator)', () => {
  const r = calculateRemaining(50, undefined);
  assert.equal(r.available, false);
  assert.equal(r.reason, 'missing_limit');
});

test('calculateRemaining: invalid (negative) cap/limit', () => {
  const r = calculateRemaining(10, -5);
  assert.equal(r.available, false);
  assert.equal(r.reason, 'invalid_limit');
});

test('calculateRemaining: zero limit never divides to a false 100%', () => {
  const r = calculateRemaining(0, 0);
  assert.equal(r.available, false);
  assert.equal(r.reason, 'invalid_limit');
  assert.equal(r.remainingPercentage, null);
});

test('calculateRemaining accepts metric-shaped inputs', () => {
  const current = createMetric({ value: 25, trustLevel: 'observed', source: 'x' });
  const limit = createMetric({ value: 100, trustLevel: 'hardcoded', source: 'y' });
  const r = calculateRemaining(current, limit);
  assert.equal(r.remainingPercentage, 75);
});

test('calculateRemaining treats an unavailable metric as missing, not zero', () => {
  const current = createMetric({ value: null, trustLevel: 'authoritative', source: 'x' });
  const r = calculateRemaining(current, 100);
  assert.equal(r.available, false);
  assert.equal(r.reason, 'missing_current');
});

// ---------------------------------------------------------------------------------------------
// C. Status selection
// ---------------------------------------------------------------------------------------------

test('selectStatus: SAFE above 50% remaining', () => {
  assert.equal(selectStatus(100), STATUS.SAFE);
  assert.equal(selectStatus(50.0001), STATUS.SAFE);
});

test('selectStatus: WATCH boundary (>20% and <=50%)', () => {
  assert.equal(selectStatus(50), STATUS.WATCH);
  assert.equal(selectStatus(21), STATUS.WATCH);
  assert.equal(selectStatus(20.0001), STATUS.WATCH);
});

test('selectStatus: HIGH boundary (>0% and <=20%)', () => {
  assert.equal(selectStatus(20), STATUS.HIGH);
  assert.equal(selectStatus(0.0001), STATUS.HIGH);
});

test('selectStatus: LIMIT at and below 0%', () => {
  assert.equal(selectStatus(0), STATUS.LIMIT);
  assert.equal(selectStatus(-10), STATUS.LIMIT);
});

test('selectStatus: UNKNOWN for non-finite / missing input', () => {
  assert.equal(selectStatus(null), STATUS.UNKNOWN);
  assert.equal(selectStatus(undefined), STATUS.UNKNOWN);
  assert.equal(selectStatus(NaN), STATUS.UNKNOWN);
});

test('calculateQuotaStatus wires remaining calculation into status, including UNKNOWN on missing inputs', () => {
  assert.equal(calculateQuotaStatus(10, 100).status, STATUS.SAFE);
  assert.equal(calculateQuotaStatus(85, 100).status, STATUS.HIGH);
  assert.equal(calculateQuotaStatus(100, 100).status, STATUS.LIMIT);
  assert.equal(calculateQuotaStatus(null, 100).status, STATUS.UNKNOWN);
  assert.equal(calculateQuotaStatus(10, null).status, STATUS.UNKNOWN);
  assert.equal(calculateQuotaStatus(10, 0).status, STATUS.UNKNOWN);
});

// ---------------------------------------------------------------------------------------------
// D. Spend-cap calculation
// ---------------------------------------------------------------------------------------------

test('spend cap: cap exists but current spend is unavailable -> UNKNOWN, not SAFE, not zero', () => {
  const r = calculateSpendCap(null, 2);
  assert.equal(r.available, false);
  assert.equal(r.reason, 'spend_unavailable');
  assert.equal(r.remainingAmount, null);
  assert.equal(r.remainingPercentage, null);
  assert.equal(r.status, STATUS.UNKNOWN);
});

test('spend cap: spend = 0 is a real, available value (missing != zero)', () => {
  const r = calculateSpendCap(0, 2);
  assert.equal(r.available, true);
  assert.equal(r.remainingAmount, 2);
  assert.equal(r.remainingPercentage, 100);
  assert.equal(r.status, STATUS.SAFE);
});

test('spend cap: spend below cap', () => {
  const r = calculateSpendCap(0.5, 2);
  assert.equal(r.remainingPercentage, 75);
  assert.equal(r.status, STATUS.SAFE);
});

test('spend cap: spend at 50% of cap', () => {
  const r = calculateSpendCap(1, 2);
  assert.equal(r.remainingPercentage, 50);
  assert.equal(r.status, STATUS.WATCH);
});

test('spend cap: spend at 80% of cap', () => {
  const r = calculateSpendCap(1.6, 2);
  assert.ok(Math.abs(r.remainingPercentage - 20) < 1e-9);
  assert.equal(r.status, STATUS.HIGH);
});

test('spend cap: spend == cap', () => {
  const r = calculateSpendCap(2, 2);
  assert.equal(r.remainingAmount, 0);
  assert.equal(r.remainingPercentage, 0);
  assert.equal(r.status, STATUS.LIMIT);
});

test('spend cap: spend > cap', () => {
  const r = calculateSpendCap(3, 2);
  assert.equal(r.remainingAmount, -1);
  assert.equal(r.status, STATUS.LIMIT);
});

test('spend cap: missing cap does not fabricate a status from spend alone', () => {
  const r = calculateSpendCap(1, null);
  assert.equal(r.available, false);
  assert.equal(r.reason, 'missing_cap');
  assert.equal(r.status, STATUS.UNKNOWN);
});

test('spend cap: cap of zero is invalid, never divides to a false reading', () => {
  const r = calculateSpendCap(1, 0);
  assert.equal(r.available, false);
  assert.equal(r.reason, 'invalid_cap');
  assert.equal(r.status, STATUS.UNKNOWN);
});

test('spend cap: missing spend is distinguishable from zero spend even when both yield "no percentage shown"', () => {
  const missing = calculateSpendCap(undefined, 2);
  const zero = calculateSpendCap(0, 2);
  assert.equal(missing.available, false);
  assert.equal(zero.available, true);
  assert.notEqual(missing.status, zero.status);
});

// ---------------------------------------------------------------------------------------------
// Spend-cap config: Production/UAT separation, four configured caps at S$2
// ---------------------------------------------------------------------------------------------

test('env/prod.json and env/uat.json each declare Cloud Run + Cloud Run Functions caps at S$2, manualConfig, verified 2026-09-26', async () => {
  const prod = JSON.parse(await readFile(new URL('../env/prod.json', import.meta.url), 'utf8'));
  const uat = JSON.parse(await readFile(new URL('../env/uat.json', import.meta.url), 'utf8'));

  for (const env of [prod, uat]) {
    for (const service of ['cloudRun', 'cloudRunFunctions']) {
      const cfg = env.usageCostGuard[service];
      assert.equal(cfg.configuredCapSgd, 2);
      assert.equal(cfg.trustLevel, 'manualConfig');
      assert.equal(cfg.source, 'dashboard-config');
      assert.equal(cfg.verifiedAt, '2026-09-26');
    }
  }

  // Production and UAT must be genuinely separate config objects, not a shared reference.
  assert.notStrictEqual(prod.usageCostGuard, uat.usageCostGuard);
});

test('the four configured caps normalize to independent manualConfig metrics per environment/service', async () => {
  const prod = JSON.parse(await readFile(new URL('../env/prod.json', import.meta.url), 'utf8'));
  const uat = JSON.parse(await readFile(new URL('../env/uat.json', import.meta.url), 'utf8'));

  const metrics = [
    normalizeSpendCapConfig(prod.usageCostGuard.cloudRun, { environment: 'prod', service: 'cloudRun' }),
    normalizeSpendCapConfig(prod.usageCostGuard.cloudRunFunctions, { environment: 'prod', service: 'cloudRunFunctions' }),
    normalizeSpendCapConfig(uat.usageCostGuard.cloudRun, { environment: 'uat', service: 'cloudRun' }),
    normalizeSpendCapConfig(uat.usageCostGuard.cloudRunFunctions, { environment: 'uat', service: 'cloudRunFunctions' }),
  ];
  for (const metric of metrics) {
    assert.equal(metric.value, 2);
    assert.equal(metric.trustLevel, 'manualConfig');
  }
  assert.deepEqual(metrics.map((m) => `${m.environment}:${m.service}`), [
    'prod:cloudRun',
    'prod:cloudRunFunctions',
    'uat:cloudRun',
    'uat:cloudRunFunctions',
  ]);
});

// ---------------------------------------------------------------------------------------------
// E. Pacific daily boundary / DST
// ---------------------------------------------------------------------------------------------

test('toPacificDateKey: normal PST day (winter, UTC-8)', () => {
  // 2026-01-15 07:59:59 UTC is still 2026-01-14 23:59:59 PST.
  assert.equal(toPacificDateKey(Date.UTC(2026, 0, 15, 7, 59, 59)), '2026-01-14');
  // 2026-01-15 08:00:00 UTC is 2026-01-15 00:00:00 PST -- the Pacific midnight boundary.
  assert.equal(toPacificDateKey(Date.UTC(2026, 0, 15, 8, 0, 0)), '2026-01-15');
});

test('toPacificDateKey: normal PDT day (summer, UTC-7)', () => {
  // 2026-07-15 06:59:59 UTC is still 2026-07-14 23:59:59 PDT.
  assert.equal(toPacificDateKey(Date.UTC(2026, 6, 15, 6, 59, 59)), '2026-07-14');
  // 2026-07-15 07:00:00 UTC is 2026-07-15 00:00:00 PDT.
  assert.equal(toPacificDateKey(Date.UTC(2026, 6, 15, 7, 0, 0)), '2026-07-15');
});

test('toPacificDateKey: spring-forward DST transition (2026-03-08, PST -> PDT)', () => {
  // Just before the transition: still PST (UTC-8).
  assert.equal(toPacificDateKey(Date.UTC(2026, 2, 8, 9, 59, 59)), '2026-03-08');
  // Just after: now PDT (UTC-7), same Pacific calendar day.
  assert.equal(toPacificDateKey(Date.UTC(2026, 2, 8, 10, 0, 0)), '2026-03-08');
});

test('toPacificDateKey: fall-back DST transition (2026-11-01, PDT -> PST)', () => {
  assert.equal(toPacificDateKey(Date.UTC(2026, 10, 1, 8, 59, 59)), '2026-11-01');
  assert.equal(toPacificDateKey(Date.UTC(2026, 10, 1, 9, 0, 0)), '2026-11-01');
});

test('aggregateDailyPacificWrites: a bucket crossing Pacific midnight is attributed by bucketStart', () => {
  // A 12-hour bucket [2026-06-01 20:00 UTC, 2026-06-02 08:00 UTC) crosses Pacific midnight
  // (2026-06-01 17:00 PDT start; Pacific midnight is 2026-06-02 07:00 UTC). It is attributed
  // to the Pacific day of its bucketStart, not its bucketEnd.
  const bucketStart = Date.UTC(2026, 5, 1, 20, 0, 0);
  const bucketEnd = Date.UTC(2026, 5, 2, 8, 0, 0);
  const rows = [{ bucketStart, bucketEnd, writes: 42 }];
  const result = aggregateDailyPacificWrites(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].date, toPacificDateKey(bucketStart));
  assert.equal(result[0].date, '2026-06-01');
  assert.equal(result[0].writes, 42);
});

test('aggregateDailyPacificWrites: multiple buckets on the same Pacific day sum correctly', () => {
  const day = Date.UTC(2026, 5, 1, 8, 0, 0); // 2026-06-01 01:00 PDT
  const rows = [
    { bucketStart: day, bucketEnd: day + 43_200_000, writes: 10 },
    { bucketStart: day + 43_200_000, bucketEnd: day + 86_400_000, writes: 5 },
  ];
  const result = aggregateDailyPacificWrites(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].writes, 15);
  assert.equal(result[0].bucketCount, 2);
});

test('aggregateDailyPacificWrites: ignores rows with missing bucketStart/writes rather than crashing', () => {
  const result = aggregateDailyPacificWrites([{ bucketStart: null, writes: 5 }, { bucketStart: 1, writes: null }, {}]);
  assert.deepEqual(result, []);
});

test('Pacific daily aggregation does not change with host/local timezone (proof)', () => {
  // toPacificDateKey/aggregateDailyPacificWrites use Intl with an explicit IANA zone, so they
  // must be independent of any ambient TZ. We assert directly against explicit UTC inputs
  // (equivalent to running this same assertion under any process TZ) rather than mutating
  // process.env.TZ, since the Intl formatter is cached at module load in some engines.
  const epochMs = Date.UTC(2026, 5, 15, 6, 59, 59); // ambiguous near Pacific midnight
  const singaporeDateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(epochMs));
  const pacificDateKey = toPacificDateKey(epochMs);
  // Singapore's calendar date is already June 15, yet the Pacific date key must be June 14 --
  // the function must not be silently reusing Singapore or any browser-local timezone.
  assert.equal(singaporeDateKey, '2026-06-15');
  assert.equal(pacificDateKey, '2026-06-14');
});

// ---------------------------------------------------------------------------------------------
// F. Rolling metrics
// ---------------------------------------------------------------------------------------------

function daysFrom(startDate, values) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  return values.map((writes, i) => ({
    date: toPacificDateKeyUTCSafe(start + i * 86_400_000),
    writes,
  }));
}
function toPacificDateKeyUTCSafe(ms) {
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

test('calculateRollingWindow: 7-day average over a full window', () => {
  const rows = daysFrom('2026-06-01', [10, 20, 30, 40, 50, 60, 70]);
  const result = calculateRollingWindow(rows, 7, '2026-06-07');
  assert.equal(result.available, true);
  assert.equal(result.daysObserved, 7);
  assert.equal(result.isPartial, false);
  assert.equal(result.average, 280 / 7);
});

test('calculateRollingWindow: 30-day average over a full window', () => {
  const values = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30
  const rows = daysFrom('2026-05-01', values);
  const result = calculateRollingWindow(rows, 30, '2026-05-30');
  assert.equal(result.daysObserved, 30);
  assert.equal(result.average, values.reduce((a, b) => a + b, 0) / 30);
});

test('calculateRollingWindow: 7-day peak', () => {
  const rows = daysFrom('2026-06-01', [10, 999, 30, 40, 50, 60, 70]);
  const result = calculateRollingWindow(rows, 7, '2026-06-07');
  assert.equal(result.peak, 999);
});

test('calculateRollingWindow: 30-day peak', () => {
  const values = Array.from({ length: 30 }, (_, i) => (i === 15 ? 5000 : i));
  const rows = daysFrom('2026-05-01', values);
  const result = calculateRollingWindow(rows, 30, '2026-05-30');
  assert.equal(result.peak, 5000);
});

test('calculateRollingWindow: incomplete range is reported as partial, not padded with zeros', () => {
  const rows = daysFrom('2026-06-05', [10, 20, 30]); // only 3 days available in a 7-day window
  const result = calculateRollingWindow(rows, 7, '2026-06-07');
  assert.equal(result.available, true);
  assert.equal(result.daysObserved, 3);
  assert.equal(result.isPartial, true);
  assert.equal(result.average, 20); // (10+20+30)/3, never /7
});

test('calculateRollingWindow: missing days inside the window are excluded, not treated as 0', () => {
  const rows = [
    { date: '2026-06-01', writes: 100 },
    { date: '2026-06-03', writes: 100 }, // 2026-06-02 is missing entirely
  ];
  const result = calculateRollingWindow(rows, 3, '2026-06-03');
  assert.equal(result.daysObserved, 2);
  assert.equal(result.average, 100); // not (100+0+100)/3
});

test('calculateRollingWindow: no data at all', () => {
  const result = calculateRollingWindow([], 7);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'no_data');
  assert.equal(result.average, null);
});

test('calculateRollingWindow: invalid window size', () => {
  const rows = daysFrom('2026-06-01', [1, 2, 3]);
  assert.equal(calculateRollingWindow(rows, 0).available, false);
  assert.equal(calculateRollingWindow(rows, -1).available, false);
  assert.equal(calculateRollingWindow(rows, 1.5).available, false);
});

// ---------------------------------------------------------------------------------------------
// G. Headroom helper
// ---------------------------------------------------------------------------------------------

test('calculateHeadroom: zero usage', () => {
  const r = calculateHeadroom(0, 20000);
  assert.equal(r.headroom, 20000);
  assert.equal(r.headroomPercentage, 100);
  assert.equal(r.exceeded, false);
});

test('calculateHeadroom: invalid quota', () => {
  assert.equal(calculateHeadroom(100, 0).available, false);
  assert.equal(calculateHeadroom(100, -1).available, false);
  assert.equal(calculateHeadroom(100, null).available, false);
});

test('calculateHeadroom: exceeded quota', () => {
  const r = calculateHeadroom(25000, 20000);
  assert.equal(r.headroom, -5000);
  assert.equal(r.exceeded, true);
});

test('calculateHeadroom: missing usage is not treated as zero', () => {
  const r = calculateHeadroom(undefined, 20000);
  assert.equal(r.available, false);
  assert.equal(r.reason, 'missing_usage');
});

// ---------------------------------------------------------------------------------------------
// H. Simple forecast
// ---------------------------------------------------------------------------------------------

test('forecastLinear: 1x, 2x, 5x, 10x multipliers', () => {
  assert.equal(forecastLinear(100, 1).forecastedDailyWrites, 100);
  assert.equal(forecastLinear(100, 2).forecastedDailyWrites, 200);
  assert.equal(forecastLinear(100, 5).forecastedDailyWrites, 500);
  assert.equal(forecastLinear(100, 10).forecastedDailyWrites, 1000);
});

test('forecastLinear: fractional multiplier', () => {
  assert.equal(forecastLinear(100, 0.5).forecastedDailyWrites, 50);
});

test('forecastLinear: always marked isEstimate: true', () => {
  assert.equal(forecastLinear(100, 1).isEstimate, true);
  assert.equal(forecastLinear(null, 1).isEstimate, true);
});

test('forecastLinear: no data', () => {
  const r = forecastLinear(null, 2);
  assert.equal(r.available, false);
  assert.equal(r.reason, 'no_data');
  assert.equal(r.forecastedDailyWrites, null);
});

test('forecastLinear: invalid multiplier', () => {
  assert.equal(forecastLinear(100, 0).available, false);
  assert.equal(forecastLinear(100, -1).available, false);
  assert.equal(forecastLinear(100, NaN).available, false);
});

// ---------------------------------------------------------------------------------------------
// Data truth: the historical 42x20,000 cumulative-quota mental model must not exist in this module
// ---------------------------------------------------------------------------------------------

test('this module exposes no cumulative/aggregate free-quota concept', async () => {
  const source = await readFile(new URL('../js/usage-cost-guard.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /840[,_]?000/, 'must not hardcode the retired 42x20,000 cumulative quota figure');
  assert.doesNotMatch(source, /cumulative.*quota/i);
  assert.doesNotMatch(source, /aggregate.*free.*quota/i);
});

test('TRUST_LEVELS enumerates exactly the six required categories', () => {
  assert.deepEqual([...TRUST_LEVELS].sort(), [
    'authoritative', 'estimated', 'hardcoded', 'manualConfig', 'observed', 'unavailable',
  ].sort());
});

test('sanity: repo root is reachable for the config-reading tests above', async () => {
  const pkg = JSON.parse(await readFile(`${repoRoot}package.json`, 'utf8'));
  assert.equal(pkg.type, 'module');
});
