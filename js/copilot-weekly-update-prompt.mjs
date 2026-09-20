import { normalizeRiskActionRows } from './portfolio-core.mjs';

const NONE_RECORDED = '(none recorded)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const STATUS_LABELS = { green: 'On Track', yellow: 'At Risk', red: 'Critical' };

function clean(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function normalizeName(value) {
  return clean(value).toLowerCase().replace(/\s+/g, ' ');
}

function parseWeekLabel(label) {
  const match = clean(label).match(/^W(\d{1,2})\s+(\d{4})\b/i);
  return match ? { week: Number(match[1]), year: Number(match[2]) } : null;
}

function weekKey(parsed) {
  return parsed.year * 100 + parsed.week;
}

function isoDate(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return '';
  return date.toISOString().slice(0, 10);
}

/**
 * Turns a week record ("W38 2026" / "Sep 14 - Sep 18") into ISO start/end dates.
 * `raw` always carries the stored weekDate text so callers can still show it
 * when the range cannot be parsed.
 */
export function resolveWeekPeriod(week = {}) {
  const raw = clean(week?.weekDate);
  const label = parseWeekLabel(week?.weekLabel);
  const match = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*[-–—]\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})$/);
  const unresolved = { start: '', end: '', raw };
  if (!match || !label) return unresolved;

  const startMonth = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase());
  const endMonth = MONTHS.indexOf(match[3].slice(0, 3).toLowerCase());
  if (startMonth < 0 || endMonth < 0) return unresolved;

  let startYear = label.year;
  let endYear = label.year;
  if (startMonth > endMonth) {
    // The range crosses New Year: W52/W53 ends next year, W1 starts last year.
    if (label.week >= 52) endYear += 1;
    else startYear -= 1;
  }
  const start = isoDate(startYear, startMonth, Number(match[2]));
  const end = isoDate(endYear, endMonth, Number(match[4]));
  return start && end ? { start, end, raw } : unresolved;
}

/**
 * The latest persisted week strictly before `currentWeek`, ordered by
 * (year, week) rather than array position so a year rollover cannot pick the
 * wrong week.
 */
export function findPreviousWeek(weeks = [], currentWeek = {}) {
  const current = parseWeekLabel(currentWeek?.weekLabel);
  if (!current) return null;
  const currentKey = weekKey(current);
  let best = null;
  let bestKey = -1;
  for (const week of Array.isArray(weeks) ? weeks : []) {
    const parsed = parseWeekLabel(week?.weekLabel);
    if (!parsed) continue;
    const key = weekKey(parsed);
    if (key < currentKey && key > bestKey) {
      best = week;
      bestKey = key;
    }
  }
  return best;
}

/**
 * The same project as it was saved in the previous week, matched by project
 * code first and then by name. Returns { week, project } or null.
 */
export function findPreviousReport({ weeks = [], currentWeek = {}, project = {} } = {}) {
  const week = findPreviousWeek(weeks, currentWeek);
  if (!week) return null;
  const projects = Array.isArray(week.projects) ? week.projects : [];
  const code = clean(project?.code).toLowerCase();
  const name = normalizeName(project?.name);
  const found = (code && projects.find(item => clean(item?.code).toLowerCase() === code))
    || (name && projects.find(item => normalizeName(item?.name) === name))
    || null;
  return found ? { week, project: found } : null;
}

function describeWeek(week) {
  const label = clean(week?.weekLabel);
  const dates = clean(week?.weekDate);
  return label && dates ? `${label} (${dates})` : label || dates;
}

function describeStatus(project) {
  const label = STATUS_LABELS[clean(project?.status)] || '';
  const progress = Number.isFinite(Number(project?.progress)) && clean(project?.progress) !== ''
    ? `progress ${Number(project.progress)}%`
    : '';
  if (label && progress) return `${label} (${progress})`;
  return label || progress;
}

/**
 * Assembles the plain-data context for the prompt from persisted weeks only.
 * Nothing here reads editor/DOM state, so unsaved edits cannot leak into the
 * "last week" baseline.
 */
export function buildPromptContext({ weeks = [], currentWeek = {}, project = {} } = {}) {
  const period = resolveWeekPeriod(currentWeek);
  const previous = findPreviousReport({ weeks, currentWeek, project });
  return {
    projectName: clean(project?.name),
    customerName: clean(project?.customer),
    projectStatus: describeStatus(project),
    periodStart: period.start,
    periodEnd: period.end,
    periodText: period.raw,
    previousReportDate: previous ? describeWeek(previous.week) : '',
    previousReport: previous
      ? {
        highlight: clean(previous.project.highlight),
        weeklyActions: clean(previous.project.weeklyActions || previous.project.weeklyAction),
        riskActionPairs: normalizeRiskActionRows(previous.project),
      }
      : null,
  };
}

function field(label, value) {
  return value ? [`${label}:`, value, ''] : [];
}

function periodRange(context) {
  if (context.periodStart && context.periodEnd) return `${context.periodStart} to ${context.periodEnd}`;
  return context.periodText;
}

