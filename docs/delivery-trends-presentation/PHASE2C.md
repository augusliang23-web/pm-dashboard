# Phase 2C — browser reliability and UAT automation (UAT-only, not deployed)

Base: PR #53 `e06da6e`. Stacked branch: `claude/v23-browser-e2e-hardening`. No Production behavior changed; no Codex-owned file touched.

## Findings
1. **Week ordering (confirmed, deterministic reproduction).** `sortWeeksByLabel` (numeric `localeCompare`) orders `W2 2026, W52 2025, W7 2025, W1 2026, W17 2025, W53 2026, W10 2026, W9 2026` as `W1 2026 | W2 2026 | W7 2025 | W9 2026 | W10 2026 | W17 2025 | W52 2025 | W53 2026`. Inside one year it is correct; across ISO years the "latest" week (`allWeeks.length - 1`), previous/next navigation, and "create next week from the last week" use the wrong week. `getIsoWeekData` is correct (verified at ISO-year boundaries in three time zones).
   Fix: `js/week-order.mjs` + one call in `initData__uat` (UAT only). Invalid/ambiguous labels (prototype labels, W0, W54, W53 in a 52-week year) are never dated and sort after valid weeks. Production keeps the legacy sort byte-for-byte.
2. **Real-browser findings (all fixed, UAT-only).**
   - `isDeliveryPerformancePdfAvailable` was referenced but not imported (opening the Overview PDF dialog threw in UAT). Source-level tests had not caught it.
   - Executive/VIP did see the Delivery Trends button: in the UAT profile `isVipPerspective()` is only an Admin preview, and `.executive-hidden` is not applied to a signed-in Executive. The entry is now hidden by role (`isDeliveryTrendsExecutive`).
   - Signing out left the Delivery Trends content in the DOM behind the login overlay; it is now cleared.
3. **Prototype data.** `buildPrototypeWeeks()` weeks have no saved document id. Delivery Trends now reports "prototype data, not verified" and never builds a contract from them.
4. **Pre-existing, not changed:** the app header is wider than a phone viewport on every view (document overflow ~999px at 390px). The Delivery Trends view itself fits.

## Test evidence classes
| Class | Where | Meaning |
|---|---|---|
| Actual full-app browser, **mocked Firebase** | `pdf-service/test/dashboard-browser-smoke.test.mjs` | Real built `index.html`, real dashboard code, real Chromium; Firebase Auth/Firestore/Functions replaced by `tests/browser/firebase-stubs.mjs`. **Not authenticated E2E.** |
| Module/source level | `tests/week-order.test.mjs`, `tests/delivery-trends-history.test.mjs`, `tests/delivery-trends-integration.test.mjs`, `tests/delivery-trends-page.test.mjs` | Real engine + real functions extracted from the page source, synthetic data |

Firebase emulators were not used: the Firestore emulator needs a Java runtime, which is not installed here (`/usr/bin/java` is a stub).

## Requires a real, signed-in UAT session
- Real `weekLabel`/`weekDate` values parse (all stored weeks) and are ISO-consistent.
- Real project identity stability (`projectId`) and 0–100 numeric progress.
- Real role/permission documents (including delegated `week.manage`, which loads draft weeks for non-admin/pm users).
- Real Firestore listener behavior and index requirements; real latency.
- Real PDF backend round trip (blocked by Codex F-1/F-2).
