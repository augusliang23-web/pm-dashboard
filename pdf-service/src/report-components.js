import { escapeHtml } from './report-html.js';

const TONES = new Set(['green', 'yellow', 'red', 'neutral']);

function toneClass(value) {
  const normalized = String(value || '').toLowerCase();
  return TONES.has(normalized) ? normalized : 'neutral';
}

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}

export function statusBadge(status, label = status) {
  return `<span class="status-badge ${toneClass(status)}">${escapeHtml(label)}</span>`;
}

export function progressBar(percent, tone = 'green') {
  const value = clampPercent(percent);
  return `<div class="progress-track" role="img" aria-label="${escapeHtml(`${value}% complete`)}"><div class="progress-fill ${toneClass(tone)}" style="width:${value}%"></div></div>`;
}

export function metricCard(label, value, detail = '', tone = 'neutral') {
  const detailMarkup = String(detail || '').trim()
    ? `<div class="metric-card-detail">${escapeHtml(detail)}</div>`
    : '';
  return `<article class="card metric-card ${toneClass(tone)}"><div class="metric-card-label">${escapeHtml(label)}</div><div class="metric-card-value">${escapeHtml(value)}</div>${detailMarkup}</article>`;
}

export function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function rawTextLines(value) {
  const source = Array.isArray(value)
    ? value.map(item => String(item ?? '')).join('\n')
    : String(value ?? '');
  return source.replace(/\r\n?/g, '\n').split('\n');
}

export function rawTextBlock(value, emptyMessage = '') {
  const source = Array.isArray(value)
    ? value.map(item => String(item ?? '')).join('\n')
    : String(value ?? '');
  if (!source && !source.includes('\n')) return emptyMessage ? emptyState(emptyMessage) : '';
  return `<div class="pdf-raw-text">${rawTextLines(source).map(line => line
    ? `<div class="pdf-raw-text-line" data-pdf-split-unit>${escapeHtml(line)}</div>`
    : '<div class="pdf-raw-text-line pdf-raw-text-blank" data-pdf-split-unit><span aria-hidden="true">&nbsp;</span></div>'
  ).join('')}</div>`;
}

export function dataTable({ headings = [], rows = [], className = '' } = {}) {
  const safeClass = String(className || '').split(/\s+/).filter(Boolean).map(value => value.replace(/[^A-Za-z0-9_-]/g, '')).join(' ');
  return `<table${safeClass ? ` class="${safeClass}"` : ''}><thead><tr>${headings.map(heading => `<th>${escapeHtml(heading)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function reportPage({ section = '', title = '', context = '', kicker = 'Project Dashboard', period = '', body = '', continuation = false, measuredFlow = '' } = {}) {
  const suffix = continuation ? ' · Continued' : '';
  const flowAttribute = measuredFlow ? ` data-measured-flow="${escapeHtml(measuredFlow)}"` : '';
  const contextMarkup = context ? `<div class="report-page-context">${escapeHtml(context)}</div>` : '';
  return `<section class="report-page" data-report-section="${escapeHtml(section)}"${flowAttribute}><header class="report-page-head"><div><div class="report-kicker">${escapeHtml(kicker)}</div><h1 class="report-title">${escapeHtml(title)}${suffix}</h1>${contextMarkup}</div><div class="report-meta">${escapeHtml(period || 'Current reporting period')}</div></header><main class="report-body">${body}</main><footer class="report-footer"><span>LITEON Project Dashboard</span><span>${escapeHtml(period || '')}</span></footer></section>`;
}
