# Overview PDF Project Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-step Overview PDF export that recalculates every project-scoped section from selected projects.

**Architecture:** `team-2/index.html` collects section and project choices without persisting them. The shared Cloud Run service validates selected codes, filters trusted current and trend-week data before report modelling, and excludes unscoped Executive milestones for a partial selection.

**Tech Stack:** Static HTML, JavaScript ES modules, Node.js `node:test`, Cloud Run.

## Global Constraints

- Apply the same feature to v2.1 `pm-dashboard` and v2.2T `pm-dashboard-uat`.
- List only visible Overview projects, checked by default.
- Send only project codes; server-side Firestore data remains authoritative.
- Reject no selection and do not store a previous choice.
- Omit Executive milestones for a partial project selection.

---

### Task 1: Define and test the project-selection request contract

**Files:**
- Modify: `pdf-service/src/report-request.js`
- Test: `pdf-service/test/report-request.test.mjs`

**Interfaces:** `parseReportRequest({ mode: 'overview', weekId, sections, projectCodes })` returns an overview request with `projectCodes: string[]`.

- [ ] **Step 1: Write failing tests**

```js
test('accepts unique selected project codes', () => {
  assert.deepEqual(parseReportRequest({ mode: 'overview', weekId: 'W28', sections: ['health-focus'], projectCodes: ['PMS-001', 'MOD-002'] }).projectCodes, ['PMS-001', 'MOD-002']);
});
test('rejects empty or duplicate selected project codes', () => {
  for (const projectCodes of [[], ['PMS-001', 'PMS-001'], [' '], [42]]) {
    assert.throws(() => parseReportRequest({ mode: 'overview', weekId: 'W28', sections: ['health-focus'], projectCodes }), ReportRequestError);
  }
});
```

- [ ] **Step 2: Run `npm test --prefix pdf-service -- report-request.test.mjs`; confirm the tests fail because `projectCodes` is currently unexpected.**
- [ ] **Step 3: Add `projectCodes` to the overview allow-list, require a non-empty unique array of non-blank strings, and return it on the request object.**
- [ ] **Step 4: Re-run `npm test --prefix pdf-service -- report-request.test.mjs`; confirm it passes.**
- [ ] **Step 5: Commit `pdf-service/src/report-request.js` and its test using `feat: accept Overview PDF project selections`.**

### Task 2: Enforce project scope in the PDF service

**Files:**
- Modify: `pdf-service/src/report-data.js`
- Modify: `pdf-service/src/report-model.js`
- Modify: `pdf-service/src/overview-report.js`
- Test: `pdf-service/test/report-data.test.mjs`
- Test: `pdf-service/test/overview-report.test.mjs`

**Interfaces:** `loadAuthorizedReport` returns a selected current week, selected trend weeks, and original visible-project count. `buildOverviewReportModel` receives selection metadata.

- [ ] **Step 1: Write failing tests**

```js
test('filters current and trend weeks to selected project codes', async () => {
  const report = await loadAuthorizedReport({ request: { mode: 'overview', weekId: 'W28', sections: ['weekly-trend'], projectCodes: ['PMS-001'] }, idToken: 'pm@example.com', adapters });
  assert.deepEqual(report.week.projects.map(project => project.code), ['PMS-001']);
  assert.ok(report.trendWeeks.every(week => week.projects.every(project => project.code === 'PMS-001')));
});
test('omits Executive milestones for a partial project selection', () => {
  const fixture = completeOverviewReportFixture();
  fixture.projectCodes = [fixture.week.projects[0].code];
  assert.doesNotMatch(renderOverviewReportHtml(fixture), /data-section-unit="executive-milestones"/);
});
```

- [ ] **Step 2: Run `npm test --prefix pdf-service -- report-data.test.mjs overview-report.test.mjs`; confirm failure.**
- [ ] **Step 3: Filter cloned trusted week objects with a `Set(request.projectCodes)` before all model calculations; filter trend weeks identically; omit Executive-milestone markup when selected count is smaller than original visible count.**
- [ ] **Step 4: Re-run the focused service tests; confirm pass.**
- [ ] **Step 5: Commit the listed source and test files with `feat: scope Overview PDF data to selected projects`.**

### Task 3: Add the browser's two-step selection UI

**Files:**
- Modify: `team-2/index.html`
- Test: `tests/overview-print-selection.test.mjs`

**Interfaces:** `openOverviewProjectPrintDialog()` renders checked project options. `confirmOverviewProjectPrint()` passes `projectCodes` to `downloadProfessionalReport`.

- [ ] **Step 1: Write failing UI-source tests for `overviewProjectPrintOverlay`, `Next: choose projects`, Select all, Clear, no-selection validation, and `projectCodes` without `localStorage` or Firestore writes.**
- [ ] **Step 2: Run `node --test tests/overview-print-selection.test.mjs`; confirm failure.**
- [ ] **Step 3: Add an accessible project-picker modal; populate it from the current role-filtered Overview project list; wire first-dialog validation to advance; implement Back, Select all, Clear, and final export.**
- [ ] **Step 4: Re-run `node --test tests/overview-print-selection.test.mjs`; confirm pass.**
- [ ] **Step 5: Commit `team-2/index.html` and its test with `feat: choose projects for Overview PDF export`.**

### Task 4: Mirror, verify, and deploy both releases

**Files:**
- Modify: equivalent Task 1–3 files in `pm-dashboard-uat`
- Verify: all dashboard and `pdf-service` tests in both repositories

- [ ] **Step 1: Repeat Tasks 1–3 using TDD in the UAT worktree.**
- [ ] **Step 2: Run `npm test --prefix pdf-service && node --test tests/*.test.mjs` in both worktrees; stop on any failure.**
- [ ] **Step 3: Compare shared feature files with `git diff --no-index` and resolve unintended differences.**
- [ ] **Step 4: Prepare and smoke-test a temporary Cloud Run source identical to the final service except that an omitted `projectCodes` field remains accepted for cached legacy clients.**
- [ ] **Step 5: Deploy the temporary compatible Cloud Run revision before changing either Pages site.**
- [ ] **Step 6: Push both verified Pages repositories and confirm each live URL exposes the two-step flow and submits `projectCodes`.**
- [ ] **Step 7: Keep the compatible revision active through the Pages cache and active-session transition, then deploy the strict UAT Cloud Run source that requires `projectCodes`.**
- [ ] **Step 8: Re-test both release URLs against the strict revision and record the deployed commits and Cloud Run revision.**
