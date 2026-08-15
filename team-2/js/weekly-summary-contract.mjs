export const NO_MANAGEMENT_DECISION_TEXT = 'No immediate management decision required this week.';

const MOVEMENT_HEADING = /^WEEKLY MOVEMENT$/i;
const MANAGEMENT_HEADING = /^MANAGEMENT ASK$/i;
const PORTFOLIO_SUMMARY = /^Portfolio Summary:\s*(.*)$/i;
const PROJECT_LINE = /^-\s+Project:\s*(.*)$/i;
const MOVEMENT_FIELD = /^Movement:\s*(.*)$/i;
const BLOCKER_FIELD = /^Blocker:\s*(.*)$/i;
const NEXT_STEP_FIELD = /^Next step:\s*(.*)$/i;
const SUPPORT_FIELD = /^Decision \/ Support needed:\s*(.*)$/i;
const IMPACT_FIELD = /^Business impact:\s*(.*)$/i;

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

function activeProjectNames(activeProjects) {
  return new Set((Array.isArray(activeProjects) ? activeProjects : [])
    .map(project => typeof project === 'string' ? project : project?.name)
    .map(name => String(name || '').trim())
    .filter(Boolean));
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

function parseMovementProject(lines, start, names, errors) {
  const index = findNextSignificant(lines, start);
  const match = index < lines.length ? lines[index].trim().match(PROJECT_LINE) : null;
  if (!match) {
    errors.push(error(index < lines.length ? index + 1 : null, 'Expected "- Project:" for a movement entry.'));
    return { index: Math.min(lines.length, index + 1), project: null };
  }
  const projectName = match[1].trim();
  if (!projectName) errors.push(error(index + 1, 'Project name cannot be empty.'));
  else if (!names.has(projectName)) {
    errors.push(error(index + 1, `"${projectName}" is not an active project name.`));
  }
  let cursor = index + 1;
  const movement = readField(lines, cursor, MOVEMENT_FIELD, 'Movement', errors, projectName);
  cursor = movement.index;
  const blocker = readField(lines, cursor, BLOCKER_FIELD, 'Blocker', errors, projectName, true);
  cursor = blocker.index;
  const nextStep = readField(lines, cursor, NEXT_STEP_FIELD, 'Next step', errors, projectName);
  cursor = nextStep.index;
  return {
    index: cursor,
    project: { projectName, movement: movement.value, blocker: blocker.value, nextStep: nextStep.value }
  };
}

function parseManagementProject(lines, start, names, errors) {
  const index = findNextSignificant(lines, start);
  const match = index < lines.length ? lines[index].trim().match(PROJECT_LINE) : null;
  if (!match) {
    errors.push(error(index < lines.length ? index + 1 : null, 'Expected "- Project:" for a management ask.'));
    return { index: Math.min(lines.length, index + 1), ask: null };
  }
  const projectName = match[1].trim();
  if (!projectName) errors.push(error(index + 1, 'Project name cannot be empty.'));
  else if (!names.has(projectName)) {
    errors.push(error(index + 1, `"${projectName}" is not an active project name.`));
  }
  let cursor = index + 1;
  const support = readField(lines, cursor, SUPPORT_FIELD, 'Decision / Support needed', errors, projectName);
  cursor = support.index;
  const impact = readField(lines, cursor, IMPACT_FIELD, 'Business impact', errors, projectName);
  cursor = impact.index;
  return {
    index: cursor,
    ask: { projectName, supportNeeded: support.value, businessImpact: impact.value }
  };
}

export function validateWeeklySummaryForSave(source, activeProjects = []) {
  const normalized = String(source ?? '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const errors = [];
  const names = activeProjectNames(activeProjects);
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
  const portfolioMatch = cursor < lines.length ? lines[cursor].trim().match(PORTFOLIO_SUMMARY) : null;
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
    const parsed = parseMovementProject(lines, next, names, errors);
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
        const parsed = parseManagementProject(lines, next, names, errors);
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
