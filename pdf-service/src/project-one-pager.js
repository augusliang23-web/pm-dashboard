import { escapeHtml } from './report-html.js';

const DAY_MS = 86400000;

const STATUS_PRESENTATION = {
  green: ['green', 'On Track'], yellow: ['yellow', 'At Risk'], red: ['red', 'Critical']
};

const LANE_STATUS_PRESENTATION = {
  completed: ['green', 'Completed'], done: ['green', 'Completed'],
  'on-track': ['green', 'On Track'], 'not-started': ['neutral', 'Not Started'],
  'in-progress': ['yellow', 'In Progress'],
  'at-risk': ['red', 'At Risk'], risk: ['red', 'At Risk'], delayed: ['red', 'Delayed']
};

function projectStatusPresentation(status) {
  return STATUS_PRESENTATION[status] || ['neutral', 'Not set'];
}

function laneStatusPresentation(status) {
  return LANE_STATUS_PRESENTATION[String(status || '').toLowerCase()] || ['neutral', String(status || 'Not set')];
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShortDate(date) {
  return date ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '';
}

const HIGHLIGHT_DENSE_THRESHOLD = 4;
const RISK_DENSE_THRESHOLD = 2;
const GANTT_DENSE_THRESHOLD = 8;

/**
 * Renders raw (unstripped) source lines as a bullet list: blank lines are
 * dropped (a bulleted list has no use for an empty bullet), but each
 * remaining line is shown verbatim - a PM-typed leading "-" or "3." is never
 * silently eaten the way lines()/listItemText() would eat it.
 *
 * Past a per-quadrant item count, a "dense" modifier shrinks the font and
 * spacing so more content keeps fitting on the fixed-size quadrant instead
 * of silently clipping - the same protective sizing pattern applies to
 * Highlights, Action Items, Risk & Required Action, and the Gantt summary.
 */
function rawBulletList(rawLines, { tone = '', emptyMessage } = {}) {
  const items = rawLines.map(line => line.trim()).filter(Boolean);
  if (!items.length) return `<p class="one-pager-empty">${escapeHtml(emptyMessage)}</p>`;
  const dense = items.length > HIGHLIGHT_DENSE_THRESHOLD ? ' dense' : '';
  return `<ul class="one-pager-list ${tone}${dense}">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderRiskActions(model) {
  const pairs = model.rawRiskActionPairs.length ? model.rawRiskActionPairs : model.riskActions;
  if (!pairs.length) return '<p class="one-pager-empty">No material risk reported.</p>';
  const dense = pairs.length > RISK_DENSE_THRESHOLD ? ' dense' : '';
  return `<div class="one-pager-risk-stack${dense}">${pairs.map(pair => `<div class="one-pager-risk-pair"><div class="one-pager-risk-block"><div class="one-pager-risk-label">${pair.primary ? 'Primary risk' : 'Risk'}</div><p>${escapeHtml(pair.risk.trim() || 'No material risk reported.')}</p></div><div class="one-pager-required-action"><strong>Required</strong><p>${escapeHtml(pair.action.trim() || 'No required action reported.')}</p></div></div>`).join('')}</div>`;
}

function laneRange(lanes) {
  const dated = lanes
    .map(lane => ({ start: parseIsoDate(lane.start), end: parseIsoDate(lane.end) }))
    .filter(lane => lane.start && lane.end);
  if (!dated.length) return { start: null, end: null, span: 1 };
  const start = new Date(Math.min(...dated.map(item => item.start.getTime())));
  const end = new Date(Math.max(...dated.map(item => item.end.getTime())));
  return { start, end, span: Math.max(1, end.getTime() - start.getTime()) };
}

const AXIS_TICK_COUNT = 6;

/**
 * Evenly-spaced date labels across the lane range, aligned with the gantt
 * track's own 5-band background texture (20% per band -> 6 tick marks).
 */
function laneAxisTicks(range) {
  if (!range.start || !range.end) return [];
  const startMs = range.start.getTime();
  return Array.from({ length: AXIS_TICK_COUNT }, (_, index) => {
    const fraction = index / (AXIS_TICK_COUNT - 1);
    return new Date(startMs + range.span * fraction);
  });
}

function renderSummaryGantt(lanes) {
  if (!lanes.length) return '<p class="one-pager-empty">No schedule data reported.</p>';
  const range = laneRange(lanes);
  const rows = lanes.map(lane => {
    const start = parseIsoDate(lane.start);
    const end = parseIsoDate(lane.end);
    const [tone, label] = laneStatusPresentation(lane.status);
    if (!start || !end || !range.start) {
      return `<div class="one-pager-gantt-row"><div class="one-pager-gantt-name"><strong>${escapeHtml(lane.label)}</strong><small>Dates not scheduled</small></div><div class="one-pager-gantt-track"></div><div class="one-pager-gantt-status neutral">Unscheduled</div></div>`;
    }
    const left = ((start.getTime() - range.start.getTime()) / range.span) * 100;
    const width = Math.max(2, ((end.getTime() - start.getTime()) / range.span) * 100);
    return `<div class="one-pager-gantt-row"><div class="one-pager-gantt-name"><strong>${escapeHtml(lane.label)}</strong><small>${escapeHtml(formatShortDate(start))} – ${escapeHtml(formatShortDate(end))}</small></div><div class="one-pager-gantt-track"><div class="one-pager-gantt-bar ${tone}" style="left:${left.toFixed(2)}%;width:${Math.min(width, 100 - left).toFixed(2)}%"><span style="width:${lane.progress}%"></span><b>${escapeHtml(lane.progress)}%</b></div></div><div class="one-pager-gantt-status ${tone}">${escapeHtml(label)}</div></div>`;
  }).join('');
  const axis = range.start && range.end
    ? `<div class="one-pager-gantt-axis">${laneAxisTicks(range).map(date => `<span>${escapeHtml(formatShortDate(date))}</span>`).join('')}</div>`
    : '';
  const dense = lanes.length > GANTT_DENSE_THRESHOLD ? ' dense' : '';
  return `${axis}<div class="one-pager-gantt-stack${dense}">${rows}</div>`;
}

/**
 * Renders the compact single-page (A4 landscape) project quadrant summary.
 * Designed to always fit on exactly one physical page: content is capped
 * upstream (4-8 summary lanes, primary risk/action only) rather than flowed
 * or measured across pages like the other report sections.
 */
export function renderProjectOnePagerHtml(model, period = model.period || '') {
  const [statusTone, statusLabel] = projectStatusPresentation(model.status);
  const lowConfidenceNote = model.summaryLanesLowConfidence
    ? `<div class="one-pager-low-confidence">${escapeHtml(model.summaryLanesUngroupedCount)} workstream(s) could not be confidently auto-grouped – review Summary Group in the schedule editor.</div>`
    : '';
  const windowNote = model.ganttWindowFilteredCount > 0
    ? `<div class="one-pager-window-note">${escapeHtml(model.ganttWindowFilteredCount)} task(s) outside the ${escapeHtml(model.ganttWindowMonths)}-month display window are not shown – see the full schedule on the Gantt Chart detail page.</div>`
    : '';

  return `<section class="one-pager" data-report-section="one-page-summary"><header class="one-pager-header"><div><div class="one-pager-eyebrow">Single project weekly brief</div><h1>${escapeHtml(model.name)}</h1><div class="one-pager-meta">${escapeHtml(model.code || 'No code')} &nbsp;·&nbsp; ${escapeHtml(period)} &nbsp;·&nbsp; Owner: ${escapeHtml(model.owner || 'Unassigned')}</div></div><div class="one-pager-status"><span class="status-badge ${statusTone}">${escapeHtml(statusLabel)}</span><div class="one-pager-progress">${escapeHtml(model.progress)}%<small>Delivery progress</small></div></div></header>
    <section class="one-pager-grid">
      <article class="one-pager-quadrant green"><div class="one-pager-section-head"><div><div class="one-pager-kicker">Progress made</div><h2>Highlights</h2></div><span class="one-pager-chip">Last week</span></div>${rawBulletList(model.rawHighlightLines, { emptyMessage: 'No highlight reported.' })}</article>
      <article class="one-pager-quadrant blue"><div class="one-pager-section-head"><div><div class="one-pager-kicker">Delivery focus</div><h2>Action Items</h2></div><span class="one-pager-chip">Next week</span></div>${rawBulletList(model.rawActionLines, { tone: 'blue', emptyMessage: 'No action reported.' })}</article>
      <article class="one-pager-quadrant schedule"><div class="one-pager-section-head"><div><div class="one-pager-kicker">Plan and progress</div><h2>Schedule Summary</h2></div></div>${renderSummaryGantt(model.summaryLanes)}${lowConfidenceNote}${windowNote}</article>
      <article class="one-pager-quadrant risk"><div class="one-pager-section-head"><div><div class="one-pager-kicker">Management attention</div><h2>Risk &amp; Required Action</h2></div><span class="one-pager-chip">Action needed</span></div>${renderRiskActions(model)}</article>
    </section>
    <footer class="one-pager-footer"><span>LITEON Project Dashboard</span><span>${escapeHtml(period)}</span></footer>
  </section>`;
}
