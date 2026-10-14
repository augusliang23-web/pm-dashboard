import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_TRENDS_CSS, renderDeliveryWindowToggle, formatPct, formatPp, renderDeliveryPortfolioChanges, renderDeliveryProgressTrend,
  renderDeliveryProjectRows, renderDeliverySparkline, renderDeliverySummaryCards, renderDeliveryTrendsPage
} from '../js/delivery-trends-view.mjs';
import {
  emptyContract, gapContract, historicalOnlyContract, hostileContract, noScopeFlagContract, unavailableContract, largeContract, longNameContract, missingMetricsContract,
  negativeContract, syntheticContract, zeroGainContract
} from './delivery-trends-synthetic-fixtures.mjs';

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('normal KPI cards render the contract values with units', () => {
  const html = renderDeliverySummaryCards(syntheticContract());
  assert.match(text(html), /Weekly Progress Gain \+2\.5pp 6 comparable projects/);
  assert.match(text(html), /Projects Progressed 5 of 6 comparable/);
  assert.match(text(html), /Current Completion 48\.3%/);
  assert.match(text(html), /On Track 3/);
  assert.match(text(html), /Critical 1/);
});

test('genuine zero progress is shown as 0.0-style zero, not N/A', () => {
  const html = text(renderDeliverySummaryCards(zeroGainContract()));
  assert.match(html, /Weekly Progress Gain 0pp/);
  assert.match(html, /Projects Progressed 0 of 6 comparable/);
  assert.doesNotMatch(html, /N\/A/);
});

test('missing metrics render N/A and never 0, 0% or 0pp', () => {
  const html = text(renderDeliverySummaryCards(missingMetricsContract()));
  assert.match(html, /Weekly Progress Gain N\/A No comparable projects/);
  assert.match(html, /Projects Progressed N\/A No comparable projects/);
  assert.match(html, /Current Completion N\/A/);
  assert.doesNotMatch(html, /0pp|0%/);
  assert.equal(formatPp(null), 'N/A');
  assert.equal(formatPp(undefined), 'N/A');
  assert.equal(formatPp('3'), 'N/A');
  assert.equal(formatPct(NaN), 'N/A');
  assert.equal(formatPct(null), 'N/A');
});

test('no comparable projects is not phrased as "no progress"', () => {
  const page = text(renderDeliveryTrendsPage(missingMetricsContract()));
  assert.match(page, /No comparable projects/);
  assert.doesNotMatch(page, /no progress/i);
  const chart = renderDeliveryProgressTrend(missingMetricsContract());
  assert.match(text(chart), /No comparable projects/);
  assert.doesNotMatch(chart, /<path/);
});

test('project rows show PM label, progress, sparkline, change and status', () => {
  const html = renderDeliveryProjectRows(syntheticContract());
  assert.equal((html.match(/class="dt-row"/g) || []).length, 6);
  assert.match(html, /Project Manager: <span>Synthetic PM 1/);
  assert.doesNotMatch(html, />Owner</);
  assert.match(html, /▲ \+2\.5pp/);
  assert.match(html, /On Track/);
  assert.equal((html.match(/class="dt-spark"/g) || []).length, 6);
});

test('negative recorded progress is shown with a minus sign and a down marker', () => {
  const html = renderDeliveryProjectRows(negativeContract());
  assert.match(html, /▼ -3\.4pp/);
  assert.match(text(renderDeliverySummaryCards(negativeContract())), /-3\.4pp/);
  assert.match(renderDeliveryProgressTrend(negativeContract()), /-3\.4pp/);
});

test('missing weeks create visible gaps in the trend chart and sparkline', () => {
  const contract = gapContract();
  const chart = renderDeliveryProgressTrend(contract);
  assert.equal((chart.match(/class="dt-gap"/g) || []).length, 2);
  assert.equal((chart.match(/M/g) || []).length >= 2, true, 'line is split into separate segments');
  assert.equal((chart.match(/ M\d/g) || []).length, 1);
  assert.match(chart, /W38: N\/A/);
  const spark = renderDeliverySparkline(contract.projects[0].trend);
  assert.equal((spark.match(/dt-spark-gap/g) || []).length, 2);
  assert.equal((spark.match(/ M\d/g) || []).length, 1);
  assert.doesNotMatch(spark, /NaN/);
});

test('sparkline with no observations shows N/A instead of a flat line', () => {
  const spark = renderDeliverySparkline([null, null, null]);
  assert.match(spark, /N\/A/);
  assert.doesNotMatch(spark, /<path/);
});

test('empty portfolio renders safe empty states', () => {
  const page = text(renderDeliveryTrendsPage(emptyContract()));
  assert.match(page, /No projects are available/);
  assert.match(page, /No weekly trend data is available/);
  assert.match(page, /Weekly Progress Gain N\/A/);
});

test('portfolios larger than seven projects render every row', () => {
  const html = renderDeliveryProjectRows(largeContract(14));
  assert.equal((html.match(/class="dt-row"/g) || []).length, 14);
});

