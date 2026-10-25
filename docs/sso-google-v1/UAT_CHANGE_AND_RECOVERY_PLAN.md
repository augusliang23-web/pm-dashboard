> Superseded product policy (2026-10-25): Google is UAT-only and Admin-only. PM/all other roles use password; Production must not receive SSO. This document is historical; follow ../sso-uat-admin-only/REPORT.md and RELEASE_ISOLATION.md.

# UAT SSO changes and recovery — prepare only

No command in this document was executed against UAT/Production. Owner separately approved the local UID design and local PDF authorization scope; neither is cloud authorization. UAT is `pm-dashboard-uat-20260820-a7f3`; Production is excluded.

## Preconditions and identity inventory

Read actual PR79/main status and exact final SSO SHA before any release decision. Keep Google provider disabled until the authoritative gate is deployed and password regression passes. Inspect actual UAT Auth provider configuration, account-linking setting, Authorized Domains, Auth billing mode and existing deployments; all remain UNKNOWN in this local task.

Through separately authorized Admin SDK metadata access (no password hashes, passwords, ID/refresh tokens in exports), inventory Auth UID/email/emailVerified/disabled/providerData and users/{email} roles/current identity fields. Owner reviews an explicit one-to-one mapping. Email equality is a consistency check, NOT approval or automatic role assignment. Existing Admin UID must be captured before linking and unchanged afterward. Preserve exact role and userPermissions documents.

Use `planIdentityMigration` from `scripts/identity-migration-plan.mjs` on those trusted inventories and explicit approvedMappings. It is a pure read-only planner with no Firebase/network/write ability. It rejects missing coverage, duplicate UID/email, case collisions, mismatched existing bindings, disabled Auth users and unapproved/mismatched Google providers. No role record is created. Review its additive patches before authorizing a separate Admin SDK write step. Migration must cover every retained legacy account before enforcing UID checks; there is no email-only grace path.

## Exact future resources requiring approval

- UAT users/{email}: additive `authUid`; add `googleSubject` only with explicit Owner approval and trusted Auth providerData verification. No role change for existing Admin; new PM role record only in a separately approved provisioning operation.
- UAT Firebase Auth: Google provider, required Authorized Domains only, explicit Admin linking, explicit independent PM account provisioning. No provider activation/linking/account creation occurred locally against cloud.
- UAT Firestore rules selected by the UAT release configuration; no Production rules change. Shared profile must be accounted for if actually used. All three local profiles are tested, but that is not authorization to deploy all environments.
- UAT authenticated Functions: all24 callable endpoints below, because separate actor loaders previously used email-only authorization. Shared pure helper has identical shipped copies in browser/Functions/PDF; all must be included in actual upload package. Existing runtime/service accounts/ingress/resources/IAM remain unchanged.
- Existing UAT PDF service authorization (`pdf-service/src/report-data.js` plus identity helper) and UAT Hosting from the same exact candidate. No new OAuth backend, service account, API, Rules privilege or infrastructure is required by this source design. Inspect actual deployment prerequisites; stop if CLI would create service identities/change IAM/resources.

Functions inventory:

```
addExecutiveMilestoneUpdate
createExecutiveMilestoneChangeRequest
withdrawExecutiveMilestoneChangeRequest
decideExecutiveMilestoneChangeRequest
applyDirectExecutiveMilestoneChange
initializeExecutiveMilestoneLiveTimeline
saveExecutiveMilestoneTimelineConfig
setExecutiveRagOverride
saveDashboardProject
deleteDashboardProject
setDashboardProjectAttention
setDashboardWeekRelease
saveDashboardWeekFields
createDashboardWeek
saveDashboardGanttTemplateSettings
saveDashboardGanttWindowSettings
setUserPermissionOverrides
syncProductionWeeksToUat
getProductionWeekSyncStatus
restoreUatWeeksSnapshot
listDashboardProjectDrafts
getDashboardProjectDraft
saveDashboardProjectDraft
publishDashboardProjectDraft
```

Scheduled aggregatePresenceSessions is not a user-authenticated endpoint and is unchanged. Do not call sync/restore just to smoke-test authentication; those can affect real UAT data.

## Staged UAT procedure

