# Production promotion: User Permissions / `week.manage`

Release runbook for promoting the UAT-validated User Permissions feature to Production
(`project-manager-dashboar-a067f`). **This document performs nothing.** Every stage below is a future, separately
authorized action; nothing here has been deployed, granted, published or created.

Rule for every stage: **failure → STOP → roll back to the last verified compatible state** (see *Rollback state
machine*). There is no automatic recovery; each step advances only on recorded evidence.

## Scope

| Function | Live Production (2026-10-03) | Release action | Runtime | Runtime identity |
|---|---|---|---|---|
| `setUserPermissionOverrides` | not deployed | **create** | nodejs22 | `pmdash-user-perms@project-manager-dashboar-a067f.iam.gserviceaccount.com` |
| `createDashboardWeek` | nodejs20, rev `createdashboardweek-00005-yap`, default compute SA, pre-`week.manage` (Admin-only) | **update** | nodejs22 | `pmdash-create-week@project-manager-dashboar-a067f.iam.gserviceaccount.com` |
| `saveDashboardWeekFields` | nodejs20, rev `savedashboardweekfields-00005-yul`, default compute SA, pre-`week.manage` (Admin-only) | **update** | nodejs22 | `pmdash-week-fields@project-manager-dashboar-a067f.iam.gserviceaccount.com` |
| `setDashboardWeekRelease` | nodejs20, Admin/PM release contract | **none** | unchanged | unchanged |

- Every other live Production Function stays on its current Node 20 revision and default compute identity. The
  remaining Node 20 estate (6 Core + 8 Executive) is a separate migration track and must be planned before the
  Node 20 decommission date (2026-10-30).
- The eight Executive Functions stay **PRESERVED** (not deployed, updated, deleted or re-identified).
- `syncProductionWeeksToUat`, `getProductionWeekSyncStatus`, `restoreUatWeeksSnapshot` stay **FORBIDDEN** and absent.
- Expected inventory after release: **18 = 10 MANAGED + 8 PRESERVED**.

Selector (built by the manifest module; never `--only functions`):

```text
functions:setUserPermissionOverrides,functions:createDashboardWeek,functions:saveDashboardWeekFields
```

Being in the Production allowlist does **not** authorize deploying all ten managed Functions; each release names
its reviewed subset.

## Candidate pins and validation contract

Each candidate is validated on its own terms. Record both in the final freeze.

