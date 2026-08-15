# Weekly Summary Save Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Block invalid Copilot or Gemini Weekly Summary text at save time, require one canonical report format, and prevent the Overview PDF from silently omitting summary content.

**Architecture:** Add a dependency-free browser contract parser that returns canonical source text or ordered, line-specific errors. Both dashboard entry points use it before closing Week Management or mutating Firestore. The Cloud Run PDF service keeps a parallel validator because its Docker image copies only pdf-service/src; shared cross-runtime fixtures hold both implementations to the same grammar.

**Tech Stack:** Browser ES modules, vanilla DOM, Firebase Firestore, Node.js ESM, Node test runner, Cloud Run PDF service.

## Global Constraints

- Accept only the approved canonical plain-text Weekly Summary grammar.
- Reject invalid input before closing Week Management, starting the loader, mutating allWeeks, or calling setDoc.
- Preserve pasted textarea content exactly on error; do not sanitize or auto-repair it.
- Store only canonical valid source in existing week.summary; no Firestore migration.
- Require exact active-project names from the selected reporting week.
- Allow None only as Blocker and zero asks only through No immediate management decision required this week.
- Make equivalent browser changes in index.html and team-2/index.html.
- Apply the PDF 422 guard only when Executive Summary is selected for export.
- Do not add an AI API, auto-rewriting, legacy migration, or visual PDF redesign.
- Stage only files owned by this plan.

---

### Task 1: Define and test the browser Weekly Summary contract

**Files:**
- Create: js/weekly-summary-contract.mjs
- Create: tests/weekly-summary-contract-fixtures.mjs
- Create: tests/weekly-summary-contract.test.mjs

**Interfaces:**
- Consumes: source string and activeProjects array containing project names.
- Produces: validateWeeklySummaryForSave(source, activeProjects), returning ok, canonicalText, errors with line and message, and parsed brief data.
- Exports: NO_MANAGEMENT_DECISION_TEXT and validateWeeklySummaryForSave.

- [ ] **Step 1: Write the shared contract fixtures**

Create tests/weekly-summary-contract-fixtures.mjs with two valid examples and a fixed invalid matrix:

~~~js
export const activeProjects = [{ name: 'PMS' }, { name: 'Master Controller' }];
export const validNoAskSummary = [
  'WEEKLY MOVEMENT',
  'Portfolio Summary: Delivery remained stable.',
  '',
  '- Project: PMS',
  '  Movement: Validation completed.',
  '  Blocker: None',
  '  Next step: Confirm the release date.',
  '',
  'MANAGEMENT ASK',
  'No immediate management decision required this week.'
].join('\\n');
export const validAskSummary = [
  'WEEKLY MOVEMENT',
  'Portfolio Summary: One decision requires leadership support.',
  '',
  '- Project: Master Controller',
  '  Movement: Layout review completed.',
  '  Blocker: Supplier timing remains open.',
  '  Next step: Confirm the recovery plan.',
  '',
  'MANAGEMENT ASK',
  '- Project: Master Controller',
  '  Decision / Support needed: Approve supplier escalation.',
  '  Business impact: Protects the prototype schedule.'
].join('\\n');
export const invalidSummaryCases = [
  ['missing-next-step', validNoAskSummary.replace('  Next step: Confirm the release date.\\n', ''), 'expected "Next step:"'],
  ['unknown-project', validNoAskSummary.replace('Project: PMS', 'Project: pms'), 'is not an active project name'],
  ['markdown-heading', validNoAskSummary.replace('WEEKLY MOVEMENT', '## WEEKLY MOVEMENT'), 'Markdown heading'],
  ['unlabelled-prose', validNoAskSummary.replace('  Blocker: None', '  Unexpected prose'), 'expected "Blocker:"'],
  ['missing-management-body', validNoAskSummary.replace('No immediate management decision required this week.', ''), 'MANAGEMENT ASK'],
  ['too-many-asks', validAskSummary + '\\n- Project: PMS\\n  Decision / Support needed: A\\n  Business impact: B\\n- Project: PMS\\n  Decision / Support needed: C\\n  Business impact: D\\n- Project: PMS\\n  Decision / Support needed: E\\n  Business impact: F\\n- Project: PMS\\n  Decision / Support needed: G\\n  Business impact: H', 'at most four']
];
~~~

