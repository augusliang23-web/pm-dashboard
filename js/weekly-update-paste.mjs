// One-paste weekly update: a deterministic parser for the versioned block the
// Copilot Weekly Update Prompt asks for, plus the pure checks the project
// editor runs before applying it. Pasted text is untrusted: it is only ever
// returned as plain strings, never evaluated, rendered as HTML, or logged.

export const WEEKLY_UPDATE_FORMAT = 'PM_WEEKLY_UPDATE_V1';
export const WEEKLY_UPDATE_MAX_LENGTH = 50000;

/**
 * Stable contract sections -> the existing project fields they fill.
 * `key` is the persisted project field; FIELD_3 becomes `riskActions` rows
 * (the legacy `risk` / `next` text is still derived from them on Save).
 */
export const WEEKLY_UPDATE_SECTIONS = Object.freeze([
  Object.freeze({ id: 'FIELD_1', key: 'highlight', label: 'Highlight' }),
  Object.freeze({ id: 'FIELD_2', key: 'weeklyActions', label: 'Weekly Key Actions' }),
  Object.freeze({ id: 'FIELD_3', key: 'riskActions', label: 'Risk & Mitigation Actions' }),
]);

const SECTION_IDS = WEEKLY_UPDATE_SECTIONS.map(section => section.id);
const labelOf = id => WEEKLY_UPDATE_SECTIONS.find(section => section.id === id)?.label || id;
const describe = id => `${id} (${labelOf(id)})`;

