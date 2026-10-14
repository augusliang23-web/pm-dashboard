// Presentation-only renderers for the Delivery Trends page (contract "delivery-trends/v1").
// Every number shown here comes from the shared metrics contract; this module never computes a metric.
// Missing / non-numeric values render as "N/A" and are never coerced to 0.

export const DELIVERY_TRENDS_CONTRACT_VERSION = 'delivery-trends/v1';
export const NA = 'N/A';
const NO_COMPARABLE = 'No comparable projects';
const STATUS_TONES = new Set(['green', 'yellow', 'red']);
const STATUS_LABELS = { green: 'On Track', yellow: 'At Risk', red: 'Critical' };
const SPARK_WEEKS = 6;

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

// Strict numeric check: null, undefined, '', '3', NaN and Infinity are all "missing".
export function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function round1(value) {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatPp(value) {
  if (!isNum(value)) return NA;
  const rounded = round1(value);
  return `${rounded > 0 ? '+' : ''}${rounded}pp`;
}

export function formatPct(value) {
  return isNum(value) ? `${round1(value)}%` : NA;
}

export function formatCount(value) {
  return isNum(value) ? String(Math.trunc(value)) : NA;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clampWidth(value) {
  return isNum(value) ? Math.min(100, Math.max(0, value)) : 0;
}

export function statusTone(status) {
  const tone = String(status ?? '').toLowerCase();
  return STATUS_TONES.has(tone) ? tone : 'neutral';
}

function comparableDetail(count) {
  if (!isNum(count)) return 'Comparison basis unavailable';
  if (count === 0) return NO_COMPARABLE;
  return `${count} comparable ${count === 1 ? 'project' : 'projects'}`;
}

export function isSyntheticContract(contract) {
  return obj(obj(contract).provenance).source === 'synthetic';
}

// Display label for a reporting week. Identifiers (weekId, ISO period) stay untouched; only the visible text changes.
// Uses the engine's verified reportingPeriod when present, else parses a canonical "YYYY-Www" label. No date ranges are
// guessed: anything else is shown as given.
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
const GENERIC_WARNING = 'Some data-quality notes apply to this view.';

function warningInfo(warning) {
  if (typeof warning === 'string') return { code: '', text: warning };
  const entry = obj(warning);
  const code = String(entry.code ?? '').trim() || String(entry.message ?? '').trim().replaceAll(' ', '-');
  const text = WARNING_MESSAGES[code] || GENERIC_WARNING;
  return { code, text };
}


// The engine emits one warning per affected week. Show each distinct condition once in plain language with its
// occurrence count; the diagnostic code stays available on the element for developers.
export function groupWarnings(warnings) {
  const groups = new Map();
  list(warnings).forEach(raw => {
    const { code, text } = warningInfo(raw);
    if (!text) return;
    const key = code || text;
    const group = groups.get(key) || { code, text, count: 0 };
    group.count += 1;
    groups.set(key, group);
  });
  return [...groups.values()].map(group => ({ ...group, display: group.count > 1 ? `${group.text} (${group.count} weeks)` : group.text }));
}

function toneClass(tone) {
  return `dt-tone-${statusTone(tone)}`;
}

export function renderDeliverySummaryCards(contract) {
  const summary = obj(obj(contract).summary);
  const health = obj(summary.health);
  const comparable = summary.comparableCount;
  const gain = summary.weeklyProgressGainPp;
  const gainTone = !isNum(gain) ? 'neutral' : gain > 0 ? 'green' : gain < 0 ? 'red' : 'neutral';
  const healthRows = [['green', 'On Track'], ['yellow', 'At Risk'], ['red', 'Critical'], ['unknown', 'Unknown']];
  const healthKnown = healthRows.some(([key]) => isNum(health[key]));
  const healthMarkup = healthKnown
    ? healthRows.map(([key, label]) => `<span class="dt-health-item"><i class="dt-dot ${toneClass(key)}"></i>${escapeHtml(label)} <b>${escapeHtml(formatCount(health[key]))}</b></span>`).join('')
    : `<span class="dt-card-value">${NA}</span>`;
  return `<section class="dt-cards" data-dt-section="summary" aria-label="Portfolio summary">
    <article class="dt-card"><div class="dt-card-label">Weekly Progress Gain</div><div class="dt-card-value ${toneClass(gainTone)}">${escapeHtml(formatPp(gain))}</div><div class="dt-card-detail">${escapeHtml(comparableDetail(comparable))}</div></article>
    <article class="dt-card"><div class="dt-card-label">Projects Progressed</div><div class="dt-card-value">${escapeHtml(formatCount(summary.projectsProgressedCount))}</div><div class="dt-card-detail">${isNum(comparable) && comparable > 0 ? `of ${escapeHtml(comparable)} comparable` : escapeHtml(comparableDetail(comparable))}</div></article>
    <article class="dt-card"><div class="dt-card-label">Current Completion</div><div class="dt-card-value">${escapeHtml(formatPct(summary.currentCompletionPct))}</div><div class="dt-card-detail">Portfolio, latest observation</div></article>
    <article class="dt-card"><div class="dt-card-label">Project Health</div><div class="dt-health">${healthMarkup}</div></article>
  </section>`;
}

function trendPoints(trend, weeks = SPARK_WEEKS) {
  return list(trend).slice(-weeks).map(point => {
    if (isNum(point)) return { label: '', value: point };
    const entry = obj(point);
    return { label: formatWeekLabel(entry), value: isNum(entry.progressPct) ? entry.progressPct : null };
  });
}

// Sparkline scaled to each project's own range; null observations break the line (gaps are never zero).
export function renderDeliverySparkline(trend, { width = 120, height = 32, name = '', weeks = SPARK_WEEKS } = {}) {
  const points = trendPoints(trend, weeks);
  const observed = points.filter(point => point.value !== null);
  const aria = escapeHtml(`${name ? `${name} ` : ''}progress trend`);
  if (!observed.length) {
    return `<svg class="dt-spark dt-spark-empty" viewBox="0 0 ${width} ${height}" role="img" aria-label="${aria}: no data"><text x="${width / 2}" y="${height / 2 + 3}" text-anchor="middle">${NA}</text></svg>`;
  }
  const pad = 3;
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  // Scaled to this project's own range (min span 5pp) so small weekly movements stay readable.
  const low = Math.min(...observed.map(point => point.value));
  const range = Math.max(5, Math.max(...observed.map(point => point.value)) - low);
  const coords = points.map((point, index) => ({
    x: points.length > 1 ? pad + index * step : width / 2,
    y: point.value === null ? null : height - pad - ((point.value - low) / range) * (height - pad * 2),
    point
  }));
  let path = '';
  let pen = false;
  coords.forEach(({ x, y }) => {
    if (y === null) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    pen = true;
  });
  const dots = coords.filter(item => item.y !== null).map(({ x, y, point }, index, all) => {
    const last = index === all.length - 1;
    return `<circle class="dt-spark-dot${last ? ' last' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${last ? 2.6 : 1.8}"><title>${escapeHtml(`${point.label ? `${point.label}: ` : ''}${formatPct(point.value)}`)}</title></circle>`;
  }).join('');
  const gaps = coords.filter(item => item.y === null).map(({ x }) => `<line class="dt-spark-gap" x1="${x.toFixed(1)}" y1="${pad}" x2="${x.toFixed(1)}" y2="${height - pad}"></line>`).join('');
  return `<svg class="dt-spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="${aria}">${gaps}<path class="dt-spark-line" d="${path.trim()}"></path>${dots}</svg>`;
}

function changeCell(value) {
  if (!isNum(value)) return `<span class="dt-change dt-tone-neutral">${NA}</span>`;
  const tone = value > 0 ? 'green' : value < 0 ? 'red' : 'neutral';
  const arrow = value > 0 ? '▲ ' : value < 0 ? '▼ ' : '';
  return `<span class="dt-change ${toneClass(tone)}">${arrow}${escapeHtml(formatPp(value))}</span>`;
}

function statusBadgeMarkup(status) {
  const tone = statusTone(status);
  return `<span class="dt-badge ${toneClass(tone)}"><i class="dt-dot ${toneClass(tone)}" aria-hidden="true"></i>${escapeHtml(STATUS_LABELS[tone] || 'Not set')}</span>`;
}

// The current project list is limited to projects the metrics engine marks as members of the anchor week's
// authorized scope (projects[].isInAnchorScope === true). The flag is never inferred: when the contract does not
// carry it, the listing fails closed instead of showing every historical project.
export function selectCurrentScopeProjects(contract) {
  const projects = list(obj(contract).projects);
  const flagged = projects.some(project => typeof obj(project).isInAnchorScope === 'boolean');
  if (projects.length && !flagged) return { projects: [], scopeUnavailable: true };
  return { projects: projects.filter(project => obj(project).isInAnchorScope === true), scopeUnavailable: false };
}

export function renderDeliveryProjectRows(contract, { sparkWeeks = SPARK_WEEKS } = {}) {
  const { projects, scopeUnavailable } = selectCurrentScopeProjects(contract);
  if (scopeUnavailable) {
    return `<section class="dt-panel" data-dt-section="projects"><div class="dt-panel-head"><div class="dt-eyebrow">Individual Project Trends</div></div><div class="dt-empty" role="status">The current project list is unavailable because scope membership data (isInAnchorScope) is not provided yet.</div></section>`;
  }
  if (!projects.length) {
    return `<section class="dt-panel" data-dt-section="projects"><div class="dt-panel-head"><div class="dt-eyebrow">Individual Project Trends</div></div><div class="dt-empty">No projects are available for this reporting week.</div></section>`;
  }
  const rows = projects.map(raw => {
    const project = obj(raw);
    const name = String(project.name ?? project.code ?? project.projectId ?? 'Unnamed project');
    const manager = String(project.projectManager ?? '').trim();
    const tone = statusTone(project.status);
    const completion = project.currentCompletionPct;
    const note = project.comparable === false ? `<div class="dt-row-note">Not comparable this week</div>` : '';
    return `<article class="dt-row" data-project="${escapeHtml(project.projectId ?? project.code ?? '')}">
      <div class="dt-row-id"><div class="dt-row-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div><div class="dt-row-pm">Project Manager: <span>${escapeHtml(manager || NA)}</span></div></div>
      <div class="dt-row-progress"><div class="dt-row-pct">${escapeHtml(formatPct(completion))}</div><div class="dt-track" role="img" aria-label="${escapeHtml(`${name} completion ${formatPct(completion)}`)}"><div class="dt-fill" style="width:${clampWidth(completion)}%"></div></div></div>
      <div class="dt-row-spark">${renderDeliverySparkline(project.trend, { name, weeks: sparkWeeks })}</div>
      <div class="dt-row-change"><div class="dt-mini-label">Weekly change</div>${changeCell(project.weeklyChangePp)}${note}</div>
      <div class="dt-row-status">${statusBadgeMarkup(project.status)}</div>
    </article>`;
  }).join('');
  return `<section class="dt-panel" data-dt-section="projects"><div class="dt-panel-head"><div><div class="dt-eyebrow">Individual Project Trends</div><div class="dt-title">Progress by project</div></div><div class="dt-note">${projects.length} ${projects.length === 1 ? 'project' : 'projects'} · last ${sparkWeeks} weeks</div></div><div class="dt-rows">${rows}</div></section>`;
}

export function renderDeliveryProgressTrend(contract, { maxWeeks = 12 } = {}) {
  const series = list(obj(contract).weeklySeries).slice(-maxWeeks).map(entry => {
    const item = obj(entry);
    return {
      label: formatWeekLabel(item),
      value: isNum(item.gainPp) ? item.gainPp : null,
      comparable: isNum(item.comparableCount) ? item.comparableCount : null
    };
  });
  const head = `<div class="dt-panel-head"><div><div class="dt-eyebrow">Weekly Progress Trend</div><div class="dt-title">Weekly progress gain (pp)</div></div><div class="dt-note">Gaps = no comparable data</div></div>`;
  const observed = series.filter(point => point.value !== null);
  if (!observed.length) {
    return `<section class="dt-panel" data-dt-section="trend">${head}<div class="dt-empty">${series.length ? NO_COMPARABLE : 'No weekly trend data is available.'}</div></section>`;
  }
  const width = 720;
  const height = 190;
  const left = 36;
  const right = 14;
  const top = 18;
  const bottom = 46;
  const maxValue = Math.max(0, ...observed.map(point => point.value));
  const minValue = Math.min(0, ...observed.map(point => point.value));
  const span = Math.max(1, maxValue - minValue);
  const plotH = height - top - bottom;
  const yOf = value => top + ((maxValue - value) / span) * plotH;
  const xOf = index => (series.length === 1 ? (left + width - right) / 2 : left + (index / (series.length - 1)) * (width - left - right));
  let path = '';
  let pen = false;
  series.forEach((point, index) => {
    if (point.value === null) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${xOf(index).toFixed(1)},${yOf(point.value).toFixed(1)} `;
    pen = true;
  });
  const marks = series.map((point, index) => {
    const x = xOf(index).toFixed(1);
    const labels = `<text class="dt-axis-label" x="${x}" y="${height - 26}" text-anchor="middle">${escapeHtml(point.label)}</text><text class="dt-axis-sub" x="${x}" y="${height - 13}" text-anchor="middle">${point.value === null ? NA : point.comparable === null ? '' : `n=${escapeHtml(point.comparable)}`}</text>`;
    if (point.value === null) {
      return `<g class="dt-gap"><line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotH}"><title>${escapeHtml(`${point.label}: ${NA}`)}</title></line>${labels}</g>`;
    }
    const y = yOf(point.value).toFixed(1);
    const text = `${point.label}: ${formatPp(point.value)}${point.comparable === null ? '' : ` (n=${point.comparable})`}`;
    return `<g><circle class="dt-dot-point" cx="${x}" cy="${y}" r="4"><title>${escapeHtml(text)}</title></circle><text class="dt-value-label" x="${x}" y="${(Number(y) - 9).toFixed(1)}" text-anchor="middle">${escapeHtml(formatPp(point.value))}</text>${labels}</g>`;
  }).join('');
  const zeroY = yOf(0).toFixed(1);
  return `<section class="dt-panel" data-dt-section="trend">${head}<div class="dt-trend-scroll"><svg class="dt-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly progress gain trend"><line class="dt-zero" x1="${left}" y1="${zeroY}" x2="${width - right}" y2="${zeroY}"></line><text class="dt-axis-sub" x="${left - 6}" y="${(Number(zeroY) + 3).toFixed(1)}" text-anchor="end">0</text><path class="dt-trend-line" d="${path.trim()}"></path>${marks}</svg></div></section>`;
}