- [ ] **Step 2: Write the failing browser parser tests**

Create tests/weekly-summary-contract.test.mjs:

~~~js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWeeklySummaryForSave } from '../js/weekly-summary-contract.mjs';
import { activeProjects, validAskSummary, validNoAskSummary, invalidSummaryCases } from './weekly-summary-contract-fixtures.mjs';

test('accepts canonical no-ask source without changing it', () => {
  const result = validateWeeklySummaryForSave(validNoAskSummary, activeProjects);
  assert.equal(result.ok, true);
  assert.equal(result.canonicalText, validNoAskSummary);
  assert.equal(result.brief.projects[0].projectName, 'PMS');
  assert.deepEqual(result.brief.managementAsks, []);
});
test('accepts canonical management asks', () => {
  const result = validateWeeklySummaryForSave(validAskSummary, activeProjects);
  assert.equal(result.ok, true);
  assert.equal(result.brief.managementAsks[0].projectName, 'Master Controller');
});
for (const [name, source, expected] of invalidSummaryCases) {
  test('rejects ' + name, () => {
    const result = validateWeeklySummaryForSave(source, activeProjects);
    assert.equal(result.ok, false);
    assert.equal(result.canonicalText, '');
    assert.ok(result.errors.some(error => error.message.includes(expected)));
  });
}
~~~

- [ ] **Step 3: Run the test to verify it fails**

Run:

~~~bash
node --test tests/weekly-summary-contract.test.mjs
~~~

Expected: FAIL with ERR_MODULE_NOT_FOUND for js/weekly-summary-contract.mjs.

- [ ] **Step 4: Implement the dependency-free finite-state parser**

Create js/weekly-summary-contract.mjs:

~~~js
export const NO_MANAGEMENT_DECISION_TEXT = 'No immediate management decision required this week.';
export function validateWeeklySummaryForSave(source, activeProjects = []) {
  // Normalize CRLF or CR to LF only. Never mutate source.
  // Return every ordered error and canonicalText only when valid.
}
~~~

Use states expectMovementHeading, expectPortfolioSummary, movement, expectManagementHeading, and management. Recognize only: WEEKLY MOVEMENT; Portfolio Summary: value; - Project: active exact name; Movement: value; Blocker: value; Next step: value; MANAGEMENT ASK; Decision / Support needed: value; and Business impact: value. Reject Markdown headings or emphasis, table/code-fence lines, duplicate headings, unknown projects, blank values, unexpected labels, invalid field order, unlabelled prose, and a fifth ask. Accepted source keeps its blank-line arrangement and uses LF only.

- [ ] **Step 5: Run the test to verify it passes**

Run:

~~~bash
node --test tests/weekly-summary-contract.test.mjs
~~~

Expected: PASS for every shared fixture.

- [ ] **Step 6: Commit**

~~~bash
git add js/weekly-summary-contract.mjs tests/weekly-summary-contract-fixtures.mjs tests/weekly-summary-contract.test.mjs
git commit -m "feat: validate weekly summary contract"
~~~

### Task 2: Enforce validation in both Week Management dialogs and strengthen the prompt

**Files:**
- Modify: index.html at Week Management markup, module imports, addPortfolioSummaryInstruction, open Week Management, and saveWeekSummary
- Modify: team-2/index.html at equivalent locations
- Modify: tests/weekly-summary-prompt.test.mjs
- Create: tests/weekly-summary-save-ui.test.mjs

**Interfaces:**
- Consumes: validateWeeklySummaryForSave(field.value, activeProjectsForWeek(week)).
- Produces: setWeeklySummaryValidation(result) and a Save path that reaches setDoc only on result.ok.

- [ ] **Step 1: Write failing prompt and UI-wiring tests**

Extend tests/weekly-summary-prompt.test.mjs for both dashboard sources:

~~~js
assert.match(source, /Required output example/);
assert.match(source, /Your response will be rejected by the dashboard unless it follows this format exactly/);
assert.match(source, /No immediate management decision required this week\\./);
~~~

Create tests/weekly-summary-save-ui.test.mjs. Read both HTML files, isolate each saveWeekSummary body, and assert:

