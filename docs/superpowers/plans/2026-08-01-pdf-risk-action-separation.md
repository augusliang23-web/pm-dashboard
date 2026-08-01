# PDF Weekly Actions and Risk Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Weekly Key Actions from appearing as Risk Required Actions in Project and Overview PDFs.

**Architecture:** `normalizeProjectForReport` will preserve weekly actions and build risk pairs only from explicit risk-pair records that contain a risk. The Project Portfolio renderer will output a dedicated weekly-actions flow item and emit the risk section only when reportable pairs exist.

**Tech Stack:** Node.js, node:test, HTML PDF renderer.

## Global Constraints

- Update production and UAT with equivalent source and tests.
- Weekly actions must never be used as a risk-action fallback.
- Omit the whole risks section when no risk exists.

---

### Task 1: Prove the separated report model

**Files:**
- Modify: `pdf-service/test/report-model.test.mjs`
- Modify: `pdf-service/src/report-model.js`

**Interfaces:**
- Consumes: `normalizeProjectForReport(source)`.
- Produces: `model.actions` from weekly actions and `model.riskActions` from explicit risk records only.

- [ ] **Step 1: Write the failing test**

```js
const project = normalizeProjectForReport({
  weeklyActions: 'Weekly action',
  risk: '',
  riskActions: []
});
assert.deepEqual(project.actions, ['Weekly action']);
assert.deepEqual(project.riskActions, []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pdf-service/test/report-model.test.mjs`
Expected: the model creates a risk pair from the weekly action.

- [ ] **Step 3: Write minimal implementation**

```js
return structured.filter(item => item.risk);
```

Remove the fallback that zips `risks` with `actions`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pdf-service/test/report-model.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pdf-service/src/report-model.js pdf-service/test/report-model.test.mjs
git commit -m "fix: separate weekly actions from PDF risks"
```

### Task 2: Render independent portfolio blocks

**Files:**
- Modify: `pdf-service/test/overview-report.test.mjs`
- Modify: `pdf-service/src/overview-report.js`

**Interfaces:**
- Consumes: `project.actions` and `project.riskActions`.
- Produces: `project-weekly-actions` only for weekly actions and `project-risk-action` only for explicit risks.

- [ ] **Step 1: Write the failing test**

```js
project.weeklyActions = 'Weekly marker';
project.risk = '';
project.riskActions = [];
const html = renderOverviewReportHtml(fixture);
assert.match(html, /Weekly Key Actions[\\s\\S]*Weekly marker/);
assert.doesNotMatch(html, /Risks &amp; required actions/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pdf-service/test/overview-report.test.mjs`
Expected: Weekly marker appears in the risk section or no independent block exists.

- [ ] **Step 3: Write minimal implementation**

```js
if (project.actions.length) blocks.push(portfolioFlowItem(project, 'project-weekly-actions', weeklyActionsHtml));
if (project.riskActions.length) project.riskActions.forEach(renderRiskAction);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pdf-service/test/overview-report.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pdf-service/src/overview-report.js pdf-service/test/overview-report.test.mjs
git commit -m "fix: render weekly actions independently in PDFs"
```

### Task 3: Verify and release both variants

**Files:**
- Verify: `pdf-service/test/*.test.mjs`

- [ ] **Step 1: Run full suites**

Run: `node --test pdf-service/test/*.test.mjs`
Expected: all tests pass in production and UAT worktrees.

- [ ] **Step 2: Check patch quality**

Run: `git diff --check`
Expected: no output.

- [ ] **Step 3: Integrate and publish**

Fast-forward each approved branch into `main`, push both repositories, and deploy the shared Cloud Run PDF service from the verified production source.