| Candidate | Pin (to be confirmed at freeze) | Required evidence |
|---|---|---|
| `main` promotion (PR #36) | head SHA of PR #36 at freeze; base `main` | GitHub CI **5/5 success at that exact SHA** (`root-tests`, `firestore-rules`, `pdf-tests`, `sync-boundary`, `hosting-builds`), plus the local checks below reproduced at the pin under Node 22: `npm run test:all`, `cd functions && npm test`, `npm run test:rules`, `node scripts/build-hosting.mjs --env prod`, `npm run verify:sync-boundary`, `git diff --check`. |
| `production-pages` port (PR #37) | head SHA of PR #37 at freeze; base `production-pages` @ `932c6e2bda17acad9ffc8fc0153421dcd93410dd` unless re-pinned | **No GitHub CI workflow exists on `production-pages`; none is expected unless one is added.** Accepted only on **reproducible local evidence at the pinned SHA**: `npm run test:all`, `npm run test:rules`, `git diff --check`, Production binding and asset-closure verification (only `project-manager-dashboar-a067f` and the Production PDF endpoint; no UAT project, endpoint or profile code), and the focused guard tests (`tests/manage-weeks-visibility.test.mjs`, `tests/create-week-error-handling.test.mjs`, `tests/user-permissions-ui.test.mjs`). Reviewers must explicitly accept this evidence before release. |

Do not describe PR #37 as "CI PASS". The freeze must state that PR #37 is accepted on reproducible local evidence,
not GitHub CI.

## Production GO prerequisites (unresolved — do not start the release until each is closed)

1. Decision or remediation for the HIGH dependency advisory (`@grpc/grpc-js`, see *Dependency note*).
2. Cleanup of the UAT manual grant on `uat-e2e-20260906-astra-other@example.com` through the audited callable.
3. Authorization to create the three Production runtime service accounts.
4. Authorization to grant each of them exactly `roles/datastore.user`.
5. A fresh Production before-snapshot (Stage 0).
6. Final pinned SHAs for the `main` promotion candidate and the `production-pages` candidate.
7. A Production release window (see *Node 20 rollback viability*).
8. The final Control Plane freeze.
9. A fresh confirmation that Vercel project `nextjs-boilerplate` remains disconnected from this repository.
10. The authenticated acceptance path (A or B, see Stage 9) decided before the release starts.

## Node 20 rollback viability

The recorded rollback for `createDashboardWeek` and `saveDashboardWeekFields` redeploys their reviewed pre-release
source, which runs on **Node 20**.

- That rollback is valid **only while Google Cloud still allows deploying the `nodejs20` runtime**
  (decommission for deploys: 2026-10-30). The release window must fall inside the period when that path is
  available, with margin for a rollback after the soak starts.
- Immediately before Stage 1, verify that Node 20 deployment is still supported for this project and region.
- A historical source archive is **not** an executable rollback by itself. If Node 20 redeploy is no longer
  supported, the existing Node 20 archive is **not** a sufficient rollback plan, and the release must **HOLD** until
  an equivalent reviewed Node 22 rollback artifact or strategy exists (the pre-release Admin-only authorization
  contract on Node 22, reviewed and tested).

## Release sequence

Every command names `--project project-manager-dashboar-a067f` explicitly. Each stage ends with a recorded
verification; a failed verification triggers the matching *Partial-failure* path.

### Stage 0 — Freeze and before-snapshot (read-only)
Functions inventory (name, runtime, revision, update time, runtime SA, state);
`assertLiveFunctionInventory(manifest, 'prod', live)` → 9 managed + 8 preserved + 0 unexpected; rules release;
Hosting live version; `production-pages` head; IAM policy etag; `userPermissions` / `userPermissionAudit` counts
(expected 0 / 0). A missing permission document resolves to the role default, so no data migration is required.

### Stage 1 — Runtime identities and least-privilege IAM
None of the three identities exists today. For each of `pmdash-user-perms`, `pmdash-create-week`, `pmdash-week-fields`:

```bash
gcloud iam service-accounts create pmdash-user-perms --project=project-manager-dashboar-a067f --display-name="PM Dashboard User Permissions"
```

```bash
gcloud projects add-iam-policy-binding project-manager-dashboar-a067f --member="serviceAccount:pmdash-user-perms@project-manager-dashboar-a067f.iam.gserviceaccount.com" --role="roles/datastore.user" --condition=None
```

(repeat for `pmdash-create-week` / `pmdash-week-fields`). Only `roles/datastore.user`; never Owner, Editor,
Firebase Admin, Project IAM Admin or Service Account Admin; zero user-managed keys. Verify the project IAM diff is
exactly three added bindings. Record whether the deploy principal's `iam.serviceAccounts.actAs` on the three
identities is inherited (project Owner) or granted narrowly per service account.

### Stage 2 — Deploy `setUserPermissionOverrides` only
`buildFunctionsOnlyFlag(manifest, 'prod', [the three names])` must return the selector above. Then:

```bash
npx firebase deploy --only functions:setUserPermissionOverrides --project project-manager-dashboar-a067f --non-interactive
```

Verify: ACTIVE, GEN_2, `us-central1`, `nodejs22`, runtime SA `pmdash-user-perms@…`; Cloud Run service
`setuserpermissionoverrides` has `allUsers → roles/run.invoker`; an unauthenticated POST returns HTTP 401
`unauthenticated` (application layer), never a platform 403; `userPermissions` / `userPermissionAudit` unchanged.
**Do not create any permission grant at this stage.**

### Stage 3 — Deploy exactly the two week Functions

```bash
npx firebase deploy --only functions:createDashboardWeek,functions:saveDashboardWeekFields --project project-manager-dashboar-a067f --non-interactive
```

Verify: both ACTIVE, GEN_2, `nodejs22`, runtime SAs `pmdash-create-week@…` / `pmdash-week-fields@…`, existing
`allUsers` invoker unchanged, unauthenticated probes return 401; deployed source archives equal the pinned SHA;
every non-selected Function (including `setDashboardWeekRelease` and all Executive) has an unchanged revision,
update time, runtime and runtime SA. From this point the backend honors stored `week.manage` grants.

### Stage 4 — Deploy Production rules only
`firebase.json` → `firestore.rules`; never `firestore.uat.rules`.

```bash
npx firebase deploy --only firestore:rules --project project-manager-dashboar-a067f --non-interactive
```

Verify the live ruleset is byte-identical to `firestore.rules` at the pin and `/weeks` reads are unchanged.

### Stage 5 — Deploy Production Firebase Hosting (pinned script)

```bash
npm run deploy:hosting:prod:dry
```

```bash
npm run deploy:hosting:prod
```

Verify `env-config.js` is the Production profile/project and `js/user-permissions-admin.mjs` /
`js/permission-registry.mjs` match the pin.

### Stage 6 — STOP POINT before `production-pages`
An API-level authenticated check may be performed here if Path A is authorized (Stage 9), but it does **not**
replace post-Pages served-artifact verification. Before Stage 7 the operator must reconfirm and record:

- the exact PR #37 head SHA equals the pinned SHA;
- the PR #37 base is `production-pages` at `932c6e2bda17acad9ffc8fc0153421dcd93410dd` (or the re-pinned base);
- `git diff` of PR #37 against that base shows no unexpected change;
- Production Functions, rules and Firebase Hosting from Stages 2–5 are verified healthy;
- the authenticated acceptance decision (Path A or B) is in place;
- the rollback reference `932c6e2bda17acad9ffc8fc0153421dcd93410dd` is still the `production-pages` head and valid.

Any mismatch → STOP.

### Stage 7 — `production-pages` release (Production mutation)
**Merging PR #37 into `production-pages` is a Production publishing action, not source integration**: GitHub
Pages publishes the Production surface `https://augusliang23-web.github.io/pm-dashboard/` from that branch. It is
performed only after Stage 6 is fully green.

### Stage 8 — Served-artifact verification
Verify the GitHub Pages build completed and that the served `index.html`, `js/permission-registry.mjs`,
`js/user-permissions-admin.mjs` and `sync-core.js` equal the merged Pages SHA, bound only to the Production project
and PDF endpoint.

### Stage 9 — Authenticated acceptance (required)
The release cannot be declared successful without an authenticated acceptance decision. Authorization to release
does **not** imply authorization to create Production test identities or data; these are separate decisions.

- **Path A — explicit temporary Production E2E authorization.** Create bounded temporary Production Admin and
  delegate identities; verify Admin grant, delegated Create Week / Save Weekly Summary on one uniquely named
  temporary week, Admin-only and security boundaries, reset, and post-reset denial; then clean up the temporary
  Auth users, `users` documents, permission document and temporary week. **Retain all audit records.**
- **Path B — no temporary Production write authorization.** Do not silently skip validation or declare full PASS.
  Perform the strongest authorized read-only / existing-user smoke, record exactly which write-path evidence is
  missing, and have Control Plane explicitly decide whether that evidence is sufficient or the release stays HOLD.

If the authenticated check needs the Pages UI, it runs after Stage 8.

### Stage 10 — After-snapshot
18 Functions = 10 MANAGED + 8 PRESERVED, 0 unexpected; the three UAT-only sync Functions absent; non-selected
Functions unchanged; rules, Hosting and Pages at the pinned versions; IAM diff exactly the Stage 1 bindings.

### Stage 11 — Soak
Start the approved Production soak only after Stages 0–10 are recorded as passing.

## Rollback state machine

Stored `week.manage` grants are **not** inert while an upgraded week Function is live: Stage 3 Functions honor them
server-side. The new UI only mirrors that server decision (it shows controls the server would accept) and cannot
grant access by itself. Grants become inert only once no deployed Function honors them. Roll back in this order;
each step requires recorded evidence before the next:

1. **STOP** all further release steps immediately.
2. **Preserve evidence**: Function revisions, live ruleset, Hosting version, `production-pages` SHA, IAM state, and
   `userPermissions` / `userPermissionAudit` state.
3. **Keep `setUserPermissionOverrides` deployed** while any deployed week Function still honors delegated
   `week.manage`. It is the only audited way to reset grants.
4. **Reset grants** created during the release (temporary/test grants, and any other grant that should not survive
   rollback) through the audited callable with `null`; verify the effective permissions returned to role defaults;
   retain `userPermissionAudit`.
5. **Restore both week Functions** — `createDashboardWeek` and `saveDashboardWeekFields` — to the reviewed
   pre-release implementation, runtime and identity (see *Rollback references* and *Node 20 rollback viability*).
6. **Verify** the restored week Functions enforce the prior Admin-only authorization contract (e.g. a non-Admin is
   denied; Admin create/save still works) before proceeding.
7. **Roll back the UI surfaces and rules as far as the release progressed**, UI first: `production-pages` (revert
   the release merge to `932c6e2…`), then Firebase Hosting (prior version), then Firestore rules (prior ruleset).
   Rolling back UI before rules avoids a live UI that depends on rules that are no longer deployed; every
   intermediate state fails closed (the new UI treats a denied permission read as role defaults).
8. **Only after** grants are reset, both week Functions are restored (or were never upgraded, as in a failure
   before Stage 3) and prior authorization is verified may `setUserPermissionOverrides` be deleted, and only if
   rollback requires removing the feature completely.
9. **Only after** no deployed Function uses the new runtime identities may the three service accounts and their
   `roles/datastore.user` bindings be removed.
10. **Never delete `userPermissionAudit`** as normal rollback.

**Rejected sequence:** deleting `setUserPermissionOverrides` while upgraded week Functions remain live. That would
leave stored grants honored with no audited way to reset them.

## Partial-failure paths

All paths stop immediately and do not advance to "make state symmetrical".

- **Failure after Stage 2, before Stage 3** — no delegated behavior is live through week Functions. Verify no
  unintended permission records exist. If none exist, the callable may be removed as rollback. If audited grants
  exist, reset them first, then remove the callable. Preserve audit.
- **Failure after only one week Function updated** — stop immediately; do **not** deploy the other to finish the
  stage. Keep the permission callable available, reset any temporary delegated grants, restore the updated week
  Function, verify both week Functions are back on the prior contract, then continue the broader rollback if needed.
- **Failure after both week Functions, before rules / Hosting / Pages** — stop; reset temporary grants; restore both
  week Functions first; verify prior authorization; remove the permission callable only after those steps.
- **Failure after rules (Stage 4) or Firebase Hosting (Stage 5)** — stop; reset temporary grants; restore both week
  Functions and verify; roll back Firebase Hosting to the prior version, then the rules to the prior ruleset; remove
  the callable only if the feature is being removed. The old Hosting UI against the restored Admin-only backend is
  the pre-release state.
- **Failure after `production-pages` publish (Stage 7 onwards)** — rollback may require reverting the
  `production-pages` release merge **in addition to** Firebase Hosting, rules and Functions. Order: reset grants →
  restore and verify both week Functions → revert `production-pages` → roll back Firebase Hosting → roll back
  rules → optionally remove the callable → remove identities last.

## Rollback references (recorded 2026-10-03)

| Surface | Reference |
|---|---|
| `setUserPermissionOverrides` | New Function. Delete it only at state-machine step 8 (`npx firebase functions:delete setUserPermissionOverrides --region us-central1 --project project-manager-dashboar-a067f`). Stored permission documents are inert only once no deployed Function honors them. |
| `createDashboardWeek` | Prior revision `createdashboardweek-00005-yap`; source `gs://gcf-v2-sources-842441149281-us-central1/createDashboardWeek/function-source.zip` generation `1789829964702697` (= `functions/` at `bab7357`, also `production-pages`). Redeploy from that reviewed source (restores Node 20 + default compute SA) **only while Node 20 deploys are supported**; otherwise see *Node 20 rollback viability*. |
| `saveDashboardWeekFields` | Prior revision `savedashboardweekfields-00005-yul`; source generation `1789829963699468` (same `bab7357` source), same Node 20 condition. |
| Runtime identities / IAM | Remove the three `roles/datastore.user` bindings and the three service accounts only at state-machine step 9. |
| Invoker | Standard `allUsers` binding; no invoker change is part of this release. |
| Firestore rules | Prior ruleset `7ed64612-dc1c-4856-baf1-f627972046b6` (= `firestore.rules` at `0719238`). |
| Firebase Hosting | Prior live version `d8b102f996a1366b` ("prod d345008"); earlier `e954f2445df3fa42` ("prod 3c4f35d"). |
| `production-pages` | Prior head `932c6e2bda17acad9ffc8fc0153421dcd93410dd`; rollback = revert the release merge (a Production publishing action). |
| Permission data | Reset overrides through `setUserPermissionOverrides` (`null`); **never delete `userPermissionAudit`** as normal rollback. |

## Invoker fallback

If Stage 2 fails specifically because the `allUsers` invoker binding is refused, **stop the release** and
re-evaluate. Do not apply UAT's `--no-invoker-iam-check` workaround in Production without a new security review.

## Dependency note

`npm audit --omit=dev` (functions, at `606fe7e`): 1 high, 10 moderate. Still an open GO prerequisite.

- **High — `@grpc/grpc-js@1.14.4`** (GHSA-m9gg-hp2v-232j, `getAuthContext` may report unauthorized peer certificates
  as authorized; affects `>=1.14.0 <1.14.5`). Transitive: `firebase-admin@13.10.0 → @google-cloud/firestore@7.11.6 →
  google-gax@4.6.1 → @grpc/grpc-js`. The Functions use gRPC only as a Firestore client; no dependency outside
  grpc-js calls `getAuthContext` and nothing runs a gRPC server. Fixed in `1.14.5`, inside google-gax's
  `^1.10.9` range (lockfile-only). Proposed classification: **ACCEPT_WITH_RATIONALE_PENDING_SEPARATE_SECURITY_GATE**;
  remediate in a separate lockfile-only dependency PR, not in this release, unless Control Plane decides otherwise.
- **Moderate:** `uuid`/`teeny-request`/`retry-request`/`google-gax`/`@google-cloud/{firestore,storage}` via
  `firebase-admin` (fix requires `firebase-admin@14`, a major upgrade → separate gate); `qs`/`express` via
  `firebase-functions` (non-major fix available → same separate dependency PR).
