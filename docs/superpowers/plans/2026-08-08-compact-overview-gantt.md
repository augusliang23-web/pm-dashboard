# Compact Overview Project Portfolio Gantt Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make consecutive Overview Project Portfolio Gantt rows touch without blank gaps in v2.1 and v2.2T.

**Architecture:** Keep each Gantt row as an independent measured PDF flow item so pagination does not change. Add a Project Portfolio-specific print CSS rule that cancels only the inherited gap between adjacent Gantt row flow items, and square only the inner joined corners.

**Tech Stack:** Node.js ESM, Puppeteer, CSS Grid, Cloud Run PDF renderer.

## Global Constraints

- Apply the same renderer and print styling in v2.1 and v2.2T.
- Scope styling to Overview PDF → Project Portfolio consecutive Gantt rows only.
- Preserve Schedule heading, update note, axis, row content, status badges, and measured pagination.
- Keep the existing spacing before the first Gantt row.
- Do not change Project PDF Gantt output or non-Gantt Overview sections.
- Run only relevant Overview renderer and PDF layout tests, then visually inspect a representative PDF.

---

### Task 1: Add the compact Gantt layout regression test

**Files:**
- Modify: `pdf-service/test/pdf-layout.test.mjs`

**Interfaces:**
- Consumes: `renderOverviewReportHtml(fixture)` and `paginateMeasuredFlows`.
- Produces: an automated assertion that adjacent Project Portfolio Gantt flow items have no rendered vertical gap.

- [ ] **Step 1: Write the failing test**

Add this test after `dense project portfolio keeps project context and footer clearance on continuations`:

```js
test('keeps consecutive Project Portfolio Gantt rows visually joined', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['project-portfolio'];
  fixture.week.projects = [fixture.week.projects[0]];
  fixture.week.projects[0].ganttWorkstreams = Array.from({ length: 3 }, (_, index) => ({
    name: `Compact workstream ${index + 1}`,
    startDate: `2026-08-0${index + 1}`,
    endDate: `2026-08-1${index + 1}`,
    status: 'in-progress', progress: index * 10
  }));
  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.setContent(renderOverviewReportHtml(fixture), { waitUntil: 'networkidle0' });
    await page.evaluate(paginateMeasuredFlows);
    const gaps = await page.$$eval('[data-flow-kind="project-gantt-row"]', rows => rows.slice(1)
      .map((row, index) => row.getBoundingClientRect().top - rows[index].getBoundingClientRect().bottom));
    gaps.forEach(gap => assert.ok(Math.abs(gap) < 0.1, `adjacent Gantt rows must touch; got ${gap}px`));
  } finally {
    await page.close();
    await browser.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/pdf-layout.test.mjs`

Expected: FAIL at `adjacent Gantt rows must touch`, reporting the current 2.5mm row gap.

- [ ] **Step 3: Commit the regression test**

```bash
git add pdf-service/test/pdf-layout.test.mjs
git commit -m "test: cover compact overview Gantt rows"
```

### Task 2: Compact only adjacent Overview Gantt rows

**Files:**
- Modify: `pdf-service/src/report-theme.js:289-316`

**Interfaces:**
- Consumes: `data-flow-kind="project-gantt-row"` emitted by `renderProjectPortfolioFlow`.
- Produces: compact adjacent Gantt row layout without changing the measured flow item structure.

- [ ] **Step 1: Add the scoped CSS implementation**

Insert these rules next to `.project-portfolio-flow [data-pdf-flow-items]`:

```css
  .project-portfolio-flow [data-flow-kind="project-gantt-row"] + [data-flow-kind="project-gantt-row"] { margin-top:-2.5mm; }
  .project-portfolio-flow [data-flow-kind="project-gantt-row"] + [data-flow-kind="project-gantt-row"] .gantt-row { border-top-left-radius:0; border-top-right-radius:0; }
  .project-portfolio-flow [data-flow-kind="project-gantt-row"]:has(+ [data-flow-kind="project-gantt-row"]) .gantt-row { border-bottom-left-radius:0; border-bottom-right-radius:0; }
```

- [ ] **Step 2: Run the focused layout test to verify it passes**

Run: `node --test test/pdf-layout.test.mjs`

Expected: PASS, including the new compact-row test and existing Project Portfolio continuation test.

- [ ] **Step 3: Commit the CSS change**

```bash
git add pdf-service/src/report-theme.js
git commit -m "fix: compact overview Gantt row spacing"
```

### Task 3: Mirror, verify, and deploy both versions

**Files:**
- Modify: `pdf-service/src/report-theme.js`
- Modify: `pdf-service/test/pdf-layout.test.mjs`

**Interfaces:**
- Consumes: the v2.1 tested CSS and test case.
- Produces: identical Gantt row behavior in v2.2T and one shared Cloud Run revision.

- [ ] **Step 1: Apply Tasks 1 and 2 unchanged to v2.2T**

Use the same test and CSS rules in `pm-dashboard-uat`; do not alter UAT-only application files.

- [ ] **Step 2: Run only the affected tests in each repository**

Run in each `pdf-service` directory:

```bash
node --test test/overview-report.test.mjs test/pdf-layout.test.mjs
```

Expected: zero failures in both repositories.

- [ ] **Step 3: Render and inspect the representative Overview PDF**

```bash
npm run render:samples
pdftoppm -f 9 -l 10 -png -r 144 ../tmp/pdf-samples/overview.pdf /private/tmp/compact-overview-gantt
```

Expected: consecutive Gantt rows touch, while the Schedule heading and first row remain separated and continuation pages retain their heading and footer.

- [ ] **Step 4: Commit, integrate, and deploy**

```bash
git add pdf-service/src/report-theme.js pdf-service/test/pdf-layout.test.mjs
git commit -m "fix: compact overview Gantt row spacing"
git checkout main
git merge --ff-only fix/compact-overview-gantt
git push origin main
gcloud run deploy pm-dashboard-pdf --source pdf-service --project project-manager-dashboar-a067f --region asia-southeast1 --allow-unauthenticated --ingress all --min-instances 0 --max-instances 1 --concurrency 1 --cpu 1 --memory 1Gi --timeout 120 --service-account pm-dashboard-pdf@project-manager-dashboar-a067f.iam.gserviceaccount.com --set-env-vars ALLOWED_ORIGIN=https://augusliang23-web.github.io --quiet
```

Expected: both GitHub Pages workflows complete successfully, and the new Cloud Run revision receives 100% of traffic.