function contextSection(context) {
  return [
    'PROJECT CONTEXT',
    '',
    ...field('Project', context.projectName),
    ...field('Customer', context.customerName),
    ...field('Project Status', context.projectStatus),
    ...field('Current Reporting Period', periodRange(context)),
    ...field('Previous Report Date', context.previousReportDate),
  ];
}

function riskPairsBlock(pairs) {
  if (!pairs.length) return [NONE_RECORDED, ''];
  return pairs.flatMap((pair, index) => [
    `Risk ${index + 1}`,
    '',
    `Primary: ${pair.primary ? 'Yes' : 'No'}`,
    '',
    'Risk / Blocker:',
    pair.risk || NONE_RECORDED,
    '',
    'Required Action:',
    pair.action || NONE_RECORDED,
    '',
  ]);
}

function previousReportSection(report) {
  if (!report) {
    return [
      'No previous weekly report is available.',
      '',
      'Build the report based on available project information for the current reporting period.',
      '',
      'Do not attempt week-over-week comparison where no baseline exists.',
      '',
    ];
  }
  return [
    "LAST WEEK'S REPORT",
    '',
    'HIGHLIGHT',
    '',
    report.highlight || NONE_RECORDED,
    '',
    'WEEKLY KEY ACTIONS',
    '',
    report.weeklyActions || NONE_RECORDED,
    '',
    'RISK / ACTION PAIRS',
    '',
    ...riskPairsBlock(report.riskActionPairs),
  ];
}

function taskSection(context) {
  const hasBaseline = Boolean(context.previousReport);
  const range = periodRange(context);
  const focus = range
    ? [
      'Focus primarily on information created or updated during the current reporting period:',
      '',
      range,
      '',
      'The period covers working days only, so also consider relevant information dated between the previous report and this period, including weekends.',
      '',
    ]
    : ['Focus primarily on information created or updated during the current reporting period.', ''];

  const analysis = hasBaseline
    ? [
      "Compare the evidence against last week's report. For each important topic, work through:",
      '',
      "last week's position -> new evidence -> what changed -> current status -> next action",
      '',
      'and decide whether the topic:',
      '',
      '- progressed',
      '- completed',
      '- remained unchanged',
      '- deteriorated',
      '- is newly identified',
      '',
      'Do not treat activity as progress unless there is an actual change in:',
      '',
      '- status',
      '- decision',
      '- deliverable',
      '- schedule',
      '- responsibility',
      '- technical result',
      '- risk',
      '',
      "Do not simply restate last week's wording, and do not claim an issue is resolved without evidence.",
      'Example: if last week the installation team was unconfirmed, and this week a subcontractor is confirmed but the mobilization date is still pending, report that resource uncertainty has reduced while schedule uncertainty remains. Do not repeat "unconfirmed" and do not write "resolved".',
      '',
    ]
    : [
      'Base the report on the available project information for the current reporting period.',
      '',
    ];

  return [
    'YOUR TASK',
    '',
    'Review relevant Microsoft 365 information related to this project: Teams conversations, meeting records, meeting notes, meeting summaries, meeting transcripts, project-related email, decisions, action items, and stakeholder commitments.',
    '',
    ...focus,
    ...analysis,
    'Evidence rules:',
    '',
    '- Discussion is not a decision.',
    '- A proposal is not a commitment.',
    '- A tentative date is not a confirmed schedule.',
    '- If sources conflict, prefer newer confirmed information, then explicit decisions, then formal meeting or email confirmation. If it is still unclear, do not guess; use cautious wording.',
    '',
    'Do not invent:',
    '',
    '- facts',
    '- dates',
    '- owners',
    '- responsibilities',
    '- decisions',
    '- commitments',
    '- project status',
    '- schedule',
    '- technical results',
    '',
    'Distinguish what is Confirmed, Tentative, Open, or Unknown. If evidence is insufficient, use conservative wording rather than filling the gap.',
    '',
  ];
}

