import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEKLY_UPDATE_SECTIONS,
  isWeeklyUpdateDraftCurrent,
  parseRiskActionSection,
  parseWeeklyUpdateResponse,
  validateWeeklyUpdateValues,
  weeklyFieldsDiffer,
} from '../js/weekly-update-paste.mjs';
import { buildPromptContext, buildWeeklyCopilotPrompt } from '../js/copilot-weekly-update-prompt.mjs';

const HIGHLIGHT = '- Installer contract signed with Delta Field Services.\n- Firmware 2.3 passed thermal validation.';
const ACTIONS = '- Confirm mobilization date.\n  - Owner: PM\n- Validate BMS recovery plan.';
const RISKS = [
  '### Risk 1',
  '',
  'Primary: No',
  '',
  'Risk / Blocker:',
  'Supplier lead time slipped two weeks.',
  '',
  'Required Action:',
  'Obtain revised delivery commitment.',
  '',
  '### Risk 2',
  '',
  'Primary: Yes',
  '',
  'Risk / Blocker:',
  'Mobilization date unconfirmed.',
  'Schedule float is now 3 days.',
  '',
  'Required Action:',
  '- Obtain signed mobilization schedule.',
  '- Escalate to sponsor if not received.',
].join('\n');

function block({ f1 = HIGHLIGHT, f2 = ACTIONS, f3 = RISKS } = {}) {
  return [
    '<<<PM_WEEKLY_UPDATE_V1>>>',
    '',
    '<<<FIELD_1>>>', f1, '<<<END_FIELD_1>>>',
    '',
    '<<<FIELD_2>>>', f2, '<<<END_FIELD_2>>>',
    '',
    '<<<FIELD_3>>>', f3, '<<<END_FIELD_3>>>',
    '',
    '<<<END_PM_WEEKLY_UPDATE_V1>>>',
  ].join('\n');
}

function expectError(input, pattern) {
  const result = parseWeeklyUpdateResponse(input);
  assert.equal(result.ok, false, 'should be rejected');
  assert.equal(result.values, undefined, 'a failed parse returns no partial values');
  assert.match(result.error, pattern);
}

test('T01 a valid structured response parses', () => {
  const result = parseWeeklyUpdateResponse(block());
  assert.equal(result.ok, true);
  assert.equal(result.format, 'PM_WEEKLY_UPDATE_V1');
  assert.equal(result.ignoredOutsideText, false);
});

test('T02 the three contract sections map to the existing project field keys', () => {
  assert.deepEqual(WEEKLY_UPDATE_SECTIONS.map(section => [section.id, section.key, section.label]), [
    ['FIELD_1', 'highlight', 'Highlight'],
    ['FIELD_2', 'weeklyActions', 'Weekly Key Actions'],
    ['FIELD_3', 'riskActions', 'Risk & Mitigation Actions'],
  ]);
  const { values } = parseWeeklyUpdateResponse(block());
  assert.deepEqual(Object.keys(values), ['highlight', 'weeklyActions', 'riskActions']);
  assert.equal(values.highlight, HIGHLIGHT);
  assert.equal(values.weeklyActions, ACTIONS);
  assert.deepEqual(values.riskActions, [
    { primary: false, risk: 'Supplier lead time slipped two weeks.', action: 'Obtain revised delivery commitment.' },
    {
      primary: true,
      risk: 'Mobilization date unconfirmed.\nSchedule float is now 3 days.',
      action: '- Obtain signed mobilization schedule.\n- Escalate to sponsor if not received.',
    },
  ]);
});

test('T03/T04 multiline content, blank lines, indentation and bullets are preserved', () => {
  const f1 = '- First bullet\n\n- Second bullet\n  - nested detail\n• Third bullet\n1. Numbered';
  const { values } = parseWeeklyUpdateResponse(block({ f1 }));
  assert.equal(values.highlight, f1);
  assert.match(values.weeklyActions, /\n  - Owner: PM\n/);
});

