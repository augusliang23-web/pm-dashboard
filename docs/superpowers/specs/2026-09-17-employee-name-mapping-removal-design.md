# Employee Name Mapping Removal Design (UAT and Production)

## Goal and scope

Remove the fixed employee email-prefix-to-display-name mapping from the public UAT and Production frontend source, and from Production Functions source, without changing project ownership, roles, or existing business data. This is Step 2 of the agreed security remediation sequence, not a claim that every employee name has been removed from the repository or Git history.

The UAT and Production repositories are public. At the 2026-09-17 inspection, both `index.html` files contained the four-entry mapping; Production also contained it in `functions/project-dashboard-writes.js` and had a fixed-name PM-list fallback. All six UAT `users` documents had `displayName`; none of the ten Production `users` documents did. Four Production accounts need their existing display names moved to their `users` documents before the mapping can be removed. The Production project corpus contains many owner/deputy values using those names, so deleting the server mapping first could remove legitimate PM edit access.

## Chosen architecture

### Name source and authorization boundary

- `users/{email}.displayName` is the canonical display label for an authorized account. Preserve the existing user-document ID, role, flags, and all other fields.
- The frontend reads labels only after successful authentication and dashboard access initialization. It must not ship a fixed employee-name dictionary or fixed-name error fallback. Existing Firestore rules continue to deny anonymous user-directory reads and client writes. Display names are presentation and identity-matching data, not independent proof of authorization.
- Frontend name lookup uses a session-scoped directory keyed by normalized email. A nonempty stored `displayName` wins; a missing value uses the existing generic email-prefix formatting. Keep `System` handling. On sign-out or auth-generation change, clear the directory and ignore stale subscription/results so one account does not see another session's cached data.
- UAT's `buildProjectManagerList` must use each account's stored `displayName` (with generic fallback) while keeping its current PM/admin-membership filtering. Production's `fetchDynamicPMList` must use stored labels while keeping its current membership behavior; a directory-read error returns no invented employee list and surfaces a recoverable warning.
- Production Functions' authenticated actor derives its name from the server-read `users` document, with only a generic email-prefix fallback. Remove `LEGACY_DISPLAY_NAME_BY_EMAIL_PREFIX`. Keep server-side role and owner/deputy checks; never trust a client-supplied display name for permission decisions.
- Treat stored `displayName` as untrusted text at every HTML sink: validate it as a bounded, nonempty label for lookup, and escape it in generated markup or render with `textContent`. In particular, cover PM selectors, presence, project-member, and audit labels. Do not use HTML escaping when comparing ownership tokens; compare normalized plain text instead.

### Production data preparation

Before Production code or Functions rollout, update only the `displayName` field on the four matching Production `users` documents. The values must exactly match the currently used owner/deputy labels; do not rename project rows. The migration operator must verify the Firebase project binding and the exact four document IDs and intended labels in a private, non-repository manifest. Redact names/emails from shared command output and logs; use synthetic names in new committed test fixtures and no real names/emails in the design/plan.

For each document, read its current data and update time, assert that the expected role and absence of `displayName` still hold, then update only `displayName` with an update-time precondition. Abort rather than overwrite if any assertion or precondition fails. Read back all four documents and compare field values and unchanged roles/flags. UAT needs no data migration. The migration must have a reviewed dry-run output with counts and redacted identifiers before live write.

## Release sequence and gates

1. In isolated branches/worktrees, implement and test UAT and Production source changes. Keep existing dirty Production checkout untouched. Open separate PRs with source-level and test evidence; a PR or merge is not a deployment.
2. Merge UAT first. Wait for GitHub Pages to publish the exact merged commit, inspect the public HTML asset, and sign in with an authorized UAT account to verify its own name, PM list, project-owner labels, and an approved test edit. Check sign-out/re-login for stale names. Stop if behavior regresses.
3. Re-read Production `users` and representative owner/deputy records, confirm the binding and the four exact targets, perform the guarded data preparation, and verify it. This is a separate live Production write gate even though this design was approved.
4. Only after Production data verification, merge the Production PR. Verify the public Pages asset is built from the merge commit and no longer includes either fixed mapping or fixed-name PM fallback.
5. From a clean checkout pinned to that merge commit, deploy only the seven Production Functions exported from `project-dashboard-writes.js`: `saveDashboardProject`, `deleteDashboardProject`, `setDashboardProjectAttention`, `setDashboardWeekRelease`, `saveDashboardWeekFields`, `createDashboardWeek`, and `saveDashboardGanttTemplateSettings`. Verify deployed revision/project binding and live callable behavior separately; do not infer backend deployment from a merged PR or Pages build.
6. Complete an authorized Production sign-in/read check and an approved, low-risk PM edit/readback check. If no safe business record is authorized for editing, report the write path as unverified rather than modifying one silently.

Do not advance to the next gate when the preceding environment, source revision, data check, or runtime check is uncertain. Production deployment must not target UAT, and UAT verification must not be reported as Production evidence.

## Error handling and rollback

- If UAT fails, restore the previous frontend revision through a normal reviewed revert and confirm Pages has actually rebuilt. Production remains unchanged.
- If Production data preparation fails before code release, stop; restore only any field actually added, using a new update-time precondition and a saved redacted before-state. Never overwrite roles, flags, or unrelated fields.
- If the Production Pages release fails, revert the frontend change and verify the live asset. The added `displayName` fields can remain because they do not remove access or alter project data.
- If Functions fail, redeploy the last known-good Functions revision from a clean, verified checkout; keep the new `displayName` fields so both old and new revisions can resolve existing owners. Verify the deployed revision and PM permission behavior after rollback.
- If a user lacks `displayName`, the generic fallback must not grant ownership of a differently named project. Log only a non-PII diagnostic. Do not restore the hardcoded name map as a fallback.

## Verification and acceptance

- Add failing tests first for stored-label precedence, generic fallback, `System`, PM-list membership parity, directory failure, auth-session cache invalidation, HTML-injection-safe rendering, and server-side ownership parity using synthetic accounts and names.
- Remove tests that assert real legacy aliases; replace them with synthetic fixtures proving a stored name authorizes only the matching owner/deputy and a similar generic prefix does not.
- Run focused frontend/Functions tests, the repository suite, relevant Firestore emulator tests, a source scan for the four legacy prefix/name tuples and fixed-name fallback, and `git diff --check` in each repository. The source scan must inspect tracked source and produced public assets, not merely unit-test output.
- For UAT and Production independently, record source commit, PR/merge state, Pages asset-to-commit proof, backend deployment revision where applicable, and live read/write verification. Report any unperformed check explicitly.
- Acceptance requires no fixed employee lookup in current public frontend/Production Functions source, unchanged roles/project data, preserved existing project-edit authority for the four affected Production accounts, no new anonymous user-directory access, and no unapproved Production business-data mutation.

## Git history and residual exposure

Do not rewrite or force-push Git history in this step. Old commits, clones, forks, and caches can retain the mapping even after current source and Pages assets are cleaned. Inventory remaining employee names in fixtures/docs separately; this design does not promise complete historical erasure. Revisit history rewrite only if the data owner identifies a legal/privacy obligation or material exposure that warrants its collaboration, PR, and clone-disruption costs. Any later rewrite needs its own approval and coordinated plan.

## Approval boundary

This document approves the architecture only. It does not itself authorize the four live Production document writes, PR merges, Firebase deployments, history rewrite, or production business-record edits. The implementation plan must make those gates explicit and preserve separate UAT and Production evidence.
