// Standalone renderer for the "Portfolio Delivery Performance" Overview PDF section (contract "delivery-trends/v1").
// Presentation only: every figure comes from the shared metrics contract. Missing values render as "N/A", never 0.
import { dataTable, metricCard, reportPage, statusBadge } from './report-components.js';
import { escapeHtml, reportDocument } from './report-html.js';
import { DELIVERY_PERFORMANCE_CSS } from './report-theme.js';

export { DELIVERY_PERFORMANCE_CSS };

export const DELIVERY_PERFORMANCE_SECTION_ID = 'portfolio-delivery-performance';
export const DELIVERY_TRENDS_CONTRACT_VERSION = 'delivery-trends/v1';
export const PDF_DISPLAY_WEEKS = 6;
const NA = 'N/A';
const NO_COMPARABLE = 'No comparable projects';
const STATUS_LABELS = { green: 'On Track', yellow: 'At Risk', red: 'Critical' };

const isNum = value => typeof value === 'number' && Number.isFinite(value);
const list = value => (Array.isArray(value) ? value : []);
const obj = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const round1 = value => { const r = Math.round(value * 10) / 10; return Object.is(r, -0) ? 0 : r; };
const formatPp = value => (isNum(value) ? `${round1(value) > 0 ? '+' : ''}${round1(value)}pp` : NA);
const formatPct = value => (isNum(value) ? `${round1(value)}%` : NA);
const formatCount = value => (isNum(value) ? String(Math.trunc(value)) : NA);
const tone = status => (['green', 'yellow', 'red'].includes(String(status ?? '').toLowerCase()) ? String(status).toLowerCase() : 'neutral');

// Display label for a reporting week; identifiers stay untouched. Mirrors js/delivery-trends-view.mjs (a parity test
// keeps them identical). No date ranges are guessed.
export function formatWeekLabel(entry) {
  const item = obj(entry);
  const period = obj(item.reportingPeriod);
  if (isNum(period.year) && isNum(period.week)) return `W${String(period.week).padStart(2, '0')} ${period.year}`;
  const raw = String(item.label ?? item.weekLabel ?? item.weekId ?? '');
  const match = /^(\d{4})-W(\d{1,2})$/.exec(raw);
  return match ? `W${match[2].padStart(2, '0')} ${match[1]}` : raw;
}

export const WARNING_MESSAGES = Object.freeze({
  'baseline-unverified': 'Some historical progress comparisons have unverified baselines and should be interpreted with caution.',
  'comparison-baseline-unavailable': 'Some weeks have no baseline to compare against, so their weekly change is not shown.',
  'legacy-provisional-match': 'Some projects are matched by project code only (legacy records); treat their history as provisional.',
  'missing-calendar-week': 'One or more calendar weeks have no report and are shown as gaps.',
  'missing-or-invalid-progress': 'Some projects have missing or invalid progress; they are left out of the calculations and never counted as zero.',
  'ambiguous-project-identity': 'Some projects could not be matched reliably across weeks and are excluded from comparisons.',
  'invalid-reporting-week': 'Reporting weeks do not carry verified ISO week periods, so trends cannot be calculated.',
  'ambiguous-week-order': 'The order of reporting weeks is ambiguous, so trends cannot be calculated.',
  'anchor-unavailable': 'The selected reporting week is not available for this view.',
  'invalid-weeks': 'The reporting data could not be validated for this view.',
  'invalid-provenance': 'The reporting data could not be validated for this view.',
  'invalid-window': 'The selected history window is not supported.',
  'invalid-publication-policy': 'The reporting data could not be validated for this view.',
  'invalid-scope': 'The selected project scope is not supported.'
});

function comparableDetail(count) {
  if (!isNum(count)) return 'Comparison basis unavailable';
  if (count === 0) return NO_COMPARABLE;
  return `${count} comparable ${count === 1 ? 'project' : 'projects'}`;
}

function labelOf(item) {
  if (typeof item === 'string') return item;
  const entry = obj(item);
  return String(entry.name ?? entry.code ?? entry.projectId ?? 'Unnamed project');
}