test('T05 a missing section is rejected', () => {
  const input = block().replace(/<<<FIELD_2>>>[\s\S]*?<<<END_FIELD_2>>>\n/, '');
  expectError(input, /Missing section: FIELD_2 \(Weekly Key Actions\)/);
});

test('T06 a duplicated section is rejected', () => {
  const input = block().replace('<<<END_PM_WEEKLY_UPDATE_V1>>>', '<<<FIELD_1>>>\n- again\n<<<END_FIELD_1>>>\n<<<END_PM_WEEKLY_UPDATE_V1>>>');
  expectError(input, /FIELD_1 \(Highlight\) appears more than once/);
});

test('T07 empty or placeholder-only sections are rejected', () => {
  expectError(block({ f1: '' }), /FIELD_1 \(Highlight\) is empty/);
  expectError(block({ f2: '   \n\n' }), /FIELD_2 \(Weekly Key Actions\) is empty/);
  expectError(block({ f1: '- ...\n- ...' }), /FIELD_1 \(Highlight\) is empty/);
  expectError(block({ f3: '### Risk 1\nPrimary: Yes\nRisk / Blocker:\n\nRequired Action:\nDo it' }), /Risk 1 has no "Risk \/ Blocker" text/);
  expectError(block({ f3: '### Risk 1\nPrimary: Yes\nRisk / Blocker:\nA risk\nRequired Action:\n' }), /Risk 1 has no "Required Action" text/);
});

test('T08 malformed, unclosed, misplaced or unknown delimiters are rejected', () => {
  expectError(block().replace('<<<END_FIELD_1>>>', '<<END_FIELD_1>>>'), /malformed or misplaced marker/);
  expectError(block().replace('<<<FIELD_2>>>\n', '<<<FIELD_2>>> - inline content\n'), /malformed or misplaced marker/);
  expectError(block().replace('<<<END_FIELD_1>>>\n', ''), /FIELD_1 \(Highlight\) is not closed/);
  expectError(block().replace('<<<END_FIELD_3>>>', '<<<END_FIELD_2>>>'), /FIELD_3 \(Risk & Mitigation Actions\) is not closed/);
  expectError(block().replace('<<<END_PM_WEEKLY_UPDATE_V1>>>', ''), /block is not closed/);
  expectError(block().replace('<<<PM_WEEKLY_UPDATE_V1>>>', ''), /appears before <<<PM_WEEKLY_UPDATE_V1>>>/);
  expectError(block().replace('<<<FIELD_3>>>', '<<<FIELD_4>>>'), /unrecognized marker <<<FIELD_4>>>/);
  expectError(block().replace('<<<PM_WEEKLY_UPDATE_V1>>>', '<<<PM_WEEKLY_UPDATE_V2>>>'), /Unsupported format/);
  expectError(block().replace('\n\n<<<FIELD_2>>>', '\nStray heading\n<<<FIELD_2>>>'), /text outside a section/);
  expectError('Here is the update:\n- a\n- b', /No <<<PM_WEEKLY_UPDATE_V1>>> block was found/);
  expectError('', /Paste the complete Copilot response/);
  expectError(undefined, /Paste the complete Copilot response/);
});

test('T09 CRLF / CR line endings, a BOM and surrounding whitespace are accepted', () => {
  const expected = parseWeeklyUpdateResponse(block()).values;
  for (const input of [
    block().replace(/\n/g, '\r\n'),
    block().replace(/\n/g, '\r'),
    `﻿\n\n   ${block()}   \n\n`,
    block().replace(/^<<</gm, '   <<<').replace(/>>>$/gm, '>>>  '),
  ]) {
    const result = parseWeeklyUpdateResponse(input);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.values, expected);
  }
});

