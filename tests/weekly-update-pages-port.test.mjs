// Production Pages port of the One-Paste weekly update (main PR #47). These checks cover what is specific to
// this single-profile, subpath-served branch; parser and UI behaviour are covered by the shared test files.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dashboardSource } from './helpers/dashboard-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = dashboardSource('production');
const read = path => readFileSync(join(root, path), 'utf8');
const section = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${start} should exist`);
  return text.slice(from, text.indexOf(end, from));
};

test('T14 the new modules are loaded by relative paths that resolve under the /pm-dashboard/ Pages subpath', () => {
  const imports = [...html.matchAll(/^import .*? from "(\.\/js\/(?:weekly-update-paste|copilot-weekly-update-prompt)\.mjs[^"]*)";$/gm)].map(match => match[1]);
  assert.deepEqual(imports.sort(), ['./js/copilot-weekly-update-prompt.mjs', './js/weekly-update-paste.mjs']);
  for (const specifier of imports) {
    assert.ok(!specifier.startsWith('/'), 'no root-absolute path (would break under /pm-dashboard/)');
    assert.ok(existsSync(join(root, posix.normalize(specifier))), `${specifier} exists`);
  }
  // Module-to-module imports stay relative and inside js/.
  const prompt = read('js/copilot-weekly-update-prompt.mjs');
  assert.match(prompt, /from '\.\/weekly-update-paste\.mjs';/);
  assert.match(prompt, /from '\.\/portfolio-core\.mjs';/);
  assert.doesNotMatch(read('js/weekly-update-paste.mjs'), /^import /m, 'the parser has no dependencies');
});

test('T14 the new modules load and run as plain ES modules (no browser globals at import time)', async () => {
  const paste = await import('../js/weekly-update-paste.mjs');
  const prompt = await import('../js/copilot-weekly-update-prompt.mjs');
  assert.equal(paste.WEEKLY_UPDATE_FORMAT, 'PM_WEEKLY_UPDATE_V1');
  assert.match(prompt.buildWeeklyCopilotPrompt({}), /<<<PM_WEEKLY_UPDATE_V1>>>/);
});

test('Production binding: no UAT configuration or external API arrived with the port', () => {
  for (const text of [html, read('js/weekly-update-paste.mjs'), read('js/copilot-weekly-update-prompt.mjs')]) {
    assert.doesNotMatch(text, /pm-dashboard-uat|b266ahac7q|IS_UAT_PROFILE|@profile-/);
    assert.doesNotMatch(text, /api\.openai\.com|openai\.azure\.com|graph\.microsoft\.com|login\.microsoftonline\.com/);
  }
  assert.ok(html.includes('projectId: "project-manager-dashboar-a067f"'));
});

test('T10 the existing Save path is unchanged and still reads the same three editor fields', () => {
  const save = section(html, 'window.saveProjEdit = async () => {', 'window.deleteProject = async () => {');
  assert.match(save, /highlight: document\.getElementById\('pe_highlight'\)\.value,\n\s+weeklyActions: document\.getElementById\('pe_weekly_actions'\)\.value,\n\s+riskActions: riskActions,/);
  assert.match(save, /await projectDashboardApi\.saveProject\(\{/);
  assert.match(save, /isProjectEditorSessionCurrent\(session\)/);
  const onePaste = section(html, '// ── ONE-PASTE WEEKLY UPDATE ──', '\nfunction activeProjectsForWeek(week) {');
  assert.doesNotMatch(onePaste, /projectDashboardApi|httpsCallable|setDoc|updateDoc|addDoc|runTransaction|writeBatch|fetch\(|localStorage|sessionStorage|console\.|innerHTML/);
});

test('T11 permission gates are intact: the editor opens only for authorized users and the panel is hidden when delete-only', () => {
  const open = section(html, 'window.openProjEdit = (code, isNew = false) => {', 'function getEditorPortfolioValue(');
  assert.match(open, /canEditProject\(existingProject\) \|\| canCurrentUser\('project\.manage'\)/);
  assert.match(open, /if \(isWeekReleased\(week\)\) return;/);
  assert.match(open, /resetWeeklyUpdatePaste\(projectEditorSession\);\n\s+document\.getElementById\('pe_details'\)\.open = isNew;/);
  assert.match(html, /document\.getElementById\('pe_weekly_paste'\)\.hidden = !session \|\| session\.manageOnly;/);
});

test('T12/T13 Dashboard and PDF still read the same persisted keys (highlight, weeklyActions, riskActions)', () => {
  assert.match(html, /riskActions: \['riskActions', 'risk', 'next', 'riskList', 'riskManual'\]|riskActions/);
  assert.match(html, /function getRiskActionPairs\(p\) \{/);
  assert.match(read('professional-pdf-client.mjs'), /export /);
  assert.ok(existsSync(join(root, 'pdf-service/src/report-model.js')));
});

test('T15 existing Pages features around the editor are untouched: Copy Prompt, portfolio Copilot prompt, manual fields', () => {
  assert.match(html, /<button type="button" class="btn btn-ghost" id="pe_btn_copy_copilot_prompt" onclick="copyProjectCopilotWeeklyPrompt\(\)">Copy Weekly Update Prompt<\/button>/);
  assert.match(html, /onclick="copyCopilotPrompt\(\)">Copy Copilot Prompt<\/button>/);
  assert.match(html, /<textarea class="ft" id="pe_highlight" rows="3"/);
  assert.match(html, /<textarea class="ft" id="pe_weekly_actions" rows="3"/);
  assert.match(html, /onclick="addRiskActionPairRow\(\)"/);
  const copy = html.indexOf('id="pe_btn_copy_copilot_prompt"');
  assert.ok(copy < html.indexOf('id="pe_weekly_paste"') && html.indexOf('id="pe_weekly_paste"') < html.indexOf('id="pe_highlight"'));
});
