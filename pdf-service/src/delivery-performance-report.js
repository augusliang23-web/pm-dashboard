// Standalone renderer for the "Portfolio Delivery Performance" Overview PDF section (contract "delivery-trends/v1").
// Presentation only: every figure comes from the shared metrics contract. Missing values render as "N/A", never 0.
import { dataTable, metricCard, reportPage, statusBadge } from './report-components.js';
import { escapeHtml, reportDocument } from './report-html.js';
import { REPORT_CSS } from './report-theme.js';

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

function summaryCards(contract) {
  const summary = obj(contract.summary);
  const health = obj(summary.health);
  const healthKnown = ['green', 'yellow', 'red', 'unknown'].some(key => isNum(health[key]));
  const healthValue = healthKnown ? `${formatCount(health.green)} · ${formatCount(health.yellow)} · ${formatCount(health.red)}` : NA;
  const healthDetail = healthKnown ? `On Track · At Risk · Critical${isNum(health.unknown) && health.unknown > 0 ? ` (+${health.unknown} unknown)` : ''}` : 'Health unavailable';
  const gain = summary.weeklyProgressGainPp;
  const comparable = summary.comparableCount;
  return `<div class="metric-grid dp-metrics">${[
    metricCard('Weekly Progress Gain', formatPp(gain), comparableDetail(comparable), !isNum(gain) ? 'neutral' : gain > 0 ? 'green' : gain < 0 ? 'red' : 'neutral'),
    metricCard('Projects Progressed', formatCount(summary.projectsProgressedCount), isNum(comparable) && comparable > 0 ? `of ${comparable} comparable` : comparableDetail(comparable)),
    metricCard('Current Completion', formatPct(summary.currentCompletionPct), 'Portfolio, latest observation'),
    metricCard('Project Health', healthValue, healthDetail)
  ].join('')}</div>`;
}

