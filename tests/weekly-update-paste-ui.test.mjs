import { dashboardSource, PROFILES } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as paste from '../js/weekly-update-paste.mjs';

const START = '// ── ONE-PASTE WEEKLY UPDATE ──';
const END = '\nfunction activeProjectsForWeek(week) {';

function block(source) {
  const start = source.indexOf(START);
  assert.ok(start > 0, 'one-paste block exists');
  return source.slice(start, source.indexOf(END, start));
}

const dashboard = dashboardSource('production');
const onePaste = block(dashboard);

// Minimal DOM double: just enough for the one-paste handlers.
function element(props = {}) {
  const el = {
    value: '', hidden: false, textContent: '', checked: false, className: '', children: [], listeners: {},
    classList: { set: new Set(), toggle(name, on) { on ? this.set.add(name) : this.set.delete(name); }, contains(name) { return this.set.has(name); } },
    setAttribute() {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    append(...items) { this.children.push(...items.filter(item => typeof item === 'object')); },
    replaceChildren(...items) { this.children = items; },
    querySelector(selector) { return all(this).find(child => hasClass(child, selector.slice(1))) || null; },
    ...props,
  };
  return el;
}
const hasClass = (el, name) => String(el.className).split(/\s+/).includes(name);
const all = el => el.children.flatMap(child => [child, ...all(child)]);

function harness({ session, editor = {}, confirmAnswer = true } = {}) {
  const ids = ['pe_highlight', 'pe_weekly_actions', 'riskActionPairContainer', 'pe_copilot_response', 'pe_weekly_paste',
    'pe_weekly_paste_error', 'pe_weekly_paste_preview', 'pe_wu_highlight', 'pe_wu_weekly_actions', 'pe_wu_risks', 'pe_weekly_paste_status'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  nodes.pe_highlight.value = editor.highlight ?? '';
  nodes.pe_weekly_actions.value = editor.weeklyActions ?? '';
  let editorPairs = (editor.riskActions ?? []).map(pair => ({ ...pair }));
  const calls = { confirm: 0, toasts: [], saves: 0 };
  // Controllable fake timers: nothing runs until the test flushes them.
  const timers = new Map();
  let timerId = 0;
  const context = {
    console: { log() { throw new Error('must not log'); }, error() { throw new Error('must not log'); } },
    setTimeout: (fn, delay = 0) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => { timers.delete(id); },
    Object, Array, String, Boolean,
    projectEditorSession: session,
    isProjectEditorSessionCurrent: candidate => Boolean(candidate) && candidate === context.projectEditorSession,
    collectRiskActionPairs: () => editorPairs.filter(pair => pair.risk || pair.action).map(pair => ({ ...pair })),
    addRiskActionPairRow: pair => { editorPairs.push({ primary: pair.primary === true, risk: pair.risk, action: pair.action }); },
    ensurePrimaryRiskActionPair() {},
    confirm: () => { calls.confirm += 1; return confirmAnswer; },
    showSaveToast: message => calls.toasts.push(message),
    saveProjEdit: () => { calls.saves += 1; },
    window: {},
    document: {
      getElementById: id => nodes[id],
      createElement: tag => element({ tagName: tag.toUpperCase() }),
      querySelectorAll: selector => {
        assert.equal(selector, '#pe_wu_risks .weekly-paste-risk');
        return nodes.pe_wu_risks.children.filter(child => hasClass(child, 'weekly-paste-risk'));
      },
    },
    ...paste,
  };
  nodes.riskActionPairContainer.replaceChildren = () => { editorPairs = []; };
  vm.createContext(context);
  vm.runInContext(`${onePaste}\nthis.resetWeeklyUpdatePaste = resetWeeklyUpdatePaste;`, context);
  context.resetWeeklyUpdatePaste(session);
  const flush = () => {
    for (const [id, timer] of [...timers]) {
      timers.delete(id);
      timer.fn();
    }
  };
  // Browser order: paste event (value not yet changed) -> value changes -> input event.
  const pasteEvent = text => {
    nodes.pe_copilot_response.listeners.paste();
    nodes.pe_copilot_response.value = text;
    nodes.pe_copilot_response.listeners.input({ inputType: 'insertFromPaste' });
  };
  const typeText = (text, inputType = 'insertText') => {
    nodes.pe_copilot_response.value = text;
    nodes.pe_copilot_response.listeners.input({ inputType });
  };
  const pasteText = text => {
    pasteEvent(text);
    flush();
  };
  const editorState = () => ({ highlight: nodes.pe_highlight.value, weeklyActions: nodes.pe_weekly_actions.value, riskActions: editorPairs });
  return {
    context, nodes, calls, timers, flush, pasteEvent, typeText, pasteText, editorState,
    apply: () => context.window.applyWeeklyUpdateDraft(),
  };
}

const SESSION = Object.freeze({ token: 'project-editor-1', weekId: 'W38-2026', weekLabel: 'W38 2026', code: 'SYS-001', manageOnly: false });
const RESPONSE = [
  '<<<PM_WEEKLY_UPDATE_V1>>>',
  '<<<FIELD_1>>>', '- Installer signed.', '- Firmware validated.', '<<<END_FIELD_1>>>',
  '<<<FIELD_2>>>', '- Confirm mobilization date.', '<<<END_FIELD_2>>>',
  '<<<FIELD_3>>>', 'Risk 1', 'Primary: Yes', 'Risk / Blocker:', 'Date unconfirmed.', 'Required Action:', 'Obtain schedule.', '<<<END_FIELD_3>>>',
  '<<<END_PM_WEEKLY_UPDATE_V1>>>',
].join('\n');
const SAVED = { highlight: 'Saved highlight', weeklyActions: 'Saved actions', riskActions: [{ primary: true, risk: 'Old risk', action: 'Old action' }] };

test('a valid paste is parsed automatically into an editable preview without touching the form', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  h.pasteText(RESPONSE);
  assert.equal(h.nodes.pe_weekly_paste_preview.hidden, false);
  assert.equal(h.nodes.pe_wu_highlight.value, '- Installer signed.\n- Firmware validated.');
  assert.equal(h.nodes.pe_wu_weekly_actions.value, '- Confirm mobilization date.');
  assert.equal(h.nodes.pe_wu_risks.children.length, 1);
  assert.deepEqual(h.editorState(), SAVED, 'parsing alone never changes the editor fields');
  assert.match(h.nodes.pe_weekly_paste_status.textContent, /Read for W38 2026/);
});

test('T12/T13 preview edits are applied and all three fields update together; Save is not called (T14)', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  h.pasteText(RESPONSE);
  h.nodes.pe_wu_highlight.value = '- PM edited highlight';
  h.nodes.pe_wu_risks.children[0].querySelector('.wu-action').value = 'PM edited mitigation';
  h.apply();
  assert.equal(h.calls.confirm, 0, 'no unsaved manual edits, so no confirmation');
  assert.deepEqual(h.editorState(), {
    highlight: '- PM edited highlight',
    weeklyActions: '- Confirm mobilization date.',
    riskActions: [{ primary: true, risk: 'Date unconfirmed.', action: 'PM edited mitigation' }],
  });
  assert.equal(h.calls.saves, 0, 'Apply never saves');
  assert.equal(h.nodes.pe_copilot_response.value, '', 'raw paste is discarded after apply');
  assert.equal(h.nodes.pe_weekly_paste_preview.hidden, true);
  assert.match(h.calls.toasts.at(-1), /click Save/);
});