// Health is shown as labelled counts with a shape + text per status (never colour alone).
function healthCard(health, known) {
  const row = (tone, label, mark, value) => `<span class="dp-health-item ${tone}"><i aria-hidden="true">${mark}</i>${label} <b>${escapeHtml(formatCount(value))}</b></span>`;
  const unknown = isNum(health.unknown) && health.unknown > 0 ? row('neutral', 'Unknown', '◇', health.unknown) : '';
  const body = known
    ? `${row('green', 'On Track', '●', health.green)}${row('yellow', 'At Risk', '▲', health.yellow)}${row('red', 'Critical', '■', health.red)}${unknown}`
    : `<span class="metric-card-value">${NA}</span>`;
  return `<article class="card metric-card dp-health"><div class="metric-card-label">Project Health</div><div class="dp-health-list">${body}</div></article>`;
}

function summaryCards(contract) {
  const summary = obj(contract.summary);
  const health = obj(summary.health);
  const healthKnown = ['green', 'yellow', 'red', 'unknown'].some(key => isNum(health[key]));
  const gain = summary.weeklyProgressGainPp;
  const comparable = summary.comparableCount;
  return `<div class="metric-grid dp-metrics">${[
    metricCard('Weekly Progress Gain', formatPp(gain), comparableDetail(comparable), !isNum(gain) ? 'neutral' : gain > 0 ? 'green' : gain < 0 ? 'red' : 'neutral'),
    metricCard('Projects Progressed', formatCount(summary.projectsProgressedCount), isNum(comparable) && comparable > 0 ? `of ${comparable} comparable` : comparableDetail(comparable)),
    metricCard('Current Completion', formatPct(summary.currentCompletionPct), 'Portfolio, latest observation'),
    healthCard(health, healthKnown)
  ].join('')}</div>`;
}

function trendChart(contract) {
  const series = list(contract.weeklySeries).slice(-PDF_DISPLAY_WEEKS).map(entry => {
    const item = obj(entry);
    return {
      label: formatWeekLabel(item),
      value: isNum(item.gainPp) ? item.gainPp : null,
      comparable: isNum(item.comparableCount) ? item.comparableCount : null
    };
  });
  const head = '<div class="dp-chart-head"><h3 class="pdf-continuation-label">Weekly Progress Trend</h3><span class="dp-note">Weekly progress gain (pp) · gaps = no comparable data</span></div>';
  const observed = series.filter(point => point.value !== null);
  if (!observed.length) {
    return `<section class="dp-chart card">${head}<div class="empty-state">${series.length ? NO_COMPARABLE : 'No weekly trend data is available.'}</div></section>`;
  }
  // viewBox is sized to the rendered box (~165mm x 20mm) so text renders at its nominal size instead of being scaled down.
  const width = 640; const height = 82; const left = 28; const right = 16; const top = 16; const bottom = 30;
  const max = Math.max(0, ...observed.map(point => point.value));
  const min = Math.min(0, ...observed.map(point => point.value));
  const span = Math.max(1, max - min);
  const plotH = height - top - bottom;
  const yOf = value => top + ((max - value) / span) * plotH;
  const xOf = index => (series.length === 1 ? (left + width - right) / 2 : left + (index / (series.length - 1)) * (width - left - right));
  let path = ''; let pen = false;
  series.forEach((point, index) => {
    if (point.value === null) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${xOf(index).toFixed(1)},${yOf(point.value).toFixed(1)} `;
    pen = true;
  });
  const marks = series.map((point, index) => {
    const x = xOf(index).toFixed(1);
    const axis = `<text class="dp-axis" x="${x}" y="${height - 17}" text-anchor="middle">${escapeHtml(point.label)}</text><text class="dp-axis-sub" x="${x}" y="${height - 6}" text-anchor="middle">${point.value === null ? NA : point.comparable === null ? '' : `n=${escapeHtml(point.comparable)}`}</text>`;
    if (point.value === null) return `<g><line class="dp-gap" x1="${x}" y1="${top}" x2="${x}" y2="${top + plotH}"></line>${axis}</g>`;
    const y = yOf(point.value);
    return `<g><circle class="dp-point" cx="${x}" cy="${y.toFixed(1)}" r="3"></circle><text class="dp-value" x="${x}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${escapeHtml(formatPp(point.value))}</text>${axis}</g>`;
  }).join('');
  const zero = yOf(0).toFixed(1);
  return `<section class="dp-chart card">${head}<svg class="dp-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly progress gain trend"><line class="dp-zero" x1="${left}" y1="${zero}" x2="${width - right}" y2="${zero}"></line><path class="dp-line" d="${path.trim()}"></path>${marks}</svg></section>`;
}

