import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('project detail and one-page Gantt stay contained at narrow widths', () => {
  assert.match(html, /\.detail-left,\s*\.detail-right\s*\{\s*min-width:\s*0/);
  assert.match(html, /\.one-page-status-gantt\s*\{[^}]*min-width:\s*0/);
  assert.match(
    html,
    /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.detail-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/
  );
});

test('schedule rows expose persistent visible guidance and units', () => {
  assert.match(html, /class="editor-row-head schedule-row-head"/);
  for (const label of ['Workstream', 'Start date', 'End date', 'Status', 'Progress %', 'Linked milestone', 'Actions']) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(html, /Progress % is completion from 0% to 100%/);
  assert.match(html, /class="fi ws-progress"[^>]*max="100"[^>]*aria-label="Progress percent"/);
});

test('team rows explain allocation and enforce the documented range', () => {
  assert.match(html, /class="editor-row-head team-row-head"/);
  assert.match(html, />Allocation %</);
  assert.match(html, /planned capacity assigned to this project, from 0% to 100%/i);
  assert.match(html, /class="fi team-effort"[^>]*max="100"[^>]*aria-label="Allocation percent"/);
});

test('budget rule inputs shrink within their grid instead of overlapping budget linkage', () => {
  assert.match(html, /class="budget-rule-fields"/);
  assert.match(
    html,
    /\.budget-rule-fields\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s,
  );
  assert.match(html, /\.budget-rule-fields\s*>\s*\*\s*\{[^}]*min-width:\s*0/s);
  assert.match(
    html,
    /\.budget-rule-fields\s+\.(?:fi|fs),\s*\.budget-rule-fields\s+\.(?:fi|fs)\s*\{[^}]*width:\s*100%/s,
  );
});

test('dynamic Project Editor inputs have explicit accessible names and units', () => {
  for (const label of [
    'Risk or blocker',
    'Required action',
    'Milestone name',
    'Milestone date',
    'Milestone status',
    'Quarter',
    'Quarterly target',
    'Target month',
    'Planned month',
    'Planned category',
    'Planned currency',
    'Planned amount',
    'Actual month',
    'Actual category',
    'Actual currency',
    'Actual amount',
    'Actual spend note'
  ]) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
  }
  assert.match(html, />Estimated hours<\/label>/);
  assert.match(html, />Actual hours \(optional\)<\/label>/);
});

test('ambiguous static Project Editor fields include visible or inline examples', () => {
  assert.match(html, /id="pe_customer"[^>]*placeholder="e\.g\. Internal or customer name"/);
  assert.match(html, /id="pe_location"[^>]*placeholder="e\.g\. Taiwan or Texas, US"/);
});

test('quarterly milestone rows expose completion, weight, health, and completion date', () => {
  assert.match(html, /class="editor-row-head qms-row-head"/);
  for (const heading of ['Quarter', 'Target', 'Target month', 'Completion', 'Weight', 'Health', 'Actual completion', 'Actions']) {
    assert.match(html, new RegExp(`>${heading}<`));
  }
  for (const label of [
    'Quarterly completion',
    'Quarterly weight',
    'Quarterly health',
    'Actual completion date',
  ]) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
  }
  assert.match(html, /\[0, 25, 50, 75, 100\]/);
  assert.match(html, /value="medium"[^>]*>Medium/);
  assert.match(html, /value="delayed"[^>]*>Delayed/);
  assert.match(html, /function updateQuarterlyCompletionDate/);
  assert.match(html, /getSelectedReportingDate\(\)/);
});
