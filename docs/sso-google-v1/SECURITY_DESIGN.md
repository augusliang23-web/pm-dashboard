# Google SSO V1 — security design for local implementation

Status: security design approved by Owner in this chat; local implementation in progress, no live account or cloud change.
Baseline: PR79 `30b19c7d82118d19595006192e16401a7c9d1d49`, OPEN Draft, not merged. Main remains `b3b7a51d5db680cfc87acdf24d06d73a9de2aaac`. Branch: codex/s02-google-sso, isolated local checkout. PDF authorization added to local scope by explicit Owner reply; no PDF deployment authorization.

## Product contract

Existing Admin keeps its UID, Admin role and Admin+PM workflow. Independent PM has a different approved UID, PM-only role, no automatically created dashboard role record. Support Google chooser, password fallback, safe explicit linking, clear identity/loading/error states, independent browser sessions and logout/revocation cleanup. Preserve all S01 behavior. No impersonation, framework, custom OAuth backend, cloud change, real credentials or live account operation.

## Verified current boundary

Rules in all three profiles authorize users by token.email existence. Browser resolves role by users/{email}. Five independent Functions actor loaders do the same: dashboard writes, drafts, executive milestones, permission overrides and UAT sync. Scheduled presence aggregation is not a user-authenticated callable. PDF loadAuthorizedReport separately verifies a Firebase token, then looks up role by email; it also needs binding. userPermissions is server-written but keyed by email, so it must only be consulted AFTER identity binding. Existing client writes to users are denied.

## Selected design

Keep existing users/{normalizedEmail} and role/permission semantics; extend its server-managed identity metadata. `authUid` must exactly equal authenticated UID; absent or mismatched binding fails closed for ALL providers. No legacy email-only fallback. `active:false` denies. Password remains supported for bound users. Google additionally requires verified email and the token's firebase.identities['google.com'] to contain the explicitly approved `googleSubject`; missing or mismatched subject denies. Unknown providers deny. Role always comes from server user data; token/client role is ignored. Client user-record writes remain denied.

Apply the same contract in all three Rules profiles, all five Functions actor loaders, PDF adapter and browser lifecycle. Rules/Functions/PDF are authoritative; frontend mirrors rejection only for UX. Binding/revocation errors clear private UI, close editors, cancel request generations and sign out. A listener on the current user's server record handles revocation/role changes and cannot let stale responses restore prior state. Independent browser contexts use Firebase native session isolation.

Alternatives rejected: Google email-only whitelist (violates identity binding), unbound-password grace fallback (wrong UID could retain legacy email privileges), custom OAuth backend or role switcher (unnecessary). This is a new mandatory trust check around existing roles, not a role redesign.

## Safe linking and provisioning

For existing Admin: authenticate bound password account, require recent password reauthentication, explicitly link Google using Firebase standard provider API with chooser. Never sign in a second Firebase account and merge it automatically. Original UID must remain identical; inspect returned Google provider email/subject. Wrong email, UID or account collision fails closed; do not authorize the new provider. If a wrong provider was linked, attempt unlink and sign out; report any failed unlink, never claim recovery succeeded without confirmation.

A newly linked Google provider is not a grant of dashboard access. In the actual emulator a link immediately refreshes the provider token; an unapproved Google token intentionally clears private state/signs out, with an Owner-review message. Password re-login remains available. Committed links are still checked for a wrong provider and cleaned up even if this token recheck already signed out. Its `googleSubject` must be trusted through a separately Owner-authorized Admin SDK provisioning step after verifying original UID, approved email and providerData. Until approved, Google login is denied and password fallback remains available. No client write of authUid/googleSubject/role. An already approved matching subject may be verified locally without another grant.

For PM: provision an independent Auth UID in future UAT only after explicit Owner authorization; verify Google identity using trusted Auth providerData, then provision matching authUid/googleSubject and role pm. Do not create users/{email} from sign-in and do not reuse Admin UID. Any existing-email or UID collision is a stop condition; no automatic reassignment, merge or data transfer.

## Staged migration and lockout prevention

1. Keep Google provider disabled and old live code unchanged during planning.
2. With separate future approval, inventory Auth metadata and every legacy users record in the target UAT project. Preserve exact existing UID/role and permission overrides. Detect duplicate/case-colliding emails, missing users, disabled accounts and conflicting provider identities. Produce an Owner-reviewed one-to-one mapping; unresolved records block cutover.
3. Back up identity metadata/role records and Auth provider associations. Backfill authUid using trusted Admin SDK metadata, never browser email claims. This additive stage must leave existing password login working. Prepare at least an independently verified recovery Admin and out-of-band recovery access; do not create resources in this task.
4. Dry-run complete inventory coverage; ALL retained users must be bound before enforcing mandatory binding. No partial deployment of strict auth that locks out unbound legacy users. Test password login and Admin self-assignment with synthetic copies first.
5. Under separate UAT authorization deploy coordinated Rules, Functions, PDF authorization and Hosting, validate bound password flows, then enable Google provider and perform explicitly approved linking/provisioning. Enabling provider before all authoritative services are protected is forbidden.
6. Password fallback must remain present and tested after linking. Inspect trusted Auth metadata before/after because provider auto-link behavior cannot be assumed; unexpected removal/change of credentials or UID stops activation.

## Validation and remaining live limitations

Tests must deny wrong UID for both Admin/PM, missing binding, wrong/missing Google subject, unverified Google email, disabled user, unknown provider and forged roles. Use actual Auth emulator Google credentials and Rules/Functions/PDF entry points, not frontend-only checks. Verify correct UID/provider linking, collision failure, password fallback, dual browser sessions, logout/role revocation/stale requests and all changed S01 flows. Frozen-source guards need exact independently auditable deltas, not refreshed historical hashes.

Real Google chooser/account linking and actual legacy mapping cannot be certified by emulators. Those require separate Owner-authorized UAT acceptance at exact candidate. No local-ready verdict equals UAT/production readiness.

## Rollback

Before any future rollout capture exact source, live Rules/Functions/PDF/Hosting revisions, Auth UID/provider inventory and binding backups. Additive authUid metadata can remain if old code ignores it, but old email-only authorization must NEVER be restored while Google provider remains usable. Disable further Google entry and revoke affected sessions as part of a separately authorized coordinated recovery before considering older authorization. Do not delete/reassign Auth accounts, change Admin UID or discard project ownership. Browser UI rollback alone is unsafe.

## Required future resources

UAT Google provider/Authorized Domains; approved users binding metadata and explicit Admin/PM Auth linking/provisioning; all relevant Rules/Functions, existing PDF Cloud Run auth code and Hosting. No IAM, new services, billing-mode change or custom OAuth backend is planned. Actual Auth billing mode/MAU exposure remains UNKNOWN until separately inspected; no made-up zero-cost promise.
