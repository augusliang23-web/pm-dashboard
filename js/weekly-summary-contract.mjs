export const NO_MANAGEMENT_DECISION_TEXT = 'No immediate management decision required this week.';

const MOVEMENT_HEADING = /^WEEKLY MOVEMENT$/i;
const MANAGEMENT_HEADING = /^MANAGEMENT ASK$/i;
const PORTFOLIO_SUMMARY = /^Portfolio Summary\s*[:：]\s*(.*)$/i;
const PROJECT_LINE = /^-\s+Project:\s*(.*)$/i;
const PROJECT_LINE_VARIANT = /^\s*(?:[-*+•]\s*)?Project\s*[:：]\s*(.*?)\s*$/i;
const MOVEMENT_FIELD = /^Movement:\s*(.*)$/i;
const BLOCKER_FIELD = /^Blocker:\s*(.*)$/i;
const NEXT_STEP_FIELD = /^Next step:\s*(.*)$/i;
const SUPPORT_FIELD = /^Decision \/ Support needed:\s*(.*)$/i;
const IMPACT_FIELD = /^Business impact:\s*(.*)$/i;

const FIELD_VARIANTS = [
  ['Movement', /^\s*Movement\s*[:：]\s*(.*?)\s*$/i, MOVEMENT_FIELD],
  ['Blocker', /^\s*Blocker\s*[:：]\s*(.*?)\s*$/i, BLOCKER_FIELD],
  ['Next step', /^\s*Next step\s*[:：]\s*(.*?)\s*$/i, NEXT_STEP_FIELD],
  ['Decision / Support needed', /^\s*Decision \/ Support needed\s*[:：]\s*(.*?)\s*$/i, SUPPORT_FIELD],
  ['Business impact', /^\s*Business impact\s*[:：]\s*(.*?)\s*$/i, IMPACT_FIELD]
];

function error(line, message) {
  return { line, message };
}

function isBlank(line) {
  return line.trim() === '';
}

