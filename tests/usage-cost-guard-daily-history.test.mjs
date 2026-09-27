import { dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

// UCG-V2-2C: malformed-counter NaN robustness, Tracked Daily Writes history, and the collapsed
// Diagnostics hierarchy. These assert on the rendered Production/UAT index.html source (this
// dashboard's existing convention -- see tests/modal-backdrop-close.test.mjs) rather than
// executing the DOM, since the pure data-truth math this UI composes is already exhaustively
// unit-tested in tests/usage-cost-guard.test.mjs and tests/usage-cost-guard-view.test.mjs.

const production = await dashboardSourceAsync('production');
const uat = await dashboardSourceAsync('uat');

// ---------------------------------------------------------------------------------------------
// 1. Malformed counterFlushWrites cannot produce NaN/Infinity chart coordinates
// ---------------------------------------------------------------------------------------------

for (const [label, html] of [['production', production], ['uat', uat]]) {
  test(`${label}: renderPresenceUsageChart drops non-finite bucketStart/writes instead of coercing to 0`, () => {
    assert.match(
      html,
      /const points = rows\s*\n\s*\.map\(row => \{\s*\n\s*const bucketStart = Number\(row\.bucketStart\);\s*\n\s*const writes = Number\(row\.counterFlushWrites\);\s*\n\s*if \(!Number\.isFinite\(bucketStart\) \|\| !Number\.isFinite\(writes\) \|\| writes < 0\) return null;/,
    );
    // The old unguarded `Number(row.counterFlushWrites || 0)` coercion (which turns a
    // non-numeric string into NaN, and would have let NaN reach the SVG y/height math) must be
    // gone from the chart's point-building step.
    assert.doesNotMatch(html, /writes: Number\(row\.counterFlushWrites \|\| 0\)/);
  });

  test(`${label}: chart peak/scale math only ever runs over already-filtered finite points`, () => {
    assert.match(html, /const peakWrites = points\.reduce\(\(max, item\) => Math\.max\(max, item\.writes\), 0\);/);
    assert.match(html, /const maxWrites = Math\.max\(1, peakWrites \* 1\.2\);/);
  });
}

// ---------------------------------------------------------------------------------------------
// 2. Tracked Daily Writes: source, 30/60-day control, missing-day-is-a-gap semantics
// ---------------------------------------------------------------------------------------------

for (const [label, html] of [['production', production], ['uat', uat]]) {
  test(`${label}: Tracked Daily Writes section exists with the required label and subtitle`, () => {
    assert.match(html, /Tracked Daily Writes/);
    assert.match(html, /Presence-tracked Firestore writes · approximate day attribution/);
    assert.doesNotMatch(html, /Firestore Daily Usage/);
  });

  test(`${label}: history range control defaults to 30 days and offers up to 60`, () => {
    assert.match(
      html,
      /<select class="session-range-select" id="ucgHistoryRangeDays"[^>]*>\s*<option value="30" selected>Last 30 days<\/option>\s*<option value="60">Available history \(up to 60 days\)<\/option>/,
    );
  });

  test(`${label}: history rows come from the approved foundation pipeline, not a reimplementation`, () => {
    assert.match(
      html,
      /function buildObservedPresenceWriteRows\(presenceDocs\) \{\s*\n\s*const observations = presenceDocs\.flatMap\(\(\{ id, data \}\) =>\s*\n\s*Object\.values\(data\.usageBuckets \|\| \{\}\)\s*\n\s*\.map\(bucket => adaptPresenceBucketToObservedWrite\(bucket, \{ sourceDocumentId: id \}\)\)\s*\n\s*\.filter\(Boolean\)\);\s*\n\s*return aggregateObservedBucketsByPacificStartDate\(observations\);/,
    );
    // UCG-V2-3-R1: the null-vs-0 rule (no valid observations -> unavailable, never a fabricated 0)
    // moved into the approved, unit-tested js/usage-cost-guard-view.mjs
    // deriveTrackedFirestoreWritesTotal -- calculateTrackedFirestoreWrites is now a thin wrapper,
    // not a second implementation of that rule (see tests/usage-cost-guard-view.test.mjs for the
    // behavior-level coverage of deriveTrackedFirestoreWritesTotal itself).
    assert.match(html, /calculateTrackedFirestoreWrites\(presenceDocs\) \{\s*\n\s*return deriveTrackedFirestoreWritesTotal\(buildObservedPresenceWriteRows\(presenceDocs\)\);/);
    assert.match(html, /ucgTrackedDailyWritesRows = buildObservedPresenceWriteRows\(presenceDocs\);/);
  });

  test(`${label}: renderTrackedDailyWritesHistory filters to the window (anchored to now, not the latest row) and never fills missing days as zero`, () => {
    assert.match(html, /function renderTrackedDailyWritesHistory\(\)/);
    // UCG-V2-2C-R1: the window is built by the shared, unit-tested buildTrackedDailyHistoryWindow
    // helper (js/usage-cost-guard-view.mjs), anchored to Date.now() -- never to the latest
    // observed row -- so stale data can never masquerade as "today". The helper's own window-
    // filter behavior (rows.filter, never zero-filling a missing date) is covered by
    // tests/usage-cost-guard-view.test.mjs; this only checks index.html wires it correctly.
    assert.match(
      html,
      /const \{ windowStartDateKey, rows \} = buildTrackedDailyHistoryWindow\(allRows, \{\s*\n\s*days: windowDays,\s*\n\s*now: Date\.now\(\),\s*\n\s*\}\);/,
    );
    assert.doesNotMatch(html, /const anchor = allRows\[allRows\.length - 1\]\.date;/,
      'the window must not anchor to the latest observed row');
    assert.match(html, /missing days are gaps, not zero writes/);
  });

  test(`${label}: history availability failure is surfaced via the shared, unit-tested reason-message helper, never defaulted`, () => {
    assert.match(html, /if \(!ucgTrackedDailyWritesRows\.available\) \{/);
    // UCG-V2-3-R1: the actual reason text (data conflict vs. loading vs. load_failed) now comes
    // from the shared, pure, unit-tested describeTrackedDailyWritesUnavailability helper (see
    // tests/usage-cost-guard-view.test.mjs) rather than being hardcoded per-branch in index.html
    // -- this only checks index.html actually calls it and surfaces the result, never defaulting.
    assert.match(html, /const reason = describeTrackedDailyWritesUnavailability\(ucgTrackedDailyWritesRows\.reason\);/);
    assert.match(html, /Tracked daily writes are unavailable: \$\{escHtml\(reason\)\}/);
  });
}

// ---------------------------------------------------------------------------------------------
// 3. Diagnostics hierarchy: collapsed by default, existing content preserved
// ---------------------------------------------------------------------------------------------

for (const [label, html] of [['production', production], ['uat', uat]]) {
  test(`${label}: Diagnostics is a collapsed-by-default, keyboard-accessible <details>`, () => {
    assert.match(html, /<details class="ucg-diagnostics" id="usageCostGuardDiagnostics">\s*\n\s*<summary>Diagnostics<\/summary>/);
    // No `open` attribute -- collapsed by default.
    assert.doesNotMatch(html, /<details class="ucg-diagnostics" id="usageCostGuardDiagnostics" open>/);
  });

  test(`${label}: existing Presence diagnostic content still lives inside Diagnostics`, () => {
    const diagnosticsMatch = html.match(/<details class="ucg-diagnostics" id="usageCostGuardDiagnostics">([\s\S]*?)<\/details>/);
    assert.ok(diagnosticsMatch, 'Diagnostics <details> block not found');
    const body = diagnosticsMatch[1];
    for (const marker of [
      'id="firestoreHistoricalSummary"',
      'id="presenceUsageSummary"',
      'id="presenceRangeDays"',
      'id="presenceSessionSummary"',
      'id="presenceDailyChart"',
      'id="presenceSessionTable"',
      'id="presenceUsageTable"',
    ]) {
      assert.ok(body.includes(marker), `expected ${marker} inside Diagnostics`);
    }
  });

  test(`${label}: the three first-screen safety cards and Tracked Daily Writes are NOT inside Diagnostics`, () => {
    const diagnosticsMatch = html.match(/<details class="ucg-diagnostics" id="usageCostGuardDiagnostics">([\s\S]*?)<\/details>/);
    const body = diagnosticsMatch[1];
    for (const marker of ['id="usageCostGuardCards"', 'id="ucgHistoryChart"', 'id="usageCostGuardOverall"']) {
      assert.ok(!body.includes(marker), `expected ${marker} to stay outside Diagnostics`);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 4. Data-truth: no quota-derived semantics anywhere in the new sections
// ---------------------------------------------------------------------------------------------

for (const [label, html] of [['production', production], ['uat', uat]]) {
  test(`${label}: Tracked Daily Writes chart never derives quota %/remaining/SAFE-WATCH-HIGH`, () => {
    const historyBlock = html.slice(
      html.indexOf('function renderTrackedDailyWritesHistory()'),
      html.indexOf('window.renderTrackedDailyWritesHistory'),
    );
    assert.ok(historyBlock.length > 0, 'Tracked Daily Writes render block not found');
    for (const forbidden of [
      'FIRESTORE_FREE_WRITES_PER_DAY',
      'quota remaining',
      'quota %',
      '% LEFT',
      'SAFE',
      'WATCH',
      'HIGH',
    ]) {
      assert.ok(!historyBlock.includes(forbidden), `unexpected "${forbidden}" in Tracked Daily Writes block`);
    }
  });

  test(`${label}: first-screen 20,000 writes/day reference is still the only project-wide quota mention`, () => {
    assert.match(html, /Reference: \$\{fmtUsageNumber\(firestore\.referenceQuotaWrites\)\}/);
  });
}
