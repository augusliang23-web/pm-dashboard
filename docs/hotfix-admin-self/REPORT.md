# PM_SELF_ASSIGNMENT_HOTFIX

## Product Contract / reality check

Owner decision 2026-10-23: server-verified authenticated Admin may select ONLY their own users account as PRIMARY Project Manager. Other targets remain PM-only; Deputy eligibility unchanged. No hardcoded names/emails; no Rules/registry/IAM/cloud/business-data changes. New standalone branch from main b3b7a51d5db680cfc87acdf24d06d73a9de2aaac, independent of PR74/75; both remain Draft/unmerged and untouched. Observed PR74 c1d652c and PR75 304c38e each CI4/5, root source-hash failures.

## Root cause and smallest implementation

Main frontend beginDraftEditor filtered users to PM only; backend resolveAssignment required every selected account role=pm. This is a deterministic Admin policy mismatch, not a live account diagnosis. No Production user records were queried; an Owner whose actual role is PM would need a separate directory investigation.

Frontend retains existing PM options and adds the current authenticated Admin's directory name+normalized email to the primary dropdown only. The users document must exist and have raw role=admin; other Admins are excluded. Assignment selection survives hydration. Existing awaited directory loading/error/retry and auth generation/role/UID/email checks remain unchanged.

Backend permits `ownerEmail` only when requested normalized email equals the authenticated actor email AND the server-read target document role is admin. Actor comes from readActor's authenticated UID/token email and the server users document, not input claims. assignmentDirectory reads the canonical normalized-email users document in the same transaction. Deputy and every other target still require PM. No assignment ownership, revision, archive/delete or publication semantics changed.

## Validation

- Root: 1,791 pass, 3 existing skip, 0 fail.
- Initial focused draft/core/callable tests:31/31. Added core positive/negative self-assignment tests; existing auth/session/revision/isolation tests retained.
- Actual Auth/Firestore/Functions emulator: Admin create/save/publish/get/edit/republish; PM automatic self and Admin→legitimate PM remain valid. Both save AND publish reject other Admin, PM→Admin, VIP, forged role, missing target document, invalid role, Admin deputy, anonymous. Rejections assert unchanged draft count and official week data. Stale revision and unrelated-PM draft read are rejected.
- Real Chromium Production and UAT profiles: create→choose self→Save Draft→Publish→reload→reopen→edit/republish→logout/login→week roundtrip→reopen. Assert own option once, real directory label, unrelated Admin absent, Admin deputy absent, stored email/name and progress. 11 scenario groups, zero page errors; screenshots/results in evidence/. All accounts/data synthetic.
- Stale directory response/auth generation and superseding opening regressions use existing executable VM tests; no new private caches. Archive/delete/Overview/PDF and legacy source behavior rely on existing focused/full regressions plus independent review; no claim of deployed acceptance.

## Historical source isolation

Original three frozen SHA values remain unchanged. Exact reviewed frontend additions are stored in tests/fixtures/admin-self-source-delta.json. Guarded normalization rejects any changed/missing/duplicated approved hunk, restores only these additions, and leaves unrelated source changes visible to historical hashes. Byte-exact main-source hash proof plus other-Admin, Deputy-widening, role-widening negative mutations pass. Existing Production/UAT role and Delivery Trends assertions remain active. This is the Owner-authorized bounded remediation, not wholesale expected-hash replacement.

## Reproduction

Node22+, Java21; npm ci at root/functions/pdf-service. Start `firebase emulators:start --only auth,firestore,functions --project demo-pm-dashboard-v22t --config firebase.v231-e2e.json`.
Set GCLOUD_PROJECT=demo-pm-dashboard-v22t, FIRESTORE_EMULATOR_HOST=127.0.0.1:8188, FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9198, SPRINT_TEST_PASSWORD to a local synthetic password; run `node scripts/verification/admin-self-hotfix-e2e.mjs`. Script resets only this pinned demo emulator; do not share it with another local test. No credentials in report. Accounts sprint.admin/pm/other/vip@example.test, additional synthetic Admin/invalid user. It blocks nonlocal dynamic endpoints; only SDK/fonts static origins permitted.

## Release impact / rollback / Sprint reconciliation plan

Not deployed or merged. A future authorized release requires Firebase Functions **saveDashboardProjectDraft and publishDashboardProjectDraft**, then Firebase Hosting for the dropdown. No Rules, IAM, indexes, PDF, billing or other resources required by this source change. Existing get/list handlers and public schema are unchanged. Old frontend remains compatible with the additive backend. New frontend against old backend will safely reject new self assignments; keep the backend and Hosting candidate aligned. Rollback UI first, then only the two named function versions after reviewing persisted self-assigned drafts. No rollback time guarantee.

After an approved hotfix merge milestone only: rebase PR74 on the accepted main, manually reconcile beginDraftEditor's session directory with the same primary-only self eligibility, then rebase stacked PR75 on updated PR74. Preserve both scopes and re-run focused identity/assignment and source-baseline checks. This plan is NOT authorization to execute that reconciliation.

## Gate boundary

Independent source/security review and final exact-SHA GitHub5/5 evidence are required before READY_FOR_CONTROL_PLANE_REVIEW. No UAT/Production deployment, merge, real data writes or Gate approval is authorized. Pending or failing evidence means HOTFIX_HOLD. Local tests do not establish deployed user acceptance.

Independent source review found one P2: another Admin opening a self-owned draft could clear the absent dropdown value. Fixed by a disabled current-assignment option (never a new selectable Admin target). Actual prod+uat browser now verifies A self-assignment → B login → reopen → progress-only save retains A email. Changed-area review requested; no self Gate approval. Rules50/50 passed; PDF final result and exact-SHA CI recorded on PR when complete.