function changeSummary(contract) {
  const changes = obj(contract.changes);
  const rows = [
    ['firstObserved', 'First observed'],
    ['confirmedCompleted', 'Confirmed completed'],
    ['missingObservation', 'Missing observation'],
    ['ambiguousIdentity', 'Non-comparable / ambiguous']
  ].map(([key, label]) => {
    const items = list(changes[key]);
    const names = items.slice(0, 3).map(labelOf).join(', ');
    return `<div class="dp-change"><span>${escapeHtml(label)}</span><b>${items.length}</b>${names ? `<small>${escapeHtml(names)}${items.length > 3 ? ` +${items.length - 3} more` : ''}</small>` : ''}</div>`;
  }).join('');
  return `<section class="dp-changes card"><h3 class="pdf-continuation-label">Portfolio Changes</h3>${rows}</section>`;
}

function sparkline(trend, name) {
  const points = list(trend).slice(-PDF_DISPLAY_WEEKS).map(point => (isNum(point) ? point : isNum(obj(point).progressPct) ? point.progressPct : null));
  const width = 70; const height = 16; const pad = 2;
  if (!points.some(value => value !== null)) return `<span class="dp-na">${NA}</span>`;
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  // Scaled to this project's own range (min span 5pp) so small weekly movements stay readable.
  const seen = points.filter(value => value !== null);
  const low = Math.min(...seen); const range = Math.max(5, Math.max(...seen) - low);
  let path = ''; let pen = false; let dots = '';
  points.forEach((value, index) => {
    if (value === null) { pen = false; return; }
    const x = points.length > 1 ? pad + index * step : width / 2;
    const y = height - pad - ((value - low) / range) * (height - pad * 2);
    path += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    pen = true;
    if (index === points.length - 1 || points[index + 1] === null) dots += `<circle class="dp-spark-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6"></circle>`;
  });
  return `<svg class="dp-spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${name} progress trend`)}"><path class="dp-spark-line" d="${path.trim()}"></path>${dots}</svg>`;
}

function changeText(value) {
  if (!isNum(value)) return `<span class="dp-na">${NA}</span>`;
  const cls = value > 0 ? 'positive-value' : value < 0 ? 'negative-value' : '';
  return `<span class="${cls}">${value > 0 ? '▲ ' : value < 0 ? '▼ ' : ''}${escapeHtml(formatPp(value))}</span>`;
}

// Current-scope listing mirrors the web view: only projects flagged isInAnchorScope === true are listed, and the
// listing fails closed when the contract does not carry the flag. The flag is never inferred.
function currentScopeProjects(contract) {
  const projects = list(contract.projects);
  const flagged = projects.some(project => typeof obj(project).isInAnchorScope === 'boolean');
  if (projects.length && !flagged) return null;
  return projects.filter(project => obj(project).isInAnchorScope === true);
}

function projectTable(contract) {
  const projects = currentScopeProjects(contract);
  if (projects === null) return '<div class="empty-state">The current project list is unavailable because scope membership data (isInAnchorScope) is not provided yet.</div>';
  if (!projects.length) return '<div class="empty-state">No projects are available for this reporting week.</div>';
  const rows = projects.map(raw => {
    const project = obj(raw);
    const name = String(project.name ?? project.code ?? project.projectId ?? 'Unnamed project');
    return [
      `<strong class="dp-name">${escapeHtml(name)}</strong>${project.comparable === false ? '<br><small>Not comparable this week</small>' : ''}`,
      `<span class="dp-pm">${escapeHtml(String(project.projectManager ?? '').trim() || NA)}</span>`,
      escapeHtml(formatPct(project.currentCompletionPct)),
      sparkline(project.trend, name),
      changeText(project.weeklyChangePp),
      project.status && tone(project.status) !== 'neutral' ? statusBadge(tone(project.status), STATUS_LABELS[tone(project.status)]) : statusBadge('neutral', 'Not set')
    ];
  });
  return dataTable({ headings: ['Project', 'Project Manager', 'Completion', `${PDF_DISPLAY_WEEKS}-week trend`, 'Weekly change', 'Status'], rows, className: 'dp-table' })
    .replace('<tbody><tr>', '<tbody><tr data-pdf-split-unit>')
    .replaceAll('</tr><tr>', '</tr><tr data-pdf-split-unit>');
}