test('T11 unsaved manual edits require confirmation, and declining keeps them untouched', () => {
  const h = harness({ session: SESSION, editor: SAVED, confirmAnswer: false });
  h.nodes.pe_highlight.value = 'Unsaved manual highlight';
  h.pasteText(RESPONSE);
  h.apply();
  assert.equal(h.calls.confirm, 1);
  assert.deepEqual(h.editorState(), { ...SAVED, highlight: 'Unsaved manual highlight' });
  assert.equal(h.nodes.pe_weekly_paste_preview.hidden, false, 'the preview stays for another try');

  const accepted = harness({ session: SESSION, editor: SAVED, confirmAnswer: true });
  accepted.nodes.pe_weekly_actions.value = 'Unsaved manual actions';
  accepted.pasteText(RESPONSE);
  accepted.apply();
  assert.equal(accepted.calls.confirm, 1);
  assert.equal(accepted.editorState().weeklyActions, '- Confirm mobilization date.');
});

test('parse failure shows an actionable error and preserves every field (no partial apply)', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  h.pasteText(RESPONSE.replace('<<<END_FIELD_2>>>\n', ''));
  assert.equal(h.nodes.pe_weekly_paste_preview.hidden, true);
  assert.match(h.nodes.pe_weekly_paste_error.textContent, /FIELD_2 \(Weekly Key Actions\) is not closed.*Nothing was changed\./);
  assert.ok(h.nodes.pe_weekly_paste_error.classList.contains('show'));
  h.apply();
  assert.deepEqual(h.editorState(), SAVED);
  h.pasteText(RESPONSE);
  assert.equal(h.nodes.pe_weekly_paste_error.textContent, '', 'correcting the paste clears the error');
});