const CHANGE_GROUPS = [
  ['firstObserved', 'First observed', 'Newly present in the data; no earlier week to compare.'],
  ['confirmedCompleted', 'Confirmed completed', 'Explicitly recorded as completed.'],
  ['missingObservation', 'Missing observations', 'Absent this week; not treated as completed.'],
  ['ambiguousIdentity', 'Non-comparable / ambiguous', 'Identity could not be matched across weeks.']
];

function changeItemLabel(item) {
  if (typeof item === 'string') return item;
  const entry = obj(item);
  return String(entry.name ?? entry.code ?? entry.projectId ?? 'Unnamed project');
}

export function renderDeliveryPortfolioChanges(contract) {
  const changes = obj(obj(contract).changes);
  const groups = CHANGE_GROUPS.map(([key, title, hint]) => {
    const items = list(changes[key]);
    const body = items.length
      ? `<ul>${items.map(item => `<li>${escapeHtml(changeItemLabel(item))}</li>`).join('')}</ul>`
      : '<div class="dt-none">None</div>';
    return `<div class="dt-change-group" data-change="${key}"><div class="dt-change-head"><span>${escapeHtml(title)}</span><b>${items.length}</b></div><div class="dt-hint">${escapeHtml(hint)}</div>${body}</div>`;
  }).join('');
  const entered = list(changes.enteredScope);
  const exited = list(changes.exitedScope);
  const scopeLine = entered.length || exited.length
    ? `<div class="dt-scope-line">Scope change · entered: ${escapeHtml(entered.map(changeItemLabel).join(', ') || 'none')} · exited: ${escapeHtml(exited.map(changeItemLabel).join(', ') || 'none')}</div>`
    : '';
  const historicalOnly = list(obj(contract).projects).filter(project => obj(project).isInAnchorScope === false);
  const historicalLine = historicalOnly.length
    ? `<div class="dt-scope-line" data-historical-only>Observed earlier in this window, not in the current scope (${historicalOnly.length}): ${escapeHtml(historicalOnly.map(changeItemLabel).join(', '))}</div>`
    : '';
  return `<section class="dt-panel" data-dt-section="changes"><div class="dt-panel-head"><div><div class="dt-eyebrow">Portfolio Changes</div><div class="dt-title">What changed in the portfolio</div></div></div><div class="dt-change-grid">${groups}</div>${scopeLine}${historicalLine}</section>`;
}