function generateSection(context) {
  const hasBaseline = Boolean(context.previousReport);
  return [
    'GENERATE:',
    '',
    '1. HIGHLIGHT',
    '',
    hasBaseline
      ? '3-6 concise, fact-based, executive-level bullets describing meaningful changes versus last week: completed milestones, meaningful progress, important decisions, clarified root causes, resolved blockers, confirmed responsibilities, technical findings, or major stakeholder alignment.'
      : '3-6 concise, fact-based, executive-level bullets describing the most meaningful developments in the reporting period: completed milestones, meaningful progress, important decisions, clarified root causes, resolved blockers, confirmed responsibilities, technical findings, or major stakeholder alignment.',
    'Describe the actual change, not just activity. Keep each bullet to 1-2 sentences, about 40 words or fewer.',
    'Weaker: "Continued discussion with the supplier about installation."',
    'Better: "Clarified that the original supplier engagement covered equipment supply only, explaining the gap in onsite installation responsibility."',
    '',
    '2. WEEKLY KEY ACTIONS',
    '',
    '3-6 execution-oriented actions describing the most important remaining work for the next reporting period, drawn from unresolved work, remaining blockers, dependencies, commitments, testing, validation, schedule recovery, and issue closure.',
    'Prefer action verbs such as Confirm, Complete, Validate, Resolve, Finalize, Obtain, Close, Execute. Avoid "Follow up", "Continue discussion", and "Keep monitoring"; state the intended outcome instead.',
    'Weaker: "Follow up with the supplier regarding installation resources."',
    'Better: "Obtain final confirmation of the onsite installation team and mobilization schedule."',
    'Keep each action to one sentence, about 33 words or fewer.',
    '',
    '3. RISK / ACTION PAIRS',
    '',
    '1-4 active risks. Each risk requires:',
    '',
    'Primary: Yes / No',
    '',
    'Risk / Blocker:',
    '',
    'Required Action:',
    '',
    'Every Risk must have its own Required Action; do not reuse one generic action for several risks.',
    'Keep each Risk / Blocker to 1-2 sentences, about 60 words or fewer, and each Required Action to one sentence, about 45 words or fewer.',
    hasBaseline
      ? "Do not automatically carry forward last week's risks. Reassess each one as: remains active, improved, resolved, replaced, or mitigation needs revision. Remove resolved risks from the active list."
      : 'Include only risks that are supported by evidence.',
    'Suggest exactly one Primary risk, considering schedule impact, customer impact, commissioning impact, technical readiness, cost impact, project dependency, and safety impact. The PM makes the final decision.',
    '',
    '4. WEEK-OVER-WEEK CHANGES',
    '',
    hasBaseline
      ? 'A review section for the PM only; it is not pasted into the executive report. For each important topic give: Topic, Last Week, This Week, Change, and Evidence Confidence (High / Medium / Low). List at most 6 topics and keep each field to 1-2 sentences.'
      : 'Not applicable: there is no previous weekly report, so write exactly "Not applicable - no previous weekly report is available."',
    '',
    'Length limits are approximate. Never drop a confirmed date, owner, or decision just to stay within them.',
    '',
    'CONSISTENCY CHECK:',
    '',
    'Before answering, verify:',
    '',
    '- completed issues are not active risks',
    '- Highlights describe actual changes',
    '- Weekly Key Actions represent remaining work',
    '- every Risk has a corresponding Required Action',
    '- content is not mechanically repeated across the three sections',
    '- all sections tell one consistent project story',
    '- no unsupported facts are introduced',
    '',
  ];
}

function outputFormatSection(context) {
  const hasBaseline = Boolean(context.previousReport);
  return [
    'OUTPUT FORMAT:',
    '',
    hasBaseline
      ? "Use exactly this structure and write in the same language and tone as last week's report."
      : 'Use exactly this structure and write in concise, professional English.',
    'Return only these sections, with no introduction, explanation, or closing remarks.',
    '',
    '## HIGHLIGHT',
    '',
    '- ...',
    '- ...',
    '- ...',
    '',
    '## WEEKLY KEY ACTIONS',
    '',
    '- ...',
    '- ...',
    '- ...',
    '',
    '## RISK / ACTION PAIRS',
    '',
    '### Risk 1',
    '',
    'Primary: Yes / No',
    '',
    'Risk / Blocker:',
    '...',
    '',
    'Required Action:',
    '...',
    '',
    '### Risk 2',
    '',
    'Primary: Yes / No',
    '',
    'Risk / Blocker:',
    '...',
    '',
    'Required Action:',
    '...',
    '',
    '## WEEK-OVER-WEEK CHANGES',
    '',
    ...(hasBaseline
      ? [
        'Topic:',
        '...',
        '',
        'Last Week:',
        '...',
        '',
        'This Week:',
        '...',
        '',
        'Change:',
        '...',
        '',
        'Evidence Confidence:',
        'High / Medium / Low',
      ]
      : ['Not applicable - no previous weekly report is available.']),
  ];
}

/** Builds the Microsoft Copilot master prompt. Pure and deterministic. */
export function buildWeeklyCopilotPrompt(context = {}) {
  const safe = { ...context, previousReport: context.previousReport || null };
  return [
    'You are helping me prepare the weekly executive project update for the project below.',
    '',
    'You have access to my authorized Microsoft 365 work information, including relevant Teams conversations, meeting records, meeting summaries, meeting transcripts, and email correspondence.',
    '',
    safe.previousReport
      ? "Your task is to review the available project information and generate this week's PM update by comparing new information against last week's report."
      : "Your task is to review the available project information and generate this week's PM update.",
    '',
    ...contextSection(safe),
    ...previousReportSection(safe.previousReport),
    ...taskSection(safe),
    ...generateSection(safe),
    ...outputFormatSection(safe),
  ].join('\n').trimEnd() + '\n';
}

/**
 * Copies text without ever throwing. Returns true only when a copy method
 * reported success, so callers can show a truthful success/failure message.
 */
export async function copyTextToClipboard(text, { clipboard, fallbackCopy } = {}) {
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path (e.g. permission denied, insecure context).
    }
  }
  if (typeof fallbackCopy === 'function') {
    try {
      return (await fallbackCopy(text)) === true;
    } catch {
      return false;
    }
  }
  return false;
}
