import { escapeHtml, reportDocument } from './report-html.js';
import {
  dataTable,
  emptyState,
  metricCard,
  progressBar,
  reportPage,
  statusBadge
} from './report-components.js';
import { parseExecutiveSummaryBrief } from './executive-summary-brief.js';
import { budgetTotals, buildOverviewReportModel, formatSectionUpdate } from './report-model.js';
import { buildGanttRange, renderGanttAxis, renderGanttRow } from './project-visuals.js';

function statusPresentation(status) {
  const values = {
    green: ['green', 'On Track'], yellow: ['yellow', 'At Risk'], red: ['red', 'Critical']
  };
  return values[status] || ['neutral', 'Not set'];
}

function renderHealthFocus(model) {
  const health = model.health;
  return `<section class="overview-unit health-focus" data-section-unit="health-focus"><div class="overview-unit-head"><div><div class="report-kicker">Portfolio Health &amp; Focus</div><h2>Management focus</h2></div>${statusBadge(health.red ? 'red' : health.yellow ? 'yellow' : 'green', health.red ? 'Escalation required' : health.yellow ? 'Monitor closely' : 'Portfolio stable')}</div><div class="metric-grid health-metrics">${metricCard('Active projects', health.total, 'Selected Overview scope')}${metricCard('On Track', health.green, 'Green status', 'green')}${metricCard('At Risk', health.yellow, 'Yellow status', 'yellow')}${metricCard('Critical', health.red, 'Red status', health.red ? 'red' : 'neutral')}</div><article class="card portfolio-progress-card"><div><div class="metric-card-label">Average delivery progress</div><strong>${escapeHtml(health.averageProgress)}%</strong></div>${progressBar(health.averageProgress, health.red ? 'red' : health.yellow ? 'yellow' : 'green')}</article></section>`;
}

function trendSvg(points, key, tone = 'green') {
  const width = 320;
  const height = 140;
  const left = 28;
  const right = 12;
  const top = 16;
  const bottom = 28;
  const values = points.map(point => Number(point[key]) || 0);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 1);
  const span = Math.max(1, maxValue - minValue);
  const coords = points.map((point, index) => {
    const x = left + (points.length === 1 ? 0 : index / (points.length - 1)) * (width - left - right);
    const y = height - bottom - ((Number(point[key]) - minValue) / span) * (height - top - bottom);
    return { x, y, label: point.label, value: point[key] };
  });
  const path = coords.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  return `<svg class="weekly-trend-svg ${tone}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(key)} trend"><line class="trend-axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line><line class="trend-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"></line><path class="trend-line" d="${path}"></path>${coords.map(point => `<circle class="trend-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.6"></circle><text class="trend-value" x="${point.x.toFixed(1)}" y="${Math.max(10, point.y - 7).toFixed(1)}">${escapeHtml(point.value)}</text><text class="trend-label" x="${point.x.toFixed(1)}" y="130">${escapeHtml(point.label)}</text>`).join('')}</svg>`;
}

function renderWeeklyTrend(model) {
  if (model.trend.length < 2) return '';
  const latest = model.trend.at(-1);
  const previous = model.trend.at(-2);
  const riskDelta = latest.riskPressure - previous.riskPressure;
  const progressDelta = latest.avgProgress - previous.avgProgress;
  return `<section class="overview-unit weekly-trend" data-section-unit="weekly-trend"><div class="overview-unit-head"><div><div class="report-kicker">Weekly portfolio trend</div><h2>Trend signals</h2></div><span class="overview-note">Last ${model.trend.length} reporting periods</span></div><div class="weekly-trend-grid"><article class="card trend-card risk"><div class="trend-card-head"><div><h3>Risk pressure</h3><span>Total risk entries; critical entries weighted 1.5×</span></div><strong>${escapeHtml(latest.riskPressure)} <small>${riskDelta >= 0 ? '+' : ''}${escapeHtml(riskDelta)}</small></strong></div>${trendSvg(model.trend, 'riskPressure', 'red')}</article><article class="card trend-card"><div class="trend-card-head"><div><h3>Average progress</h3><span>Portfolio delivery progress</span></div><strong>${escapeHtml(latest.avgProgress)}% <small>${progressDelta >= 0 ? '+' : ''}${escapeHtml(progressDelta)}%</small></strong></div>${trendSvg(model.trend, 'avgProgress', 'green')}</article></div></section>`;
}

