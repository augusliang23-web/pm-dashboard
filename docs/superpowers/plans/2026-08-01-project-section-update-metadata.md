# Project Section Update Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record and quietly show the last editor and save time for each tracked project section in both dashboard and PDF views.

**Architecture:** `applyProjectSave` compares the persisted project with the save draft, then updates only changed keys in `sectionUpdatedAt`. Browser renderers and the PDF report model use one formatter for the compact `Updated · date · name` label, allowing legacy projects with no metadata to show a muted fallback.

**Tech Stack:** Vanilla JavaScript, Firestore transactions, Node.js `node:test`, Puppeteer PDF tests.

## Global Constraints

- Track status, highlights, weekly actions, risks, milestones, schedule, team allocation, budget plan, actual spend, and discipline hours.
- Do not track Project details.
- Any authorised editor updates changed sections; preserve unchanged section entries.
- Display compact grey text in section-header corners; no cards, badges, icons, or large text.
- Update production and UAT with equivalent source and tests.

---

### Task 1: Persist changed section metadata

**Files:**
- Modify: `js/project-mutations.mjs`
- Modify: `tests/project-mutations.test.mjs`
- Modify: `index.html:9009-9090`

**Interfaces:**
- Consumes: `applyProjectSave(week, { draft, editorName, savedAt, ... })`.
- Produces: `project.sectionUpdatedAt[sectionId] = { savedAt, editorName }` for changed tracked fields.

- [ ] **Step 1: Write failing model tests**

```js
const result = applyProjectSave(week, {
  draft: { ...project, highlight: 'Updated highlight' },
  editorName: 'AUGUS.LIANG', savedAt: '2026-08-01T06:00:00.000Z', ...options
});
assert.deepEqual(result.project.sectionUpdatedAt.highlights, {
  savedAt: '2026-08-01T06:00:00.000Z', editorName: 'AUGUS.LIANG'
});
assert.equal(result.project.sectionUpdatedAt.schedule.savedAt, previousScheduleTime);
```

- [ ] **Step 2: Verify red**

Run: `node --test tests/project-mutations.test.mjs`
Expected: metadata is absent or unchanged after a modified highlight.

- [ ] **Step 3: Implement minimal comparison and save metadata**

```js
const SECTION_FIELDS = {
  status: ['status', 'progress', 'attention'], highlights: ['highlight'],
  'weekly-actions': ['weeklyActions'], 'risk-actions': ['riskActions', 'risk', 'next'],
  milestones: ['milestones', 'quarterlyMilestones'], schedule: ['ganttWorkstreams'],
  'team-allocation': ['teamMembers', 'dataStatus.team'],
  'budget-plan': ['budget.mode', 'budget.currency', 'budget.totalEstimated', 'budget.monthlyPlans'],
  'actual-spend': ['budget.actuals', 'dataStatus.budgetActual'],
  'discipline-hours': ['resources']
};
function sectionUpdateMetadata(previous, draft, prior, editorName, savedAt) { /* return prior entries except changed SECTION_FIELDS */ }
```

Pass `getUserDisplayName(session.authEmail)` and `new Date().toISOString()` to `applyProjectSave` from `saveProjEdit`.

- [ ] **Step 4: Verify green**

Run: `node --test tests/project-mutations.test.mjs`
Expected: PASS, including unchanged and legacy metadata cases.

- [ ] **Step 5: Commit**

```bash
git add js/project-mutations.mjs tests/project-mutations.test.mjs index.html
git commit -m "feat: record project section update metadata"
```

### Task 2: Display metadata in dashboard project views

**Files:**
- Modify: `index.html:2137-2160,6290-6460,6647-6724`
- Modify: `tests/v2-baseline.test.mjs`

**Interfaces:**
- Consumes: `project.sectionUpdatedAt` entries.
- Produces: `formatSectionUpdateMeta(project, sectionId)` and section-header markup with a muted `section-update-meta` element.

- [ ] **Step 1: Write failing UI-source tests**

```js
assert.ok(dashboard.includes('function formatSectionUpdateMeta'));
assert.ok(dashboard.includes('section-update-meta'));
assert.ok(dashboard.includes("formatSectionUpdateMeta(p, 'weekly-actions')"));
```

- [ ] **Step 2: Verify red**

Run: `node --test tests/v2-baseline.test.mjs`
Expected: the shared formatter and compact markup do not exist.

- [ ] **Step 3: Implement compact section-header metadata**

Add a formatter returning `Updated · 1 Aug 2026 · NAME` or `No update recorded`; render it in project detail and Overview Project Portfolio headers for every tracked section. Add muted small-text CSS with header-corner alignment.

- [ ] **Step 4: Verify green**

Run: `node --test tests/v2-baseline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/v2-baseline.test.mjs
git commit -m "feat: show project section update metadata"
```

### Task 3: Include metadata in professional PDFs

**Files:**
- Modify: `pdf-service/src/report-model.js`
- Modify: `pdf-service/src/project-report.js`
- Modify: `pdf-service/src/overview-report.js`
- Modify: `pdf-service/src/report-theme.js`
- Modify: `pdf-service/test/report-model.test.mjs`
- Modify: `pdf-service/test/project-report.test.mjs`
- Modify: `pdf-service/test/overview-report.test.mjs`

**Interfaces:**
- Consumes: normalized `sectionUpdatedAt` metadata.
- Produces: compact `.section-update-meta` text in the matching Project PDF and Overview portfolio sections.

- [ ] **Step 1: Write failing PDF tests**

```js
fixture.project.sectionUpdatedAt = {
  'weekly-actions': { savedAt: '2026-08-01T06:00:00.000Z', editorName: 'AUGUS.LIANG' }
};
assert.match(html, /Updated · 1 Aug 2026 · AUGUS\.LIANG/);
assert.match(html, /section-update-meta/);
```

- [ ] **Step 2: Verify red**

Run: `node --test pdf-service/test/report-model.test.mjs pdf-service/test/project-report.test.mjs pdf-service/test/overview-report.test.mjs`
Expected: metadata text is absent.

- [ ] **Step 3: Implement shared PDF formatter and header placement**

Normalize metadata in `report-model.js`; add a safe formatter in PDF components or report modules; render it beside every matching heading in both report types; define small muted PDF CSS.

- [ ] **Step 4: Verify green**

Run: `node --test pdf-service/test/report-model.test.mjs pdf-service/test/project-report.test.mjs pdf-service/test/overview-report.test.mjs`
Expected: PASS, including no-metadata fallback.

- [ ] **Step 5: Commit**

```bash
git add pdf-service/src pdf-service/test
git commit -m "feat: show section update metadata in PDFs"
```

### Task 4: Verify and release both variants

**Files:**
- Verify: `tests/*.test.mjs`, `pdf-service/test/*.test.mjs`

- [ ] **Step 1: Run production suite serially**

Run: `node --test --test-concurrency=1 tests/*.test.mjs pdf-service/test/*.test.mjs`
Expected: all production tests pass without leaving Chrome-for-Testing processes.

- [ ] **Step 2: Run UAT suite serially**

Run: `node --test --test-concurrency=1 tests/*.test.mjs pdf-service/test/*.test.mjs`
Expected: all UAT tests pass without leaving Chrome-for-Testing processes.

- [ ] **Step 3: Integrate and publish**

Fast-forward each feature branch into `main`, push both repositories, then deploy the shared Cloud Run PDF service from verified production source.