test('an edited preview that becomes invalid is rejected without changing the form', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  h.pasteText(RESPONSE);
  h.nodes.pe_wu_weekly_actions.value = '  ';
  h.apply();
  assert.match(h.nodes.pe_weekly_paste_error.textContent, /Weekly Key Actions is empty/);
  assert.deepEqual(h.editorState(), SAVED);
});

for (const [name, change] of [
  ['T16 another project', { code: 'SYS-002' }],
  ['T17 another reporting week', { weekId: 'W39-2026', weekLabel: 'W39 2026' }],
  ['a reopened editor session', { token: 'project-editor-2' }],
]) {
  test(`${name} invalidates a stale parsed preview`, () => {
    const h = harness({ session: SESSION, editor: SAVED });
    h.pasteText(RESPONSE);
    h.context.projectEditorSession = Object.freeze({ ...SESSION, ...change });
    h.apply();
    assert.deepEqual(h.editorState(), SAVED);
    assert.match(h.nodes.pe_weekly_paste_error.textContent, /no longer matches the open project and week/);
    assert.equal(h.nodes.pe_weekly_paste_preview.hidden, true);
  });
}

test('reopening the editor clears any previous paste and preview; delete-only editors hide the panel', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  h.pasteText(RESPONSE);
  h.context.resetWeeklyUpdatePaste(Object.freeze({ ...SESSION, token: 'project-editor-2' }));
  assert.equal(h.nodes.pe_copilot_response.value, '');
  assert.equal(h.nodes.pe_weekly_paste_preview.hidden, true);
  assert.equal(h.nodes.pe_wu_risks.children.length, 0);
  h.context.resetWeeklyUpdatePaste(Object.freeze({ ...SESSION, manageOnly: true }));
  assert.equal(h.nodes.pe_weekly_paste.hidden, true);
});

test('T18 hostile pasted markup only reaches .value / .textContent', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  const hostile = '<img src=x onerror="alert(1)">';
  h.pasteText(RESPONSE.replace('- Installer signed.', hostile));
  assert.equal(h.nodes.pe_wu_highlight.value.split('\n')[0], hostile);
  assert.doesNotMatch(onePaste, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function/);
});