function renderBriefField(label, value) {
  return value
    ? `<div class="executive-brief-field" data-pdf-field><strong>${escapeHtml(label)}</strong><p>${escapeHtml(value)}</p></div>`
    : '';
}

function decisionOverviewMarkup(model, brief) {
  return `<div class="executive-brief-metrics">${metricCard('Active projects', model.health.total, 'Selected Overview scope')}${metricCard('On Track', model.health.green, 'Green status', 'green')}${metricCard('At Risk', model.health.yellow, 'Yellow status', 'yellow')}${metricCard('Critical', model.health.red, 'Red status', model.health.red ? 'red' : 'neutral')}</div>
    <div class="executive-portfolio-lead"><h2 class="executive-brief-section-title">Portfolio summary</h2><p>${escapeHtml(brief.portfolioSummary || 'No executive summary is available for this reporting period.')}</p></div>`;
}

function renderPriorityCard(project) {
  return `<article class="executive-priority-card card">
    <h3 class="executive-project-title">${escapeHtml(project.projectName)}</h3>
    ${renderBriefField('Movement', project.movement)}
    ${renderBriefField('Blocker', project.blocker)}
    ${renderBriefField('Next step', project.nextStep)}
  </article>`;
}

function renderAskCard(ask) {
  return `<article class="executive-ask-card">
    <h3 class="executive-project-title">${escapeHtml(ask.projectName)}</h3>
    ${renderBriefField('Decision / Support needed', ask.supportNeeded)}
    ${renderBriefField('Business impact', ask.businessImpact)}
  </article>`;
}

function renderContextCard(project) {
  return `<article class="executive-context-card card">
    <h2 class="executive-project-title">${escapeHtml(project.projectName)}</h2>
    ${renderBriefField('Movement', project.movement)}
    ${renderBriefField('Blocker', project.blocker)}
    ${renderBriefField('Next step', project.nextStep)}
  </article>`;
}

function flowItem({ kind, pageTitle, pageKicker, pageSection, body, splittable = false }) {
  return `<div data-pdf-flow-item data-flow-kind="${escapeHtml(kind)}" data-page-title="${escapeHtml(pageTitle)}" data-page-kicker="${escapeHtml(pageKicker)}" data-page-section="${escapeHtml(pageSection)}"${splittable ? ' data-pdf-splittable' : ''}>${body}</div>`;
}

function renderExecutiveSummaryFlow(model, brief) {
  const decisionMeta = {
    pageTitle: 'Decision Brief',
    pageKicker: 'Executive Summary - Management-ready update',
    pageSection: 'executive-summary-brief'
  };
  const contextMeta = {
    pageTitle: 'Project Context',
    pageKicker: 'Executive Summary - Supporting detail',
    pageSection: 'executive-summary-context'
  };
  const blocks = [flowItem({
    ...decisionMeta,
    kind: 'portfolio-summary',
    body: decisionOverviewMarkup(model, brief)
  })];

  brief.priorityProjects.forEach((project, index) => blocks.push(flowItem({
    ...decisionMeta,
    kind: 'priority-project',
    splittable: true,
    body: `${index ? '' : '<h2 class="executive-brief-section-title">Priority projects</h2>'}${renderPriorityCard(project)}`
  })));
  brief.managementAsks.forEach((ask, index) => blocks.push(flowItem({
    ...decisionMeta,
    kind: 'management-decision',
    splittable: true,
    body: `${index ? '' : '<h2 class="executive-brief-section-title">Management decisions</h2>'}${renderAskCard(ask)}`
  })));

  const contextProjects = brief.projects.length ? brief.projects : [null];
  contextProjects.forEach((project, index) => blocks.push(flowItem({
    ...contextMeta,
    kind: 'project-context',
    splittable: Boolean(project),
    body: `${index ? '' : '<h2 class="executive-brief-section-title">Project Context</h2><p class="executive-context-intro">Supporting movement, blocker, and next-step detail for the current reporting period.</p>'}${project ? renderContextCard(project) : emptyState(brief.fallbackText || 'No project context is available.')}${brief.hasAdditionalContent && index === contextProjects.length - 1 ? '<p class="executive-additional-note">Additional project details are available in the dashboard.</p>' : ''}`
  })));

  return `<section class="executive-brief-copy" data-section-unit="executive-summary"><div data-pdf-flow-items>${blocks.join('')}</div></section>`;
}

