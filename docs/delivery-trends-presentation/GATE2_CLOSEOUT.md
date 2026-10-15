# Gate 2 closeout (UAT-only, not deployed)

Start: PR #56 `aed4e72`. Imported PR #55: `2b25b98` -> `6ce42f1`, `669ab2d` -> `b1a82dc` (conflict resolutions in `index.html`, `tests/delivery-trends-integration.test.mjs`, `tests/role-contract.test.mjs`).

## F-1 (HIGH) — draft-history authorization for Delivery Performance
- `pdf-service/src/report-data.js`: draft readers are exactly `admin` and `pm` (mirrors `js/dashboard-access.mjs` `canReadDraftWeeks`, asserted equal by a test). Every other role (sales, engineering, business, product, bd, vip, executive) is released-only: the history query itself filters `isReleased == true`.
- A role without draft access that anchors on a draft week gets a fail-closed section (`draft-week-not-authorized`, no history read, no project data); a request for **only** this section is rejected with 403. Other sections' existing authorization is unchanged.
- The role comes from the trusted `users/{email}` record after token verification; client claims, token extras and request fields are ignored/rejected.
- **Documented Browser/PDF mismatch (fails closed):** a delegated `week.manage` override lets the dashboard load draft weeks, but the PDF backend cannot verify that override authoritatively (it only reads `users/{email}`), so those users get released-only history in the PDF section.

## Other changes
- Chronological ISO ordering (PR #55) + default selection = latest VALID ISO week; invalid labels preserved; selection survives snapshot refreshes by stored week id (UAT only; Production unchanged).
- Prototype data: `source: 'synthetic'` with no saved weeks is reported as prototype data, never UAT.
- Friendly messages for the new history/authorization warning codes (web + PDF parity test).
- PDF layout: footnotes in two columns so a normal portfolio and long-name cases stay on one page; 14 projects continue on a second page.

## Known behavior to decide
A single stored week whose label/date cannot be verified as an ISO week makes the whole history unavailable in BOTH Browser and PDF (Phase 2A fail-closed). Real UAT data must be checked for such weeks.

## Not verifiable here
- Docker image build: fails on this Apple-silicon host with `rosetta error: failed to open elf` while running the amd64 Chromium smoke step (emulation limitation, not a code failure). CI covers it.
- Firestore rules tests need a Java-based emulator (no Java here); CI covers them.
- Authenticated UAT end-to-end: not possible without credentials.
