# New Project Draft / Publish — UAT candidate validation

Date: 2026-10-14 (Asia/Singapore). Status: **HOLD — independent review and CI pending; not deployed**.

## Resulting behavior

New UAT projects use a separate persistent Draft workspace. Save Draft does not write a reporting week. Publish creates/updates an official snapshot in an unreleased week; later working edits leave that snapshot unchanged. Existing legacy projects and Production keep their current workflow. Existing Add / Delete Projects permission controls creation/first publication; owning PMs can maintain assigned existing drafts. Archive remains a separate lifecycle action.

Raw client reads/writes to drafts and their publication audit are denied. Callables read users/permission/assignment data on the server. Publication writes the official snapshot, draft publication marker and audit in one transaction. Old Save/attention/new-project payloads cannot bypass the UAT publication path. Four new Functions are explicitly forbidden by the Production deployment manifest.

## Evidence at initial review HEAD 3c380ab

- Node 22.23.3, locked dependencies; no dependency or Node-version changes.
- Root suite: **1512 passed, 0 failed, 2 existing emulator-only skips** (1514 total). The two skips are covered by the explicit emulator run below.
- Firestore Rules suites: **49 passed / 0 failed / 0 skipped** across Production (15), UAT (17), shared backend (17). Includes denied get/list/write for draft and publication-audit collections.
- Hosting: UAT and Production builds passed. Production source baseline checks remain enabled. Only the UAT rendering snapshot was deliberately updated for this approved feature.
- Production→UAT synchronization boundary verification passed. No cloud synchronization executed.
- Formal report model tests exercise actual draft save/publish handlers at the Firestore boundary and verify official Overview/PDF/Trend/Copilot/carryover exclude saved working drafts. Empty official portfolios remain empty.
- Full PDF suite: initial sandboxed run had 47 Chromium launch failures caused by macOS sandbox permission. An unsandboxed local renderer rerun is pending; initial failures are not counted as feature passes.

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
| History and carryover | REVIEW PENDING | Automated tests exist; independent review checking stronger edge cases |
| Concurrency / account changes / retry | REVIEW PENDING | CAS, retry, revocation and controller tests; review ongoing |
| Old write paths cannot bypass Publish | PASS locally / review pending | Real Save/attention handler rejection tests |
| Legacy / Archive / PDF / sync regressions | PARTIAL | Root, Rules, builds and sync pass; full PDF renderer rerun pending |
| Environment binding | PASS locally | Runtime gate, build checks, explicit Production prohibition |
| Draft PR, CI and independent review | PENDING | Must finish before declaring ready for review |

## Deployment boundary and remaining prerequisites

No merge, deployment, production write, permission grant, service-account creation, IAM change, or live financial/email/provider operation was performed.

Before a separately authorized UAT deployment, review/create the dedicated `pmdash-project-drafts@` runtime identity and its minimal database access, apply the UAT draft query indexes and Rules, and deploy only explicitly named UAT Functions plus UAT Hosting in a coordinated release. Do not update the Production release subset.

Runtime intent: read users and userPermissions, query/read/create/update projectDrafts, read/update official weeks, and create publication audit records. Firestore IAM scope is not equivalent to document-level Rules; actual IAM must be reviewed rather than assumed to enforce collection boundaries. Existing general-write identities require no new draft access.

Live UAT role grant/revoke, deployment read-back, cloud runtime identity, and Production readiness: **NOT_RUN / not authorized by this local implementation delivery**. Local emulator/build evidence is not live UAT acceptance.