test('common Copilot wrappers are tolerated: one code fence, bold markers, review notes after the block', () => {
  const fenced = `Here is the weekly update:\n\n\`\`\`text\n${block()}\n\`\`\`\n\n## WEEK-OVER-WEEK CHANGES\nTopic: Installer`;
  const result = parseWeeklyUpdateResponse(fenced);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.ignoredOutsideText, true);
  assert.doesNotMatch(JSON.stringify(result.values), /WEEK-OVER-WEEK|Here is/);
  assert.equal(parseWeeklyUpdateResponse('```\n' + block() + '\n```').ignoredOutsideText, false);
  const bold = block().replace(/^(<<<[A-Z0-9_]+>>>)$/gm, '**$1**');
  assert.equal(parseWeeklyUpdateResponse(bold).ok, true);
  const boldLabels = block({ f3: '**Risk 1**\n**Primary:** Yes\n**Risk / Blocker:** Late delivery\n**Mitigation Actions:** Expedite' });
  assert.deepEqual(parseWeeklyUpdateResponse(boldLabels).values.riskActions, [
    { primary: true, risk: 'Late delivery', action: 'Expedite' },
  ]);
});

test('T10 multiple structured blocks are rejected as ambiguous', () => {
  expectError(`${block()}\n\n${block()}`, /more than one weekly update block/);
  expectError(block().replace('<<<FIELD_1>>>', '<<<PM_WEEKLY_UPDATE_V1>>>\n<<<FIELD_1>>>'), /more than one weekly update block/);
});

test('risk section: Primary rules are deterministic and never guessed beyond the editor default', () => {
  const two = parseRiskActionSection('Risk 1\nPrimary: Yes\nRisk / Blocker: A\nRequired Action: B\nRisk 2\nPrimary: Yes\nRisk / Blocker: C\nRequired Action: D');
  assert.equal(two.ok, false);
  assert.match(two.error, /More than one risk is marked "Primary: Yes"/);
  const none = parseRiskActionSection('Risk 1\nPrimary: No\nRisk / Blocker: A\nRequired Action: B\nRisk 2\nRisk / Blocker: C\nRequired Action: D');
  assert.deepEqual(none.riskActions.map(item => item.primary), [true, false]);
  assert.match(parseRiskActionSection('Risk 1\nPrimary: Yes / No\nRisk / Blocker: A\nRequired Action: B').error, /must be Yes or No/);
  assert.match(parseRiskActionSection('Some text\nRisk 1').error, /must start with a "Risk 1" heading/);
  assert.match(parseRiskActionSection('None this week.').error, /must start with a "Risk 1" heading/);
  assert.match(parseRiskActionSection('Risk 1\nloose text\nRisk / Blocker: A\nRequired Action: B').error, /text outside/);
  assert.match(parseRiskActionSection('Risk 1\nRisk / Blocker: A\nRisk / Blocker: A2\nRequired Action: B').error, /more than one "Risk \/ Blocker"/);
});

test('T18 pasted markup is returned as inert plain text, never altered or executed', () => {
  const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const result = parseWeeklyUpdateResponse(block({ f1: hostile }));
  assert.equal(result.ok, true);
  assert.equal(result.values.highlight, hostile);
  assert.equal(typeof result.values.highlight, 'string');
  expectError('x'.repeat(50001), /too long/);
});

test('round trip: a response that follows the generated prompt template parses', () => {
  const prompt = buildWeeklyCopilotPrompt(buildPromptContext({
    weeks: [{ weekLabel: 'W38 2026', weekDate: 'Sep 14 - Sep 18', projects: [] }],
    currentWeek: { weekLabel: 'W38 2026', weekDate: 'Sep 14 - Sep 18' },
    project: { name: 'Demo' },
  }));
  const template = prompt.slice(prompt.indexOf('```text'), prompt.lastIndexOf('```') + 3);
  const filled = template
    .replace(/- \.\.\./g, '- Confirmed item')
    .replace(/Primary: Yes \/ No/, 'Primary: Yes')
    .replace(/Primary: Yes \/ No/, 'Primary: No')
    .replace(/\n\.\.\.\n/g, '\nDetail\n')
    .replace(/\n\.\.\.\n/g, '\nDetail\n');
  const result = parseWeeklyUpdateResponse(filled);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.values.riskActions.length, 2);
  // The raw template itself is not applicable: its placeholders are rejected.
  assert.equal(parseWeeklyUpdateResponse(template).ok, false);
});

