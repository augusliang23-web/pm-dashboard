import { dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

// UCG-V2-2D: Capacity Outlook + Growth Scenario. Asserts on the rendered Production/UAT
// index.html source (this dashboard's existing convention -- see
// tests/usage-cost-guard-daily-history.test.mjs), since the pure forecast/rolling-window math
// this UI composes is already exhaustively unit-tested in tests/usage-cost-guard.test.mjs and
// tests/usage-cost-guard-view.test.mjs.

const production = await dashboardSourceAsync('production');
const uat = await dashboardSourceAsync('uat');

for (const [label, html] of [['production', production], ['uat', uat]]) {
  test(`${label}: Capacity Outlook section exists between Tracked Daily Writes and Diagnostics, with the required disclosure`, () => {
    const historyIdx = html.indexOf('id="ucgHistoryNote"');
    const capacityIdx = html.indexOf('Capacity Outlook');
    const diagnosticsIdx = html.indexOf('<details class="ucg-diagnostics" id="usageCostGuardDiagnostics">');
    assert.ok(historyIdx !== -1 && capacityIdx !== -1 && diagnosticsIdx !== -1, 'expected all three anchors to exist');
    assert.ok(historyIdx < capacityIdx && capacityIdx < diagnosticsIdx, 'Capacity Outlook must sit between Tracked Daily Writes and Diagnostics');
    assert.match(html, /Forecast \/ planning aid · not an authoritative Firestore project capacity figure/);
  });

  test(`${label}: growth scenario selector offers exactly 1x/2x/5x/10x, defaulting to 1x Current`, () => {
    assert.match(
      html,
      /<select class="session-range-select" id="ucgCapacityScenarioMultiplier"[^>]*>\s*<option value="1" selected>1× Current<\/option>\s*<option value="2">2×<\/option>\s*<option value="5">5×<\/option>\s*<option value="10">10×<\/option>/,
    );
  });

  test(`${label}: renderCapacityOutlook reuses ucgTrackedDailyWritesRows -- no second Firestore query or aggregation pipeline`, () => {
    assert.match(html, /function renderCapacityOutlook\(\)/);
    assert.match(html, /buildCapacityOutlookViewModel\(ucgTrackedDailyWritesRows\.rows, \{ multiplier, windowDays: 30, now: Date\.now\(\) \}\)/);
    // Import comes from the same approved view-model module as the other UCG view models.
    assert.match(html, /import \{ buildUsageCostGuardOverview, buildTrackedDailyHistoryWindow, buildCapacityOutlookViewModel \} from "\.\/js\/usage-cost-guard-view\.mjs";/);
  });

  test(`${label}: renderCapacityOutlook is invoked whenever tracked daily writes are refreshed`, () => {
    assert.match(
      html,
      /ucgTrackedDailyWritesRows = buildObservedPresenceWriteRows\(presenceDocs\);\s*\n\s*renderTrackedDailyWritesHistory\(\);\s*\n\s*renderCapacityOutlook\(\);/,
    );
  });

  test(`${label}: unavailable/no-data states render "Unavailable", never a fabricated 0`, () => {
    const block = html.slice(html.indexOf('function renderCapacityOutlook()'), html.indexOf('window.renderCapacityOutlook'));
    assert.ok(block.length > 0, 'renderCapacityOutlook body not found');
    assert.match(block, /Unavailable/);
    assert.doesNotMatch(block, /usage-card-value">0</);
  });

  test(`${label}: Capacity Outlook never derives a SAFE/WATCH/HIGH/LIMIT status pill`, () => {
    const block = html.slice(html.indexOf('function renderCapacityOutlook()'), html.indexOf('window.renderCapacityOutlook'));
    for (const forbidden of ['% LEFT', 'status-safe', 'status-watch', 'status-high', 'status-limit', 'ucgStatusPillHtml']) {
      assert.ok(!block.includes(forbidden), `unexpected "${forbidden}" in Capacity Outlook render block`);
    }
    // The reference figure and disclosure note explicitly NEGATE quota-remaining semantics
    // ("not a quota-remaining calculation", "not ... quota remaining") -- that's the required
    // disclosure, not a violation, so this only checks no *affirmative* remaining/% figure exists.
    assert.doesNotMatch(block, /Remaining: <span/);
  });

  test(`${label}: the reference figure is labeled reference-only, and the note discloses the linear-projection/partial-coverage caveats`, () => {
    const block = html.slice(html.indexOf('function renderCapacityOutlook()'), html.indexOf('window.renderCapacityOutlook'));
    assert.match(block, /reference only, not a quota-remaining calculation/);
    assert.match(block, /linear projection/);
    assert.match(block, /not a prediction/);
    assert.match(block, /not project-wide current usage, quota remaining, or guaranteed free headroom/);
  });
}