1. Capture source, serving revisions, Hosting version, deployed Rules, environment configuration, Auth UID/provider inventory and binding records; verify feasible restoration and a bound recovery Admin. Pause edits only as explicitly required by the later approved rollout.
2. Approve and backfill UID metadata BEFORE stricter code. Verify exhaustive mapping coverage and existing password login. Unresolved mapping/collision is HOLD; do not auto merge identities or assign PM privileges from email.
3. Deploy coordinated UAT Rules/Functions/PDF authorization and Hosting under separate scoped permission; Google remains disabled. Verify every password role and Admin self-assignment, including wrong-UID denial at all data entrypoints.
4. Inspect Authorized Domains and OAuth settings. Enable Google only under explicit approval and once all authoritative routes reject unapproved identities. Standard Firebase Google provider APIs are used; no custom OAuth service.
5. Existing Admin: password sign-in, recent password reauthentication, explicit Google account chooser/link. Confirm UID/expected provider email/password fallback/role before and after. A freshly linked provider may refresh a Google token and cause an intentional sign-out before approval. UI must explain the Owner gate; use password fallback, not an email-only override.
6. Read trusted Admin Auth metadata for that same UID. Check emailVerified, Google provider email and provider UID against the Owner-approved Google identity; then separately authorize the googleSubject patch. This patch is not written by the browser. Re-login with Google and verify same Admin UID/role and self-PM draft/publish flow.
7. PM: separately authorize creation/provisioning of the second Google identity with its own Firebase UID. Capture trusted provider metadata; create an explicit PM-only dashboard record/binding after approval. No Admin UID reuse or automatic users record from sign-in. Collision stops; never transfer old account data automatically.
8. Chrome Profile A Admin and Profile B PM: simultaneous sign-in/refresh, independent logout, chooser, role isolation, unprovisioned identity denial, revoked binding, stale requests, PM Admin-action denial, S01 workflows. Real Google chooser/profile acceptance must be independently observed in UAT, not inferred from emulator contexts.

## Recovery precautions

Keep Auth UIDs, roles and project ownership intact. The additive UID fields may remain during a UI rollback; do not delete/reassign accounts or wipe bindings to make old code pass. A Hosting-only rollback does not undo Auth provider links or backend trust changes.

Disabling Google provider does NOT by itself prove previously issued Firebase ID tokens are invalid. Refresh-token revocation also must not be confused with immediate ID-token rejection in paths that do not call verifyIdToken(checkRevoked=true). Current UID/subject/active checks are the authoritative denial mechanism on every request. If Google access must be withdrawn, separately approve removal of that subject binding or active=false as appropriate, revoke sessions where authorized and verify effective denial before any further recovery.

Prefer keeping the UID authorization layer deployed and rolling back only the Google UI or rolling forward a fix. Never restore old email-only Rules/Functions/PDF while Google tokens could remain valid. A complete old-backend rollback needs a separate reviewed maintenance/denial and token-invalidation plan; no recovery time guarantee is claimed. Capture actual rollback revisions before deployment; no cloud rollback inventory was inspected in this task.

## Cost truth

Standard Firebase provider APIs avoid a new OAuth backend. There is no demonstrated unavoidable incremental authentication charge merely for two Google accounts in the documented no-cost bands; actual project billing mode and combined usage are UNKNOWN. Firebase distinguishes base Authentication from Authentication with Identity Platform; its upgraded Blaze scheme charges beyond the50,000 monthly-active-user free tier, while upgraded Spark has a different daily-active limit. Do not upgrade billing or Identity Platform as part of enabling this feature without separate approval. [Firebase Authentication](https://firebase.google.com/docs/auth/), [Identity Platform pricing](https://cloud.google.com/identity-platform/pricing), [Firebase pricing](https://firebase.google.com/pricing).

No phone/SMS authentication is added. UID fields reuse existing user-document reads in Functions/PDF; the browser adds an own-identity subscription and future migration performs explicit metadata writes, so Firestore/network/compute and eventual deploy/build/storage costs remain subject to actual usage and existing quotas. No Artifact Registry image was pulled or cloud build triggered. Any future PDF build must follow repository cost/cleanup guardrails and capture its actual billable implications.

## Reference contracts

[Firebase account linking](https://firebase.google.com/docs/auth/web/account-linking), [Google sign-in and collision behavior](https://firebase.google.com/docs/auth/web/google-signin), [Auth emulator provider behavior](https://firebase.google.com/docs/emulator-suite/connect_auth), [verified ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens). Email/UID/provider auto-link behavior must be checked against actual UAT settings; a same-email Google sign-in is not proof of approved binding.