function trendChart(contract) {
  const series = list(contract.weeklySeries).slice(-PDF_DISPLAY_WEEKS).map(entry => {
    const item = obj(entry);
    return {
      label: String(item.label ?? item.weekLabel ?? item.weekId ?? ''),
      value: isNum(item.gainPp) ? item.gainPp : null,
      comparable: isNum(item.comparableCount) ? item.comparableCount : null
    };
  });
  const head = '<div class="dp-chart-head"><h3 class="pdf-continuation-label">Weekly Progress Trend</h3><span class="dp-note">Weekly progress gain (pp) · gaps = no comparable data</span></div>';
  const observed = series.filter(point => point.value !== null);
  if (!observed.length) {
    return `<section class="dp-chart card">${head}<div class="empty-state">${series.length ? NO_COMPARABLE : 'No weekly trend data is available.'}</div></section>`;
  }
  const width = 560; const height = 124; const left = 28; const right = 14; const top = 18; const bottom = 36;
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
    const axis = `<text class="dp-axis" x="${x}" y="${height - 21}" text-anchor="middle">${escapeHtml(point.label)}</text><text class="dp-axis-sub" x="${x}" y="${height - 9}" text-anchor="middle">${point.value === null ? NA : point.comparable === null ? '' : `n=${escapeHtml(point.comparable)}`}</text>`;
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

function projectTable(contract) {
  const projects = list(contract.projects);
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
  list(contract.warnings).forEach(warning => {
    const text = typeof warning === 'string' ? warning : String(obj(warning).message ?? obj(warning).text ?? obj(warning).code ?? '');
    if (text) notes.push(text);
  });
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
  if (data.contractVersion !== DELIVERY_TRENDS_CONTRACT_VERSION) {
    return reportPage({
      section: DELIVERY_PERFORMANCE_SECTION_ID, title: 'Portfolio Delivery Performance', kicker: 'Overview report · Delivery performance', period,
      body: '<div class="empty-state">Delivery performance data is unavailable or uses an unsupported contract version.</div>'
    });
  }
  const items = [
    flowItem({ kind: 'delivery-summary', body: `${banner}${summaryCards(data)}<div class="dp-mid">${trendChart(data)}${changeSummary(data)}</div>` }),
    flowItem({ kind: 'delivery-projects', splittable: true, body: `<section class="dp-projects"><h3 class="pdf-continuation-label">Project Progress Summary</h3>${projectTable(data)}${footnotes(data)}</section>` })
  ];
  return reportPage({
    section: DELIVERY_PERFORMANCE_SECTION_ID, title: 'Portfolio Delivery Performance', kicker: 'Overview report · Delivery performance', period,
    measuredFlow: DELIVERY_PERFORMANCE_SECTION_ID, body: `<section class="dp-flow"><div data-pdf-flow-items>${items.join('')}</div></section>`
  });
}

// Stylesheet for this section. The integration phase appends it to REPORT_CSS (report-theme.js).
export const DELIVERY_PERFORMANCE_CSS = `
  .dp-metrics { margin-bottom:3mm; }
  .dp-synthetic { margin-bottom:2mm; padding:1.2mm 3mm; border:1px solid var(--yellow); background:var(--yellow-soft); color:#7a5a14; font-size:8pt; font-weight:700; }
  .dp-mid { display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr); gap:3mm; margin-bottom:3mm; align-items:stretch; }
  .dp-chart-head { display:flex; justify-content:space-between; align-items:baseline; gap:3mm; }
  .dp-chart-head h3, .dp-changes h3, .dp-projects h3 { margin-bottom:1.5mm; }
  .dp-note { color:var(--muted); font-size:7pt; }
  .dp-trend-svg { width:100%; height:27mm; display:block; }
  .dp-line { fill:none; stroke:var(--blue); stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .dp-point { fill:#fff; stroke:var(--blue); stroke-width:1.6; }
  .dp-zero { stroke:var(--line); stroke-dasharray:3 2; }
  .dp-gap { stroke:var(--line); stroke-dasharray:2 2; }
  .dp-axis { font-size:9.5px; fill:var(--ink); font-weight:700; } .dp-axis-sub { font-size:8px; fill:var(--muted); } .dp-value { font-size:9.5px; fill:var(--ink); font-weight:700; }
  .dp-changes .dp-change { display:grid; grid-template-columns:1fr auto; gap:0 2mm; padding:1mm 0; border-bottom:1px solid var(--line); font-size:8pt; }
  .dp-changes .dp-change small { grid-column:1 / -1; color:var(--muted); font-size:7pt; overflow-wrap:anywhere; }
  .dp-table { table-layout:fixed; }
  .dp-table th:nth-child(1) { width:30%; } .dp-table th:nth-child(2) { width:17%; } .dp-table th:nth-child(3) { width:11%; }
  .dp-table th:nth-child(4) { width:14%; } .dp-table th:nth-child(5) { width:13%; } .dp-table th:nth-child(6) { width:15%; }
  .dp-table th, .dp-table td { padding:1.3mm 2mm; }
  .dp-table td { vertical-align:middle; overflow-wrap:anywhere; }
  .dp-name { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .dp-pm { overflow-wrap:anywhere; }
  .dp-spark { width:18mm; height:4.5mm; display:block; }
  .dp-spark-line { fill:none; stroke:var(--blue); stroke-width:1.4; stroke-linecap:round; stroke-linejoin:round; } .dp-spark-dot { fill:var(--blue); }
  .dp-na { color:var(--muted); }
  .dp-footnotes { margin-top:2mm; color:var(--muted); font-size:7pt; line-height:1.4; }
  .positive-value { color:var(--green); font-weight:700; } .negative-value { color:var(--red); font-weight:700; }
`;

// Self-contained document for previews and tests (no host Overview report needed).
export function renderDeliveryPerformanceDocument(contract, { period = '' } = {}) {
  const html = reportDocument({ title: 'Portfolio Delivery Performance', period, reportKind: 'overview', body: renderPortfolioDeliveryPerformancePages(contract, { period }) });
  return html.replace(REPORT_CSS, `${REPORT_CSS}${DELIVERY_PERFORMANCE_CSS}`);
}