// A marker line may be wrapped in bold/inline-code by chat UIs; nothing else may share its line.
const MARKER_LINE = /^[*`]*<<<\s*([A-Za-z0-9_]+)\s*>>>[*`]*$/;
const RISK_HEADER = /^(?:#{1,6}\s*)?\**\s*Risk\s*#?\s*(\d+)\s*\**\s*:?\s*\**\s*$/i;
const LABEL = String.raw`^(?:[-*•]\s*)?\**\s*(%s)\s*\**\s*:\s*\**\s*(.*)$`;
const PRIMARY_LABEL = new RegExp(LABEL.replace('%s', 'Primary'), 'i');
const RISK_LABEL = new RegExp(LABEL.replace('%s', String.raw`Risk\s*\/\s*Blocker`), 'i');
const ACTION_LABEL = new RegExp(LABEL.replace('%s', String.raw`Required\s+Actions?|Mitigation\s+Actions?`), 'i');
const PLACEHOLDER_ONLY = /^[\s.…\-•*]*$/;

function fail(error) {
  return { ok: false, error };
}

function normalizeText(value) {
  return String(value ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** Drops leading/trailing blank lines and trailing spaces; keeps indentation and bullets. */
function tidyBlock(lines) {
  const trimmed = lines.map(line => line.replace(/[ \t]+$/, ''));
  while (trimmed.length && !trimmed[0].trim()) trimmed.shift();
  while (trimmed.length && !trimmed[trimmed.length - 1].trim()) trimmed.pop();
  return trimmed.join('\n');
}

function isEmptyContent(text) {
  return PLACEHOLDER_ONLY.test(String(text ?? ''));
}

function classifyMarker(name) {
  const upper = name.toUpperCase();
  if (upper === WEEKLY_UPDATE_FORMAT) return { type: 'begin' };
  if (upper === `END_${WEEKLY_UPDATE_FORMAT}`) return { type: 'end' };
  if (SECTION_IDS.includes(upper)) return { type: 'open', id: upper };
  if (upper.startsWith('END_') && SECTION_IDS.includes(upper.slice(4))) return { type: 'close', id: upper.slice(4) };
  if (/^(?:END_)?PM_WEEKLY_UPDATE_V\d+$/.test(upper)) return { type: 'version', name: upper };
  return { type: 'unknown', name: upper };
}

/** Splits FIELD_3 into Risk / Required Action rows. Returns { ok, riskActions } or { ok:false, error }. */
export function parseRiskActionSection(text) {
  const lines = normalizeText(text).split('\n');
  const risks = [];
  let current = null;
  let target = '';
  const where = () => `Risk ${risks.length}`;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const header = line.match(RISK_HEADER);
    if (header) {
      current = { primary: null, risk: null, action: null };
      risks.push(current);
      target = '';
      continue;
    }
    if (!current) {
      if (!line) continue;
      return fail(`${labelOf('FIELD_3')} must start with a "Risk 1" heading.`);
    }
    const primary = line.match(PRIMARY_LABEL);
    const risk = !primary && line.match(RISK_LABEL);
    const action = !primary && !risk && line.match(ACTION_LABEL);
    if (primary) {
      if (current.primary !== null) return fail(`${where()} has more than one "Primary" line.`);
      const value = primary[2].replace(/\*+/g, '').trim().toLowerCase();
      if (value !== 'yes' && value !== 'no') return fail(`${where()}: "Primary" must be Yes or No.`);
      current.primary = value === 'yes';
      target = '';
      continue;
    }
    if (risk || action) {
      const field = risk ? 'risk' : 'action';
      if (current[field] !== null) return fail(`${where()} has more than one "${risk ? 'Risk / Blocker' : 'Required Action'}" entry.`);
      current[field] = risk ? [risk[2]] : [action[2]];
      target = field;
      continue;
    }
    if (!target) {
      if (!line) continue;
      return fail(`${where()} has text outside "Risk / Blocker" and "Required Action".`);
    }
    current[target].push(rawLine);
  }

  if (!risks.length) return fail(`${labelOf('FIELD_3')} must contain at least one risk with a Required Action.`);
  const riskActions = [];
  for (const [index, item] of risks.entries()) {
    const risk = tidyBlock(item.risk || []);
    const action = tidyBlock(item.action || []);
    if (isEmptyContent(risk)) return fail(`Risk ${index + 1} has no "Risk / Blocker" text.`);
    if (isEmptyContent(action)) return fail(`Risk ${index + 1} has no "Required Action" text.`);
    riskActions.push({ primary: item.primary === true, risk, action });
  }
  const primaries = riskActions.filter(item => item.primary).length;
  if (primaries > 1) return fail('More than one risk is marked "Primary: Yes". Mark exactly one.');
  // Same rule as the editor: with no Primary chosen, the first risk is Primary.
  if (!primaries) riskActions[0].primary = true;
  return { ok: true, riskActions };
}

/**
 * Parses a complete Copilot response containing exactly one
 * <<<PM_WEEKLY_UPDATE_V1>>> block. All-or-nothing: either every section is
 * valid and returned, or a single actionable error is returned.
 */
export function parseWeeklyUpdateResponse(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return fail('Paste the complete Copilot response, including the <<<PM_WEEKLY_UPDATE_V1>>> markers.');
  }
  if (input.length > WEEKLY_UPDATE_MAX_LENGTH) {
    return fail(`The pasted response is too long (over ${WEEKLY_UPDATE_MAX_LENGTH.toLocaleString('en-US')} characters). Paste only the weekly update.`);
  }

  const lines = normalizeText(input).split('\n');
  const sections = new Map();
  let state = 'before';
  let open = null;
  let buffer = [];
  let outsideText = false;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    const lineNo = index + 1;
    const markerMatch = line.match(MARKER_LINE);
    if (!markerMatch) {
      if (line.includes('<<<') || line.includes('>>>')) {
        return fail(`Line ${lineNo} has a malformed or misplaced marker. Each <<<...>>> marker must be on its own line.`);
      }
      if (state === 'field') buffer.push(rawLine);
      else if (state === 'block' && line) {
        return fail(`Line ${lineNo} has text outside a section. Keep all content between a <<<FIELD_n>>> and <<<END_FIELD_n>>> pair.`);
      } else if (line && !line.startsWith('```')) outsideText = true;
      continue;
    }

    const marker = classifyMarker(markerMatch[1]);
    if (marker.type === 'unknown') return fail(`Line ${lineNo} has an unrecognized marker <<<${marker.name}>>>.`);
    if (marker.type === 'version') return fail(`Unsupported format <<<${marker.name}>>>. Copy a new Weekly Update Prompt and try again.`);
    if (state === 'after') {
      return fail(marker.type === 'begin'
        ? 'The response contains more than one weekly update block. Paste only one.'
        : `Line ${lineNo} has a marker after <<<END_${WEEKLY_UPDATE_FORMAT}>>>.`);
    }
    if (state === 'before') {
      if (marker.type !== 'begin') return fail(`Line ${lineNo}: <<<${markerMatch[1].toUpperCase()}>>> appears before <<<${WEEKLY_UPDATE_FORMAT}>>>.`);
      state = 'block';
      continue;
    }
    if (state === 'field') {
      if (marker.type === 'close' && marker.id === open) {
        sections.set(open, tidyBlock(buffer));
        state = 'block';
        open = null;
        buffer = [];
        continue;
      }
      return fail(`${describe(open)} is not closed. Add <<<END_${open}>>> before line ${lineNo}.`);
    }
    // state === 'block'
    if (marker.type === 'begin') return fail('The response contains more than one weekly update block. Paste only one.');
    if (marker.type === 'close') return fail(`Line ${lineNo}: <<<END_${marker.id}>>> has no matching <<<${marker.id}>>>.`);
    if (marker.type === 'open') {
      if (sections.has(marker.id)) return fail(`${describe(marker.id)} appears more than once.`);
      state = 'field';
      open = marker.id;
      buffer = [];
      continue;
    }
    // marker.type === 'end'
    state = 'after';
  }

  if (state === 'before') return fail(`No <<<${WEEKLY_UPDATE_FORMAT}>>> block was found. Copy a new Weekly Update Prompt, run it in Copilot, and paste the full response.`);
  if (state === 'field') return fail(`${describe(open)} is not closed. Add <<<END_${open}>>>.`);
  const missing = SECTION_IDS.filter(id => !sections.has(id));
  if (missing.length) return fail(`Missing section${missing.length > 1 ? 's' : ''}: ${missing.map(describe).join(', ')}.`);
  if (state !== 'after') return fail(`The block is not closed. Add <<<END_${WEEKLY_UPDATE_FORMAT}>>>.`);
  for (const id of SECTION_IDS) {
    if (isEmptyContent(sections.get(id))) return fail(`${describe(id)} is empty.`);
  }

  const riskResult = parseRiskActionSection(sections.get('FIELD_3'));
  if (!riskResult.ok) return riskResult;
  return {
    ok: true,
    format: WEEKLY_UPDATE_FORMAT,
    ignoredOutsideText: outsideText,
    values: {
      highlight: sections.get('FIELD_1'),
      weeklyActions: sections.get('FIELD_2'),
      riskActions: riskResult.riskActions,
    },
  };
}