function renderAttentionMatrix(model) {
  const quadrants = [
    ['monitor', 'Monitor Closely', 'High urgency / lower impact'],
    ['action', 'Executive Action', 'High urgency / higher impact'],
    ['watch', 'Keep Watching', 'Lower urgency / lower impact'],
    ['strategy', 'Strategic Watch', 'Lower urgency / higher impact']
  ];
  const meta = {
    pageTitle: 'Management Attention',
    pageKicker: 'Overview report · Decision view',
    pageSection: 'overview-management'
  };
  const heading = flowItem({
    ...meta,
    kind: 'attention-heading',
    body: '<div class="overview-unit-head" data-section-unit="attention-matrix"><div><div class="report-kicker">Management attention map</div><h2>Attention Matrix</h2></div><span class="overview-note">Static executive view</span></div>'
  });
  const items = quadrants.map(([key, title, detail]) => flowItem({
    ...meta,
    kind: `attention-quadrant-${key}`,
    splittable: model.attention[key].length > 0,
    body: `<article class="attention-quadrant ${key}"><div class="attention-quadrant-head"><div><h3 class="pdf-continuation-label">${escapeHtml(title)}</h3><span>${escapeHtml(detail)}</span></div><b>${model.attention[key].length}</b></div>${model.attention[key].length ? model.attention[key].map(project => {
    const [tone, label] = statusPresentation(project.status);
    return `<div class="attention-project keep-together" data-pdf-split-unit><div><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.code)} · ${escapeHtml(project.owner || 'Unassigned')}</small></div>${statusBadge(tone, label)}<p>${escapeHtml(project.risks[0] || 'No active risk recorded.')}</p></div>`;
  }).join('') : '<div class="attention-empty">No projects</div>'}</article>`
  }));
  return `${heading}${items.join('')}`;
}

function renderRiskActions(model) {
  if (!model.riskRows.length) return '';
  const rows = model.riskRows.map(row => [
    `<strong>${escapeHtml(row.projectName)}</strong><br><small>${escapeHtml(row.projectCode)}</small>`,
    escapeHtml(row.risk || '-'),
    statusBadge(row.status, row.attention.replace(/\b\w/g, character => character.toUpperCase())),
    escapeHtml(row.owner),
    escapeHtml(row.action || '-'),
    escapeHtml(row.checkpoint || '-')
  ]);
  const table = dataTable({ headings: ['Project', 'Risk / Blocker', 'Escalation', 'Owner', 'Required action', 'Checkpoint'], rows, className: 'risk-action-table' })
    .replace('<tbody><tr>', '<tbody><tr data-pdf-split-unit>')
    .replaceAll('</tr><tr>', '</tr><tr data-pdf-split-unit>');
  return flowItem({
    kind: 'risk-actions',
    pageTitle: 'Management Attention',
    pageKicker: 'Overview report · Decision view',
    pageSection: 'overview-management',
    splittable: true,
    body: `<section class="overview-unit risk-actions" data-section-unit="risk-actions"><div class="overview-unit-head"><div><div class="report-kicker">Risk action table</div><h2 class="pdf-continuation-label">Risk Actions</h2></div><span class="overview-note">Primary risk and action pair</span></div>${table}</section>`
  });
}

function renderQuarterlyRoadmap(model) {
  if (!model.quarterlyItems.length) return '';
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  return `<section class="overview-unit quarterly-roadmap" data-section-unit="quarterly-roadmap"><div data-pdf-flow-items>${quarters.map(quarter => {
    const items = model.quarterlyItems.filter(item => item.quarter === quarter);
    return `<div data-pdf-flow-item data-flow-kind="quarterly-roadmap-quarter" data-page-title="Quarterly Roadmap" data-page-kicker="Overview report · Portfolio roadmap" data-page-section="quarterly-roadmap"><article class="quarter-column"><header><strong>${quarter}</strong><span>${items.length} items</span></header><div class="quarter-items">${items.length ? items.map(item => {
      const progress = Math.min(100, Math.max(0, Number(item.progress) || 0));
      return `<div class="quarter-item keep-together"><strong>${escapeHtml(item.name || 'Quarterly milestone')}</strong><small>${escapeHtml(item.projectName)} · ${escapeHtml(item.projectCode)}</small>${progressBar(progress, item.status === 'at-risk' ? 'red' : 'green')}<span>${progress}% complete</span></div>`;
    }).join('') : '<div class="attention-empty">No milestones</div>'}</div></article></div>`;
  }).join('')}</div></section>`;
}

