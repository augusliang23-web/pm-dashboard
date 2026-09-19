import { escapeHtml } from './report-html.js';
import { statusBadge } from './report-components.js';
import { parseIsoDate } from './date-utils.js';

const DAY_MS = 86400000;

function statusPresentation(status) {
  const normalized = String(status || '').toLowerCase();
  const values = {
    green: ['green', 'On Track'], yellow: ['yellow', 'At Risk'], red: ['red', 'Critical'],
    done: ['green', 'Done'], completed: ['green', 'Completed'],
    'in-progress': ['yellow', 'In Progress'], 'at-risk': ['red', 'At Risk'],
    risk: ['red', 'At Risk'], delayed: ['red', 'Delayed'], 'on-track': ['green', 'On Track'],
    planned: ['neutral', 'Planned'], 'to-do': ['neutral', 'To Do'],
    'not-started': ['neutral', 'Not Started']
  };
  return values[normalized] || ['neutral', normalized.replace(/-/g, ' ') || 'Not set'];
}

export function buildGanttRange(workstreams = []) {
  const rows = workstreams.map(item => ({
    ...item,
    start: parseIsoDate(item.startDate),
    end: parseIsoDate(item.endDate)
  }));
  const scheduled = rows.filter(item => item.start && item.end && item.start <= item.end);
  const min = scheduled.length ? new Date(Math.min(...scheduled.map(item => item.start.getTime()))) : null;
  const max = scheduled.length ? new Date(Math.max(...scheduled.map(item => item.end.getTime()))) : null;
  return {
    rows,
    min,
    max,
    span: min && max ? Math.max(1, Math.round((max - min) / DAY_MS) + 1) : 1
  };
}

export function renderGanttAxis({ min, max }) {
  return min && max
    ? `<div class="gantt-axis"><span>${escapeHtml(min.toISOString().slice(0, 10))}</span><span>${escapeHtml(max.toISOString().slice(0, 10))}</span></div>`
    : '';
}

export function renderGanttRow(item, range) {
  const [tone, label] = statusPresentation(item.status);
  if (!item.start || !item.end || item.start > item.end || !range.min) {
    return `<article class="gantt-row keep-together" data-pdf-split-unit><div class="gantt-label"><strong>${escapeHtml(item.name)}</strong><small>Dates not scheduled</small></div><div class="gantt-track unscheduled">${statusBadge('neutral', 'Unscheduled')}</div></article>`;
  }
  const left = Math.max(0, ((item.start - range.min) / DAY_MS / range.span) * 100);
  const width = Math.max(1.5, (((item.end - item.start) / DAY_MS + 1) / range.span) * 100);
  return `<article class="gantt-row keep-together" data-pdf-split-unit><div class="gantt-label"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.startDate)} &ndash; ${escapeHtml(item.endDate)}</small></div><div class="gantt-track"><div class="gantt-bar ${tone}" style="left:${left.toFixed(2)}%;width:${Math.min(width, 100 - left).toFixed(2)}%"><span class="gantt-completed" style="width:${item.progress}%"></span><b>${escapeHtml(item.progress)}%</b></div></div><div class="gantt-state">${statusBadge(tone, label)}</div></article>`;
}
