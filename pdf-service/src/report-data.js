import {
  authorizeExecutiveAudienceView,
  authorizeReportAccess,
  ReportAccessError
} from './report-access.js';
import { validateExecutiveSummaryForPdf } from './executive-summary-brief.js';

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

function executiveTimelineForReport(week, liveState) {
  const snapshot = week?.strategyLayer?.executiveMilestoneTimelineSnapshot;
  if (week?.isReleased === true && snapshot?.timeline) return snapshot.timeline;
  if (week?.isReleased !== true && liveState?.timeline) return liveState.timeline;
  return week?.strategyLayer?.executiveMilestoneTimeline || week?.executiveMilestoneTimeline || null;
}

export async function loadAuthorizedReport({ request, idToken, adapters }) {
  const decodedToken = await adapters.verifyIdToken(idToken);
  const email = String(decodedToken?.email || '').trim().toLowerCase();
  if (!email) throw new ReportAccessError('The authentication token does not include an email address.', 401);
  const user = await adapters.getUserByEmail(email);
  const week = await adapters.getWeekById(request.weekId);
  if (!week) throw new ReportDataError('The selected reporting week no longer exists.');
  const access = authorizeReportAccess({ email, role: user?.role }, week, request);

  if (request.mode !== 'project') {
    if (request.sections.includes('executive-summary')) {
      const summary = String(week.executiveSummary || week.summary || week.overviewSummary || '');
      const validation = validateExecutiveSummaryForPdf(summary);
      if (!validation.ok) {
        const details = validation.errors.map(error => error.message).join(' ');
        throw new ReportDataError(`Weekly Summary is not valid for PDF export: ${details}`, 422);
      }
    }
    let trendWeeks = [];
    if (request.sections.includes('weekly-trend') && typeof adapters.getTrendWeeks === 'function') {
      const history = await adapters.getTrendWeeks(week);
      trendWeeks = (Array.isArray(history) ? history : [])
        .filter(item => item && typeof item === 'object')
        .filter(item => access.role !== 'executive' || item.isReleased === true)
        .slice(-6);
    }
    const reportWeek = clone(week);
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
      overviewScope: request.overviewScope || 'system'
    };
    if (request.sections.includes('executive-milestones')) {
      report.executiveAudienceView = authorizeExecutiveAudienceView(user?.role, request.executiveAudienceView);
    }
    return report;
  }

  const project = (week.projects || []).find(item => item?.code === request.projectCode);
  if (!project) throw new ReportDataError('The selected project no longer exists in this reporting week.');
  return { access, week, project, sections: includedProjectSections(project, request.sections) };
}
