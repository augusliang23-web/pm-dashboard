# Weekly Summary AI Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let users paste one Copilot/Gemini Weekly Summary once, automatically normalize safe AI formatting differences, explain every automatic correction, and preserve a canonical source for Overview and PDF.

**Architecture:** Extend the existing Weekly Summary contract into a normalization parser that separates repairable formatting corrections from semantic blocking errors. The browser passes current and previous-week project identity context so known removed projects remain valid movement entries; the PDF service validates saved structure without applying a current-only project-name rule. Both dashboard entrypoints use identical behavior.

**Tech Stack:** Browser ES modules, vanilla HTML/JavaScript, Node.js node:test, Firebase Firestore, PDF service Node.js ES modules.

## Global Constraints

- One paste and one Save action must be sufficient for repairable AI output; correction feedback is informational, not a second approval step.
- Never invent a missing movement, blocker, next step, support request, business impact, or project identity.
- Normalize Project:, - Project:, * Project:, and • Project: into canonical - Project: entries.
- Accept current-week active projects and previous-week active projects removed/released this week for WEEKLY MOVEMENT; only current-week active projects are valid MANAGEMENT ASK entries.
- Keep root index.html and team-2/index.html behavior identical.
- Keep PDF export fail-closed for malformed structure, but do not reject a canonical movement solely because its project was removed during the comparison period.
- Preserve raw PM text elsewhere; this change only normalizes Weekly Summary at save time.
- Do not deploy or push as part of implementation.

---

### Task 1: Expand the Weekly Summary contract into a normalizer

**Files:**
- Modify: js/weekly-summary-contract.mjs
- Modify: team-2/js/weekly-summary-contract.mjs
- Modify: tests/weekly-summary-contract-fixtures.mjs
- Modify: tests/weekly-summary-contract.test.mjs
- Create: tests/weekly-summary-normalization.test.mjs

**Interfaces:**
- Consumes: source text plus context { currentProjects, historicalProjects }.
- Produces: normalizeWeeklySummaryForSave(source, context) returning { ok, canonicalText, corrections, errors, brief }.
- Preserves: validateWeeklySummaryForSave(source, activeProjects) as a compatibility wrapper.

- [ ] **Step 1: Write failing tests for repairable markers and correction records**

Add tests that call the normalizer with currentProjects: [{ code: 'PMS-001', name: 'PMS' }] and assert:

~~~js
const result = normalizeWeeklySummaryForSave(sourceWithoutMarker, context);
assert.equal(result.ok, true);
assert.match(result.canonicalText, /- Project: PMS/);
assert.deepEqual(result.corrections, [
  { line: 4, message: 'Changed "Project:" to "- Project:".' }
]);
~~~

Cover Project:, *, •, leading whitespace, CRLF, full-width colons, and a canonical source with no corrections. Add the reported Gemini output with Released project only in historicalProjects and assert it is accepted for movement.

- [ ] **Step 2: Run tests and verify the expected red state**

Run:

~~~bash
node --test tests/weekly-summary-normalization.test.mjs tests/weekly-summary-contract.test.mjs
~~~

Expected: FAIL because normalizeWeeklySummaryForSave is not exported and correction records do not exist.

- [ ] **Step 3: Implement the minimal normalizer**

Add normalizeWeeklySummaryForSave to both browser contract modules. Normalize line endings and required labels, convert accepted project markers to - Project:, resolve official names from current plus historical context, collect correction records, and return canonicalText only when checks pass.

Use exact project-name match first, then lowercase plus collapsed-whitespace match. Reject an unmatched project with the message Project "..." was not found in the current or comparison-week project list. Reject a historical project in a management ask with Management asks must reference a current active project. Keep missing required values as errors and never fill them with placeholders.

- [ ] **Step 4: Run contract and normalization tests green**

~~~bash
node --test tests/weekly-summary-normalization.test.mjs tests/weekly-summary-contract.test.mjs
~~~

Expected: all existing contract tests and new normalization cases PASS.

- [ ] **Step 5: Commit the contract change**

~~~bash
git add js/weekly-summary-contract.mjs team-2/js/weekly-summary-contract.mjs tests/weekly-summary-contract-fixtures.mjs tests/weekly-summary-contract.test.mjs tests/weekly-summary-normalization.test.mjs
git commit -m "feat: normalize AI weekly summary input"
~~~

### Task 2: Add correction feedback and context-aware prompt generation

**Files:**
- Modify: index.html
- Modify: team-2/index.html
- Modify: tests/weekly-summary-prompt.test.mjs
- Modify: tests/weekly-summary-save-ui.test.mjs
- Create: tests/weekly-summary-correction-ui.test.mjs

**Interfaces:**
- Consumes: normalizeWeeklySummaryForSave and current/previous allWeeks records.
- Produces: correction dialog ID weeklySummaryCorrectionOverlay, error panel, and prompt sections CURRENT ACTIVE PROJECTS and REMOVED SINCE LAST WEEK.

- [ ] **Step 1: Write failing UI/static tests**

Assert both entrypoints contain weeklySummaryCorrectionOverlay, Summary corrected, normalizeWeeklySummaryForSave, CURRENT ACTIVE PROJECTS, and REMOVED SINCE LAST WEEK. Assert saveWeekSummary normalizes before setDoc, writes canonicalText, and renders corrections after a successful write. Assert the prompt no longer requires an unconditional four-to-six project count.

- [ ] **Step 2: Run UI tests and verify red**

