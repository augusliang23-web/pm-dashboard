# New Project Draft / Publish — UAT candidate validation

Date: 2026-10-14 (Asia/Singapore). Status: **READY FOR REVIEW — review fixes locally verified; CI pending; not deployed**.

## Resulting behavior

New UAT projects use a separate persistent Draft workspace. Save Draft does not write a reporting week. Publish creates/updates an official snapshot in an unreleased week; later working edits leave that snapshot unchanged. Existing legacy projects and Production keep their current workflow. Existing Add / Delete Projects permission controls creation/first publication; owning PMs can maintain assigned existing drafts. Archive remains a separate lifecycle action.

Raw client reads/writes to drafts and their publication audit are denied. Callables read users/permission/assignment data on the server. Publication writes the official snapshot, draft publication marker and audit in one transaction. Old Save/attention/new-project payloads cannot bypass the UAT publication path. Four new Functions are explicitly forbidden by the Production deployment manifest.

## Final local evidence (after independent review fixes)

- Node 22.23.3, locked dependencies; no dependency or Node-version changes.
- Root suite: **1521 passed, 0 failed, 2 existing emulator-only skips** (1523 total). The two skips are covered by the explicit emulator run below.
- Firestore Rules suites: **49 passed / 0 failed / 0 skipped** across Production (15), UAT (17), shared backend (17). Includes denied get/list/write for draft and publication-audit collections.
- Hosting: UAT and Production builds passed. Production source baseline checks remain enabled. Only the UAT rendering snapshot was deliberately updated for this approved feature.
- Production→UAT synchronization boundary verification passed. No cloud synchronization executed.
- Formal report model tests exercise actual draft save/publish handlers at the Firestore boundary and verify official Overview/PDF/Trend/Copilot/carryover exclude saved working drafts. Empty official portfolios remain empty.
- Full PDF suite: initial sandboxed run had 47 Chromium launch failures caused by macOS sandbox permission. The local renderer rerun outside that sandbox passed **404 / 404**, with zero failures/skips; initial launch failures are not counted as feature passes.

Commands: `npm run test:all`, `npm run test:rules`, `npm --prefix pdf-service test`, `npm run build:hosting:uat`, `npm run build:hosting:prod`, `npm run verify:sync-boundary`, `git diff --check`.

## Browser smoke — local demo project only

Used a separate local Firebase Auth/Firestore/Functions emulator and the built UAT page, with synthetic accounts and project data. No production browser or cloud data was used for feature validation.

1. Admin saved an incomplete unnamed/codeless Draft successfully; it survived page reload and login.
2. Admin assigned the synthetic project to a PM, saved 40%; official portfolio remained unchanged until Publish.
3. First Publish added the official 40% snapshot to the selected unreleased week.
4. Admin saved working progress 65%; official project remained 40%.
5. Assigned PM, with no Add / Delete Projects grant, could see the existing assigned Draft and republish it to 65%; the New Project button was unavailable.
6. The official card's Edit action opened the working Draft. PM saved progress 75%; the official project remained 65% and My Drafts showed Unpublished changes.
7. No unpublished target week still permits Save Draft; Publish has no target. This is covered by UI-state tests; the first browser session also exercised the no-target state during local emulator restart.

Local screenshots are supplied separately with the final user report; no private Production project data is included in this PR.

## Acceptance status

| Spec criterion | Initial status | Evidence / limit |
|---|---|---|
| Persistent drafts and no implicit weekly write | PASS locally | Actual handler tests + browser save/reload/login |
| Draft progress/risk/count exclusion | PASS locally | Official read-model and publication tests |
| Ownership / role / capability enforcement | PASS locally | Handler/core tests; assigned PM browser smoke |
| Direct Firestore access denied | PASS locally | 49 Rules emulator tests |
| Explicit Publish and rejection cases | PASS locally | Publication tests; release/duplicate/stale/grant cases |
| Published 40 → Draft65 → Publish65 | PASS locally | Browser and official PDF data-model test |
| History and carryover | PASS locally after fixes | Numeric reporting-period guard; earlier unchanged retry; changed/deleted/restored target rejection |
| Concurrency / account changes / retry | PASS locally after fixes | CAS, retry, revocation, auth/request generation and delayed-save tests |
| Old write paths cannot bypass Publish | PASS locally | Real Save/attention handler rejection tests |
| Legacy / Archive / PDF / sync regressions | PASS locally | Root, Rules, builds, synchronization boundary and full PDF renderer pass |
| Environment binding | PASS locally | Runtime gate, build checks, explicit Production prohibition |
| Draft PR, CI and independent review | CI PENDING | One independent review completed; six Important findings fixed with regressions; no second review / no independent approval of final fixes |

