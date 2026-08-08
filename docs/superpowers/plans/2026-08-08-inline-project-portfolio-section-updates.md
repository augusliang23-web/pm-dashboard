# Inline Project Portfolio Section Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the oversized Project Portfolio Section Updates card and show each update record beside the matching Overview PDF content.

**Architecture:** Keep `formatSectionUpdate` as the sole formatter. `renderProjectPortfolioFlow` will render compact update notes with the section title or snapshot card they describe; it will no longer produce a separate flow item solely for update metadata. Shared CSS provides a wrapping heading row that remains safe for measured-page pagination.

**Tech Stack:** Node.js, node:test, HTML report rendering, Puppeteer PDF layout tests.

## Global Constraints

- Change Overview PDF Project Portfolio only; Project PDF output is unchanged.
- Keep `No update recorded` visible in the mapped section when no metadata exists.
- Keep Budget Plan and Actual Spend separate; pair Team Allocation and Discipline Hours with Resource Load.
- Apply identical behavior to v2.1 and v2.2T.
- Run only affected renderer and PDF layout tests, plus the targeted source test added here.

---

### Task 1: Prove the inline metadata contract

**Files:**
- Modify: `pdf-service/test/overview-report.test.mjs`

**Interfaces:**
- Consumes: `renderOverviewReportHtml(report)`
- Produces: a regression test requiring no `Section updates` card and requiring metadata inside its matching Project Portfolio section.

- [ ] **Step 1: Write the failing test**

```js
test('places Project Portfolio update metadata with its matching sections instead of an aggregate card', () => {
  const fixture = completeOverviewReportFixture();
  fixture.week.projects[0].sectionUpdatedAt = {
    status: { savedAt: '2026-08-01T08:00:00.000Z', editorName: 'AUGUS.LIANG' },
    highlights: { savedAt: '2026-08-02T08:00:00.000Z', editorName: 'BONNIE' },
    weeklyActions: { savedAt: '2026-08-03T08:00:00.000Z', editorName: 'AUGUS.LIANG' }
  };
  const html = renderOverviewReportHtml(fixture);
  assert.doesNotMatch(html, /Section updates/);
  assert.match(html, /Weekly Key Actions[\\s\\S]*Updated · 3 Aug 2026 · AUGUS\\.LIANG/);
  assert.match(html, /Highlights[\\s\\S]*Updated · 2 Aug 2026 · BONNIE/);
  assert.match(html, /No update recorded/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/overview-report.test.mjs` from `pdf-service`.

Expected: FAIL because the current HTML still contains `Section updates`.

- [ ] **Step 3: Commit the red test**

```bash
git add pdf-service/test/overview-report.test.mjs
git commit -m "test: cover inline portfolio section updates"
```

### Task 2: Render update notes in the matching Project Portfolio sections

**Files:**
- Modify: `pdf-service/src/overview-report.js`
- Modify: `pdf-service/src/report-theme.js`
- Test: `pdf-service/test/overview-report.test.mjs`

**Interfaces:**
- Consumes: `formatSectionUpdate(project, section): string`
- Produces: `renderProjectPortfolioFlow(project): string` without the `project-section-updates` flow item.

- [ ] **Step 1: Add a small section-heading helper**

```js
const updateNote = (section, label = '') =>
  `<div class="section-update-note">${label ? `${escapeHtml(label)} · ` : ''}${escapeHtml(formatSectionUpdate(project, section))}</div>`;
const sectionHeading = (title, section) =>
  `<div class="portfolio-section-heading"><h2 class="portfolio-section-title">${escapeHtml(title)}</h2>${updateNote(section)}</div>`;
```

- [ ] **Step 2: Replace the aggregate card with mapped inline notes**

```js
// Project header: status
// Highlights card: highlights
// Weekly Key Actions heading: weeklyActions
// Risks & required actions heading: riskActions
// Next milestone snapshot: milestones
// Resource load snapshot: teamAllocation and disciplineHours
// Budget snapshot: budgetPlan and actualSpend
// Gantt schedule heading: schedule
```

Delete the `sectionUpdates` variable and do not call `portfolioFlowItem(project, 'project-section-updates', ...)`.

- [ ] **Step 3: Add compact wrapping CSS**

```css
.portfolio-section-heading { display:flex; align-items:baseline; justify-content:space-between; gap:4mm; }
.portfolio-section-heading .section-update-note { margin:0; flex:0 1 auto; }
.portfolio-snapshot-grid .section-update-note { margin-top:1mm; text-align:left; }
```

- [ ] **Step 4: Run the focused regression test and verify it passes**

Run: `node --test test/overview-report.test.mjs` from `pdf-service`.

Expected: PASS; no aggregate card remains and mapped notes render in the relevant HTML.

- [ ] **Step 5: Commit the renderer change**

```bash
git add pdf-service/src/overview-report.js pdf-service/src/report-theme.js pdf-service/test/overview-report.test.mjs
git commit -m "fix: inline portfolio section updates"
```

### Task 3: Verify PDF pagination and synchronize both repositories

**Files:**
- Modify: the Task 1 and Task 2 files in both v2.1 and v2.2T repositories.
- Test: `pdf-service/test/overview-report.test.mjs`
- Test: `pdf-service/test/pdf-layout.test.mjs`

**Interfaces:**
- Consumes: the inline Project Portfolio HTML from Task 2.
- Produces: matching v2.1 and v2.2T PDF rendering behavior.

- [ ] **Step 1: Apply the tested renderer changes to the second repository**

Keep the two source changes behavior-equivalent while preserving any pre-existing repository-specific formatting.

- [ ] **Step 2: Run only affected test files in each repository**

Run from each `pdf-service` directory:

```bash
node --test test/overview-report.test.mjs test/pdf-layout.test.mjs
```

Expected: PASS with no failed tests.

- [ ] **Step 3: Commit the synchronized UAT change**

```bash
git add pdf-service/src/overview-report.js pdf-service/src/report-theme.js pdf-service/test/overview-report.test.mjs
git commit -m "fix: inline portfolio section updates"
```

- [ ] **Step 4: Perform final narrow checks before deployment**

Run in each repository:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors and no uncommitted files.

- [ ] **Step 5: Deploy the PDF service and both Pages repositories**

Deploy the shared PDF service once from the final v2.2T `pdf-service` source, then push both `main` branches and verify their GitHub Pages builds complete successfully.
