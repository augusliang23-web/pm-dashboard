# V2.3 UAT release runbook (Gate 3B) — NOTHING IN THIS FILE HAS BEEN EXECUTED

Scope: UAT only. Production is untouched at every step. Execute only after explicit Control Plane **and** user approval.

## Candidates
| | Branch | PR | SHA | Contains |
|---|---|---|---|---|
| Base (Gate 2, CI 5/5) | `claude/v23-gate2-closeout` | #57 | `7c02e7f44e4aac72c9a1a948512ea2bdbcdbd940` | Delivery Trends page, history pipeline, F-1, PDF section (gated off) |
| A. Backend | `claude/v23-uat-backend-activation` | see PR | recorded in the PR (HEAD at approval time) | Base + `registry.json` UAT `deliveryPerformanceSection: true` |
| B. Frontend | `claude/v23-uat-frontend-activation` | see PR | `1473475e78e5ff0ae9a466398ae98d35a588e117` | Base + `DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED = true` (UAT profile only) |

Both candidates are independent single-purpose changes on top of #57 and merge cleanly together (verified in a scratch merge: 521 PDF tests, 1644 root tests pass).
**Deploying the frontend publishes the whole Base UI** (the Delivery Trends page, ISO week ordering, etc.), not only the PDF option. Deploying the backend publishes all Base backend code (F-1 authorization, bounded history reader, layout).

## Fixed targets (verify again immediately before deploying — never assume)
- Firebase/GCP project: `pm-dashboard-uat-20260820-a7f3`
- Cloud Run service: `pm-dashboard-uat-pdf`, region `asia-southeast1`, URL `https://pm-dashboard-uat-pdf-b266ahac7q-as.a.run.app`
- Hosting site: `pm-dashboard-uat-20260820-a7f3`
- Allowed origins (registry): `https://augusliang23-web.github.io`, `https://pm-dashboard-uat-20260820-a7f3.web.app`
- Production (`project-manager-dashboar-a067f`, `pm-dashboard-pdf`) is **never** a target.

## State observed read-only on 2026-10-15 (re-check before use)
- Cloud Run serving `pm-dashboard-uat-pdf-00005-z6z` at 100%; previous revisions `00004-8jx`, `00003-9jd`. Limits: 1 CPU, 1 GiB, concurrency 1, timeout 120 s, max 1 instance.
- Hosting latest release version `6967bf5354ce4cc5` (message `uat 4d2c94a`); previous `51cf1db531949a13` (`uat 7a1c5ba`).

## Pre-flight (read-only)
1. `gh pr view <A>` and `<B>`: CI 5/5 on the exact SHAs; PR #57 unchanged.
2. `gcloud config get-value project` = UAT project; `gcloud auth list` = the approved account.
3. Re-run: `gcloud run revisions list --service pm-dashboard-uat-pdf --region asia-southeast1 --project pm-dashboard-uat-20260820-a7f3` and the Hosting releases listing. Write the **rollback revision / version** you will use into the release log.
4. Clean checkout of the exact SHA (the deploy script refuses a dirty tree). Run `node scripts/package-delivery-trends.mjs --check`, `npm run test:all`, `cd pdf-service && npm test`.

## Deployment sequence
1. **Backend (A).** `node pdf-service/scripts/deploy-pdf.mjs --target uat --dry-run` (review the printed `gcloud run deploy` command and env: `PDF_ENVIRONMENT=uat`, `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGIN`; no new env var is needed — the feature flag ships inside the image via `registry.json`). Then `node pdf-service/scripts/deploy-pdf.mjs --target uat`. macOS/Linux only. Cloud Build must pass the new `RUN node src/verify-delivery-trends-package.mjs` step.
2. **Backend verification before the frontend** (old frontend never sends the new section, so users are unaffected):
   - New revision is Ready, 100% traffic, limits unchanged, env unchanged.
   - Image check: pull the new image digest and run `node -e` against `/app/src/environment.js` (same check used locally): UAT `deliveryPerformanceSection: true`, Production `false`.
   - Existing export regression with the CURRENT Hosting: a signed-in admin exports an Overview PDF with default sections; identical to before.
   - Unauthenticated `POST` returns 401 (service reachable, CORS preflight for both allowed origins succeeds).
   - Note: the authenticated new-section path cannot be called without an ID token; it is first exercised in step 3/4 by a signed-in human. This is a real limitation.
3. **Frontend (B).** `node scripts/deploy-hosting.mjs --env uat --dry-run`, then `node scripts/deploy-hosting.mjs --env uat`. (Publishes the Base UI + the PDF option.)
4. **Acceptance** (below) immediately after. Stop and roll back on any failure.

