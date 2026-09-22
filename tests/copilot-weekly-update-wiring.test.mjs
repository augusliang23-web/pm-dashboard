import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await dashboardSourceAsync('production');
const moduleSource = await readFile(new URL('../js/copilot-weekly-update-prompt.mjs', import.meta.url), 'utf8');

function extract(startMarker, endMarker) {
  const start = dashboard.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} should exist`);
  const end = dashboard.indexOf(endMarker, start);
  assert.ok(end > start, `${endMarker} should follow ${startMarker}`);
  return dashboard.slice(start, end);
}

const fallback = extract('function copyTextWithLegacyFallback(text) {', '// Read-only: builds the prompt');
const handler = extract('window.copyProjectCopilotWeeklyPrompt = async () => {', '\nfunction activeProjectsForWeek(week) {');

test('the project editor exposes a Copy Copilot Weekly Update Prompt button that is not a save control', () => {
  assert.match(dashboard, /<button type="button" class="btn btn-ghost" id="pe_btn_copy_copilot_prompt" onclick="copyProjectCopilotWeeklyPrompt\(\)">Copy Copilot Weekly Update Prompt<\/button>/);
  const button = dashboard.indexOf('id="pe_btn_copy_copilot_prompt"');
  assert.ok(button > dashboard.indexOf('id="pe_status"'));
  assert.ok(button < dashboard.indexOf('id="pe_highlight"'));
});

test('the dashboard imports the prompt builder module and keeps the portfolio Copilot prompt untouched', () => {
  assert.match(dashboard, /import \{ buildPromptContext, buildWeeklyCopilotPrompt, copyTextToClipboard \} from "\.\/js\/copilot-weekly-update-prompt\.mjs";/);
  assert.match(dashboard, /window\.copyCopilotPrompt = async \(\) => \{/);
  assert.match(dashboard, /onclick="copyCopilotPrompt\(\)">Copy Copilot Prompt<\/button>/);
});

test('copying is read-only: no save, publish, callable or Firestore write is reachable from the handler', () => {
  for (const source of [handler, fallback]) {
    assert.doesNotMatch(source, /projectDashboardApi|executiveApi|uatProductionSyncApi/);
    assert.doesNotMatch(source, /httpsCallable|setDoc|updateDoc|runTransaction|addDoc|deleteDoc|writeBatch/);
    assert.doesNotMatch(source, /saveProjEdit|saveProject|saveWeekFields|saveWeekSummary|createWeek|releaseWeek/);
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/);
  }
});

test('the baseline comes from persisted weeks and never from the editor fields being edited', () => {
  assert.match(handler, /allWeeks/);
  assert.match(handler, /session\.code/);
  for (const id of ['pe_highlight', 'pe_weekly_actions', 'pe_risk', 'pe_next', 'pe_code', 'riskActionPairContainer']) {
    assert.doesNotMatch(handler, new RegExp(id));
  }
  assert.doesNotMatch(handler, /collectRiskActionPairs|\.rap-risk|\.rap-action/);
});

test('new (unsaved) projects get no previous-week baseline', () => {
  assert.match(handler, /weeks: persisted \? allWeeks : \[\]/);
});

test('success and failure both give feedback, and failure uses the error toast', () => {
  assert.match(handler, /showSaveToast\('Copilot Weekly Update Prompt copied\.'\)/);
  assert.match(handler, /showSaveToast\('Unable to copy the prompt\. Please try again\.', \{ type: 'error' \}\)/);
  assert.match(handler, /copied = await copyTextToClipboard\(prompt, \{/);
  assert.match(dashboard, /const showSaveToast = \(msg = "Saved successfully", \{ type = 'success' \} = \{\}\) => \{/);
  assert.match(dashboard, /#saveToast\.error \.toast-check \{ background: var\(--red\); \}/);
});

test('the legacy clipboard fallback only reports success when execCommand does', () => {
  assert.match(fallback, /copied = document\.execCommand\('copy'\) === true;/);
  assert.match(fallback, /area\.remove\(\)/);
  assert.match(fallback, /previouslyFocused\?\.focus\?\.\(\)/);
});

test('no Microsoft or AI service dependency was added', () => {
  assert.doesNotMatch(dashboard + moduleSource, /graph\.microsoft\.com|login\.microsoftonline\.com|api\.openai\.com|openai\.azure\.com|@azure|@microsoft/);
});
