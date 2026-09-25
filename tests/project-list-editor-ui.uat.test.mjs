// MEDIUM #4 (Control Plane remediation on top of fcca7b6): this test was skipped in 37e8408 on the premise that
// "the Production list editor is the baseline" superseded UAT's plain textareas. That premise does not hold:
// tests/project-list-editor-ui.test.mjs (Production) asserts these exact same things -- no enhanceListTextarea, no
// LIST_COMMANDS, no toolbar -- and currently passes. Neither profile wires up an interactive list editor for the
// Highlight/Weekly Actions fields; the CSS classes for one (.list-editor, .list-editor-toolbar, ...) are unused
// dead styles, and the only thing index.html imports from js/list-editor.mjs is renderListHtml, used solely for
// read-only Risk/Action-row rendering elsewhere. The one real drift was a cache-busting version-string bump
// (raw-text-preserve-1 -> -2, matching the Production test) with no behavior change, so this is un-skipped rather
// than replaced.
import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await dashboardSourceAsync('uat');

test('Project Editor keeps PM multiline fields as native textareas', () => {
  assert.match(html, /from ["']\.\/js\/list-editor\.mjs\?v=raw-text-preserve-2["']/);
  assert.doesNotMatch(html, /function enhanceListTextarea\(textarea\)/);
  assert.doesNotMatch(html, /const LIST_COMMANDS\s*=\s*\[/);
  assert.doesNotMatch(html, /Enter: new item · Tab: sub-item · Shift\+Tab: move up/);
  assert.doesNotMatch(html, /className = 'list-editor-toolbar'/);
  assert.match(html, /document\.getElementById\('pe_highlight'\)\.value = p\.highlight \|\| ''/);
  assert.match(html, /document\.getElementById\('pe_weekly_actions'\)\.value = p\.weeklyActions \|\| p\.weeklyAction \|\| ''/);
  assert.match(html, /highlight: document\.getElementById\('pe_highlight'\)\.value/);
  assert.match(html, /weeklyActions: document\.getElementById\('pe_weekly_actions'\)\.value/);
  assert.match(html, /\.structured-text\s*\{[^}]*white-space:\s*pre-wrap/s);
});

test('Project Editor leaves risk and action fields as ordinary textareas', () => {
  assert.doesNotMatch(html, /row\.querySelectorAll\('\.rap-risk, \.rap-action'\)\.forEach\(enhanceListTextarea\)/);
  assert.match(html, /risk: row\.querySelector\('\.rap-risk'\)\?\.value \|\| ''/);
  assert.match(html, /action: row\.querySelector\('\.rap-action'\)\?\.value \|\| ''/);
});

test('Risk and Required Action inputs resize vertically without escaping their grid cells', () => {
  assert.match(html, /\.risk-list-cell\s*\{[^}]*min-width:\s*0/s);
  assert.match(
    html,
    /\.risk-list-cell \.ft\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*resize:\s*vertical/s,
  );
  assert.doesNotMatch(html, /\.risk-list-cell \.ft\s*\{[^}]*resize:\s*(?:both|horizontal)/s);
  assert.match(html, /\.risk-pair-row\s*\{[^}]*align-items:\s*start/s);
  assert.match(html, /class="risk-list-cell"[^>]*><textarea class="ft rap-risk"/);
  assert.match(html, /class="risk-list-cell"[^>]*><textarea class="ft rap-action"/);
});

test('Project Editor labels explain visible list controls instead of hidden newline behavior', () => {
  assert.match(html, /<label class="fl">Highlight<\/label>/);
  assert.match(html, /<label class="fl">Risk &amp; Mitigation Actions \(shown in Overview\)<\/label>/);
  assert.doesNotMatch(html, /Highlight \(Press Enter for new bullet point\)/);
  assert.doesNotMatch(html, /Press Enter for new bullet point/);
});

test('Single Project preview renders paired Risk and Required Action rows', () => {
  assert.match(html, /<div class="info-lbl"[^>]*>Risk &amp; Mitigation Actions<\/div>/);
  assert.match(html, /class="project-risk-table-wrap"/);
  assert.match(html, /<th>Risk \/ Blocker<\/th>/);
  assert.match(html, /<th>Required Action<\/th>/);
  assert.match(html, /id="pd_risk_action_rows"/);
  assert.match(html, /function renderProjectRiskActionTable\(project\)/);
  assert.match(html, /class="project-risk-primary">Primary</);
  assert.match(html, /No active risk\/action reported\./);
  assert.match(html, /row\.risk \? renderListHtml\(row\.risk\) : '—'/);
  assert.match(html, /row\.action \? renderListHtml\(row\.action\) : '—'/);
  assert.match(html, /renderProjectRiskActionTable\(p\)/);
});

test('Single Project paired table stays two-column and scrollable at narrow widths', () => {
  assert.match(html, /\.project-risk-table-wrap\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(html, /\.project-risk-table\s*\{[^}]*min-width:\s*620px[^}]*table-layout:\s*fixed/s);
});

test('Risk/Action editors stack at phone widths', () => {
  assert.match(
    html,
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.risk-pair-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+34px/s,
  );
  assert.match(html, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.risk-list-cell\s*\{[^}]*grid-column:\s*1/s);
  assert.match(html, /class="risk-list-cell" data-list-label="Risk \/ Blocker"/);
  assert.match(html, /class="risk-list-cell" data-list-label="Required Action"/);
});