function renderExecutiveMilestones(model) {
  const timeline = model.executiveMilestones;
  if (!timeline.rows.length) return '';
  const items = timeline.rows.map(row => `<div data-pdf-flow-item data-flow-kind="executive-roadmap-category" data-page-title="Executive Milestones" data-page-kicker="Overview report · Leadership roadmap" data-page-section="executive-milestones"><article class="executive-milestone-category card"><h3>${escapeHtml(row.label)}</h3><div class="executive-milestone-quarter-grid">${timeline.quarters.map((quarter, quarterIndex) => `<section class="executive-milestone-quarter"><header><strong>${escapeHtml(quarter)}</strong><span>${escapeHtml(timeline.phases[quarterIndex])}</span></header><ul>${row.cells[quarterIndex].length ? row.cells[quarterIndex].map(outcome => `<li>${escapeHtml(outcome)}</li>`).join('') : '<li class="executive-milestone-empty">No milestone</li>'}</ul></section>`).join('')}</div></article></div>`).join('');
  return `<section class="overview-unit executive-milestones" data-section-unit="executive-milestones"><div data-pdf-flow-items>${items}</div></section>`;
}

function resourceSnapshot(project) {
  const members = project.teamMembers.filter(member => String(member?.name || '').trim());
  const effort = members.reduce((sum, member) => sum + (Number(member.effortPct ?? member.effort) || 0), 0);
  return { members: members.length, fte: Math.round(effort / 10) / 10 };
}

function renderProjectPortfolioCard(project) {
  const [tone, label] = statusPresentation(project.status);
  const resource = resourceSnapshot(project);
  const budget = budgetTotals(project);
  const milestone = [...project.milestones].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')))[0];
  return `<article class="portfolio-project-card keep-together" data-section-unit="project-portfolio"><div class="portfolio-project-head"><div><div class="report-kicker">${escapeHtml(project.projectLevel)} · ${escapeHtml(project.code)}</div><h2>${escapeHtml(project.name)}</h2><div class="portfolio-owner">Owner: ${escapeHtml(project.owner || 'Unassigned')}</div></div><div class="portfolio-project-status">${statusBadge(tone, label)}<strong>${escapeHtml(project.progress)}%</strong></div></div><div class="portfolio-progress">${progressBar(project.progress, tone)}</div><div class="portfolio-signal-grid"><section class="card"><div class="metric-card-label">Highlight</div><p>${escapeHtml(project.highlights[0] || 'No highlight reported.')}</p></section><section class="card risk"><div class="metric-card-label">Risk / Blocker</div><p>${escapeHtml(project.risks[0] || 'No active blocker reported.')}</p></section><section class="card"><div class="metric-card-label">Next action</div><p>${escapeHtml(project.actions[0] || 'No next action reported.')}</p></section></div><div class="portfolio-snapshot-grid"><article class="card"><span>Next milestone</span><strong>${escapeHtml(milestone?.name || 'No milestone')}</strong><small>${escapeHtml(milestone?.date || 'No target date')}</small></article><article class="card"><span>Resource load</span><strong>${resource.members} people · ${resource.fte} FTE</strong><small>Current team allocation</small></article><article class="card"><span>Budget snapshot</span><strong>${escapeHtml(formatMoney(budget.actual, budget.currency))} / ${escapeHtml(formatMoney(budget.total, budget.currency))}</strong><small>${escapeHtml(budget.usedPct)}% used</small></article></div></article>`;
}

function portfolioFlowItem(project, kind, body) {
  return `<div data-pdf-flow-item data-flow-kind="${escapeHtml(kind)}" data-page-title="Project Portfolio" data-page-kicker="Overview report · Project portfolio" data-page-section="project-portfolio" data-page-context="${escapeHtml(project.name)}">${body}</div>`;
}