test('one-paste code never persists, logs, or sends the pasted text', () => {
  assert.doesNotMatch(onePaste, /projectDashboardApi|httpsCallable|setDoc|updateDoc|addDoc|runTransaction|writeBatch/);
  assert.doesNotMatch(onePaste, /saveProjEdit\(|fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|console\./);
});

test('markup: one paste area with guidance, preview with the real field labels, one Apply action', () => {
  for (const profile of PROFILES) {
    const source = dashboardSource(profile);
    assert.match(source, /<label class="fl" id="pe_weekly_paste_label" for="pe_copilot_response">Paste Copilot Response<\/label>/);
    assert.match(source, /<textarea class="ft weekly-paste-input" id="pe_copilot_response"[^>]*data-editor-ignore-dirty/);
    assert.match(source, /<label class="fl" for="pe_wu_highlight">Highlight<\/label>/);
    assert.match(source, /<label class="fl" for="pe_wu_weekly_actions">Weekly Key Actions<\/label>/);
    assert.match(source, /<span class="fl">Risk &amp; Mitigation Actions<\/span>/);
    assert.equal(source.match(/onclick="applyWeeklyUpdateDraft\(\)">Apply Weekly Update<\/button>/g)?.length, 1);
    assert.doesNotMatch(source, />Parse<\/button>/);
    // The panel sits between the Copy button and the manual fields, which stay in place (T15).
    const copy = source.indexOf('id="pe_btn_copy_copilot_prompt"');
    const panel = source.indexOf('id="pe_weekly_paste"');
    assert.ok(copy < panel && panel < source.indexOf('id="pe_highlight"'));
    assert.match(source, /<textarea class="ft" id="pe_highlight" rows="3"/);
    assert.match(source, /<textarea class="ft" id="pe_weekly_actions" rows="3"/);
    assert.match(source, /onclick="addRiskActionPairRow\(\)"/);
    // Preview rows must not be picked up by the editor's own risk-pair collector.
    assert.doesNotMatch(block(source), /risk-pair-row|rap-risk|rap-action|rap-primary|riskActionPrimary/);
  }
});

test('T14 the existing Save path is unchanged and still reads the same three editor fields', () => {
  assert.match(dashboard, /highlight: document\.getElementById\('pe_highlight'\)\.value,\n    weeklyActions: document\.getElementById\('pe_weekly_actions'\)\.value,\n    riskActions: riskActions,/);
  assert.match(dashboard, /const response = await projectDashboardApi\.saveProject\(\{/);
  assert.match(dashboard, /resetWeeklyUpdatePaste\(projectEditorSession\);\n  document\.getElementById\('pe_details'\)\.open = isNew;/);
});

// ── Stale preview regression (PR #47 review, P2) ──
const OTHER = RESPONSE.replace('- Installer signed.', '- Second response highlight.');
const STALE_ERROR = /changed since the preview|no longer matches/;

function expectRejected(h, expectedSource) {
  assert.deepEqual(h.editorState(), SAVED, 'the three editor fields are unchanged');
  assert.equal(h.nodes.pe_copilot_response.value, expectedSource, 'the latest pasted source is preserved');
  assert.equal(h.calls.toasts.length, 0, 'no success toast');
}

test('stale T01: editing the source then applying before the debounce cannot apply the old preview', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  h.pasteText(RESPONSE);
  const edited = RESPONSE.replace('- Firmware validated.', '- Firmware validated on rev B.');
  h.typeText(edited);
  assert.equal(h.timers.size, 1, 'debounced re-parse is still pending');
  assert.equal(h.nodes.pe_weekly_paste_preview.hidden, true, 'old preview is hidden immediately');
  h.apply();
  expectRejected(h, edited);
  assert.match(h.nodes.pe_weekly_paste_error.textContent, STALE_ERROR);
});

test('stale T02: clearing the source then applying immediately applies nothing', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  h.pasteText(RESPONSE);
  h.typeText('', 'deleteContentBackward');
  h.apply();
  expectRejected(h, '');
});

test('stale T03: replacing the source with invalid text invalidates the old preview at once', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  h.pasteText(RESPONSE);
  h.pasteEvent('not a weekly update');
  assert.equal(h.nodes.pe_weekly_paste_preview.hidden, true);
  assert.equal(h.nodes.pe_wu_highlight.value, '');
  h.apply();
  expectRejected(h, 'not a weekly update');
  h.flush();
  assert.match(h.nodes.pe_weekly_paste_error.textContent, /No <<<PM_WEEKLY_UPDATE_V1>>> block was found/);
  h.apply();
  expectRejected(h, 'not a weekly update');
});