export function renderDeliveryNotices(contract) {
  const data = obj(contract);
  const notices = [];
  if (isSyntheticContract(data)) notices.push(['synthetic', 'Synthetic data for preview only. Not Production data.']);
  // "partial" alone is not enough (the engine also reports partial for unverified baselines): announce incomplete
  // history only when at least one displayed week genuinely has no comparable weekly change.
  if (list(data.weeklySeries).some(entry => !isNum(obj(entry).gainPp))) notices.push(['warning', 'History is incomplete: some weeks could not be compared and are shown as gaps. They are never counted as zero.', 'incomplete-history']);
  groupWarnings(data.warnings).forEach(group => notices.push(['warning', group.display, group.code]));
  if (!notices.length) return '';
  return `<div class="dt-notices" role="status">${notices.map(([kind, text, code]) => `<div class="dt-notice ${kind}"${code ? ` data-warning-code="${escapeHtml(code)}"` : ''}>${escapeHtml(text)}</div>`).join('')}</div>`;
}

function unavailableBox(message, warnings = []) {
  const reasons = groupWarnings(warnings).map(group => group.display);
  return `<div class="dt-empty" role="alert" data-dt-unavailable>${escapeHtml(message)}${reasons.length ? `<ul>${reasons.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>` : ''}</div>`;
}

export function renderDeliveryUnavailable(message = 'Delivery trends data is unavailable.', warnings = []) {
  return `<div class="dt-page">${unavailableBox(message, warnings)}</div>`;
}

export function renderDeliveryWindowToggle(windowWeeks = 6) {
  const button = weeks => `<button type="button" class="${weeks === windowWeeks ? 'active' : ''}" aria-pressed="${weeks === windowWeeks}" data-dt-window="${weeks}" onclick="setDeliveryTrendsWindow(${weeks})">${weeks} weeks</button>`;
  return `<div class="dt-toolbar no-print"><div class="dt-window" role="group" aria-label="History window">${button(6)}${button(12)}</div></div>`;
}

export function renderDeliveryTrendsPage(contract, { windowWeeks } = {}) {
  const data = obj(contract);
  if (data.contractVersion !== DELIVERY_TRENDS_CONTRACT_VERSION) {
    return renderDeliveryUnavailable('Delivery trends data is unavailable or uses an unsupported contract version.');
  }
  if (data.status === 'unavailable') {
    return `<div class="dt-page">${renderDeliveryNotices({ provenance: data.provenance })}${unavailableBox('Delivery trends cannot be calculated for this reporting week.', data.warnings)}</div>`;
  }
  const weeks = isNum(windowWeeks) ? windowWeeks : Math.max(SPARK_WEEKS, list(data.weeklySeries).length);
  return `<div class="dt-page" data-contract="${escapeHtml(data.contractVersion)}">${renderDeliveryNotices(data)}${renderDeliverySummaryCards(data)}${renderDeliveryProjectRows(data, { sparkWeeks: weeks })}${renderDeliveryProgressTrend(data, { maxWeeks: weeks })}${renderDeliveryPortfolioChanges(data)}</div>`;
}

// Isolated stylesheet reusing the dashboard's existing CSS variables. The integration phase adds it to the page.
export const DELIVERY_TRENDS_CSS = `
.dt-page { display:flex; flex-direction:column; gap:16px; }
.dt-toolbar { display:flex; justify-content:flex-end; }
.dt-window { display:flex; gap:3px; padding:3px; background:var(--s3); border-radius:7px; }
.dt-window button { border:0; border-radius:5px; background:transparent; color:var(--text-light); padding:6px 12px; font:700 11px 'Noto Sans TC',sans-serif; cursor:pointer; }
.dt-window button.active { background:var(--s1); color:var(--accent-hov); box-shadow:0 1px 4px rgba(0,0,0,.08); }
.dt-notices { display:flex; flex-direction:column; gap:6px; }
.dt-notice { border:1px solid var(--border); border-radius:8px; padding:8px 12px; font-size:12px; color:var(--text-light); background:var(--s3); }
.dt-notice.synthetic { border-color:var(--yellow); background:var(--ydim); color:#7A6428; font-weight:700; }
.dt-cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.dt-card { background:var(--s1); border:1px solid var(--border); border-radius:10px; padding:14px 16px; min-width:0; box-shadow:var(--shadow); }
.dt-card-label { font-size:10px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:var(--text-light); }
.dt-card-value { margin-top:6px; font-size:26px; font-weight:800; line-height:1.1; color:var(--text); overflow-wrap:anywhere; }
.dt-card-detail { margin-top:6px; font-size:11px; color:var(--muted); }
.dt-health { margin-top:8px; display:grid; grid-template-columns:1fr 1fr; gap:4px 10px; font-size:12px; color:var(--text); }
.dt-health-item { display:flex; align-items:center; gap:5px; min-width:0; }
.dt-dot { width:8px; height:8px; border-radius:50%; flex:none; background:var(--muted2); }
.dt-tone-green { color:#4C8F72; } .dt-tone-yellow { color:#8A6E24; } .dt-tone-red { color:#B25E5E; } .dt-tone-neutral { color:var(--text-light); }
.dt-dot.dt-tone-green { background:var(--green); } .dt-dot.dt-tone-yellow { background:var(--yellow); }
.dt-dot.dt-tone-red { background:var(--red); } .dt-dot.dt-tone-neutral { background:var(--muted2); }
.dt-panel { background:var(--s1); border:1px solid var(--border); border-radius:14px; padding:20px 22px; box-shadow:var(--shadow); min-width:0; }
.dt-panel-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:14px; }
.dt-eyebrow { font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:var(--accent-hov); }
.dt-title { margin-top:2px; font-size:16px; font-weight:800; color:var(--text); }
.dt-note { font-size:11px; color:var(--muted); text-align:right; }
.dt-empty, .dt-none { font-size:12px; color:var(--muted); padding:10px 0; }
.dt-rows { display:flex; flex-direction:column; }
.dt-row { display:grid; grid-template-columns:minmax(0,2.2fr) minmax(0,1.5fr) minmax(0,1.3fr) minmax(0,1fr) 96px; gap:16px; align-items:center; padding:12px 0; border-top:1px solid var(--border); }
.dt-row:first-child { border-top:0; }
.dt-row-name { font-size:14px; font-weight:800; color:var(--text); overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.dt-row-pm { margin-top:2px; font-size:11px; color:var(--text-light); overflow-wrap:anywhere; }
.dt-row-pct { font-size:16px; font-weight:800; color:var(--text); }
.dt-track { margin-top:5px; height:6px; border-radius:4px; background:var(--s3); overflow:hidden; }
.dt-fill { height:100%; border-radius:4px; background:#9DB6CB; }
.dt-spark { width:100%; max-width:140px; height:32px; display:block; overflow:visible; }
.dt-spark text { font-size:9px; fill:var(--muted); }
.dt-spark-line { fill:none; stroke:var(--blue); stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.dt-spark-dot { fill:#fff; stroke:var(--blue); stroke-width:1.5; } .dt-spark-dot.last { fill:var(--blue); }
.dt-spark-gap { stroke:var(--border2); stroke-width:1; stroke-dasharray:2 2; }
.dt-mini-label { font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
.dt-change { font-size:14px; font-weight:800; }
.dt-row-note { font-size:10px; color:var(--muted); }
.dt-badge { display:inline-flex; align-items:center; gap:5px; padding:3px 9px; border-radius:999px; font-size:11px; font-weight:800; white-space:nowrap; background:var(--s3); }
.dt-badge.dt-tone-green { background:var(--gdim); } .dt-badge.dt-tone-yellow { background:var(--ydim); } .dt-badge.dt-tone-red { background:var(--rdim); }
.dt-trend-svg { width:100%; height:auto; max-height:240px; display:block; overflow:visible; }
.dt-trend-scroll { overflow-x:auto; }
.dt-zero { stroke:var(--border2); stroke-dasharray:4 3; }
.dt-trend-line { fill:none; stroke:var(--blue); stroke-width:3; stroke-linecap:round; stroke-linejoin:round; }
.dt-dot-point { fill:#fff; stroke:var(--blue); stroke-width:2.5; }
.dt-gap line { stroke:var(--border2); stroke-dasharray:3 3; }
.dt-axis-label { font-size:10px; fill:var(--text-light); font-weight:700; } .dt-axis-sub { font-size:9px; fill:var(--muted); }
.dt-value-label { font-size:10px; fill:var(--text); font-weight:800; }
.dt-change-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.dt-change-group { border:1px solid var(--border); border-radius:9px; padding:12px; background:var(--s2); min-width:0; }
.dt-change-head { display:flex; justify-content:space-between; gap:8px; font-size:12px; font-weight:800; color:var(--text); }
.dt-hint { margin:3px 0 6px; font-size:10px; color:var(--muted); }
.dt-change-group ul { margin:0; padding-left:16px; font-size:12px; color:var(--text); } .dt-change-group li { overflow-wrap:anywhere; }
.dt-scope-line { margin-top:10px; font-size:11px; color:var(--text-light); overflow-wrap:anywhere; }
@media (max-width:1000px) { .dt-cards, .dt-change-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .dt-row { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } .dt-row-id { grid-column:1 / -1; } }
@media (max-width:560px) { .dt-trend-svg { min-width:560px; } .dt-change-grid { grid-template-columns:1fr; } .dt-cards { gap:8px; } .dt-card { padding:10px 12px; } .dt-card-value { font-size:21px; } .dt-card-label { font-size:9px; } .dt-card-detail { font-size:10px; } .dt-health { grid-template-columns:1fr; gap:2px; font-size:11px; } .dt-row { grid-template-columns:1fr; gap:10px; } .dt-panel { padding:14px; } }
`;