test('validateWeeklyUpdateValues checks PM-edited preview values before apply', () => {
  const good = parseWeeklyUpdateResponse(block()).values;
  assert.equal(validateWeeklyUpdateValues(good).ok, true);
  assert.match(validateWeeklyUpdateValues({ ...good, highlight: ' ' }).error, /Highlight is empty/);
  assert.match(validateWeeklyUpdateValues({ ...good, weeklyActions: '' }).error, /Weekly Key Actions is empty/);
  assert.match(validateWeeklyUpdateValues({ ...good, riskActions: [] }).error, /at least one risk/);
  assert.match(validateWeeklyUpdateValues({ ...good, riskActions: [{ primary: true, risk: 'r', action: '' }] }).error, /Risk 1 has no "Mitigation Actions"/);
  assert.match(validateWeeklyUpdateValues({ ...good, riskActions: good.riskActions.map(pair => ({ ...pair, primary: false })) }).error, /exactly one risk as Primary/);
});

test('T11 weeklyFieldsDiffer detects manual edits and ignores harmless differences', () => {
  const saved = { highlight: 'A', weeklyActions: 'B', riskActions: [{ id: 'x', primary: true, risk: 'R', action: 'M' }] };
  assert.equal(weeklyFieldsDiffer(saved, { highlight: 'A\r\n', weeklyActions: ' B', riskActions: [{ primary: false, risk: 'R', action: 'M' }, { risk: '', action: '' }] }), false);
  assert.equal(weeklyFieldsDiffer(saved, { ...saved, highlight: 'A edited' }), true);
  assert.equal(weeklyFieldsDiffer(saved, { ...saved, weeklyActions: 'B edited' }), true);
  assert.equal(weeklyFieldsDiffer(saved, { ...saved, riskActions: [{ primary: true, risk: 'R', action: 'M2' }] }), true);
  assert.equal(weeklyFieldsDiffer({ weeklyAction: 'legacy' }, { weeklyActions: 'legacy' }), false);
});

test('T16/T17 a parsed draft only applies in the same project, week and editor session', () => {
  const session = { token: 'project-editor-4', weekId: 'W38-2026', code: 'SYS-001' };
  const draft = { sessionToken: 'project-editor-4', weekId: 'W38-2026', projectCode: 'SYS-001', source: 'pasted v1' };
  assert.equal(isWeeklyUpdateDraftCurrent(draft, session, 'pasted v1'), true);
  assert.equal(isWeeklyUpdateDraftCurrent(draft, { ...session, code: 'SYS-002' }, 'pasted v1'), false, 'other project');
  assert.equal(isWeeklyUpdateDraftCurrent(draft, { ...session, weekId: 'W39-2026' }, 'pasted v1'), false, 'other week');
  assert.equal(isWeeklyUpdateDraftCurrent(draft, { ...session, token: 'project-editor-5' }, 'pasted v1'), false, 'reopened editor');
  assert.equal(isWeeklyUpdateDraftCurrent(draft, session, 'pasted v2'), false, 'source changed since parsing');
  assert.equal(isWeeklyUpdateDraftCurrent(draft, session, ''), false, 'source cleared');
  assert.equal(isWeeklyUpdateDraftCurrent(draft, session), false, 'source must be supplied');
  assert.equal(isWeeklyUpdateDraftCurrent({ ...draft, source: undefined }, session, undefined), false, 'draft without a source');
  assert.equal(isWeeklyUpdateDraftCurrent(null, session, 'pasted v1'), false);
  assert.equal(isWeeklyUpdateDraftCurrent(draft, null, 'pasted v1'), false);
});
