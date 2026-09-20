import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPromptContext,
  buildWeeklyCopilotPrompt,
  copyTextToClipboard,
  findPreviousReport,
  findPreviousWeek,
  resolveWeekPeriod,
} from '../js/copilot-weekly-update-prompt.mjs';

const previousProject = {
  code: 'SYS-001',
  name: '60kW Dual Gun',
  highlight: 'BMS recovery plan drafted',
  weeklyActions: 'Confirm installer\nValidate firmware',
  riskActions: [
    { id: 'a', primary: false, risk: 'Secondary supplier delay', action: 'Escalate to procurement' },
    { id: 'b', primary: true, risk: 'Installer unconfirmed', action: 'Obtain signed schedule' },
    { id: 'c', primary: false, risk: 'Thermal margin thin', action: 'Run derating test' },
  ],
};

function makeWeeks() {
  return [
    { weekLabel: 'W36 2026', weekDate: 'Aug 31 - Sep 4', projects: [{ code: 'SYS-001', name: 'Old name', highlight: 'OLDER WEEK' }] },
    { weekLabel: 'W37 2026', weekDate: 'Sep 7 - Sep 11', projects: [previousProject] },
    { weekLabel: 'W38 2026', weekDate: 'Sep 14 - Sep 18', projects: [{ ...previousProject, highlight: 'DRAFT TEXT EDITED THIS WEEK' }] },
  ];
}

const currentProject = { code: 'SYS-001', name: '60kW Dual Gun', customer: 'Wesco', status: 'yellow', progress: 45 };

function promptFor(overrides = {}) {
  const weeks = overrides.weeks || makeWeeks();
  const currentWeek = overrides.currentWeek || weeks[weeks.length - 1];
  return buildWeeklyCopilotPrompt(buildPromptContext({
    weeks,
    currentWeek,
    project: overrides.project || currentProject,
  }));
}

test('prompt includes project context and the correct reporting period', () => {
  const prompt = promptFor();
  assert.match(prompt, /Project:\n60kW Dual Gun/);
  assert.match(prompt, /Customer:\nWesco/);
  assert.match(prompt, /Project Status:\nAt Risk \(progress 45%\)/);
  assert.match(prompt, /Current Reporting Period:\n2026-09-14 to 2026-09-18/);
});

test('previous report date and baseline come from the previous persisted week, not the current one', () => {
  const prompt = promptFor();
  assert.match(prompt, /Previous Report Date:\nW37 2026 \(Sep 7 - Sep 11\)/);
  assert.match(prompt, /BMS recovery plan drafted/);
  assert.doesNotMatch(prompt, /DRAFT TEXT EDITED THIS WEEK/);
  assert.doesNotMatch(prompt, /OLDER WEEK/);
});

test('previous weekly key actions are carried into the prompt in full', () => {
  const prompt = promptFor();
  assert.match(prompt, /WEEKLY KEY ACTIONS\n\nConfirm installer\nValidate firmware/);
});

test('every previous risk / action pair is included with its Primary flag, Primary first', () => {
  const prompt = promptFor();
  assert.match(prompt, /Risk 1\n\nPrimary: Yes\n\nRisk \/ Blocker:\nInstaller unconfirmed\n\nRequired Action:\nObtain signed schedule/);
  assert.match(prompt, /Risk 2\n\nPrimary: No\n\nRisk \/ Blocker:\nSecondary supplier delay\n\nRequired Action:\nEscalate to procurement/);
  assert.match(prompt, /Risk 3\n\nPrimary: No\n\nRisk \/ Blocker:\nThermal margin thin\n\nRequired Action:\nRun derating test/);
  assert.equal((prompt.match(/Primary: Yes\n\nRisk \/ Blocker:\n/g) || []).length, 1);
});

test('legacy projects without structured riskActions still expose their risks and actions', () => {
  const weeks = makeWeeks();
  weeks[1].projects = [{ code: 'SYS-001', name: '60kW Dual Gun', highlight: 'h', risk: 'Risk A\nRisk B', next: 'Action A\nAction B' }];
  const prompt = promptFor({ weeks });
  assert.match(prompt, /Risk 1\n\nPrimary: Yes\n\nRisk \/ Blocker:\nRisk A\n\nRequired Action:\nAction A/);
  assert.match(prompt, /Risk 2\n\nPrimary: No\n\nRisk \/ Blocker:\nRisk B\n\nRequired Action:\nAction B/);
});

