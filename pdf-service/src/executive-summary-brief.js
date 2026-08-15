import { validateWeeklySummaryForPdf } from './weekly-summary-contract.js';

export const validateExecutiveSummaryForPdf = validateWeeklySummaryForPdf;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function optional(value) {
  const result = clean(value);
  return /^(none|n\/a|not applicable)$/i.test(result) ? '' : result;
}

function heading(line) {
  return clean(line).replace(/^#{1,6}\s*/, '').replace(/[:：]\s*$/, '').toUpperCase();
}

function rankProjects(projects, asks) {
  const asked = new Set(asks.map(item => item.projectName.toLowerCase()));
  return projects
    .map((project, index) => ({ project, index, asked: asked.has(project.projectName.toLowerCase()) }))
    .sort((left, right) => Number(right.asked) - Number(left.asked) || left.index - right.index)
    .map(item => item.project);
}

export function parseExecutiveSummaryBrief(summary = '') {
  const projects = [];
  const managementAsks = [];
  const fallback = [];
  let portfolioSummary = '';
  let section = '';
  let currentProject = null;
  let currentAsk = null;

  const flushProject = () => {
    if (currentProject?.projectName) projects.push(currentProject);
    currentProject = null;
  };
  const flushAsk = () => {
    if (currentAsk?.projectName) managementAsks.push(currentAsk);
    currentAsk = null;
  };

  String(summary || '').replace(/\r\n?/g, '\n').split('\n').forEach(rawLine => {
    let line = clean(rawLine);
    if (!line) return;
    const inlineHeadingMatch = line.match(/^(WEEKLY MOVEMENT|MANAGEMENT ASK)\s*[:\uFF1A]?\s+(.+)$/i);
    if (inlineHeadingMatch) {
      if (inlineHeadingMatch[1].toUpperCase() === 'WEEKLY MOVEMENT') {
        flushAsk();
        section = 'movement';
      } else {
        flushProject();
        section = 'ask';
      }
      line = clean(inlineHeadingMatch[2]);
    }
    const normalizedHeading = heading(line);
    if (normalizedHeading === 'WEEKLY MOVEMENT') {
      flushAsk();
      section = 'movement';
      return;
    }
    if (normalizedHeading === 'MANAGEMENT ASK') {
      flushProject();
      section = 'ask';
      return;
    }

    const portfolioMatch = line.match(/^Portfolio Summary\s*[:：]\s*(.+)$/i);
    if (portfolioMatch) {
      portfolioSummary = clean(portfolioMatch[1]);
      return;
    }

    const projectMatch = line.match(/^[-*+]?\s*Project\s*[:：]\s*(.+)$/i);
    if (projectMatch) {
      if (section === 'ask') {
        flushAsk();
        currentAsk = { projectName: clean(projectMatch[1]), supportNeeded: '', businessImpact: '' };
      } else {
        flushProject();
        currentProject = { projectName: clean(projectMatch[1]), movement: '', blocker: '', nextStep: '' };
      }
      return;
    }

    const fieldMatch = line.match(/^(Movement|Blocker|Next step|Decision \/ Support needed|Business impact)\s*[:：]\s*(.*)$/i);
    if (fieldMatch) {
      const label = fieldMatch[1].toLowerCase();
      const value = optional(fieldMatch[2]);
      if (label === 'movement' && currentProject) currentProject.movement = value;
      if (label === 'blocker' && currentProject) currentProject.blocker = value;
      if (label === 'next step' && currentProject) currentProject.nextStep = value;
      if (label === 'decision / support needed' && currentAsk) currentAsk.supportNeeded = value;
      if (label === 'business impact' && currentAsk) currentAsk.businessImpact = value;
      return;
    }

    const legacyMatch = line.match(/^[-*+]\s+(.+?)\s*[:：]\s*(.+)$/);
    const unbulletedLegacyMatch = line.match(/^(.+?)\s*[:\uFF1A]\s*(.+)$/);
    if (unbulletedLegacyMatch && !line.match(/^[-*+]\s+/) && section === 'movement') {
      flushProject();
      projects.push({
        projectName: clean(unbulletedLegacyMatch[1]),
        movement: clean(unbulletedLegacyMatch[2]),
        blocker: '',
        nextStep: ''
      });
      return;
    }
    if (unbulletedLegacyMatch && !line.match(/^[-*+]\s+/) && section === 'ask') {
      flushAsk();
      managementAsks.push({
        projectName: clean(unbulletedLegacyMatch[1]),
        supportNeeded: clean(unbulletedLegacyMatch[2]),
        businessImpact: ''
      });
      return;
    }
    if (legacyMatch && section === 'movement') {
      flushProject();
      projects.push({
        projectName: clean(legacyMatch[1]),
        movement: clean(legacyMatch[2]),
        blocker: '',
        nextStep: ''
      });
      return;
    }
    if (legacyMatch && section === 'ask') {
      flushAsk();
      managementAsks.push({
        projectName: clean(legacyMatch[1]),
        supportNeeded: clean(legacyMatch[2]),
        businessImpact: ''
      });
      return;
    }

    fallback.push(line.replace(/^[-*+]\s*/, ''));
  });

  flushProject();
  flushAsk();
  const visibleProjects = projects.slice(0, 6);
  const visibleAsks = managementAsks.slice(0, 4);
  return {
    portfolioSummary: portfolioSummary || fallback[0] || '',
    projects: visibleProjects,
    priorityProjects: rankProjects(visibleProjects, visibleAsks).slice(0, 2),
    managementAsks: visibleAsks,
    fallbackText: fallback.join(' '),
    hasAdditionalContent: projects.length > visibleProjects.length || managementAsks.length > visibleAsks.length
  };
}