## Deployment boundary and remaining prerequisites

No merge, deployment, production write, permission grant, service-account creation, IAM change, or live financial/email/provider operation was performed.

Before a separately authorized UAT deployment, review/create the dedicated `pmdash-project-drafts@` runtime identity and its minimal database access, apply the UAT draft query indexes and Rules, and deploy only explicitly named UAT Functions plus UAT Hosting in a coordinated release. Do not update the Production release subset.

Runtime intent: read users and userPermissions, query/read/create/update projectDrafts, read/update official weeks, and create publication audit records. Firestore IAM scope is not equivalent to document-level Rules; actual IAM must be reviewed rather than assumed to enforce collection boundaries. Existing general-write identities require no new draft access.

Live UAT role grant/revoke, deployment read-back, cloud runtime identity, and Production readiness: **NOT_RUN / not authorized by this local implementation delivery**. Local emulator/build evidence is not live UAT acceptance.

## Independent review and single fix pass

The independent reviewer assessed product HEAD `3c380ab` against the approved spec and returned HOLD: no Critical findings, six Important findings, no Minor findings. Focused independent tests passed 29/29 but did not cover these edges. All six were verified and fixed in the author’s single permitted fix pass:

| Finding | Correction and regression evidence |
|---|---|
| Later publication could rewrite earlier unreleased history | Derive numeric reporting order from authoritative weekLabel; reject earlier changes; harmless unchanged retries remain idempotent. UI disables ineligible per-draft publication targets. |
| Refreshed fingerprint could overwrite a restored target | Compare against the server’s recorded target digest as well as client CAS; require Admin reconciliation on divergence. |
| Typing while Save is pending became falsely clean | Keep the submitted form baseline; later typing remains dirty and protected by the discard warning. |
| Delayed Admin opening survived same-account role change | Validate authentication generation, role and opening generation after directory loading; newer openings supersede older ones. |
| Zero week documents displayed sample portfolio | Remove UAT implicit Prototype fallback; leave official data empty and Draft workspace available. Production unchanged. |
| Weekly full fingerprints exceeded document size | Persist fixed-size SHA-256 digests in target/last-publication records; 12 publications of a >120KB project remain <200KB. External revision comparison contract unchanged. |

The fix pass also prevents Publish from silently fetching and publishing a newer draft revision than the PM reviewed. Added regression tests were observed failing before the corresponding changes and passing afterward. The frozen UAT rendering hash was deliberately updated for these fixes; the Production baseline stayed unchanged.

No Minor findings were deferred. Final fixes are author-verified, **not independently approved**; no second independent review was performed per the approved execution workflow. The reviewer did not judge live IAM, cloud runtime, deployed indexes, GitHub CI, actual UAT acceptance, broader legacy ownership/Archive changes, or removal of already legitimately delivered data. PDF was separately verified by the author.

A changed/restored target (including an Archive → Restore lifecycle sequence that changes its recorded contents) intentionally returns a conflict. Automatic reconciliation is outside this scope; Admin must resolve it explicitly. Missing publication chronology/old experimental markers fail closed; no deployed Draft records or data migrations exist in this delivery.

## Prior Archive investigation and scope decision

The earlier read-only investigation found H/W-005 in archived W39, while W40’s raw project array did not contain it. All filters operate within the selected week; the existing carryover retains Active projects. This supports week/carryover behavior rather than a requirement to rebuild data. No historical operation audit established a specific actor or exact archive timestamp. The user accepted the Archive behavior and chose the separate new-project Draft workflow; this branch does not add Archive permission grants or recreate the project.

## Routing audit

Implementation: Codex in the existing isolated clone. Independent review: GPT-6.1 Sol High, one read-only reviewer; no provider switch or model escalation. Usage/credit telemetry: N/A — unavailable. The clone is preserved for PR follow-up.
