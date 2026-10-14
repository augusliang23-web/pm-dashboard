# Phase 2B — product integration status (UAT-only, not deployed)

Base: `integration/v23-foundation` @ `83a56b1f8f93fafcf23eda4b8395cca991556777`.

## Implemented
- **Navigation:** UAT-only header button `#btnDeliveryTrends` + container `#deliveryTrendsView`; independent of Overview. Hidden for VIP/Executive (`executive-hidden`), deactivated on Overview, Executive perspective and user change. `render__uat` calls `syncDeliveryTrendsView()`; `render__prod`, `toggleOverview`, `setupUI` untouched.
- **Data path:** `js/delivery-trends-page.mjs` builds engine input from already-loaded weeks using the Overview's role/visibility/scope rules (`filterRoleVisibleProjects`, `normalizeOverviewScope`) and calls `calculateDeliveryTrends` via the adapter. No metric is calculated in UI/PDF code.
- **Windows:** 6/12-week toggle (web); print and PDF default to 6.
- **Scope listing:** current project list uses `projects[].isInAnchorScope === true` only; fails closed when the flag is absent; historical-only projects appear under Portfolio Changes.
- **PDF:** `portfolio-delivery-performance` registered in `report-request.js` only when the target sets `features.deliveryPerformanceSection === true`; rendered in `overview-report.js` after the opening page from `deliveryTrends` (explicit unavailable page without a contract); CSS in `report-theme.js`.
- **Frontend gating:** checkbox hidden/unchecked; `buildOverviewPdfRequest` drops the section unless `isDeliveryPerformancePdfAvailable` (UAT profile AND `DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED === true`, currently `false`).
- **Browser print:** deferred. No user-accessible UI calls `renderOverviewPrintReport`, so the shared Production function is left untouched (no Production invariant exception). `renderDeliveryTrendsPrintHtml` is ready for when an entry point exists.
- Frozen UAT hash in `tests/role-contract.test.mjs` updated deliberately; `tests/delivery-trends-integration.test.mjs` proves the change is exactly the Delivery Trends UAT-only additions (stripping them reproduces the previous hash `e83cb180…`).

## Gate 2 UX refinements
W37 2026 week labels (web + PDF), plain-language grouped warnings (codes kept in `data-warning-code`), 2x2 mobile KPI grid, neutral progress fill with RAG on labelled badges, labelled `Trends` nav entry, PDF health card with shape+text, footnotes as their own flow item, larger PDF chart text. Executive/VIP access unchanged. Zero-based chart unchanged.

## Codex Phase 2A dependencies
1. `projects[].isInAnchorScope` (boolean) — until then the current project list shows an explicit unavailable message.
2. Authoritative `reportingPeriod` on real weeks (Firestore weeks have none) — until then the engine returns `unavailable` and the page says so.
3. `model.deliveryTrends` (canonical, 6-week) from `report-model.js`/`report-data.js` with N+1 history and authorization — until then the PDF section renders the unavailable page.
4. Registry/target feature `deliveryPerformanceSection` and deployment ordering (backend first, then flip the frontend constant).

## Blocked tests
End-to-end with real history (items 1–3); full-app browser navigation needs the Firebase emulator stack (not run here).