function footnotes(contract) {
  const notes = [
    'N/A means no valid observation exists; it is never shown as zero.',
    'A project that is absent from a week is reported as a missing observation, not as completed.'
  ];
  // One warning is emitted per affected week; list each distinct condition once, in plain language, with its count.
  const groups = new Map();
  list(contract.warnings).forEach(warning => {
    const entry = obj(warning);
    const code = typeof warning === 'string' ? '' : (String(entry.code ?? '').trim() || String(entry.message ?? '').trim().replaceAll(' ', '-'));
    const text = typeof warning === 'string' ? warning : (WARNING_MESSAGES[code] || 'Some data-quality notes apply to this view.');
    const key = code || text;
    const group = groups.get(key) || { text, count: 0 };
    group.count += 1;
    groups.set(key, group);
  });
  [...groups.values()].forEach(group => notes.push(group.count > 1 ? `${group.text} (${group.count} weeks)` : group.text));
  return `<div class="dp-footnotes">${notes.map((note, index) => `<div>${index + 1}. ${escapeHtml(note)}</div>`).join('')}</div>`;
}

function flowItem({ kind, body, splittable = false }) {
  return `<div data-pdf-flow-item data-flow-kind="${kind}" data-page-title="Portfolio Delivery Performance" data-page-kicker="Overview report · Delivery performance" data-page-section="${DELIVERY_PERFORMANCE_SECTION_ID}"${splittable ? ' data-pdf-splittable' : ''}>${body}</div>`;
}

// Returns the report page(s) for this section. `period` is the reporting-week label the host already shows.
export function renderPortfolioDeliveryPerformancePages(contract, { period = '' } = {}) {
  const data = obj(contract);
  const synthetic = obj(data.provenance).source === 'synthetic';
  const banner = synthetic ? '<div class="dp-synthetic">Synthetic data for preview only. Not Production data.</div>' : '';
  if (data.contractVersion !== DELIVERY_TRENDS_CONTRACT_VERSION || data.status === 'unavailable') {
    return reportPage({
      section: DELIVERY_PERFORMANCE_SECTION_ID, title: 'Portfolio Delivery Performance', kicker: 'Overview report · Delivery performance', period,
      body: '<div class="empty-state">Delivery performance data is unavailable for this reporting week or uses an unsupported contract version.</div>'
    });
  }
  const items = [
    flowItem({ kind: 'delivery-summary', body: `${banner}${summaryCards(data)}<div class="dp-mid">${trendChart(data)}${changeSummary(data)}</div>` }),
    flowItem({ kind: 'delivery-projects', splittable: true, body: `<section class="dp-projects"><h3 class="pdf-continuation-label">Project Progress Summary</h3>${projectTable(data)}</section>` }),
    // Footnotes are their own flow item so a continued table does not repeat them on every fragment.
    flowItem({ kind: 'delivery-footnotes', body: footnotes(data) })
  ];
  return reportPage({
    section: DELIVERY_PERFORMANCE_SECTION_ID, title: 'Portfolio Delivery Performance', kicker: 'Overview report · Delivery performance', period,
    measuredFlow: DELIVERY_PERFORMANCE_SECTION_ID, body: `<section class="dp-flow"><div data-pdf-flow-items>${items.join('')}</div></section>`
  });
}

// Self-contained document for previews and tests (no host Overview report needed).
export function renderDeliveryPerformanceDocument(contract, { period = '' } = {}) {
  const html = reportDocument({ title: 'Portfolio Delivery Performance', period, reportKind: 'overview', body: renderPortfolioDeliveryPerformancePages(contract, { period }) });
  return html;
}