test('an empty previous Highlight does not crash and is marked as none recorded', () => {
  const weeks = makeWeeks();
  weeks[1].projects = [{ ...previousProject, highlight: '' }];
  const prompt = promptFor({ weeks });
  assert.match(prompt, /HIGHLIGHT\n\n\(none recorded\)\n\nWEEKLY KEY ACTIONS/);
});

test('missing optional project metadata is omitted instead of printing placeholders', () => {
  const prompt = promptFor({ project: { code: 'SYS-001', name: '60kW Dual Gun' } });
  assert.doesNotMatch(prompt, /Customer:/);
  assert.doesNotMatch(prompt, /Project Status:/);
  assert.doesNotMatch(prompt, /undefined|null|\[object/);
});

test('the prompt requires week-over-week comparison, Microsoft 365 evidence and guardrails', () => {
  const prompt = promptFor();
  assert.match(prompt, /Teams conversations, meeting records/);
  assert.match(prompt, /email correspondence/);
  assert.match(prompt, /transcripts/);
  assert.match(prompt, /progressed/);
  assert.match(prompt, /remained unchanged/);
  assert.match(prompt, /deteriorated/);
  assert.match(prompt, /newly identified/);
  assert.match(prompt, /Discussion is not a decision/);
  assert.match(prompt, /A proposal is not a commitment/);
  assert.match(prompt, /A tentative date is not a confirmed schedule/);
  assert.match(prompt, /Do not invent:/);
  assert.match(prompt, /Confirmed, Tentative, Open, or Unknown/);
  assert.match(prompt, /CONSISTENCY CHECK/);
  assert.match(prompt, /completed issues are not active risks/);
  assert.match(prompt, /Every Risk must have its own Required Action/);
});

test('the prompt has the fixed output structure including WEEK-OVER-WEEK CHANGES', () => {
  const prompt = promptFor();
  const headings = ['## HIGHLIGHT', '## WEEKLY KEY ACTIONS', '## RISK / ACTION PAIRS', '### Risk 1', '### Risk 2', '## WEEK-OVER-WEEK CHANGES'];
  let cursor = prompt.indexOf('OUTPUT FORMAT:');
  assert.ok(cursor > 0);
  for (const heading of headings) {
    const next = prompt.indexOf(heading, cursor);
    assert.ok(next >= cursor, `${heading} should appear in order`);
    cursor = next;
  }
  assert.match(prompt, /Evidence Confidence:\nHigh \/ Medium \/ Low/);
});

test('the prompt sets approximate length limits and protects confirmed facts', () => {
  const prompt = promptFor();
  assert.match(prompt, /Keep each bullet to 1-2 sentences, about 40 words or fewer\./);
  assert.match(prompt, /Keep each action to one sentence, about 33 words or fewer\./);
  assert.match(prompt, /Keep each Risk \/ Blocker to 1-2 sentences, about 60 words or fewer, and each Required Action to one sentence, about 45 words or fewer\./);
  assert.match(prompt, /List at most 6 topics and keep each field to 1-2 sentences\./);
  assert.match(prompt, /Never drop a confirmed date, owner, or decision just to stay within them\./);
  assert.match(prompt, /Return only these sections, with no introduction, explanation, or closing remarks\./);
});

test('first report: no previous week produces the no-baseline instructions and does not crash', () => {
  const weeks = [{ weekLabel: 'W38 2026', weekDate: 'Sep 14 - Sep 18', projects: [currentProject] }];
  const prompt = promptFor({ weeks });
  assert.match(prompt, /No previous weekly report is available\./);
  assert.match(prompt, /Build the report based on available project information for the current reporting period\./);
  assert.match(prompt, /Do not attempt week-over-week comparison where no baseline exists\./);
  assert.doesNotMatch(prompt, /LAST WEEK'S REPORT/);
  assert.doesNotMatch(prompt, /Previous Report Date/);
  assert.match(prompt, /## WEEK-OVER-WEEK CHANGES\n\nNot applicable/);
});

test('a project that did not exist in the previous week gets the no-baseline prompt', () => {
  const prompt = promptFor({ project: { code: 'NEW-9', name: 'Brand new project' } });
  assert.match(prompt, /No previous weekly report is available\./);
  assert.doesNotMatch(prompt, /BMS recovery plan drafted/);
});

test('project is matched by persisted code first, then by normalized name', () => {
  const weeks = makeWeeks();
  const byCode = findPreviousReport({ weeks, currentWeek: weeks[2], project: { code: 'sys-001', name: 'Renamed' } });
  assert.equal(byCode.project, previousProject);
  const byName = findPreviousReport({ weeks, currentWeek: weeks[2], project: { code: 'CHANGED', name: '  60KW dual   gun ' } });
  assert.equal(byName.project, previousProject);
  assert.equal(findPreviousReport({ weeks, currentWeek: weeks[2], project: { code: 'X', name: 'Other' } }), null);
});

test('previous week is chosen by (year, week), including across a year rollover', () => {
  const weeks = [
    { weekLabel: 'W1 2027', weekDate: 'Dec 28 - Jan 1' },
    { weekLabel: 'W52 2026', weekDate: 'Dec 21 - Dec 25' },
    { weekLabel: 'W38 2026', weekDate: 'Sep 14 - Sep 18' },
  ];
  assert.equal(findPreviousWeek(weeks, weeks[0]).weekLabel, 'W52 2026');
  assert.equal(findPreviousWeek(weeks, weeks[1]).weekLabel, 'W38 2026');
  assert.equal(findPreviousWeek(weeks, weeks[2]), null);
  assert.equal(findPreviousWeek(weeks, { weekLabel: 'not a week' }), null);
});

test('reporting period resolves ISO dates, including New Year crossings', () => {
  assert.deepEqual(resolveWeekPeriod({ weekLabel: 'W38 2026', weekDate: 'Sep 14 - Sep 18' }),
    { start: '2026-09-14', end: '2026-09-18', raw: 'Sep 14 - Sep 18' });
  assert.deepEqual(resolveWeekPeriod({ weekLabel: 'W1 2027', weekDate: 'Dec 28 - Jan 1' }),
    { start: '2026-12-28', end: '2027-01-01', raw: 'Dec 28 - Jan 1' });
  assert.deepEqual(resolveWeekPeriod({ weekLabel: 'W53 2026', weekDate: 'Dec 28 - Jan 1' }),
    { start: '2026-12-28', end: '2027-01-01', raw: 'Dec 28 - Jan 1' });
});

test('an unparseable reporting period falls back to the stored text instead of crashing', () => {
  assert.deepEqual(resolveWeekPeriod({ weekLabel: 'W38 2026', weekDate: 'sometime' }),
    { start: '', end: '', raw: 'sometime' });
  assert.deepEqual(resolveWeekPeriod({ weekLabel: 'W38 2026', weekDate: 'Feb 30 - Mar 3' }),
    { start: '', end: '', raw: 'Feb 30 - Mar 3' });
  const prompt = promptFor({ currentWeek: { weekLabel: 'W38 2026', weekDate: 'sometime' } });
  assert.match(prompt, /Current Reporting Period:\nsometime/);
  assert.doesNotThrow(() => buildWeeklyCopilotPrompt({}));
});

test('the baseline ignores anything but the persisted weeks (no editor state can leak in)', () => {
  const weeks = makeWeeks();
  const before = promptFor({ weeks });
  weeks[2].projects[0].highlight = 'EDITING RIGHT NOW';
  weeks[2].projects[0].riskActions = [];
  assert.equal(promptFor({ weeks }), before);
});

test('prompt building is deterministic and does not mutate its inputs', () => {
  const weeks = makeWeeks();
  const snapshot = JSON.stringify(weeks);
  const first = promptFor({ weeks });
  const second = promptFor({ weeks });
  assert.equal(first, second);
  assert.equal(JSON.stringify(weeks), snapshot);
});

test('clipboard: uses the async Clipboard API and reports success', async () => {
  const written = [];
  const ok = await copyTextToClipboard('hello', { clipboard: { writeText: async text => written.push(text) } });
  assert.equal(ok, true);
  assert.deepEqual(written, ['hello']);
});

test('clipboard: falls back when the Clipboard API rejects', async () => {
  let fallbackText = null;
  const ok = await copyTextToClipboard('hello', {
    clipboard: { writeText: async () => { throw new Error('denied'); } },
    fallbackCopy: text => { fallbackText = text; return true; },
  });
  assert.equal(ok, true);
  assert.equal(fallbackText, 'hello');
});

test('clipboard: reports failure when every method fails or is unavailable', async () => {
  assert.equal(await copyTextToClipboard('x', {
    clipboard: { writeText: async () => { throw new Error('denied'); } },
    fallbackCopy: () => false,
  }), false);
  assert.equal(await copyTextToClipboard('x', {
    clipboard: { writeText: async () => { throw new Error('denied'); } },
    fallbackCopy: () => { throw new Error('boom'); },
  }), false);
  assert.equal(await copyTextToClipboard('x', {}), false);
});
