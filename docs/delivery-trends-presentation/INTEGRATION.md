# Delivery Trends presentation components — integration guide (Phase 1B → next phase)

Scope of this change: presentation only. Nothing here is wired into `index.html`, navigation, the PDF request
whitelist, `report-data.js`, `report-model.js`, `overview-report.js` or `server.js`. No metric is calculated here.

## Files

| File | Role |
|---|---|
| `js/delivery-trends-view.mjs` | Web renderers (pure functions returning HTML strings) + `DELIVERY_TRENDS_CSS` |
| `pdf-service/src/delivery-performance-report.js` | PDF section renderer + `DELIVERY_PERFORMANCE_CSS` + standalone preview document |
| `tests/delivery-trends-synthetic-fixtures.mjs` | Deterministic fixtures, all `provenance.source: "synthetic"` |
| `tests/delivery-trends-view.test.mjs`, `pdf-service/test/delivery-performance-report.test.mjs` | Tests |
| `docs/delivery-trends-presentation/samples/` | Synthetic PDFs and PNG previews |

## Input: the `delivery-trends/v1` contract

Both renderers take the same object. A different `contractVersion` renders an "unsupported" message (never guessed data).
Element shapes below are what the renderers read; **Codex must confirm or adjust them before wiring** (the task brief fixed
only the top-level names).

```
weeklySeries[]: { weekId, label, gainPp: number|null, comparableCount: number|null }
projects[]:     { projectId, code, name, projectManager, currentCompletionPct: number|null,
                  weeklyChangePp: number|null, status: 'green'|'yellow'|'red'|null, comparable: boolean,
                  trend: [{ weekId, label, progressPct: number|null }]   // or plain numbers/null
                }
changes.*[]:    { projectId, code, name }  (strings also accepted)
warnings[]:     string | { message }
```

Rules the renderers enforce: strict numbers only (`null`/`undefined`/strings/NaN → `N/A`), genuine `0` shows `0pp`/`0%`,
`comparableCount === 0` shows "No comparable projects", `null` weeks are chart gaps, `provenance.source === "synthetic"`
shows a visible banner.

## Web (next phase, owner of `index.html`)

1. Import `renderDeliveryTrendsPage` (or the individual `renderDelivery*` functions) and `DELIVERY_TRENDS_CSS`.
2. Add the CSS once (inline `<style>` in `index.html`; it only uses existing CSS variables).
3. Supply: the contract built by the shared adapter from the **already role/scope-filtered** weeks for `allWeeks[currentIdx]`
   (same inputs the PDF uses). Do not re-filter in the view.
4. Mount into a new container; do not touch `normalView` / `execView` toggling, and remember `render`/`render__uat` duplicates.
5. Gate with the UAT flag/profile decision from Phase 0B.

## PDF (next phase)

1. Add `'portfolio-delivery-performance'` (exported as `DELIVERY_PERFORMANCE_SECTION_ID`) to `OVERVIEW_SECTIONS` in `report-request.js`.
2. Build the contract server-side from `report.trendWeeks` (needs the shared metrics module packaged into `pdf-service`; the Docker image only copies `src/`).
3. In `overview-report.js` push `renderPortfolioDeliveryPerformancePages(contract, { period: model.period })` into `pages`.
4. Append `DELIVERY_PERFORMANCE_CSS` to `REPORT_CSS` (`report-theme.js`).
5. Frontend: add the section to `overview-pdf-selection`/print section lists **after** the backend is deployed (old backend answers 400 for unknown sections), and handle the browser-print path.
6. History window: the renderer shows at most the last 6 `weeklySeries` entries; the backend still hard-caps trend history at 6 in three places.

## Known limits / notes

- The section is one flow page (summary, chart, changes) plus a splittable project table. 6 projects fit one A4-landscape page; 14 projects continue onto a second page with repeated header (`· Continued`).
- Sparklines scale to each project's own range (minimum 5 pp span) so 2–3 pp movements are visible; they show trend shape, not absolute level (the completion % and bar carry that).
- Formatting helpers are duplicated in the web and PDF modules because `pdf-service` cannot import `js/`. A test asserts both render identical figures.
- Pixel-level visual regression does not exist in this repo; layout is guarded by page-count assertions and the committed previews.
