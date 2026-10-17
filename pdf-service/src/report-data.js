import {
  authorizeExecutiveAudienceView,
  authorizeReportAccess,
  ReportAccessError
} from './report-access.js';
import { validateExecutiveSummaryForPdf } from './executive-summary-brief.js';
import { resolveGanttWindowSettings, sanitizeDraftGanttWindowSettings } from './gantt-window.js';
import { verifyBearerToken } from './auth-error.js';
import { calculateDeliveryTrends, normalizeDeliveryReportingPeriod, normalizeDeliveryProjectData } from './generated/delivery-trends.mjs';

export class ReportDataError extends Error {
  constructor(message, statusCode = 404) {
    super(message);
    this.name = 'ReportDataError';
    this.statusCode = statusCode;
  }
}

function hasTeamMembers(project) {
  return Array.isArray(project?.teamMembers) && project.teamMembers.some(member => String(member?.name || '').trim());
}

function hasResources(project) {
  return project?.resources && typeof project.resources === 'object' && Object.keys(project.resources).length > 0;
}

function hasBudget(project) {
  return project?.budget && typeof project.budget === 'object' && Object.keys(project.budget).length > 0;
}

function includedProjectSections(project, sections) {
  return sections.filter(section => {
    if (section === 'team-allocation') return hasTeamMembers(project);
    if (section === 'resources') return hasResources(project);
    if (section === 'budget') return hasBudget(project);
    if (section === 'milestone') return Array.isArray(project?.milestones) && project.milestones.length > 0;
    if (section === 'gantt') return Array.isArray(project?.ganttWorkstreams) && project.ganttWorkstreams.length > 0;
    return true;
  });
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function selectOverviewProjects(week, projectCodes) {
  if (!Array.isArray(projectCodes)) return week;
  const selected = new Set(projectCodes);
  return { ...week, projects: (week?.projects || []).filter(project => selected.has(project?.code)) };
}

function reportableOverviewProjects(week, overviewScope = 'system') {
  const scope = overviewScope === 'module' ? 'hardware-module' : overviewScope;
  return (Array.isArray(week?.projects) ? week.projects : [])
    .filter(project => {
      const visibility = String(project?.visibility || '').trim().toLowerCase();
      return !visibility || visibility === 'active';
    })
    .filter(project => {
      if (scope === 'all') return true;
      const level = ['system', 'hardware-module', 'software'].includes(project?.projectLevel)
        ? project.projectLevel
        : 'system';
      return level === scope;
    });
}

function activeOverviewWeek(week) {
  return { ...week, projects: reportableOverviewProjects(week, 'all') };
}

function executiveTimelineForReport(week, liveState) {
  const snapshot = week?.strategyLayer?.executiveMilestoneTimelineSnapshot;
  if (week?.isReleased === true && snapshot?.timeline) return snapshot.timeline;
  if (week?.isReleased !== true && liveState?.timeline) return liveState.timeline;
  return week?.strategyLayer?.executiveMilestoneTimeline || week?.executiveMilestoneTimeline || null;
}


// Bounded transport only: document-ID pagination is not chronological week ordering.
export function createBoundedDeliveryHistoryReader({ db, documentIdField = '__name__', pageSize = 50, maxPages = 6 } = {}) {
  if (!db || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50
    || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 6) throw new TypeError('Invalid bounded history configuration.');
  return async ({ publicationMode } = {}) => {
    if (!['released','include-drafts'].includes(publicationMode)) throw new TypeError('Invalid history publication policy.');
    const weeks = [];
    let cursor = null;
    for (let page = 0; page < maxPages; page++) {
      let query = db.collection('weeks');
      if (publicationMode === 'released') query = query.where('isReleased', '==', true);
      query = query.orderBy(documentIdField).limit(pageSize);
      if (cursor !== null) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (!Array.isArray(snapshot.docs) || snapshot.docs.length > pageSize) throw new Error('Invalid bounded history response.');
      weeks.push(...snapshot.docs.map(document => ({ ...document.data(), weekId: document.id })));
      if (snapshot.docs.length < pageSize) return { weeks, complete: true };
      cursor = snapshot.docs.at(-1).id;
    }
    return { weeks, complete: false };
  };
}

// Roles that may read DRAFT reporting weeks. This mirrors the dashboard's authoritative contract
// (js/dashboard-access.mjs canReadDraftWeeks: admin and pm). Every other supported role (sales, engineering, business,
// product, bd, vip, executive) is released-only. The role comes from the trusted users/{email} record read after the
// Firebase ID token was verified; nothing the client sends is used.
//
// Known Browser/PDF mismatch (documented, fails closed): the dashboard also lets a user holding a delegated
// week.manage override load draft weeks. The PDF service cannot verify that override authoritatively (it only reads
// users/{email}), so such a user gets released-only history in this section.
const DELIVERY_DRAFT_READER_ROLES = new Set(['admin', 'pm']);
export const DELIVERY_PERFORMANCE_SECTION_ID = 'portfolio-delivery-performance';

export function canReadDraftDeliveryHistory(role) {
  return DELIVERY_DRAFT_READER_ROLES.has(String(role || '').trim().toLowerCase());
}

async function deliveryTrendsForReport({ request, week, access, adapters, overviewScope }) {
  const draftReader = canReadDraftDeliveryHistory(access.role);
  const publicationMode = draftReader ? 'include-drafts' : 'released';
  const provenance = typeof adapters.getDeliveryTrendsProvenance === 'function' ? adapters.getDeliveryTrendsProvenance() : {};
  const base = { ...provenance, anchorWeekId: request.weekId, windowWeeks: adapters.deliveryTrendsWindowWeeks ?? 6,
    publicationMode, scope: { projectLevel: overviewScope === 'module' ? 'hardware-module' : overviewScope } };
  const unavailable = code => {
    const result = calculateDeliveryTrends({ ...base, weeks: [] });
    result.warnings.push({ code, message: code.replaceAll('-', ' '), weekId: null, count: 1 });
    return result;
  };
  // Fail closed: a role without draft access never gets metrics anchored on a draft week (no history is even read).
  if (!draftReader && week?.isReleased !== true) return unavailable('draft-week-not-authorized');
  if (typeof adapters.getDeliveryHistory !== 'function') return unavailable('history-reader-unavailable');
  let history;
  try { history = await adapters.getDeliveryHistory({ publicationMode }); }
  catch { return unavailable('history-read-failed'); }
  if (!history || history.complete !== true || !Array.isArray(history.weeks)) return unavailable('history-read-limit');
  // Defensive publication filtering precedes normalization and all diagnostic generation.
  const permitted = history.weeks.filter(item => item && (publicationMode !== 'released' || item.isReleased === true));
  const anchor = permitted.find(item => item.weekId === request.weekId);
  if (anchor && (anchor.version !== week.version || JSON.stringify(anchor.projects) !== JSON.stringify(week.projects))) {
    return unavailable('anchor-revised-during-read');
  }
  const keyFor = project => typeof project?.projectId === 'string' && project.projectId.trim()
    ? `id:${project.projectId.trim()}` : `code:${String(project?.code || '').trim().toLowerCase()}`;
  if (Array.isArray(request.projectCodes)) {
    const anchorScope = reportableOverviewProjects(week, overviewScope);
    const fullSelection = anchorScope.length > 0 && anchorScope.every(project => request.projectCodes.includes(project?.code));
    // All current projects means the portfolio history, including previously visible missing projects.
    if (!fullSelection) base.scope.projectKeys = (Array.isArray(week.projects) ? week.projects : [])
      .filter(project => request.projectCodes.includes(project?.code)).map(keyFor);
  }
  const weeks = permitted.map(item => ({ ...item, reportingPeriod: normalizeDeliveryReportingPeriod(item),
    // Week-level authorization is already complete; scope is evaluated by the canonical engine.
    projects: Array.isArray(item.projects) ? item.projects.map(normalizeDeliveryProjectData) : null }));
  return calculateDeliveryTrends({ ...base, weeks });
}

export async function loadAuthorizedReport({ request, idToken, adapters }) {
  const decodedToken = await verifyBearerToken(adapters, idToken);
  const email = String(decodedToken?.email || '').trim().toLowerCase();
  if (!email) throw new ReportAccessError('The authentication token does not include an email address.', 401);
  const user = await adapters.getUserByEmail(email);
  const week = await adapters.getWeekById(request.weekId);
  if (!week) throw new ReportDataError('The selected reporting week no longer exists.');
  const access = authorizeReportAccess({ email, role: user?.role }, week, request);
  const ganttWindowSettings = request.previewGanttWindowSettings !== undefined
    ? sanitizeDraftGanttWindowSettings(request.previewGanttWindowSettings)
    : resolveGanttWindowSettings(
      typeof adapters.getDashboardSettings === 'function' ? await adapters.getDashboardSettings() : undefined
    );

  if (request.mode !== 'project') {
    if (request.sections.includes('executive-summary')) {
      const summary = String(week.executiveSummary || week.summary || week.overviewSummary || '');
      const validation = validateExecutiveSummaryForPdf(summary);
      if (!validation.ok) {
        const details = validation.errors.map(error => error.message).join(' ');
        throw new ReportDataError(`Weekly Summary is not valid for PDF export: ${details}`, 422);
      }
    }
    const overviewScope = request.overviewScope || 'system';
    let trendWeeks = [];
    if (request.sections.includes('weekly-trend') && typeof adapters.getTrendWeeks === 'function') {
      const history = await adapters.getTrendWeeks(week);
      trendWeeks = (Array.isArray(history) ? history : [])
        .filter(item => item && typeof item === 'object')
        .filter(item => !['vip', 'executive'].includes(access.role) || item.isReleased === true)
        // New combined section uses ISO anchors; legacy standalone exports remain unchanged.
        .filter(item => {
          if (!request.sections.includes('portfolio-delivery-performance')) return true;
          const anchor = normalizeDeliveryReportingPeriod(week);
          const period = normalizeDeliveryReportingPeriod(item);
          return anchor && period && (period.year < anchor.year || (period.year === anchor.year && period.week <= anchor.week));
        })
        .map(item => selectOverviewProjects(activeOverviewWeek(item), request.projectCodes))
        .slice(-6);
    }
    const reportWeek = selectOverviewProjects(activeOverviewWeek(clone(week)), request.projectCodes);
    const availableProjectCount = reportableOverviewProjects(week, overviewScope).length;
    const selectedProjectCount = reportableOverviewProjects(reportWeek, overviewScope).length;
    if (request.sections.includes('executive-milestones')) {
      const liveState = week.isReleased === true || typeof adapters.getLiveExecutiveTimeline !== 'function'
        ? null
        : await adapters.getLiveExecutiveTimeline();
      const executiveTimeline = executiveTimelineForReport(week, liveState);
      if (executiveTimeline) {
        reportWeek.strategyLayer = {
          ...(reportWeek.strategyLayer || {}),
          executiveMilestoneTimeline: clone(executiveTimeline)
        };
      }
    }
    const report = {
      access,
      week: reportWeek,
      trendWeeks,
      sections: request.sections,
      overviewScope,
      projectCodes: request.projectCodes,
      availableProjectCount,
      selectedProjectCount,
      projectSelectionApplied: Array.isArray(request.projectCodes),
      projectSelectionIsPartial: selectedProjectCount < availableProjectCount,
      ganttWindowSettings
    };
    if (request.sections.includes(DELIVERY_PERFORMANCE_SECTION_ID)) {
      // A request for ONLY this section on a draft week by a role without draft access is rejected outright. When other
      // sections are also requested their existing authorization is unchanged and only this section fails closed.
      if (!canReadDraftDeliveryHistory(access.role) && week.isReleased !== true && request.sections.length === 1) {
        throw new ReportAccessError('Delivery performance is available only for released weeks.');
      }
      report.deliveryTrends = await deliveryTrendsForReport({ request, week, access, adapters, overviewScope });
    }
    if (request.sections.includes('executive-milestones')) {
      report.executiveAudienceView = authorizeExecutiveAudienceView(user?.role, request.executiveAudienceView);
    }
    return report;
  }

  const project = (week.projects || []).find(item => item?.code === request.projectCode);
  if (!project) throw new ReportDataError('The selected project no longer exists in this reporting week.');
  return {
    access, week, project, sections: includedProjectSections(project, request.sections), ganttWindowSettings
  };
}