test('long project and manager names are escaped, wrapped and title-attributed', () => {
  const html = renderDeliveryProjectRows(longNameContract());
  assert.match(html, /Synthetic Extremely Long/);
  assert.match(DELIVERY_TRENDS_CSS, /\.dt-row-name \{[^}]*overflow-wrap:anywhere/);
  assert.match(DELIVERY_TRENDS_CSS, /\.dt-row-pm \{[^}]*overflow-wrap:anywhere/);
  assert.match(DELIVERY_TRENDS_CSS, /min-width:0/);
  assert.match(html, /title="Synthetic Extremely Long/);
});

test('portfolio changes group first-observed, completed, missing and ambiguous separately', () => {
  const html = renderDeliveryPortfolioChanges(syntheticContract());
  for (const key of ['firstObserved', 'confirmedCompleted', 'missingObservation', 'ambiguousIdentity']) assert.match(html, new RegExp(`data-change="${key}"`));
  assert.match(html, /Synthetic New Project/);
  assert.match(html, /not treated as completed/);
});

test('a disappearing project is never labelled completed', () => {
  const contract = syntheticContract({ changes: { firstObserved: [], confirmedCompleted: [], missingObservation: [{ name: 'Gone Project' }], ambiguousIdentity: [], enteredScope: [], exitedScope: [] } });
  const html = renderDeliveryPortfolioChanges(contract);
  const completed = html.match(/data-change="confirmedCompleted"[\s\S]*?<\/div><\/div>/)[0];
  assert.doesNotMatch(completed, /Gone Project/);
  assert.match(html.match(/data-change="missingObservation"[\s\S]*?<\/ul>/)[0], /Gone Project/);
});

test('synthetic provenance is always disclosed on the page', () => {
  assert.match(renderDeliveryTrendsPage(syntheticContract()), /Synthetic data for preview only/);
  const real = syntheticContract({ provenance: { source: 'firestore', anchorWeekId: 'x', asOf: 'y', windowWeeks: 6 } });
  assert.doesNotMatch(renderDeliveryTrendsPage(real), /Synthetic data/);
});

test('untrusted text is escaped everywhere', () => {
  const html = renderDeliveryTrendsPage(hostileContract());
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('unsupported or missing contracts do not render fake data', () => {
  assert.match(renderDeliveryTrendsPage(null), /unavailable or uses an unsupported contract version/);
  assert.match(renderDeliveryTrendsPage({ contractVersion: 'delivery-trends/v0' }), /unsupported/);
});

test('renderers never emit NaN, undefined or null text', () => {
  for (const contract of [syntheticContract(), missingMetricsContract(), emptyContract(), gapContract(), negativeContract(), zeroGainContract()]) {
    const html = renderDeliveryTrendsPage(contract);
    assert.doesNotMatch(html, /NaN|undefined|>null</);
  }
});

test('current project list uses isInAnchorScope only; historical-only projects move to Portfolio Changes', () => {
  const contract = historicalOnlyContract();
  const rows = renderDeliveryProjectRows(contract);
  assert.equal((rows.match(/class="dt-row"/g) || []).length, 2);
  assert.doesNotMatch(rows, /Synthetic Historical Only/);
  const changes = renderDeliveryPortfolioChanges(contract);
  assert.match(changes, /data-historical-only/);
  assert.match(changes, /Synthetic Historical Only/);
});

test('missing isInAnchorScope fails closed and is never inferred', () => {
  const rows = renderDeliveryProjectRows(noScopeFlagContract());
  assert.match(text(rows), /current project list is unavailable/);
  assert.equal((rows.match(/class="dt-row"/g) || []).length, 0);
  const nullProgress = syntheticContract({ projects: [{ ...syntheticContract().projects[0], isInAnchorScope: undefined, currentCompletionPct: 80 }] });
  assert.match(text(renderDeliveryProjectRows(nullProgress)), /unavailable/);
});

test('an unavailable engine result shows warnings and no metrics', () => {
  const html = renderDeliveryTrendsPage(unavailableContract());
  assert.match(text(html), /cannot be calculated/);
  assert.match(text(html), /Reporting periods are unavailable/);
  assert.doesNotMatch(html, /dt-cards/);
});

test('6-week and 12-week windows control sparkline and trend length', () => {
  const labels = Array.from({ length: 12 }, (_, i) => `W${30 + i}`);
  const contract = syntheticContract({
    weeklySeries: labels.map((label, i) => ({ weekId: label, label, gainPp: i, comparableCount: 6 })),
    projects: [{ ...syntheticContract().projects[0], trend: labels.map((label, i) => ({ weekId: label, label, progressPct: 10 + i })) }]
  });
  const six = renderDeliveryTrendsPage(contract, { windowWeeks: 6 });
  const twelve = renderDeliveryTrendsPage(contract, { windowWeeks: 12 });
  assert.equal((six.match(/class="dt-dot-point"/g) || []).length, 6);
  assert.equal((twelve.match(/class="dt-dot-point"/g) || []).length, 12);
  assert.equal((six.match(/class="dt-spark-dot/g) || []).length, 6);
  assert.equal((twelve.match(/class="dt-spark-dot/g) || []).length, 12);
  assert.match(six, /last 6 weeks/);
  assert.match(twelve, /last 12 weeks/);
});

test('window toggle marks the active window accessibly', () => {
  const html = renderDeliveryWindowToggle(12);
  assert.match(html, /data-dt-window="12" onclick="setDeliveryTrendsWindow\(12\)"/);
  assert.match(html, /class="active" aria-pressed="true" data-dt-window="12"/);
  assert.match(html, /aria-pressed="false" data-dt-window="6"/);
});

test('repeated engine warnings are shown once with an occurrence count', () => {
  const warnings = Array.from({ length: 12 }, (_, i) => ({ code: 'baseline-unverified', message: 'baseline unverified', weekId: `W${i}`, count: 1 }))
    .concat([{ code: 'x', message: 'missing or invalid progress', weekId: 'W3', count: 1 }]);
  const html = renderDeliveryTrendsPage(syntheticContract({ warnings }));
  assert.equal((html.match(/class="dt-notice warning"/g) || []).length, 2);
  assert.match(html, /baseline unverified \(12 weeks\)/);
  assert.match(html, /missing or invalid progress</);
});
