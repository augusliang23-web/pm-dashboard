# PM_ASSIGNMENT_DELEGATION_PERMISSION — execution evidence

## Architecture / permission contract

Stacked candidate from PR76 exact ce01cb0a4dac7d5de7b8b1a472b50ee9ac5a18ab; main b3b7a51. PR76/74/75 remain unchanged Draft/open. Browser/server registry adds project.assignment.delegate: Admin default ON/locked, PM default OFF and the only grantable role. Existing User Permissions UI renders the sixth ON/OFF switch automatically; existing Admin-only setUserPermissionOverrides writes overrides and audit atomically. No expiry, new service, framework, rules, index or IAM changes.

Owner explicitly chose: Save Draft stages the proposed primary PM; Save & Publish commits the handoff. Existing owner/Deputy access remains while staged. Backend-only pendingAssignment metadata stores the target email. No client role/permission claims are accepted. ReadActor re-reads authenticated users/userPermissions transactionally on every operation; target users must still exist with role=pm at publication. PM may act only on their own/Deputy-managed project, or create a draft under existing creation rights. New permission grants no visibility/archive/delete/week/permission-management rights. Deputy edits remain Admin-only; PR76 Admin-self and other-Admin denial stay unchanged.

The ordinary Admin assignment workflow is preserved. When an Admin edits a PM-staged draft without changing its displayed target, the stage is retained. No changes to PM-account flags or generic user-role interpretation.

## Transfer and revocation

A staged draft retains its active assignment, project owner label and editorEmails; B cannot read the private draft before publication. The pending UI explicitly names B and says access changes only after Save & Publish. Publication commits project content, owner, draft ACL and publication audit (including assignment before/after) in one transaction. Existing project/history/unknown metadata and revisions are preserved. A loses draft/source edit access unless still Deputy; B can resume, save and republish. The currently published official project is checked for draft access, including source-less published drafts.

After actual access loss, response contains only the success receipt (no draft/project contents). The editor closes, cache resets and the signed-in user's own drafts refresh. Exact retries verify authenticated actor UID, request digest, unchanged draft revision and official publication fingerprint, return only a receipt, and create no second write/audit. Retained Deputies and Admins follow the normal authorized draft-response path. Changed requests cannot reclaim access.

Revocation blocks the next transfer operation, including an already staged target; committed assignments are not reversed. Assignment-only denial preserves the owned unsaved form and shows the backend error; actual auth/other permission loss still clears protected editor state. An Admin can clear the stage or regrant permission before retry. Existing UI permission cache refresh behavior remains; a newly granted PM can reload/sign in again to see the enabled selector. Backend enforcement never depends on that cache.

## Validation

- Root: 1,805 PASS / 3 existing skips / 0 FAIL (1,808 total).
- 109 focused registry/User Permissions/delegation checks passed before final review fixes; final 15-callable/controller regressions passed after reproducing both review findings RED→GREEN.
- Registry parity and exhaustive role/capability defaults pass; new capability included in Admin grant/reset/audit and role-ineligibility tests. Existing audit-failure tests retain atomic permission-write coverage.
- Actual Auth/Firestore/Functions emulator + real Chromium: 10 scenario groups across Production and UAT profiles, zero page errors. Admin-only OFF→ON switch / audit; default denial; invalid Admin/VIP/missing targets; unrelated PM denial; PM stage; revoke rejects and retains progress78; regrant; publish transfers with preserved highlight/progress; old owner denied; limited identical retry; B opens/republishes progress83; revocation leaves B owner. A 1.5s concurrent list delay does not suppress success/close.
- Pure transaction tests additionally verify new-draft assignment, Deputy retention and its exact retry, official revision conflict, recipient role drift, no extra administrative rights and no private draft access before/after handoff.
- Original frozen source SHA values unchanged. Exact delegation delta is normalized before the exact PR76 delta, restoring the accepted historical source; unexpected directory/Deputy widening fails. Historical Production/UAT role and Delivery Trends protections remain active.
- Both Hosting builds, Production sync boundary and Delivery Trends package parity pass. Rules and PDF local/CI results are recorded on the PR when complete; no pending result is a PASS.

## Independent review

One bounded security/source review found two P2 response-handling issues: a retained Deputy's retry falsely reported access loss; a concurrent list refresh could discard a successful transfer receipt. Fixed together with failing-first regressions. Changed-area verification passed15/15 and found no new blocker. Reused the bounded independent request-lane solution, without modifying any existing Sprint branch. This is source-review evidence, not a Control Plane Gate or independent deployed acceptance.

## Reproduction / environment

Node22+, Java21; npm ci at root/functions/pdf-service. Start Firebase emulators with firebase.v231-e2e.json, only auth/firestore/functions, demo-pm-dashboard-v22t. Set GCLOUD_PROJECT=demo-pm-dashboard-v22t, FIRESTORE_EMULATOR_HOST=127.0.0.1:8188, FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9198 and choose a synthetic SPRINT_TEST_PASSWORD. Run node scripts/verification/assignment-delegation-e2e.mjs. The script resets only this pinned local demo database and restricts dynamic traffic to localhost; static SDK/fonts are permitted. Do not share its emulator with another task. No credentials in report. Synthetic accounts sprint.admin@example.test (Admin), sprint.pm@example.test (A), sprint.other@example.test (B), sprint.vip@example.test (VIP).

## Compatibility / release limits

PR76 behavior remains covered by its existing Admin-self tests. No merge or reconciliation of PR76/74/75 is performed. This candidate targets PR76's branch; retarget/rebase only after a separately approved PR76 milestone.

A future authorized release needs Hosting plus setUserPermissionOverrides and the four draft callables getDashboardProjectDraft/listDashboardProjectDrafts/saveDashboardProjectDraft/publishDashboardProjectDraft: registry, read-ownership and receipt behavior must remain aligned. No Rules/IAM/PDF/billing/other resource deployment is required by this source diff. Do not mix old client/server versions on staged transfers: older UI does not show pendingAssignment and older backend may discard/ignore it. Release review must account for pending records and require a compatible refreshed client before publishing them. A previously completed transfer must not be automatically undone on revocation or rollback. No migration/deployment is authorized here; no rollback timing guarantee.

Implementation complete; local synthetic acceptance collected. Exact final-SHA CI5/5 and Control Plane review determine PASS/HOLD. Deployment NOT RUN; deployed user acceptance NOT RUN.
