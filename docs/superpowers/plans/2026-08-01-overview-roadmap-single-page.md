# Overview Roadmap Single-Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Executive Milestones and Quarterly Roadmap compactly together on their own A4 landscape Overview PDF pages, with explicit continuation pages only when measured overflow requires them.

**Architecture:** The Overview renderer will emit each roadmap as a dedicated measured flow whose direct children are complete category or quarter-column units. The PDF theme will compact those units; the paginator will move whole units to a repeated roadmap continuation page rather than splitting them.

**Tech Stack:** Node.js ES modules, HTML/CSS PDF templates, Puppeteer measured pagination, Node.js built-in test runner.

## Global Constraints

- Apply identical production code, tests, and layout behavior to `pm-dashboard` and `pm-dashboard-uat`.
- Preserve milestone data, order, RAG/progress, and current section selection behavior.
- Use the compact A4 landscape page first; do not force unreadably small text to avoid an overflow page.
- Never split one Executive category or one Quarterly Roadmap quarter column across pages.

---

### Task 1: Define failing renderer contracts for compact roadmap flows

**Files:**
- Modify: `pdf-service/test/overview-report.test.mjs`
- Modify: `pdf-service/src/overview-report.js`

**Interfaces:**
- Produces: `renderExecutiveMilestones(model)` and `renderQuarterlyRoadmap(model)` markup with `data-pdf-flow-items`, one direct flow item per category or quarter, and roadmap page metadata.
- Consumed by: the measured paginator and PDF theme.

- [ ] **Step 1: Add failing Executive and Quarterly markup assertions**

Add tests requiring the rendered Overview report to contain:

```js
assert.match(html, /data-measured-flow="executive-roadmap"/);
assert.match(html, /data-flow-kind="executive-roadmap-category"/);
assert.match(html, /data-page-title="Executive Milestones"/);
assert.match(html, /data-measured-flow="quarterly-roadmap"/);
assert.match(html, /data-flow-kind="quarterly-roadmap-quarter"/);
assert.match(html, /data-page-title="Quarterly Roadmap"/);
```

- [ ] **Step 2: Run the renderer test and verify it fails**

Run:

```bash
node --test pdf-service/test/overview-report.test.mjs
```

Expected: FAIL because the current Executive categories and Quarterly Roadmap do not expose separate compact measured-flow contracts.

- [ ] **Step 3: Emit complete roadmap units from the renderer**

In `pdf-service/src/overview-report.js`, render Executive Milestones as a page shell containing `<div data-pdf-flow-items>`, with each category as one direct `data-pdf-flow-item` carrying `data-flow-kind="executive-roadmap-category"`, page title, kicker, and section attributes. Render Quarterly Roadmap through an equivalent `data-pdf-flow-items` shell with one complete Q1–Q4 column per `data-flow-kind="quarterly-roadmap-quarter"` item.

- [ ] **Step 4: Run the renderer test and verify it passes**

Run:

```bash
node --test pdf-service/test/overview-report.test.mjs
```

Expected: PASS.

### Task 2: Apply the compact one-page roadmap theme

**Files:**
- Modify: `pdf-service/src/report-theme.js`
- Modify: `pdf-service/test/pdf-layout.test.mjs`

**Interfaces:**
- Consumes: roadmap flow and unit classes from Task 1.
- Produces: compact four-quarter Executive and Quarterly grid styles that retain all required content.

- [ ] **Step 1: Add a failing layout contract test**

Require `report-theme.js` to include compact page selectors and readable floors:

```js
assert.match(theme, /\[data-report-section="executive-milestones"\][\s\S]*\.executive-milestone-category/);
assert.match(theme, /\[data-report-section="quarterly-roadmap"\][\s\S]*\.quarter-column/);
assert.match(theme, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(theme, /font-size:8pt/);
```

- [ ] **Step 2: Run the layout test and verify it fails**

Run:

```bash
node --test pdf-service/test/pdf-layout.test.mjs
```

Expected: FAIL because the roadmap-specific compact selectors are absent.

- [ ] **Step 3: Add scoped compact CSS**

In `pdf-service/src/report-theme.js`, scope Executive and Quarterly styles to their report sections. Reduce only roadmap heading margins, card padding, list gaps, and metadata spacing; retain 8pt or larger body text and retain the four-quarter grid. Add continuation-page rules that keep the roadmap title/context visible.

- [ ] **Step 4: Run the layout test and verify it passes**

Run:

```bash
node --test pdf-service/test/pdf-layout.test.mjs
```

Expected: PASS.

### Task 3: Preserve whole units through measured overflow

**Files:**
- Modify: `pdf-service/src/measured-paginator.js`
- Modify: `pdf-service/test/measured-paginator.test.mjs`

**Interfaces:**
- Consumes: roadmap direct flow items from Task 1.
- Produces: a new continuation page before an oversized subsequent roadmap unit, with title and context repeated by existing `configurePage` behavior.

- [ ] **Step 1: Add a failing paginator test**

Create a flow with two roadmap units whose combined height overflows the first page. Assert that the first unit remains whole on page one, the second unit is whole on page two, and page two has the `Continuation` title treatment.

- [ ] **Step 2: Run the paginator test and verify it fails**

Run:

```bash
node --test pdf-service/test/measured-paginator.test.mjs
```

Expected: FAIL because the roadmap flow is not yet rendered as whole direct units.

- [ ] **Step 3: Configure compact roadmap flows for continuation**

Use the existing measured-flow queue without adding `data-pdf-splittable` to Executive category or Quarterly column items. Ensure their page title, kicker, and section metadata are present so the existing paginator clones a new page and applies continuation context whenever the next whole unit does not fit.

- [ ] **Step 4: Run the paginator test and verify it passes**

Run:

```bash
node --test pdf-service/test/measured-paginator.test.mjs
```

Expected: PASS.

### Task 4: Synchronize, verify, and deploy both versions

**Files:**
- Modify in each repo: `pdf-service/src/overview-report.js`, `pdf-service/src/report-theme.js`, `pdf-service/src/measured-paginator.js`, and their tests.

**Interfaces:**
- Consumes: passing renderer, layout, and paginator tests.
- Produces: matching PDF service source in production and UAT, deployed to their configured PDF service targets.

- [ ] **Step 1: Run the full PDF service suite in each repository**

Run in each repository:

```bash
node --test pdf-service/test/*.test.mjs
```

Expected: PASS with no test failures.

- [ ] **Step 2: Compare implementation files across the repositories**

Run:

```bash
diff -u pm-dashboard/pdf-service/src/overview-report.js pm-dashboard-uat/pdf-service/src/overview-report.js
diff -u pm-dashboard/pdf-service/src/report-theme.js pm-dashboard-uat/pdf-service/src/report-theme.js
diff -u pm-dashboard/pdf-service/src/measured-paginator.js pm-dashboard-uat/pdf-service/src/measured-paginator.js
```

Expected: no output for the synchronized layout implementation.

- [ ] **Step 3: Commit and push each repository**

Run separately from each repository root:

```bash
git add pdf-service/src pdf-service/test
git commit -m "feat: compact overview roadmap PDF pages"
git push origin main
```

Expected: both `main` branches receive a matching feature commit.

- [ ] **Step 4: Deploy each configured PDF service and validate exports**

Deploy the production and UAT `pdf-service` according to each repository's documented deployment command. Export an Overview PDF from both live URLs and verify: Executive Milestones is compact on one page when it fits, Quarterly Roadmap is compact on one page when it fits, and an overflow creates a titled continuation page without splitting a category or quarter column.
