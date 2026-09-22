# UAT Phase 1 Security Remediation — Handoff and Rollback

## Scope and changed boundaries

This UAT-only Phase 1 remediation closes the paths where a signed-in browser
could bypass the dashboard's visible editor policy or inject unescaped stored
metadata into the two reviewed HTML renderers.

- Direct browser SDK writes to `weeks/{weekId}` are denied for every client.
  `saveDashboardProject` is the project-mutation path and verifies the token
  plus normalized Admin, owner, or deputy authorization on the server.
  VIP remains read-only and released weeks remain read-only.
- Client audit-log writes are limited to a bounded, self-attributed,
  append-only envelope. Client updates and deletes are denied.
- Presence writes are limited to the caller's email document with immutable
  `ownerUid` and `userKey` after initial establishment; client deletes are
  denied.
- Firestore-provided week selector metadata and presence display names are
  escaped before entering the reviewed `innerHTML` templates.

The approved design is in
[the Phase 1 design](specs/2026-08-18-phase-1-security-remediation-design.md),
and the implementation sequence is recorded in
[the Phase 1 plan](plans/2026-08-18-phase-1-security-remediation.md).

## UAT test evidence known to date

The following automated checks were recorded after the final source change
`d77d8b1`:

- Focused callable, role/UI, selector-XSS, presence-XSS, and PM editor suite:
  **56 passed, 0 failed**.
- Firestore Emulator Rules suite, using the isolated port-8081 test
  configuration: **5 passed, 0 failed**. It includes expected
  `PERMISSION_DENIED` results for direct week create/update/delete attempts by
  the tested Admin, PM-owner, and VIP browser roles.
- Full UAT suite: **398 passed, 0 failed**.

These are local automated source, renderer, callable, and Emulator checks.
They are not an authenticated browser-session test, live Firebase test, or
deployment validation. The detailed record is retained in the ignored
Task 6 report at
`.superpowers/sdd/2026-08-18-phase-1-security-remediation/task-6-report.md`.

## Deployment status and rollback

No deployment, push, remote change, Firebase configuration change, or live
Firebase data write was performed for Phase 1. This branch is a UAT candidate
only and must not be deployed without explicit approval.

If an approved UAT deployment must be rolled back, act only on the UAT branch
`codex/phase1-security-remediation`. Create new revert commits (do **not** use
`git reset`) for the implementation range `d94dc7b` through `d77d8b1`, in
reverse chronological order:

```sh
git revert --no-edit d77d8b1 357edd4 01ab5fd 3e4e646 4a9f0af d94dc7b
```

This deliberately leaves the documentation commit `48120c7` separately
addressable. Do not push the revert commits or deploy the reverted candidate
without explicit approval. Before any separately approved UAT deployment, run:

```sh
npm run test:all
JAVA_HOME=/private/tmp/pm-dashboard-phase1-jdk/jdk-21.0.12+8/Contents/Home npm run test:rules
git diff --check
```

Do not use this document as authority to deploy, to revert Production, or to
merge/copy this UAT work into Production.

## Residual and parked risks

- `presence.usageBuckets` retains dynamic date-based keys. Phase 1 caps the
  map at 256 entries and relies on Firestore's document-size limit, but Rules
  cannot validate every unknown bucket's nested type or shape. Per-bucket
  validation requires a future schema decision (for example, a subcollection
  or fixed-key schema) and migration.
- The Rules Emulator suite executes `firestore.rules`. The checked-in
  `firestore.shared-backend.rules` is covered for the direct-week-write
  boundary by source assertions, not by a separate Emulator target. A future
  shared-backend deployment route needs dedicated Emulator coverage.
- Production remains unremediated. The read-only reconciliation found its
  direct browser week writes, raw week-selector metadata, raw presence badge
  names, and lack of an equivalent server-authorized callable path still
  exposed. See the ignored Task 7 report at
  `.superpowers/sdd/2026-08-18-phase-1-security-remediation/task-7-report.md`.