function renderProjectPortfolioFlow(project) {
  const [tone, label] = statusPresentation(project.status);
  const resource = resourceSnapshot(project);
  const budget = budgetTotals(project);
  const milestone = [...project.milestones]
    .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')))[0];
  const updateNote = section => `<div class="section-update-note">${escapeHtml(formatSectionUpdate(project, section))}</div>`;
  const highlights = project.highlights.length
    ? `<ul class="report-list">${project.highlights.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p>No highlight reported.</p>';
  const sectionUpdates = ['status', 'highlights', 'weeklyActions', 'riskActions', 'milestones', 'schedule', 'teamAllocation', 'budgetPlan', 'actualSpend', 'disciplineHours']
    .map(section => `<div class="section-update-note">${escapeHtml(section)} · ${escapeHtml(formatSectionUpdate(project, section))}</div>`)
    .join('');
  const blocks = [portfolioFlowItem(project, 'project-identity', `<article class="portfolio-project-card" data-section-unit="project-portfolio"><div class="portfolio-project-head"><div><div class="report-kicker">${escapeHtml(project.projectLevel)} · ${escapeHtml(project.code)}</div><h2>${escapeHtml(project.name)}</h2><div class="portfolio-owner">Owner: ${escapeHtml(project.owner || 'Unassigned')}</div></div><div class="portfolio-project-status">${statusBadge(tone, label)}<strong>${escapeHtml(project.progress)}%</strong></div></div><div class="portfolio-progress">${progressBar(project.progress, tone)}</div><section class="portfolio-highlights card"><div class="metric-card-label">Highlights</div>${highlights}</section></article>`)];

  blocks.push(portfolioFlowItem(project, 'project-section-updates', `<section class="card"><div class="metric-card-label">Section updates</div>${['status', 'highlights', 'weeklyActions', 'riskActions', 'milestones', 'schedule', 'teamAllocation', 'budgetPlan', 'actualSpend', 'disciplineHours'].map(section => `<div class="section-update-note">${escapeHtml(section)} · ${escapeHtml(formatSectionUpdate(project, section))}</div>`).join('')}</section>`));

  if (project.actions.length) {
    blocks.push(portfolioFlowItem(project, 'project-weekly-actions', `<section class="portfolio-weekly-actions card" data-pdf-split-unit><h2 class="portfolio-section-title">Weekly Key Actions</h2><ul class="report-list">${project.actions.map(action => `<li>${escapeHtml(action)}</li>`).join('')}</ul></section>`));
  }

  project.riskActions.forEach((pair, index) => blocks.push(portfolioFlowItem(project, 'project-risk-action', `${index ? '' : '<h2 class="portfolio-section-title">Risks &amp; required actions</h2>'}<article class="portfolio-risk-row card" data-pdf-split-unit><div><span>Risk / Blocker${pair.primary ? ' · Primary' : ''}</span><p>${escapeHtml(pair.risk)}</p></div><div><span>Required action</span><p>${escapeHtml(pair.action || 'No required action reported.')}</p></div></article>`)));

  blocks.push(portfolioFlowItem(project, 'project-snapshot', `<div class="portfolio-snapshot-grid"><article class="card"><span>Next milestone</span><strong>${escapeHtml(milestone?.name || 'No milestone')}</strong><small>${escapeHtml(milestone?.date || 'No target date')}</small></article><article class="card"><span>Resource load</span><strong>${resource.members} people · ${resource.fte} FTE</strong><small>Current team allocation</small></article><article class="card"><span>Budget snapshot</span><strong>${escapeHtml(formatMoney(budget.actual, budget.currency))} / ${escapeHtml(formatMoney(budget.total, budget.currency))}</strong><small>${escapeHtml(budget.usedPct)}% used</small></article></div>`));

  if (project.workstreams.length) {
    const range = buildGanttRange(project.workstreams);
    blocks.push(portfolioFlowItem(project, 'project-gantt-heading', `<section class="portfolio-gantt-heading"><h2 class="portfolio-section-title">Gantt schedule</h2>${renderGanttAxis(range)}</section>`));
    range.rows.forEach(item => {
      blocks.push(portfolioFlowItem(project, 'project-gantt-row', renderGanttRow(item, range)));
    });
  }

  return `<section class="project-portfolio-flow"><div data-pdf-flow-items>${blocks.join('')}</div></section>`;
}

function renderResourceAnalytics(model) {
  if (!model.projects.length) return '';
  const resource = model.resource;
  const levelTotal = Object.values(resource.byLevel).reduce((sum, value) => sum + value, 0) || 1;
  return `<section class="overview-unit resource-analytics" data-section-unit="resource-analytics"><div class="overview-unit-head"><div><div class="report-kicker">Resource overview</div><h2>Resource Analytics</h2></div><span class="overview-note">Allocation by project level and function</span></div><div class="metric-grid">${metricCard('Total allocated FTE', resource.totalAllocatedFte, 'Across selected projects')}${metricCard('Allocation coverage', `${resource.allocationCoverage}%`, 'Projects with named allocation')}${metricCard('Overallocated people', resource.overallocatedPeople, 'Above 100% combined effort', resource.overallocatedPeople ? 'red' : 'green')}${metricCard('Available capacity', `${resource.availableCapacityFte} FTE`, 'Known capacity less allocation')}</div><div class="resource-analytics-layout"><article class="card resource-level-card"><h3>FTE by project level</h3><div class="resource-level-donut" style="--system:${resource.byLevel.system / levelTotal * 100}%;--module:${(resource.byLevel.system + resource.byLevel['hardware-module']) / levelTotal * 100}%"></div>${[['System', resource.byLevel.system], ['Hardware Module', resource.byLevel['hardware-module']], ['Software', resource.byLevel.software]].map(([label, value], index) => `<div class="resource-level-row"><i class="level-${index}"></i><span>${label}</span><strong>${value} FTE</strong></div>`).join('')}</article><article class="card resource-function-card"><h3>Function allocation by known capacity</h3><div class="resource-function-list">${resource.byFunction.length ? resource.byFunction.map(item => `<div class="resource-function-row keep-together"><div class="resource-function-name">${escapeHtml(item.role)}</div><div class="resource-function-bar"><i style="width:${Math.min(100, item.utilizationPct)}%"></i></div><strong>${escapeHtml(item.totalFte)} / ${escapeHtml(item.capacityFte)} FTE<small>${escapeHtml(item.utilizationPct)}%</small></strong></div>`).join('') : emptyState('No team allocation is available.')}</div></article></div></section>`;
}

function formatMoney(value, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function renderBudgetOverview(model) {
  if (!model.projects.some(project => Object.keys(project.budgetSource || {}).length)) return '';
  const budget = model.budget;
  const projectRows = budget.projectRows.map(row => [
    `<strong>${escapeHtml(row.project.name)}</strong><br><small>${escapeHtml(row.project.code)}</small>`,
    escapeHtml(formatMoney(row.total, row.currency)),
    escapeHtml(formatMoney(row.planned, row.currency)),
    escapeHtml(formatMoney(row.actual, row.currency)),
    `<span class="${row.variance > 0 ? 'negative-value' : 'positive-value'}">${escapeHtml(formatMoney(row.variance, row.currency))}</span>`
  ]);
  return `<section class="overview-unit budget-overview" data-section-unit="budget-overview"><div class="overview-unit-head"><div><div class="report-kicker">Financial overview</div><h2>Budget Overview</h2></div><span class="overview-note">${budget.mixedCurrencies ? 'Project rows retain their stored currencies' : escapeHtml(budget.currency)}</span></div><div class="metric-grid">${metricCard('Total budget', formatMoney(budget.total, budget.currency), budget.currency)}${metricCard('Planned', formatMoney(budget.planned, budget.currency), 'Approved plan')}${metricCard('Actual', formatMoney(budget.actual, budget.currency), `${budget.usedPct}% used`, budget.usedPct > 100 ? 'red' : 'neutral')}${metricCard('Variance', formatMoney(budget.variance, budget.currency), 'Actual minus planned', budget.variance > 0 ? 'red' : 'green')}</div><div class="budget-overview-layout"><article class="card budget-variance"><h3>Project budget position</h3>${dataTable({ headings: ['Project', 'Total', 'Planned', 'Actual', 'Variance'], rows: projectRows, className: 'budget-project-table' })}</article><article class="card budget-category-card"><h3>Actual spend by category</h3>${budget.categories.length ? budget.categories.map(item => {
    const max = Math.max(...budget.categories.map(category => category.amount), 1);
    return `<div class="budget-category-row"><span>${escapeHtml(item.name)}</span><div class="budget-track"><i style="width:${item.amount / max * 100}%"></i></div><strong>${escapeHtml(formatMoney(item.amount, budget.currency))}</strong></div>`;
  }).join('') : emptyState('No actual spend categories are available.')}</article></div></section>`;
}

export function renderOverviewReportHtml({
  week,
  trendWeeks = [],
  sections,
  overviewScope = 'system',
  executiveAudienceView = 'leadership'
}) {
  const model = buildOverviewReportModel({ week, trendWeeks, sections, overviewScope, executiveAudienceView });
  const selected = new Set(model.sections);
  const pages = [];

  const opening = [];
  if (selected.has('health-focus')) opening.push(renderHealthFocus(model));
  if (selected.has('weekly-trend')) {
    const trend = renderWeeklyTrend(model);
    if (trend) opening.push(trend);
  }
  if (opening.length) pages.push(reportPage({
    section: 'overview-opening', title: 'Portfolio Overview', kicker: 'Overview report · Executive view',
    period: model.period, body: opening.join('')
  }));

  if (selected.has('executive-summary')) {
    const brief = parseExecutiveSummaryBrief(model.executiveSummary);
    pages.push(reportPage({
      section: 'executive-summary-brief', title: 'Decision Brief',
      kicker: 'Executive Summary - Management-ready update', period: model.period,
      measuredFlow: 'executive-summary', body: renderExecutiveSummaryFlow(model, brief)
    }));
  }

  const management = [];
  if (selected.has('attention-matrix')) management.push(renderAttentionMatrix(model));
  if (selected.has('risk-actions')) {
    const risks = renderRiskActions(model);
    if (risks) management.push(risks);
  }
  if (management.length) pages.push(reportPage({
    section: 'overview-management', title: 'Management Attention', kicker: 'Overview report · Decision view',
    period: model.period, measuredFlow: 'management-attention',
    body: `<section class="management-flow"><div data-pdf-flow-items>${management.join('')}</div></section>`
  }));

  if (selected.has('executive-milestones')) {
    const milestones = renderExecutiveMilestones(model);
    if (milestones) pages.push(reportPage({
      section: 'executive-milestones', title: 'Executive Milestones',
      kicker: 'Overview report · Leadership roadmap', period: model.period,
      measuredFlow: 'executive-roadmap', body: milestones
    }));
  }

  if (selected.has('quarterly-roadmap')) {
    const roadmap = renderQuarterlyRoadmap(model);
    if (roadmap) pages.push(reportPage({
      section: 'quarterly-roadmap', title: 'Quarterly Roadmap', kicker: 'Overview report · Portfolio roadmap',
      period: model.period, measuredFlow: 'quarterly-roadmap', body: roadmap
    }));
  }

  if (selected.has('project-portfolio')) {
    model.projects.forEach(project => pages.push(reportPage({
      section: 'project-portfolio', title: 'Project Portfolio', kicker: 'Overview report · Project portfolio',
      context: project.name,
      period: model.period,
      measuredFlow: `project-portfolio-${project.code.replace(/[^A-Za-z0-9_-]/g, '-') || 'project'}`,
      body: renderProjectPortfolioFlow(project)
    })));
  }

  if (selected.has('resource-analytics')) {
    const resource = renderResourceAnalytics(model);
    if (resource) pages.push(reportPage({
      section: 'resource-analytics', title: 'Resource Analytics', kicker: 'Overview report · Resource view',
      period: model.period, body: resource
    }));
  }

  if (selected.has('budget-overview')) {
    const budget = renderBudgetOverview(model);
    if (budget) pages.push(reportPage({
      section: 'budget-overview', title: 'Budget Overview', kicker: 'Overview report · Financial view',
      period: model.period, body: budget
    }));
  }

  return reportDocument({ title: 'Overview report', period: model.period, reportKind: 'overview', body: pages.join('') });
}