test('stale T04/T05: a second paste blocks the old draft until it parses, then only the new content applies', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  h.pasteText(RESPONSE);
  h.pasteEvent(OTHER);
  h.apply();
  expectRejected(h, OTHER);
  h.flush();
  assert.equal(h.nodes.pe_weekly_paste_preview.hidden, false, 'fresh preview after parsing');
  assert.match(h.nodes.pe_wu_highlight.value, /Second response highlight/);
  h.apply();
  assert.equal(h.editorState().highlight, '- Second response highlight.\n- Firmware validated.');
});

test('stale guard does not depend on events: a source changed without an input event is still rejected', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  h.pasteText(RESPONSE);
  h.nodes.pe_copilot_response.value = OTHER; // e.g. programmatic change, no event fired
  h.apply();
  expectRejected(h, OTHER);
});

test('stale T06: preview edits after a successful parse remain applicable', () => {
  const h = harness({ session: SESSION, editor: SAVED });
  h.pasteText(RESPONSE);
  h.nodes.pe_wu_weekly_actions.value = '- PM rewrote the action.';
  h.apply();
  assert.equal(h.editorState().weeklyActions, '- PM rewrote the action.');
});

test('stale T07/T09: unsaved manual edits still require confirmation; a stale reject keeps them and the source', () => {
  const h = harness({ session: SESSION, editor: SAVED, confirmAnswer: false });
  h.nodes.pe_highlight.value = 'Unsaved manual highlight';
  h.pasteText(RESPONSE);
  h.typeText(OTHER);
  h.apply();
  assert.equal(h.calls.confirm, 0, 'stale drafts are rejected before any overwrite prompt');
  assert.equal(h.nodes.pe_highlight.value, 'Unsaved manual highlight');
  assert.equal(h.nodes.pe_copilot_response.value, OTHER);
  h.flush();
  h.apply();
  assert.equal(h.calls.confirm, 1, 'overwrite confirmation still runs for a fresh draft');
  assert.equal(h.nodes.pe_highlight.value, 'Unsaved manual highlight');
});

test('stale T08: a pending re-parse cannot revive a draft after the session changes or ends', () => {
  // Opening another project/week/editor runs resetWeeklyUpdatePaste (as openProjEdit does).
  const reopened = harness({ session: SESSION, editor: SAVED });
  reopened.pasteText(RESPONSE);
  reopened.typeText(OTHER);
  const next = Object.freeze({ ...SESSION, token: 'project-editor-2', code: 'SYS-002' });
  reopened.context.projectEditorSession = next;
  reopened.context.resetWeeklyUpdatePaste(next);
  assert.equal(reopened.timers.size, 0, 'pending re-parse is cancelled');
  reopened.flush();
  reopened.apply();
  expectRejected(reopened, '');

  // The editor session ends (e.g. invalidated) while a re-parse is pending.
  const ended = harness({ session: SESSION, editor: SAVED });
  ended.pasteText(RESPONSE);
  ended.typeText(OTHER);
  ended.context.projectEditorSession = null;
  ended.flush();
  assert.equal(ended.nodes.pe_weekly_paste_preview.hidden, true);
  ended.apply();
  expectRejected(ended, OTHER);
  assert.match(ended.nodes.pe_weekly_paste_error.textContent, /no longer matches the open project and week/);
});
