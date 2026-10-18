import { sortWeeksChronologically } from './week-order.mjs';

/**
 * Normalizes a project code for identity and deduplication checks.
 * Trims whitespace and folds to lower-case.
 */
export function normalizeProjectCode(code) {
  return String(code || '').trim().toLowerCase();
}

/**
 * Checks whether a given reporting week is released/locked.
 */
export function isWeekReleased(week) {
  return week?.isReleased === true;
}

/**
 * Identifies the target unreleased reporting week for restoration.
 *
 * Precedence:
 * 1. If the currently selected week exists and is unreleased, use it.
 * 2. Otherwise, find the latest chronological unreleased week in allWeeks.
 * 3. If all weeks are released (or no weeks exist), return null.
 */
export function findTargetDraftWeek(allWeeks = [], currentIdx = -1) {
  const weeks = Array.isArray(allWeeks) ? allWeeks : [];
  if (currentIdx >= 0 && currentIdx < weeks.length) {
    const candidate = weeks[currentIdx];
    if (candidate && !isWeekReleased(candidate)) {
      return candidate;
    }
  }
  const ordered = sortWeeksChronologically(weeks);
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (!isWeekReleased(ordered[i])) {
      return ordered[i];
    }
  }
  return null;
}

/**
 * Deep-clones an object safely for Firestore-compatible data.
 */
function cloneData(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Scans historical reporting weeks and discovers all archived projects.
 *
 * Rules:
 * 1. Orders weeks chronologically from earliest to latest.
 * 2. Tracks the latest valid snapshot for each normalized project code.
 * 3. Identifies a project as archived if and only if its latest known appearance
 *    has visibility === 'archived'.
 * 4. Hidden projects (visibility === 'hidden') are NOT archived.
 * 5. If the project is already active in targetWeek (or currentWeek), it is excluded
 *    from the archived collection (as it is already active).
 * 6. Preserves existing metadata faithfully without inventing information.
 */
export function collectArchivedProjects(allWeeks = [], targetWeek = null) {
  if (!Array.isArray(allWeeks) || allWeeks.length === 0) {
    return {
      archived: [],
      isHistoricalIncomplete: !Array.isArray(allWeeks),
    };
  }

  const orderedWeeks = sortWeeksChronologically(allWeeks);
  const projectHistory = new Map();

  for (const week of orderedWeeks) {
    const projects = Array.isArray(week?.projects) ? week.projects : [];
    for (const project of projects) {
      const code = normalizeProjectCode(project?.code);
      if (!code) continue;
      projectHistory.set(code, {
        project: cloneData(project),
        weekLabel: String(week.weekLabel || '').trim(),
        weekDate: String(week.weekDate || '').trim(),
        weekId: String(week.__documentId || week.weekId || '').trim(),
      });
    }
  }

  // Active codes in the target/current week
  const activeInTarget = new Set(
    (Array.isArray(targetWeek?.projects) ? targetWeek.projects : [])
      .filter(p => !p.visibility || p.visibility === 'active')
      .map(p => normalizeProjectCode(p.code))
      .filter(Boolean)
  );

  const archived = [];

  for (const [code, entry] of projectHistory.entries()) {
    const project = entry.project;
    // Must be explicitly archived in its latest known appearance
    if (project.visibility !== 'archived') continue;

    // Must not already be active in target week
    const isAlreadyActive = activeInTarget.has(code);

    archived.push({
      code: project.code || code,
      normalizedCode: code,
      name: project.name || '',
      owner: project.owner || '',
      customer: project.customer || '',
      archivedWeekLabel: entry.weekLabel,
      archivedWeekDate: entry.weekDate,
      archivedWeekId: entry.weekId,
      lastStatus: project.status || 'gray',
      isAlreadyActive,
      latestSnapshot: project,
    });
  }

  // Sort alphabetically by code
  archived.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }));

  return {
    archived,
    isHistoricalIncomplete: false,
  };
}

/**
 * Filters the archived projects list by code or name substring (case-insensitive).
 */
export function filterArchivedProjects(archivedList = [], searchQuery = '') {
  const query = String(searchQuery || '').trim().toLowerCase();
  if (!query) return [...archivedList];

  return archivedList.filter(item => {
    const codeMatch = normalizeProjectCode(item.code).includes(query);
    const nameMatch = String(item.name || '').toLowerCase().includes(query);
    return codeMatch || nameMatch;
  });
}

/**
 * Determines whether a specific project code can be restored into the target week.
 */
export function canRestoreProject(projectCode, targetWeek) {
  const code = normalizeProjectCode(projectCode);
  if (!code) {
    return { allowed: false, reason: 'Invalid project code.' };
  }
  if (!targetWeek) {
    return { allowed: false, reason: 'No eligible draft reporting week is available. Create a new week first.' };
  }
  if (isWeekReleased(targetWeek)) {
    return { allowed: false, reason: 'The target reporting week is released and locked.' };
  }

  const existingProjects = Array.isArray(targetWeek.projects) ? targetWeek.projects : [];
  const collision = existingProjects.some(p => normalizeProjectCode(p.code) === code);
  if (collision) {
    return { allowed: false, reason: `A project with code "${projectCode}" already exists in the target week.` };
  }

  return { allowed: true };
}

/**
 * Prepares the restored project payload for saving into the target week.
 * Sets visibility to 'active'.
 */
export function buildRestoredProjectPayload(archivedRecord) {
  const snapshot = cloneData(archivedRecord?.latestSnapshot || {});
  return {
    ...snapshot,
    code: archivedRecord.code || snapshot.code,
    visibility: 'active',
  };
}