## Feature-disable / rollback
- **Fastest, user-visible (frontend):** roll Hosting back to the recorded previous version (re-check the id first): `POST https://firebasehosting.googleapis.com/v1beta1/sites/pm-dashboard-uat-20260820-a7f3/releases?versionName=sites/pm-dashboard-uat-20260820-a7f3/versions/<previousVersionId>` (or the console "Rollback"). This removes the option AND the Delivery Trends page.
- **Option only:** set `DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED = false`, rebuild and redeploy Hosting.
- **Backend:** `gcloud run services update-traffic pm-dashboard-uat-pdf --to-revisions <previousRevision>=100 --region asia-southeast1 --project pm-dashboard-uat-20260820-a7f3` (currently `pm-dashboard-uat-pdf-00005-z6z`, re-check). Or set the registry flag to `false` and redeploy.
- Order when rolling back everything: frontend first (stop sending), then backend.
- No data is written by this feature; there is nothing to restore in Firestore.

## UAT acceptance checklist (real data: 23 weeks 2026-W17 … W39; 22 released, W39 draft; legacy code-only identity)
Expected values below come from the read-only preflight; they are historical UAT periods, not the current calendar week. Do not invent newer weeks.
| # | Actor | Action | Expected |
|---|---|---|---|
| 1 | Admin | Open dashboard, open Delivery Trends | Entry visible; default week `W39 2026`; cards show 0pp, 5 comparable, completion 47%; two warnings (`legacy-provisional-match`, `baseline-unverified`) in plain language; status partial |
| 2 | Admin | Select `W38 2026` | +0.83pp, 6 comparable, completion 40.17%, 6 project rows |
| 3 | Admin | 6 ↔ 12 weeks | 6 / 12 axis points, no gaps (no missing calendar weeks) |
| 4 | Admin | Overview scope change | Rows follow the scope; no errors |
| 5 | PM | Same as 1–2 | Same numbers as Admin (PM reads drafts) |
| 6 | VIP | Open dashboard | **No** Delivery Trends entry; Overview unchanged |
| 7 | Sales/Engineering (**only if separately authorized; no account is created by this plan**) | Open Delivery Trends | Latest week `W38 2026`; W39 never visible; numbers equal Admin's W38 |
| 8 | Admin | Overview PDF dialog | New option visible, unchecked; presets unchanged |
| 9 | Admin | Export default sections | Unchanged PDF behavior |
| 10 | Admin | Export with the new section for W38 and W39 (all projects selected) | PDF, 1 page; same summary numbers as the screen (W38 +0.83pp/40.17%; W39 0pp/47%); scope line "Portfolio scope: All projects · Selected projects: N" |
| 11 | Admin | Export with a partial project selection | "Selected projects: n of m" and "This report includes selected projects only." |
| 12 | Admin | Sign out / sign in as another user | No Delivery Trends content remains after sign-out |
| 13 | Any | Mobile 390 px | Delivery Trends fits, KPI cards 2×2 |
| 14 | Production site | Open dashboard | No Delivery Trends, no new PDF option, no behavior change |
| 15 | Admin | Browser vs PDF for W38 | Summary, 6 weekly gains and project rows identical |
Automation available: `pdf-service/test/dashboard-browser-smoke.test.mjs` (mocked Firebase), `pdf-service/test/uat-activation-smoke.test.mjs`, `pdf-service/test/delivery-parity.test.mjs`. Needs a signed-in human: items 1–2, 5–6, 8–12, 14–15 on the real deployment.

## Performance / cost measurements (ALL PENDING — nothing measured in the cloud)
Known from the repository and the read-only preflight: 23 weekly documents (~1.39 MB JSON total, ~60 KB each); the history reader reads each document once per section request (23 reads; hard cap 6 pages × 50 = 300); local in-memory model ≈ 8 ms and local render ≈ 2.3 s for one page.
Measure after deployment and record next to the 120 s timeout: end-to-end export time (warm), first request after idle (cold start), peak memory (Cloud Run metrics vs 1 GiB), Firestore reads per export (Firestore usage metrics), two simultaneous exports (concurrency 1, max 1 instance → the second queues), and repeat 5×.

## Accepted decisions carried into this release
Legacy code-only matching with visible warnings; no historical data changes and no invented `projectId`/`baselineId`; delegated `week.manage` PDF mismatch is fail-closed (no current UAT user has the override); PDF scope follows the projects selected in the export workflow.

## Remaining authorizations required
Explicit approval of: each candidate SHA, deploying the backend, deploying Hosting, creating any disposable non-draft test account, and the post-deployment acceptance run.