function isMarkdownLine(line) {
  const value = line.trim();
  return /^#{1,6}\s/.test(value)
    || /^(```|~~~)/.test(value)
    || /^\|/.test(value)
    || /^\|.*\|$/.test(value)
    || /^\*\*.*\*\*$/.test(value)
    || /^__.*__$/.test(value);
}

function projectName(project) {
  return typeof project === 'string' ? project : project?.name;
}

function normalizedProjectKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function projectList(projects) {
  return (Array.isArray(projects) ? projects : [])
    .map(project => ({ project, name: String(projectName(project) || '').trim() }))
    .filter(({ name }) => name);
}

function buildProjectContext({ currentProjects = [], historicalProjects = [] } = {}) {
  const current = projectList(currentProjects);
  const historical = projectList(historicalProjects);
  const currentByExact = new Map(current.map(item => [item.name, item.name]));
  const currentByKey = new Map(current.map(item => [normalizedProjectKey(item.name), item.name]));
  const historicalByExact = new Map(historical.map(item => [item.name, item.name]));
  const historicalByKey = new Map(historical.map(item => [normalizedProjectKey(item.name), item.name]));
  return { currentByExact, currentByKey, historicalByExact, historicalByKey };
}

function resolveProject(name, context, allowHistorical) {
  const value = String(name || '').trim();
  if (!value) return { name: '', kind: null };
  if (context.currentByExact.has(value)) return { name: context.currentByExact.get(value), kind: 'current' };
  if (context.currentByKey.has(normalizedProjectKey(value))) {
    return { name: context.currentByKey.get(normalizedProjectKey(value)), kind: 'current' };
  }
  if (allowHistorical && context.historicalByExact.has(value)) {
    return { name: context.historicalByExact.get(value), kind: 'historical' };
  }
  if (allowHistorical && context.historicalByKey.has(normalizedProjectKey(value))) {
    return { name: context.historicalByKey.get(normalizedProjectKey(value)), kind: 'historical' };
  }
  if (context.historicalByExact.has(value) || context.historicalByKey.has(normalizedProjectKey(value))) {
    return { name: value, kind: 'historical' };
  }
  return { name: value, kind: null };
}

function findNextSignificant(lines, start) {
  let index = start;
  while (index < lines.length && isBlank(lines[index])) index += 1;
  return index;
}

function readField(lines, index, matcher, label, errors, projectName, allowNone = false) {
  const current = findNextSignificant(lines, index);
  if (current >= lines.length) {
    errors.push(error(null, `Project "${projectName}" is missing "${label}:".`));
    return { index: current, value: '' };
  }
  const line = lines[current];
  const match = line.trim().match(matcher);
  if (!match) {
    errors.push(error(current + 1, `Project "${projectName}": expected "${label}:".`));
    return { index: current, value: '' };
  }
  const value = match[1].trim();
  if (!value) errors.push(error(current + 1, `Project "${projectName}": "${label}:" cannot be empty.`));
  if (!allowNone && /^none$/i.test(value)) {
    errors.push(error(current + 1, `Project "${projectName}": only "Blocker:" may use None.`));
  }
  return { index: current + 1, value };
}

function projectMembershipError(projectName, section, context) {
  if (section === 'management' && (context.historicalByExact.has(projectName)
    || context.historicalByKey.has(normalizedProjectKey(projectName)))) {
    return `"${projectName}" must be a current active project for a management ask.`;
  }
  return `"${projectName}" is not an active project name and was not found in the current or comparison-week project list.`;
}

function parseMovementProject(lines, start, context, errors) {
  const index = findNextSignificant(lines, start);
  const match = index < lines.length ? lines[index].trim().match(PROJECT_LINE) : null;
  if (!match) {
    errors.push(error(index < lines.length ? index + 1 : null, 'Expected "- Project:" for a movement entry.'));
    return { index: Math.min(lines.length, index + 1), project: null };
  }
  const projectName = match[1].trim();
  const resolved = resolveProject(projectName, context, true);
  if (!projectName) errors.push(error(index + 1, 'Project name cannot be empty.'));
  else if (!resolved.kind) errors.push(error(index + 1, projectMembershipError(projectName, 'movement', context)));
  let cursor = index + 1;
  const movement = readField(lines, cursor, MOVEMENT_FIELD, 'Movement', errors, projectName);
  cursor = movement.index;
  const blocker = readField(lines, cursor, BLOCKER_FIELD, 'Blocker', errors, projectName, true);
  cursor = blocker.index;
  const nextStep = readField(lines, cursor, NEXT_STEP_FIELD, 'Next step', errors, projectName);
  cursor = nextStep.index;
  return {
    index: cursor,
    project: { projectName: resolved.name || projectName, movement: movement.value, blocker: blocker.value, nextStep: nextStep.value }
  };
}

function parseManagementProject(lines, start, context, errors) {
  const index = findNextSignificant(lines, start);
  const match = index < lines.length ? lines[index].trim().match(PROJECT_LINE) : null;
  if (!match) {
    errors.push(error(index < lines.length ? index + 1 : null, 'Expected "- Project:" for a management ask.'));
    return { index: Math.min(lines.length, index + 1), ask: null };
  }
  const projectName = match[1].trim();
  const resolved = resolveProject(projectName, context, false);
  if (!projectName) errors.push(error(index + 1, 'Project name cannot be empty.'));
  else if (resolved.kind !== 'current') errors.push(error(index + 1, projectMembershipError(projectName, 'management', context)));
  let cursor = index + 1;
  const support = readField(lines, cursor, SUPPORT_FIELD, 'Decision / Support needed', errors, projectName);
  cursor = support.index;
  const impact = readField(lines, cursor, IMPACT_FIELD, 'Business impact', errors, projectName);
  cursor = impact.index;
  return {
    index: cursor,
    ask: { projectName: resolved.name || projectName, supportNeeded: support.value, businessImpact: impact.value }
  };
}

function validateCanonicalWeeklySummary(source, context) {
  const normalized = String(source ?? '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const errors = [];
  const projects = [];
  const managementAsks = [];
  const first = findNextSignificant(lines, 0);

  if (!normalized.trim()) {
    return { ok: false, canonicalText: '', errors: [error(null, 'Weekly Summary is required.')], brief: null };
  }
  if (first >= lines.length || !MOVEMENT_HEADING.test(lines[first].trim())) {
    const message = first < lines.length && isMarkdownLine(lines[first])
      ? 'Markdown heading is not allowed; use "WEEKLY MOVEMENT".'
      : 'Summary must begin with "WEEKLY MOVEMENT".';
    errors.push(error(first < lines.length ? first + 1 : null, message));
  }

  let cursor = findNextSignificant(lines, first + 1);
  const portfolioMatch = cursor < lines.length ? lines[cursor].trim().match(/^Portfolio Summary:\s*(.*)$/i) : null;
  if (!portfolioMatch || !portfolioMatch[1].trim()) {
    errors.push(error(cursor < lines.length ? cursor + 1 : null, 'Expected a non-empty "Portfolio Summary:".'));
  }
  const portfolioSummary = portfolioMatch?.[1]?.trim() || '';
  cursor = portfolioMatch ? cursor + 1 : cursor;

  let managementIndex = -1;
  while (cursor < lines.length) {
    const next = findNextSignificant(lines, cursor);
    if (next >= lines.length) break;
    const value = lines[next].trim();
    if (MANAGEMENT_HEADING.test(value)) {
      managementIndex = next;
      cursor = next + 1;
      break;
    }
    if (isMarkdownLine(lines[next])) {
      errors.push(error(next + 1, 'Markdown headings, tables, emphasis, and code fences are not allowed.'));
      cursor = next + 1;
      continue;
    }
    const parsed = parseMovementProject(lines, next, context, errors);
    if (parsed.project) projects.push(parsed.project);
    cursor = Math.max(next + 1, parsed.index);
  }

  if (managementIndex < 0) {
    errors.push(error(null, 'Summary must include one "MANAGEMENT ASK" heading after movement entries.'));
  } else {
    const bodyStart = findNextSignificant(lines, cursor);
    if (bodyStart < lines.length && lines[bodyStart].trim() === NO_MANAGEMENT_DECISION_TEXT) {
      const afterNoAsk = findNextSignificant(lines, bodyStart + 1);
      if (afterNoAsk < lines.length) {
        errors.push(error(afterNoAsk + 1, 'MANAGEMENT ASK must contain only the no-decision sentence when no ask is needed.'));
      }
    } else {
      cursor = bodyStart;
      while (cursor < lines.length) {
        const next = findNextSignificant(lines, cursor);
        if (next >= lines.length) break;
        if (isMarkdownLine(lines[next])) {
          errors.push(error(next + 1, 'Markdown headings, tables, emphasis, and code fences are not allowed.'));
          cursor = next + 1;
          continue;
        }
        const parsed = parseManagementProject(lines, next, context, errors);
        if (parsed.ask) managementAsks.push(parsed.ask);
        cursor = Math.max(next + 1, parsed.index);
      }
      if (!managementAsks.length) {
        errors.push(error(bodyStart < lines.length ? bodyStart + 1 : null, `MANAGEMENT ASK must contain a project entry or the exact sentence "${NO_MANAGEMENT_DECISION_TEXT}".`));
      }
      if (managementAsks.length > 4) {
        errors.push(error(null, 'MANAGEMENT ASK may contain at most four entries.'));
      }
    }
  }

  if (!projects.length) errors.push(error(null, 'WEEKLY MOVEMENT must contain at least one project entry.'));
  const ok = errors.length === 0;
  return {
    ok,
    canonicalText: ok ? normalized : '',
    errors,
    brief: ok ? { portfolioSummary, projects, managementAsks } : null
  };
}

function correction(line, before, after, message) {
  return { line, before, after, message };
}

function normalizeLine(line, lineNumber, corrections) {
  const trimmed = line.trim();
  if (!trimmed) return line;
  let after = line;
  if (MOVEMENT_HEADING.test(trimmed)) after = 'WEEKLY MOVEMENT';
  else if (MANAGEMENT_HEADING.test(trimmed)) after = 'MANAGEMENT ASK';
  else {
    const portfolio = trimmed.match(PORTFOLIO_SUMMARY);
    if (portfolio) after = `Portfolio Summary: ${portfolio[1].trim()}`;
    else {
      const project = trimmed.match(PROJECT_LINE_VARIANT);
      if (project) after = `- Project: ${project[1].trim()}`;
      else {
        for (const [label, variant] of FIELD_VARIANTS) {
          const field = trimmed.match(variant);
          if (field) {
            after = `  ${label}: ${field[1].trim()}`;
            break;
          }
        }
      }
    }
  }
  if (after !== line) {
    const label = after.match(/^\s*-?\s*(Project|Movement|Blocker|Next step|Decision \/ Support needed|Business impact|Portfolio Summary)\s*:/i)?.[1];
    corrections.push(correction(
      lineNumber,
      line,
      after,
      label ? `Normalized ${label}: on line ${lineNumber}.` : `Normalized line ${lineNumber} to the weekly summary format.`
    ));
  }
  return after;
}

export function normalizeWeeklySummaryForSave(source, context = {}) {
  const raw = String(source ?? '');
  const normalized = raw.replace(/\r\n?/g, '\n');
  const corrections = [];
  const lines = normalized.split('\n');
  const canonicalCandidate = lines.map((line, index) => normalizeLine(line, index + 1, corrections)).join('\n');
  const validation = validateCanonicalWeeklySummary(canonicalCandidate, buildProjectContext(context));
  return {
    ...validation,
    canonicalText: validation.ok ? canonicalCandidate : '',
    corrections,
    brief: validation.brief,
    summary: validation.brief
      ? `${validation.brief.projects.length} movement entr${validation.brief.projects.length === 1 ? 'y' : 'ies'} validated.`
      : ''
  };
}

export function validateWeeklySummaryForSave(source, activeProjects = []) {
  return normalizeWeeklySummaryForSave(source, { currentProjects: activeProjects });
}