~~~bash
node --test tests/weekly-summary-prompt.test.mjs tests/weekly-summary-save-ui.test.mjs tests/weekly-summary-correction-ui.test.mjs
~~~

Expected: FAIL because the current UI has no correction dialog and still contains unconditional project-count wording.

- [ ] **Step 3: Implement the correction dialog and save flow**

Add an accessible modal next to weekManageOverlay with heading Summary corrected, a weeklySummaryCorrectionDetails container, and one dismiss button. Change saveWeekSummary to call normalizeWeeklySummaryForSave(field.value, summaryProjectContext(week)), stop only on semantic errors, write canonicalText, update the textarea after a successful write, and call showWeeklySummaryCorrections(result.corrections).

showWeeklySummaryCorrections must use textContent, list every correction line, preserve focus, and leave the normal success toast intact. summaryProjectContext must return current active project objects plus previous-week active projects absent from the current list.

- [ ] **Step 4: Update prompt generation**

In buildCopilotPrompt, emit explicit current and removed project lists. Replace the unconditional four-to-six instruction with one entry per meaningful supplied movement. Add: Removed projects may appear only in WEEKLY MOVEMENT; do not create a MANAGEMENT ASK for them.

- [ ] **Step 5: Run browser-contract and UI tests green**

~~~bash
node --test tests/weekly-summary-contract.test.mjs tests/weekly-summary-normalization.test.mjs tests/weekly-summary-prompt.test.mjs tests/weekly-summary-save-ui.test.mjs tests/weekly-summary-correction-ui.test.mjs
~~~

Expected: all pass for root and team-2 entrypoints.

- [ ] **Step 6: Commit the browser change**

~~~bash
git add index.html team-2/index.html tests/weekly-summary-prompt.test.mjs tests/weekly-summary-save-ui.test.mjs tests/weekly-summary-correction-ui.test.mjs
git commit -m "feat: auto-correct weekly summary saves"
~~~

### Task 3: Align PDF validation with canonical saved movement data

**Files:**
- Modify: pdf-service/src/weekly-summary-contract.js
- Modify: pdf-service/src/executive-summary-brief.js
- Modify: pdf-service/src/report-data.js
- Modify: pdf-service/test/executive-summary-brief.test.mjs
- Modify: pdf-service/test/report-data.test.mjs

**Interfaces:**
- Consumes: canonical week.summary and the PDF request section list.
- Produces: structural PDF validation that accepts canonical movement entries for known removed projects and still returns ReportDataError 422 for malformed structure.

- [ ] **Step 1: Add failing PDF tests**

Add a canonical summary fixture with a Released project movement and assert validateExecutiveSummaryForPdf(summary).ok is true. Add a malformed version missing Next step and assert it remains rejected. Add a report-data test proving executive-summary accepts the canonical removed movement but malformed structure returns 422.

- [ ] **Step 2: Run PDF focused tests and verify red**

~~~bash
cd pdf-service
node --test test/executive-summary-brief.test.mjs test/report-data.test.mjs
~~~

Expected: the new removed-project acceptance test fails because current PDF validation requires every name to be in the current active list.

- [ ] **Step 3: Implement structural PDF validation**

Make validateExecutiveSummaryForPdf use the canonical structural parser with project-name membership disabled for already-saved summaries, while retaining required headings, field order, non-empty values, Markdown rejection, and management-ask count checks. Keep report-data validation only for executive-summary Overview requests and preserve the health-focus-only bypass.

- [ ] **Step 4: Run PDF focused tests green**

~~~bash
cd pdf-service
node --test test/executive-summary-brief.test.mjs test/report-data.test.mjs
~~~

Expected: all existing PDF parser/report-data tests and new removed-movement tests PASS.

- [ ] **Step 5: Commit the PDF change**

~~~bash
git add pdf-service/src/weekly-summary-contract.js pdf-service/src/executive-summary-brief.js pdf-service/src/report-data.js pdf-service/test/executive-summary-brief.test.mjs pdf-service/test/report-data.test.mjs
git commit -m "fix: accept canonical removed-project movements in PDFs"
~~~

### Task 4: Verify end-to-end local behavior

**Files:**
- Modify: none unless a scoped verification failure identifies a defect.

**Interfaces:**
- Consumes: browser save flow, canonical Firestore summary, and PDF report-data guard.
- Produces: evidence that one paste/save normalizes the reported Gemini output and the saved source remains PDF-safe.

- [ ] **Step 1: Run focused root and PDF suites**

~~~bash
node --test tests/weekly-summary-contract.test.mjs tests/weekly-summary-normalization.test.mjs tests/weekly-summary-prompt.test.mjs tests/weekly-summary-save-ui.test.mjs tests/weekly-summary-correction-ui.test.mjs
cd pdf-service
node --test test/executive-summary-brief.test.mjs test/report-data.test.mjs
~~~

- [ ] **Step 2: Run root static checks**

~~~bash
git diff --check
npm run test:all
~~~

Record unrelated pre-existing failures separately; do not modify unrelated modal/project-session code.

- [ ] **Step 3: Run local health and preview checks**

~~~bash
npm run local:start
npm run test:local
~~~

Open http://127.0.0.1:4174/?emulator=1 when standard ports are occupied by the separate UAT workspace. Verify the correction dialog and canonical textarea value with the reported Gemini sample. Stop only the process started for this checkout.

- [ ] **Step 4: Commit only scoped verification corrections**

If a scoped verification defect is found, add a failing regression test first, fix it, rerun the focused suite, and commit with a message describing the defect. Do not deploy or push.