~~~js
assert.match(source, /weeklySummaryValidation.*role="alert".*aria-live="assertive"/);
assert.match(source, /import \{ validateWeeklySummaryForSave \} from "\.\/js\/weekly-summary-contract\.mjs"/);
assert.match(saveSource, /const result = validateWeeklySummaryForSave\(field\.value, activeProjectsForWeek\(week\)\)/);
assert.match(saveSource, /if \(!result\.ok\) \{\s+setWeeklySummaryValidation\(result\);\s+return;/);
assert.ok(saveSource.indexOf('validateWeeklySummaryForSave') < saveSource.indexOf('await setDoc'));
assert.doesNotMatch(saveSource, /cleanWeeklySummaryTextarea/);
~~~

- [ ] **Step 2: Run focused tests to verify failure**

Run:

~~~bash
node --test tests/weekly-summary-prompt.test.mjs tests/weekly-summary-save-ui.test.mjs
~~~

Expected: FAIL because the contract import, alert panel, prompt example, and save guard do not exist.

- [ ] **Step 3: Add the alert UI and helpers**

Immediately below wm_summary in both HTML files add:

~~~html
<div class="resource-validation" id="weeklySummaryValidation" role="alert" aria-live="assertive" tabindex="-1"></div>
~~~

Import the Task 1 module. Add activeProjectsForWeek, which returns projects whose visibility is absent or active. Add setWeeklySummaryValidation that sets resource-validation show error only when errors exist; clears children for a valid result; renders Summary was not saved. Fix the following items: and one escaped, line-aware message per error; then focuses the alert. Clear the panel when Week Management opens and after a valid Save only.

- [ ] **Step 4: Replace save-time cleaning with pre-save validation**

Delete cleanWeeklySummaryTextarea, bindWeeklySummaryCleaner, and their paste/blur bindings. At the top of both saveWeekSummary functions, before loader, closeModal, field mutation, or setDoc, use:

~~~js
const field = document.getElementById('wm_summary');
const week = allWeeks[currentIdx];
const result = validateWeeklySummaryForSave(field.value, activeProjectsForWeek(week));
if (!result.ok) {
  setWeeklySummaryValidation(result);
  return;
}
~~~

On success clear the alert, assign canonicalText to the field, form updatedWeek from week plus summary and lastModifiedBy, call setDoc with updatedWeek, then Object.assign the local week. Only after successful write hide the loader, force-close Week Management, and show the existing success toast. Wrap the asynchronous write so failure hides the loader, leaves the dialog open, and shows no success toast.

- [ ] **Step 5: Add the exact prompt warning and complete example**

Append these strings to structuredFormat in both addPortfolioSummaryInstruction functions:

~~~js
'- Your response will be rejected by the dashboard unless it follows this format exactly. Do not add an introduction, closing note, Markdown heading, table, or explanatory text.',
'',
'Required output example:',
'WEEKLY MOVEMENT',
'Portfolio Summary: Delivery remained stable with one decision requiring leadership support.',
'- Project: <exact project name>',
'  Movement: Validation completed.',
'  Blocker: None',
'  Next step: Confirm the release date.',
'MANAGEMENT ASK',
'- Project: <exact project name>',
'  Decision / Support needed: Approve the recovery plan.',
'  Business impact: Protects the delivery date.'
~~~

Keep existing plain-text, no-invented-facts, and exact-project-name rules. Do not prefill the example in the user textarea.

- [ ] **Step 6: Run focused tests to verify success**

Run:

~~~bash
node --test tests/weekly-summary-contract.test.mjs tests/weekly-summary-prompt.test.mjs tests/weekly-summary-save-ui.test.mjs
~~~

Expected: PASS for production and UAT source.

- [ ] **Step 7: Commit**

~~~bash
git add index.html team-2/index.html tests/weekly-summary-prompt.test.mjs tests/weekly-summary-save-ui.test.mjs
git commit -m "feat: block invalid weekly summary saves"
~~~

### Task 3: Add the Cloud Run Executive Summary validation guard

**Files:**
- Modify: pdf-service/src/executive-summary-brief.js
- Modify: pdf-service/src/report-data.js
- Modify: pdf-service/test/executive-summary-brief.test.mjs
- Modify: pdf-service/test/report-data.test.mjs

**Interfaces:**
- Consumes: saved week.summary or week.executiveSummary and unfiltered active saved-week projects.
- Produces: validateExecutiveSummaryForPdf(summary, activeProjects), then ReportDataError status 422 for invalid Executive Summary reports.
- Tests consume the fixtures created in Task 1 from ../../tests/weekly-summary-contract-fixtures.mjs.

- [ ] **Step 1: Write failing PDF conformance and guard tests**

In executive-summary-brief.test.mjs, import shared fixtures and validateExecutiveSummaryForPdf. Verify validNoAskSummary and validAskSummary are accepted. Loop through invalidSummaryCases and require the same expected error substring.

In report-data.test.mjs, request an Overview with executive-summary selected and stored missing-next-step source. Assert rejection is ReportDataError, statusCode is 422, and the message begins Weekly Summary is not valid for PDF export:. Add a health-focus-only request with the same stored invalid source and assert it remains available.

- [ ] **Step 2: Run focused PDF tests to verify failure**

Run:

~~~bash
cd pdf-service && node --test test/executive-summary-brief.test.mjs test/report-data.test.mjs
~~~

Expected: FAIL because the PDF validator and 422 guard do not exist.

- [ ] **Step 3: Implement matching PDF validation and report guard**

Export this from pdf-service/src/executive-summary-brief.js:

~~~js
export function validateExecutiveSummaryForPdf(summary, activeProjects = []) {
  // Mirror Task 1 grammar, order, project matching, no-decision sentence,
  // maximum asks, and messages.
}
~~~

Keep parseExecutiveSummaryBrief as the valid-source presentation transformer. In report-data.js, import the validator after Firestore read and authorization but before selectOverviewProjects. Validate only Overview requests containing executive-summary. Use active projects from the full week, not a partial PDF project selection. Use the same summary precedence as report-model: executiveSummary, then summary, then overviewSummary. On validation failure throw ReportDataError with joined messages and status 422.

- [ ] **Step 4: Run focused PDF tests to verify success**

Run:

~~~bash
cd pdf-service && node --test test/executive-summary-brief.test.mjs test/report-data.test.mjs
~~~

Expected: PASS; canonical content renders, invalid persisted summary gets actionable 422 data, and PDFs that omit Executive Summary remain available.

- [ ] **Step 5: Commit**

~~~bash
git add pdf-service/src/executive-summary-brief.js pdf-service/src/report-data.js pdf-service/test/executive-summary-brief.test.mjs pdf-service/test/report-data.test.mjs
git commit -m "fix: reject invalid executive summary PDFs"
~~~

### Task 4: Verify authoring behavior and prepare release handoff

**Files:**
- Verify: index.html, team-2/index.html, js/weekly-summary-contract.mjs
- Verify: pdf-service/src/executive-summary-brief.js and pdf-service/src/report-data.js

**Interfaces:**
- Consumes: completed contract, UI guard, PDF guard, and local emulator.
- Produces: automated and user-visible proof that invalid input is blocked at Save Summary and valid text produces a Decision Brief PDF.

- [ ] **Step 1: Run all automated suites and whitespace checks**

Run:

~~~bash
npm run test:all
(cd pdf-service && npm test)
git diff --check
~~~

Expected: all suites pass and git diff --check has no output.

- [ ] **Step 2: Verify invalid Save Summary locally**

Run npm run local:start. Open http://127.0.0.1:4173/?emulator=1, sign in with the printed test account, paste the missing-next-step fixture, and choose Save Summary.

Expected: the dialog remains open, focus moves to the alert, the missing Next step message appears, no success toast appears, and reopening the week shows the previously saved summary.

- [ ] **Step 3: Verify valid save and Executive Summary PDF**

In the same local session paste validAskSummary, save it, reopen Week Management, then export an Overview PDF with Executive Summary selected.

Expected: source persists in canonical form and the PDF shows Portfolio Summary, project cards, and Management decisions without fallback or empty summary content.

- [ ] **Step 4: Stop local services and inspect task ownership**

Run:

~~~bash
npm run local:stop
git status --short
git log --oneline -5
~~~

Expected: services stop; this work owns only Task 1-3 files; pre-existing dirty files are untouched.

- [ ] **Step 5: Commit verification-only corrections and request release authorization**

If verification exposed a test-only correction, commit only that change. Do not push, deploy GitHub Pages, or deploy Cloud Run without explicit user authorization. Report commit IDs, test results, emulator evidence, and the required release actions.
