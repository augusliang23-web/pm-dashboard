import { escapeHtml, reportDocument } from './report-html.js';
import {
  dataTable,
  emptyState,
  metricCard,
  progressBar,
  reportPage,
  statusBadge
} from './report-components.js';
import { buildProjectReportModel } from './report-model.js';
import { buildGanttRange, renderGanttAxis, renderGanttRow } from './project-visuals.js';

function statusPresentation(status) {
  const normalized = String(status || '').toLowerCase();
  const values = {
    green: ['green', 'On Track'],
    yellow: ['yellow', 'At Risk'],
    red: ['red', 'Critical'],
    done: ['green', 'Done'],
    completed: ['green', 'Completed'],
    'in-progress': ['yellow', 'In Progress'],
    'at-risk': ['red', 'At Risk'],
    risk: ['red', 'At Risk'],
    delayed: ['red', 'Delayed'],
    'on-track': ['green', 'On Track'],
    planned: ['neutral', 'Planned'],
    'to-do': ['neutral', 'To Do'],
    'not-started': ['neutral', 'Not Started']
  };
  return values[normalized] || ['neutral', normalized.replace(/-/g, ' ') || 'Not set'];
}

function reportList(items, emptyMessage) {
  if (!items.length) return emptyState(emptyMessage);
  return `<ul class="report-list">${items.map(item => `<li data-pdf-split-unit>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function projectFlowItem(model, { kind, kicker, section, body, splittable = false }) {
  return `<div data-pdf-flow-item data-flow-kind="${escapeHtml(kind)}" data-page-title="${escapeHtml(model.name)}" data-page-kicker="${escapeHtml(kicker)}" data-page-section="${escapeHtml(section)}"${splittable ? ' data-pdf-splittable' : ''}>${body}</div>`;
}

function renderProjectBrief(model) {
  const [tone, label] = statusPresentation(model.status);
  return `<section class="project-brief-grid" data-section-unit="project-brief"><article class="card project-identity-card"><div class="report-kicker">Project brief</div><h2>${escapeHtml(model.name)}</h2><div class="project-code">${escapeHtml(model.projectLevel)} · ${escapeHtml(model.code || 'No project code')}</div>${statusBadge(tone, label)}</article><article class="card project-progress-card"><div class="metric-card-label">Delivery progress</div><div class="project-progress-value">${escapeHtml(model.progress)}%</div>${progressBar(model.progress, tone)}</article><dl class="card project-context-card"><div><dt>Owner</dt><dd>${escapeHtml(model.owner || 'Unassigned')}</dd></div><div><dt>Deputy</dt><dd>${escapeHtml(model.deputy || 'Unassigned')}</dd></div><div><dt>Customer</dt><dd>${escapeHtml(model.customer || 'Not specified')}</dd></div><div><dt>Location</dt><dd>${escapeHtml(model.location || 'Not specified')}</dd></div></dl></section>`;
}

function renderProjectUpdate(model) {
  const cards = [
    ['Highlight', model.highlights, 'No highlight reported.', ''],
    ['Weekly actions', model.actions, 'No weekly action reported.', '']
  ];
  if (model.risks.length) cards.splice(1, 0, ['Risk / Blocker', model.risks, 'No risk or blocker reported.', 'risk']);
  return cards.map(([title, items, emptyMessage, tone]) => projectFlowItem(model, {
    kind: 'project-update-card',
    kicker: 'Project report · Executive summary',
    section: 'project-summary',
    splittable: true,
    body: `<article class="card project-update-card ${tone}"><div class="report-kicker">Project update</div><h2 class="pdf-continuation-label">${escapeHtml(title)}</h2>${reportList(items, emptyMessage)}</article>`
  })).join('');
}

function renderProjectSummary(model, selected) {
  const items = [];
  if (selected.has('project-brief')) items.push(projectFlowItem(model, {
    kind: 'project-brief',
    kicker: 'Project report · Executive summary',
    section: 'project-summary',
    body: renderProjectBrief(model)
  }));
  if (selected.has('project-update')) items.push(renderProjectUpdate(model));
  return items.length
    ? `<section class="project-summary-flow"><div data-pdf-flow-items>${items.join('')}</div></section>`
    : '';
}

function sortedMilestones(model) {
  return [...model.milestones].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
}

function renderMilestoneTimeline(model) {
  const milestones = sortedMilestones(model);
  if (!milestones.length) return '';
  const compact = milestones.length <= 3
    && milestones.every(item => String(item?.name || '').length <= 28);
  if (compact) {
    return `<section class="milestone-timeline" style="--count:${milestones.length}" data-section-unit="milestone">${milestones.map(item => {
      const [tone, label] = statusPresentation(item?.status || 'planned');
      return `<article class="milestone-step keep-together"><span class="milestone-dot ${tone}"></span><h3>${escapeHtml(item?.name || 'Milestone')}</h3><time>${escapeHtml(item?.date || 'No target date')}</time>${statusBadge(tone, label)}</article>`;
    }).join('')}</section>`;
  }
  return `<ol class="milestone-list" data-section-unit="milestone">${milestones.map(item => {
    const [tone, label] = statusPresentation(item?.status || 'planned');
    return `<li class="milestone-row keep-together"><time>${escapeHtml(item?.date || 'No target date')}</time><strong>${escapeHtml(item?.name || 'Milestone')}</strong>${statusBadge(tone, label)}</li>`;
  }).join('')}</ol>`;
}

function renderMilestoneFlow(model) {
  const milestones = sortedMilestones(model);
  if (!milestones.length) return '';
  const compact = milestones.length <= 3
    && milestones.every(item => String(item?.name || '').length <= 28);
  const items = compact
    ? [projectFlowItem(model, {
      kind: 'milestone-timeline',
      kicker: 'Project report · Milestone timeline',
      section: 'milestone',
      body: renderMilestoneTimeline(model)
    })]
    : milestones.map(item => {
      const [tone, label] = statusPresentation(item?.status || 'planned');
      return projectFlowItem(model, {
        kind: 'milestone-row',
        kicker: 'Project report · Milestone timeline',
        section: 'milestone',
        body: `<ol class="milestone-list"><li class="milestone-row keep-together" data-pdf-split-unit><time>${escapeHtml(item?.date || 'No target date')}</time><strong>${escapeHtml(item?.name || 'Milestone')}</strong>${statusBadge(tone, label)}</li></ol>`
      });
    });
  return `<section class="milestone-flow" data-section-unit="milestone"><div data-pdf-flow-items>${items.join('')}</div></section>`;
}

function renderGantt(model) {
  if (!model.workstreams.length) return '';
  const range = buildGanttRange(model.workstreams);
  return `<section class="gantt-grid" data-section-unit="gantt">${renderGanttAxis(range)}${range.rows.map(item => renderGanttRow(item, range)).join('')}</section>`;
}

function renderGanttFlow(model) {
  if (!model.workstreams.length) return '';
  const range = buildGanttRange(model.workstreams);
  const rows = range.rows.map(item => projectFlowItem(model, {
    kind: 'gantt-row',
    kicker: 'Project report · Workstream schedule',
    section: 'gantt',
    body: renderGanttRow(item, range)
  }));
  return `<section class="gantt-grid" data-section-unit="gantt"><div data-pdf-flow-items><div class="gantt-repeat" data-pdf-repeat-on-page>${renderGanttAxis(range)}</div>${rows.join('')}</div></section>`;
}

function splittableTable({ headings, rows, className }) {
  return `<table class="${className}"><thead><tr>${headings.map(heading => `<th>${escapeHtml(heading)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr data-pdf-split-unit>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderTeamAllocation(model) {
  const rows = model.teamMembers.filter(member => String(member?.name || '').trim()).map(member => [
    escapeHtml(member.name || '-'),
    escapeHtml(member.roleName || member.role || '-'),
    `${escapeHtml(Number(member.effortPct ?? member.effort) || 0)}%`
  ]);
  if (!rows.length) return '';
  return projectFlowItem(model, {
    kind: 'team-allocation',
    kicker: 'Project report · Resource allocation',
    section: 'resource',
    splittable: true,
    body: `<article class="card resource-card"><div class="report-kicker">Resource plan</div><h2 class="pdf-continuation-label">Team allocation</h2>${splittableTable({ headings: ['Name', 'Role', 'Allocation'], rows, className: 'team-allocation-table' })}</article>`
  });
}

function renderDisciplineHours(model) {
  const rows = model.disciplines.map(item => [
    escapeHtml(item.label),
    escapeHtml(item.estimated),
    escapeHtml(item.actual === null ? 'Not reported' : item.actual),
    escapeHtml(item.remaining === null ? 'Not available' : item.remaining)
  ]);
  if (!rows.length) return '';
  return projectFlowItem(model, {
    kind: 'discipline-hours',
    kicker: 'Project report · Resource allocation',
    section: 'resource',
    splittable: true,
    body: `<article class="card resource-card"><div class="report-kicker">Effort tracking</div><h2 class="pdf-continuation-label">Discipline hours</h2>${splittableTable({ headings: ['Discipline', 'Estimated', 'Actual', 'Remaining'], rows, className: 'discipline-hours-table' })}</article>`
  });
}

function renderResourcePage(model, selected) {
  const parts = [];
  if (selected.has('team-allocation')) parts.push(renderTeamAllocation(model));
  if (selected.has('resources')) parts.push(renderDisciplineHours(model));
  const visible = parts.filter(Boolean);
  if (!visible.length) return '';
  return `<section class="project-resource-grid ${visible.length === 1 ? 'single' : ''}" data-section-unit="resource"><div data-pdf-flow-items>${visible.join('')}</div></section>`;
}

function formatMoney(value, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function renderBudget(model) {
  if (!Object.keys(model.budgetSource || {}).length) return '';
  const budget = model.budget;
  const denominator = Math.max(budget.total, budget.planned, budget.actual, 1);
  const plannedWidth = Math.min(100, budget.planned / denominator * 100);
  const actualWidth = Math.min(100, budget.actual / denominator * 100);
  const varianceTone = budget.variance > 0 ? 'red' : budget.variance < 0 ? 'green' : 'neutral';
  const metrics = `<div class="metric-grid budget-metrics">${metricCard('Total budget', formatMoney(budget.total, budget.currency), budget.currency)}${metricCard('Planned', formatMoney(budget.planned, budget.currency), `${Math.round(budget.planned / denominator * 100)}% of scale`)}${metricCard('Actual', formatMoney(budget.actual, budget.currency), `${budget.usedPct}% used`, budget.usedPct > 100 ? 'red' : 'neutral')}${metricCard('Variance', formatMoney(budget.variance, budget.currency), 'Actual minus planned', varianceTone)}</div>`;
  const comparison = `<article class="card budget-comparison"><div class="report-kicker">Budget comparison</div><h2>Planned versus actual</h2><div class="budget-bar-row"><span>Planned</span><div class="budget-track"><i class="planned" style="width:${plannedWidth.toFixed(2)}%"></i></div><strong>${escapeHtml(formatMoney(budget.planned, budget.currency))}</strong></div><div class="budget-bar-row"><span>Actual</span><div class="budget-track"><i class="actual ${budget.actual > budget.planned ? 'red' : ''}" style="width:${actualWidth.toFixed(2)}%"></i></div><strong>${escapeHtml(formatMoney(budget.actual, budget.currency))}</strong></div></article>`;
  return `<section class="budget-flow" data-section-unit="budget"><div data-pdf-flow-items>${projectFlowItem(model, { kind: 'budget-metrics', kicker: 'Project report · Budget snapshot', section: 'budget', body: metrics })}${projectFlowItem(model, { kind: 'budget-comparison', kicker: 'Project report · Budget snapshot', section: 'budget', body: comparison })}</div></section>`;
}

export function renderProjectReportHtml({ week, project, sections }) {
  const model = buildProjectReportModel({ week, project, sections });
  const selected = new Set(model.sections);
  const pages = [];
  const summary = renderProjectSummary(model, selected);
  if (summary) pages.push(reportPage({
    section: 'project-summary', title: model.name, kicker: 'Project report · Executive summary',
    period: model.period, measuredFlow: 'project-summary', body: summary
  }));
  const milestone = selected.has('milestone') ? renderMilestoneFlow(model) : '';
  if (milestone) pages.push(reportPage({
    section: 'milestone', title: model.name, kicker: 'Project report · Milestone timeline',
    period: model.period, measuredFlow: 'milestone', body: milestone
  }));
  const gantt = selected.has('gantt') ? renderGanttFlow(model) : '';
  if (gantt) pages.push(reportPage({
    section: 'gantt', title: model.name, kicker: 'Project report · Workstream schedule',
    period: model.period, measuredFlow: 'gantt', body: gantt
  }));
  const resource = renderResourcePage(model, selected);
  if (resource) pages.push(reportPage({
    section: 'resource', title: model.name, kicker: 'Project report · Resource allocation',
    period: model.period, measuredFlow: 'resource', body: resource
  }));
  const budget = selected.has('budget') ? renderBudget(model) : '';
  if (budget) pages.push(reportPage({
    section: 'budget', title: model.name, kicker: 'Project report · Budget snapshot',
    period: model.period, measuredFlow: 'budget', body: budget
  }));
  return reportDocument({
    title: model.name || model.code || 'Project report',
    period: model.period,
    reportKind: 'project',
    body: pages.join('')
  });
}