/** Validates (possibly PM-edited) preview values before they are applied. */
export function validateWeeklyUpdateValues(values = {}) {
  if (isEmptyContent(values.highlight)) return fail(`${labelOf('FIELD_1')} is empty.`);
  if (isEmptyContent(values.weeklyActions)) return fail(`${labelOf('FIELD_2')} is empty.`);
  const pairs = Array.isArray(values.riskActions) ? values.riskActions : [];
  if (!pairs.length) return fail(`${labelOf('FIELD_3')} needs at least one risk.`);
  for (const [index, pair] of pairs.entries()) {
    if (isEmptyContent(pair?.risk)) return fail(`Risk ${index + 1} has no "Risk / Blocker" text.`);
    if (isEmptyContent(pair?.action)) return fail(`Risk ${index + 1} has no "Mitigation Actions" text.`);
  }
  if (pairs.filter(pair => pair?.primary === true).length !== 1) return fail('Mark exactly one risk as Primary.');
  return { ok: true };
}

function comparableRiskActions(pairs) {
  const rows = (Array.isArray(pairs) ? pairs : [])
    .map(pair => ({
      primary: pair?.primary === true,
      risk: normalizeText(pair?.risk).trim(),
      action: normalizeText(pair?.action).trim(),
    }))
    .filter(pair => pair.risk || pair.action);
  if (rows.length && !rows.some(pair => pair.primary)) rows[0].primary = true;
  return rows.sort((a, b) => Number(b.primary) - Number(a.primary));
}

/** True when the three weekly fields hold different content (whitespace/line-ending insensitive at the edges). */
export function weeklyFieldsDiffer(left = {}, right = {}) {
  const text = value => normalizeText(value).trim();
  return text(left.highlight) !== text(right.highlight)
    || text(left.weeklyActions ?? left.weeklyAction) !== text(right.weeklyActions ?? right.weeklyAction)
    || JSON.stringify(comparableRiskActions(left.riskActions)) !== JSON.stringify(comparableRiskActions(right.riskActions));
}

/**
 * A parsed draft may only be applied in the exact editor session (same
 * project, same week, same opening) it was parsed in, and only while the
 * pasted source is still exactly the text it was parsed from.
 */
export function isWeeklyUpdateDraftCurrent(draft, session, currentSource) {
  return Boolean(
    draft && session
    && draft.sessionToken === session.token
    && draft.weekId === session.weekId
    && draft.projectCode === session.code
    && typeof draft.source === 'string'
    && draft.source === currentSource
  );
}
