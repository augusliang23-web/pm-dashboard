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
  const lastWeek = prompt.slice(prompt.indexOf("LAST WEEK'S REPORT"), prompt.indexOf('YOUR TASK'));
  assert.equal((lastWeek.match(/Primary: Yes\n\nRisk \/ Blocker:\n/g) || []).length, 1);
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

test('P05/P06/P07 the output is one V1 code block with only FIELD_1-3 and no separate week-over-week section', () => {
  for (const prompt of [promptFor(), promptFor({ weeks: [{ weekLabel: 'W38 2026', weekDate: 'Sep 14 - Sep 18', projects: [currentProject] }] })]) {
    const output = prompt.slice(prompt.indexOf('OUTPUT FORMAT:'));
    const markers = [
      '```text', '<<<PM_WEEKLY_UPDATE_V1>>>',
      '<<<FIELD_1>>>', '<<<END_FIELD_1>>>',
      '<<<FIELD_2>>>', '<<<END_FIELD_2>>>',
      '<<<FIELD_3>>>', '### Risk 1', '### Risk 2', '<<<END_FIELD_3>>>',
      '<<<END_PM_WEEKLY_UPDATE_V1>>>', '```',
    ];
    let cursor = 0;
    for (const marker of markers) {
      const next = output.indexOf(marker, cursor);
      assert.ok(next >= cursor, `${marker} should appear in order`);
      cursor = next;
    }
    assert.deepEqual([...new Set(prompt.match(/<<<[A-Z0-9_]+>>>/g))].sort(), [
      '<<<END_FIELD_1>>>', '<<<END_FIELD_2>>>', '<<<END_FIELD_3>>>', '<<<END_PM_WEEKLY_UPDATE_V1>>>',
      '<<<FIELD_1>>>', '<<<FIELD_2>>>', '<<<FIELD_3>>>', '<<<PM_WEEKLY_UPDATE_V1>>>',
    ]);
    for (const marker of ['<<<PM_WEEKLY_UPDATE_V1>>>', '<<<FIELD_1>>>', '<<<FIELD_2>>>', '<<<FIELD_3>>>']) {
      assert.equal(prompt.split(marker).length - 1, 1, `${marker} appears once`);
    }
    assert.equal(output.split('```').length - 1, 2, 'exactly one code block');
    assert.doesNotMatch(prompt, /## WEEK-OVER-WEEK CHANGES|4\. WEEK-OVER-WEEK|Evidence Confidence|Topic:\n|Last Week:\n|This Week:\n|Change:\n/);
    assert.match(prompt, /Return only the code block, with no introduction, summary, week-over-week section, explanation, or closing remarks before or after it\./);
  }
});

test('P01 Highlight asks for about 2-3 short, change-focused bullets without background', () => {
  const prompt = promptFor();
  assert.match(prompt, /1\. HIGHLIGHT\n\nNormally 2-3 bullets, one short sentence each where possible: meaningful achievements and changes, critical decisions, and schedule changes, including progress versus last week when relevant\./);
  assert.match(prompt, /Avoid historical project background, routine activity without impact, long technical explanations, and repeating information from the other fields\./);
  assert.match(prompt, /- FAT completion moved one week due to supplier delay\./);
  assert.doesNotMatch(prompt, /3-6/);
});

test('P02 Weekly Key Actions asks for about 2-4 verb-first actions without invented commitments', () => {
  const prompt = promptFor();
  assert.match(prompt, /2\. WEEKLY KEY ACTIONS\n\nNormally 2-4 actions, one concise sentence each, starting with a clear action verb/);
  assert.match(prompt, /Do not repeat completed work from Highlight\./);
  assert.match(prompt, /Include owners and deadlines only when supported by verified information\. Do not invent commitments\./);
  assert.match(prompt, /- Finalize BMS communication mapping\./);
});

test('P03/P12 risks: top 2-3 by impact, Primary rules kept, never invented, explicit no-risk value', () => {
  const prompt = promptFor();
  assert.match(prompt, /3\. RISK \/ ACTION PAIRS\n\nNormally the top 2-3 active risks, ordered by business and delivery impact\. Keep an additional risk only when it is material\./);
  assert.match(prompt, /Every Risk must have its own Required Action/);
  assert.match(prompt, /Mark exactly one risk "Primary: Yes"/);
  assert.match(prompt, /The PM makes the final decision\./);
  assert.match(prompt, /Do not automatically carry forward last week's risks\./);
  assert.match(prompt, /Never invent a risk to fill this section\. If no active risk is supported by evidence, write exactly "No active risks\." as the whole section\./);
  assert.doesNotMatch(prompt, /1-4 active risks/);
});

test('P04/P09 with a previous report, the comparison logic stays and feeds the three fields', () => {
  const prompt = promptFor();
  assert.match(prompt, /LAST WEEK'S REPORT/);
  assert.match(prompt, /last week's position -> new evidence -> what changed -> current status -> next action/);
  for (const word of ['progressed', 'completed', 'remained unchanged', 'deteriorated', 'is newly identified']) assert.match(prompt, new RegExp(word));
  assert.match(prompt, /put meaningful progress, completed items, newly introduced risks, and resolved issues directly where they belong\. Do not output the comparison as a separate section, and do not repeat unchanged background\./);
});

test('P10 without a previous report, no historical comparison is requested or implied', () => {
  const prompt = promptFor({ weeks: [{ weekLabel: 'W38 2026', weekDate: 'Sep 14 - Sep 18', projects: [currentProject] }] });
  assert.match(prompt, /do not describe or imply changes versus a previous week/);
  assert.doesNotMatch(prompt, /progress versus last week|last week's risks|last week's position/);
});

test('the prompt explains each contract section using the actual editor field labels', () => {
  const prompt = promptFor();
  assert.match(prompt, /- FIELD_1 fills the "Highlight" field/);
  assert.match(prompt, /- FIELD_2 fills the "Weekly Key Actions" field/);
  assert.match(prompt, /- FIELD_3 fills the "Risk & Mitigation Actions" table/);
  assert.match(prompt, /Required Action fills the Mitigation Actions column/);
  assert.match(prompt, /All three sections are required and must not be empty\./);
  assert.match(prompt, /Output the block exactly once\./);
});

test('P11 the prompt targets a 30-second read and still protects confirmed facts', () => {
  const prompt = promptFor();
  assert.match(prompt, /understand in about 30 seconds: what changed this week, what needs to happen next, and the main risks/);
  assert.match(prompt, /The counts above are guidance\. Never drop a confirmed critical development, date, owner, or decision just to meet them\./);
  assert.match(prompt, /CONSISTENCY CHECK/);
  assert.match(prompt, /no unsupported facts are introduced/);
});

test('first report: no previous week produces the no-baseline instructions and does not crash', () => {
  const weeks = [{ weekLabel: 'W38 2026', weekDate: 'Sep 14 - Sep 18', projects: [currentProject] }];
  const prompt = promptFor({ weeks });
  assert.match(prompt, /No previous weekly report is available\./);
  assert.match(prompt, /Build the report based on available project information for the current reporting period\./);
  assert.match(prompt, /Do not attempt week-over-week comparison where no baseline exists\./);
  assert.doesNotMatch(prompt, /LAST WEEK'S REPORT/);
  assert.doesNotMatch(prompt, /Previous Report Date/);
  assert.doesNotMatch(prompt, /WEEK-OVER-WEEK|Not applicable/);
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
