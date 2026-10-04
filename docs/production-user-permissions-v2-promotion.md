# Production promotion: User Permissions V2

Release runbook for promoting the UAT-validated **User Permissions V2** feature (PR #39) to Production
(`project-manager-dashboar-a067f`). **This document performs nothing.** Every stage below is a future, separately
authorized action; nothing here has been deployed, granted, created, merged or published.

This runbook **supersedes PR #36** (see *PR #36 disposition*). The machine-readable plan lives in
`config/deployment-manifest.json` under `releases.userPermissionsV2` and is pinned by
`tests/production-promotion-v2.test.mjs`.

Rule for every stage: **failure → STOP → roll back to the last verified compatible state** (see *Rollback state
machine*). There is no automatic recovery; each step advances only on recorded evidence.

## Source and live baseline

| Item | Value |
|---|---|
| Canonical source | `main` @ `1c2ec79a4b92b3dbcc7670d95ec31b3bba021e32` (merge of PR #39). If `main` moves before the freeze, re-baseline. |
| Live Production Functions (2026-10-04) | **17** = 9 MANAGED + 8 PRESERVED Executive; all `nodejs20`, Gen 2, `us-central1`, default compute runtime identity |
| `setUserPermissionOverrides` | **absent** in Production |
| Live ruleset | `7ed64612-dc1c-4856-baf1-f627972046b6` (predates `userPermissions` / `userPermissionAudit`) |
| Live Firebase Hosting | release `1790984982984000`, version `d8b102f996a1366b`, message `prod d345008` |
| `production-pages` | `932c6e2bda17acad9ffc8fc0153421dcd93410dd` |
| Project IAM etag | `BwZcleH3jJo=`; no `pmdash-*` service accounts exist |

## Scope: exactly eight Functions

| Function | Live Production | Release action | Target runtime | Runtime identity (all new in Production) |
|---|---|---|---|---|
| `setUserPermissionOverrides` | not deployed | **create** | nodejs22 | `pmdash-user-perms@project-manager-dashboar-a067f.iam.gserviceaccount.com` |
| `createDashboardWeek` | nodejs20, `createdashboardweek-00005-yap`, default compute SA | **update** | nodejs22 | `pmdash-create-week@project-manager-dashboar-a067f.iam.gserviceaccount.com` |
| `saveDashboardWeekFields` | nodejs20, `savedashboardweekfields-00005-yul`, default compute SA | **update** | nodejs22 | `pmdash-week-fields@project-manager-dashboar-a067f.iam.gserviceaccount.com` |
| `saveDashboardProject` | nodejs20, `savedashboardproject-00007-hit`, default compute SA | **update** | nodejs22 | `pmdash-save-project@project-manager-dashboar-a067f.iam.gserviceaccount.com` |
| `deleteDashboardProject` | nodejs20, `deletedashboardproject-00005-rix`, default compute SA | **update** | nodejs22 | `pmdash-delete-project@project-manager-dashboar-a067f.iam.gserviceaccount.com` |
| `saveDashboardGanttTemplateSettings` | nodejs20, `savedashboardgantttemplatesettings-00004-fix`, default compute SA | **update** | nodejs22 | `pmdash-gantt-template@project-manager-dashboar-a067f.iam.gserviceaccount.com` |
| `saveDashboardGanttWindowSettings` | nodejs20, `savedashboardganttwindowsettings-00002-pir`, default compute SA | **update** | nodejs22 | `pmdash-gantt-window@project-manager-dashboar-a067f.iam.gserviceaccount.com` |
| `setDashboardWeekRelease` | nodejs20, `setdashboardweekrelease-00005-qey`, default compute SA | **update** | nodejs22 | `pmdash-week-release@project-manager-dashboar-a067f.iam.gserviceaccount.com` |

`FINAL_PRODUCTION_FUNCTION_SCOPE = 8`

Seven exist and are updated; `setUserPermissionOverrides` is new. Why each is required: every handler above now
resolves the actor's effective capability (`week.manage`, `week.release`, `gantt.manage`, `project.manage`) from
`userPermissions/{email}` and declares its own dedicated runtime identity in source, so deploying any of them from
`main` requires its identity to exist.

Selector (built by `buildReleaseFunctionsOnlyFlag(manifest, 'userPermissionsV2')`; never `--only functions`):

```text
functions:setUserPermissionOverrides,functions:createDashboardWeek,functions:saveDashboardWeekFields,functions:saveDashboardProject,functions:deleteDashboardProject,functions:saveDashboardGanttTemplateSettings,functions:saveDashboardGanttWindowSettings,functions:setDashboardWeekRelease
```

Being in the Production allowlist does **not** authorize deploying all ten managed Functions; each release names its
reviewed subset. Explicitly **not selected**: `setDashboardProjectAttention` (identity setting only, no capability
change), `aggregatePresenceSessions` (unchanged), all eight Executive Functions, and the three UAT-only sync Functions.

### Inventory contract

`POST_RELEASE_FUNCTION_INVENTORY = 18 = 10 MANAGED + 8 PRESERVED`

That is the live **17 + 1 new Function** (`setUserPermissionOverrides`), not 17 + 8. The three UAT-only sync Functions
(`syncProductionWeeksToUat`, `getProductionWeekSyncStatus`, `restoreUatWeeksSnapshot`) stay **FORBIDDEN** and absent.
Any other live Function is UNKNOWN and fails closed (`assertPostReleaseInventory`).

### Preserved Executive Functions

These eight must remain live and untouched by this release. They are never deployed, updated, deleted,
re-identified, re-runtimed or re-invoked:

1. `addExecutiveMilestoneUpdate`
2. `createExecutiveMilestoneChangeRequest`
3. `withdrawExecutiveMilestoneChangeRequest`
4. `decideExecutiveMilestoneChangeRequest`
5. `applyDirectExecutiveMilestoneChange`
6. `initializeExecutiveMilestoneLiveTimeline`
7. `saveExecutiveMilestoneTimelineConfig`
8. `setExecutiveRagOverride`

Validation: capture `{runtime, revision, serviceAccount, invoker, updateTime}` for every Function in Stage 0 and
compare after each Function stage with `assertPreservedFunctionsUnchanged` and `assertNonSelectedUnchanged`. Any
difference **fails the runbook** (STOP).

## Node 22 contract

- Current Production runtime: **nodejs20** for all 17 Functions. Target runtime for the eight release Functions:
  **nodejs22** (`functions/package.json` engines `22`; deploying from `main` moves them).
- The patched `@grpc/grpc-js` (1.14.5, PR #38) is inherited from `main`'s lockfile.
- **Do not broaden the release to migrate other Node 20 Functions.** The eight Executive Functions,
  `aggregatePresenceSessions` and `setDashboardProjectAttention` stay on Node 20 (and their older grpc-js) until
  separate migration gates. Node 20 deploys are blocked after **2026-10-30**; that migration track must be planned
  before then.

## Candidates and validation contract

| Candidate | Pin (confirm at freeze) | Required evidence |
|---|---|---|
| This PR (`main` promotion) | head SHA of this PR at freeze; base `main` @ `1c2ec79…` | GitHub CI **5/5 success at that exact SHA** (`root-tests`, `firestore-rules`, `pdf-tests`, `sync-boundary`, `hosting-builds`) plus local: `npm run test:all`, `cd functions && npm test`, `npm run test:rules`, `node scripts/build-hosting.mjs --env prod` and `--env uat`, `npm run verify:sync-boundary`, `git diff --check` (Node 22). |
| PR #40 (`production-pages`) | head SHA at freeze (`83787c81…` when this was written); base `production-pages` @ `932c6e2…` | **No GitHub CI exists on `production-pages`.** Accepted only on reproducible local evidence at the pinned SHA (570 tests, rules 10/10, binding audit, asset closure). Never describe it as "CI PASS". |

## Production GO prerequisites (unresolved — do not start until each is closed)

1. Independent Control Plane review of this PR and PR #40.
2. Authorization to create the eight Production runtime service accounts.
3. Authorization to grant each exactly `roles/datastore.user`.
4. A fresh Production before-snapshot (Stage 0) matching *Source and live baseline*.
5. Final pinned SHAs for this PR and PR #40.
6. A release window inside the Node 20 deploy-support period (see *Node 20 rollback viability*).
7. The authenticated acceptance path (A or B, Stage 11) decided before the release starts.
8. A fresh confirmation that Vercel project `nextjs-boilerplate` remains disconnected from this repository.

## Runtime identity plan (documentation only — nothing is created here)

Eight dedicated identities, all new in Production, one per release Function, as in the scope table:
`pmdash-user-perms`, `pmdash-create-week`, `pmdash-week-fields`, `pmdash-save-project`, `pmdash-delete-project`,
`pmdash-gantt-template`, `pmdash-gantt-window`, `pmdash-week-release`.

- **Project privilege: `roles/datastore.user` only.** Code analysis of `functions/project-dashboard-writes.js` and
  `functions/user-permissions.js`: the only Google API used is Firestore through the Admin SDK (reads, writes and
  transactions); there is no Auth Admin, Storage, Pub/Sub or other call. `roles/datastore.user` is sufficient (the
  same grant ran the UAT E2E). If review finds any target needs more than Firestore access: **HOLD**.
- **Never** Owner, Editor, Firebase Admin, Project IAM Admin or Service Account Admin. **Zero user-managed keys.**
- The deploy principal needs `iam.serviceAccounts.actAs` on each identity (inherited for project Owner; record which).
- Not part of this release: the default compute account's `roles/editor`, which the unchanged Functions still use.

## Release sequence

Every command names `--project project-manager-dashboar-a067f` explicitly. Each stage ends with a recorded
verification; a failed verification triggers the matching *Partial-failure* path.

### Stage 0 — Freeze and before-snapshot (read-only)
Functions inventory (name, runtime, revision, update time, runtime SA, invoker, state) for all 17;
`assertLiveFunctionInventory(manifest, 'prod', live)` → 9 managed + 8 preserved + 0 unexpected; ruleset ID;
Hosting live release/version; `production-pages` head; project IAM policy and etag; service-account list; the
`userPermissions` / `userPermissionAudit` counts (expected 0 / 0). Verify `main` is still `1c2ec79…`; if it moved, STOP.

### Stage 1 — Runtime identities and least-privilege IAM
Create the eight service accounts (display name `PM Dashboard <purpose>`), e.g.:

```bash
for sa in pmdash-user-perms pmdash-create-week pmdash-week-fields pmdash-save-project pmdash-delete-project pmdash-gantt-template pmdash-gantt-window pmdash-week-release; do gcloud iam service-accounts create "$sa" --project=project-manager-dashboar-a067f --display-name="PM Dashboard $sa"; done
```

Grant exactly one role to each:

```bash
for sa in pmdash-user-perms pmdash-create-week pmdash-week-fields pmdash-save-project pmdash-delete-project pmdash-gantt-template pmdash-gantt-window pmdash-week-release; do gcloud projects add-iam-policy-binding project-manager-dashboar-a067f --member="serviceAccount:$sa@project-manager-dashboar-a067f.iam.gserviceaccount.com" --role="roles/datastore.user" --condition=None; done
```

Verify the project IAM diff is **exactly eight added `roles/datastore.user` bindings** and nothing else, and that
each account has **zero user-managed keys**. Stop on any other difference.

### Stage 2 — Deploy exactly the eight Functions
`buildReleaseFunctionsOnlyFlag(manifest, 'userPermissionsV2')` must return the selector above. Then:

```bash
npx firebase deploy --only functions:setUserPermissionOverrides,functions:createDashboardWeek,functions:saveDashboardWeekFields,functions:saveDashboardProject,functions:deleteDashboardProject,functions:saveDashboardGanttTemplateSettings,functions:saveDashboardGanttWindowSettings,functions:setDashboardWeekRelease --project project-manager-dashboar-a067f --non-interactive
```

If the deploy fails midway, **do not retry or "finish" the set**; go to *Partial-failure paths*.

### Stage 3 — Verify runtime, identities and invokers
For each of the eight: ACTIVE, GEN_2, `us-central1`, `nodejs22`, the exact runtime identity above, memory/timeout/
concurrency unchanged for the seven existing ones. Invoker contract below. Unauthenticated POST to each → HTTP 401
`unauthenticated` from the application layer (never a platform 403). Deployed source equals the pinned SHA.
`userPermissions` / `userPermissionAudit` unchanged (0 / 0). **Do not create any permission grant at this stage.**

### Stage 4 — Verify the eight Executive Functions and every non-selected Function are unchanged
`assertPreservedFunctionsUnchanged` and `assertNonSelectedUnchanged` against the Stage 0 snapshot: revision,
runtime, service account, invoker and update time identical for the eight Executive Functions,
`aggregatePresenceSessions` and `setDashboardProjectAttention`. Any difference → STOP.

### Stage 5 — Deploy Production rules only
`firebase.json` → `firestore.rules`; **never** `firestore.uat.rules` or the shared-backend rules.

```bash
npx firebase deploy --only firestore:rules --project project-manager-dashboar-a067f --non-interactive
```

Production rules deployment is **required** because the live ruleset predates the permission feature. Expected delta
from `7ed64612…` to `firestore.rules` at the pin is exactly:

- the `normalizeDashboardRole` helper and `normalizedDashboardRole()` (the Admin check uses the normalized role);
- `match /userPermissions/{email}`: read by the account itself or Admin; client writes denied;
- `match /userPermissionAudit/{auditId}`: Admin read; client writes denied.

Preserved: broad `/weeks` read (`hasDashboardAccess()`), the exact raw-role `presenceSessions` contract, Production
role/perspective semantics. Verify the live ruleset equals `firestore.rules` at the pin and `/weeks` reads are unchanged.

### Stage 6 — Deploy Production Firebase Hosting (pinned script)
Production Firebase Hosting deployment is **required** (the live build has none of the permission code).

```bash
npm run deploy:hosting:prod:dry
```

```bash
npm run deploy:hosting:prod
```

Arrives with it: the User Permissions ON/OFF page with automatic save, the selector race fix, capability-driven
Manage Weeks, the PM Release toggle, Gantt delegation, Add / Delete Projects, and "Saved. The permission change
applies immediately." Verify `env-config.js` is the Production profile and project, that **no UAT project ID or UAT
PDF endpoint** appears in any served file, and that `js/permission-registry.mjs` / `js/user-permissions-admin.mjs`
match the pin.

### Stage 7 — Authenticated Production smoke (backend + Firebase Hosting)
See Stage 11 for the acceptance paths. Backend/Hosting smoke must pass before Stage 8.

### Stage 8 — STOP POINT before `production-pages` (PR #40)
**DO NOT merge PR #40 until all four are recorded PASS:** the Functions stage (2–4), the rules stage (5), the Firebase
Hosting stage (6), and the authenticated Production backend/Hosting smoke (7). Also reconfirm: PR #40 head equals the
pinned SHA, its base is `production-pages` @ `932c6e2…` (or the re-pinned base), and the rollback reference is still
the `production-pages` head. Any mismatch → STOP.

### Stage 9 — `production-pages` release (PR #40, Production publishing action)
Merging PR #40 publishes `https://augusliang23-web.github.io/pm-dashboard/` from `production-pages`. Performed only
after Stage 8 is fully green. PR #40 is a **downstream, separate release surface**; it is not part of this PR.

### Stage 10 — Served-artifact verification
Verify the Pages build completed and the served `index.html`, `js/permission-registry.mjs`,
`js/user-permissions-admin.mjs` and `sync-core.js` equal the merged Pages SHA, bound only to the Production project
and PDF endpoint.

### Stage 11 — Authenticated acceptance (required)
Authorization to release does **not** imply authorization to create Production test identities or data.

- **Path A — explicit temporary Production E2E authorization.** Bounded temporary Production Admin and PM/delegate
  identities; verify Admin grant and revoke of each capability with same-session ON/OFF/ON proof, a PM Release
  denial/restore, Admin-only boundaries, and post-reset denial, using one uniquely named temporary week; then clean
  up the temporary Auth users, `users` documents, permission documents and the week. **Retain all audit records.**
  Do not initialize or change Executive state.
- **Path B — no temporary Production write authorization.** Do not silently skip validation or declare full PASS:
  perform the strongest authorized read-only / existing-user smoke, record exactly which write-path evidence is
  missing, and have Control Plane explicitly decide whether it suffices or the release stays HOLD.

### Stage 12 — Final inventory verification
`assertPostReleaseInventory(manifest, 'userPermissionsV2', live)` → **18 = 10 MANAGED + 8 PRESERVED**, 0 unexpected;
UAT-only sync Functions absent; non-selected Functions unchanged; ruleset, Hosting and Pages at the pinned versions;
IAM diff exactly the eight Stage 1 bindings.

### Stage 13 — Soak
Start the approved Production soak only after Stages 0–12 are recorded as passing.

## Invoker strategy

Production precedent for callables is public Cloud Run invocation (`allUsers → roles/run.invoker`) with Firebase
callable authentication enforced in the application. The seven existing Functions already have the `allUsers`
binding, which a redeploy preserves; the new `setUserPermissionOverrides` is expected to receive the same binding
from a normal deploy.

- **Do not assume UAT's organization-policy workaround applies to Production.** UAT's `setUserPermissionOverrides`
  uses a disabled Cloud Run invoker IAM check only because UAT's Domain Restricted Sharing policy blocked `allUsers`.
- If a public invoker binding fails or a service ends up without the expected invocation contract: **STOP.** Do
  **not** disable invoker IAM checks, do not add bindings by hand, and do not copy the UAT workaround without a
  separate Control Plane security review.

## Production data

No `userPermissions` migration is required: the collection is empty, and a missing document means the role default.
**Do not seed Production permissions during the release**, and do not create test override documents outside an
authorized Stage 11 Path A.

## Node 20 rollback viability

Rollback for the seven existing Functions prefers shifting Cloud Run traffic back to the retained prior revision
(Node 20, default compute identity — still present). If a source redeploy is ever needed, it runs on **Node 20**, which
is valid **only while Google Cloud still allows Node 20 deploys (until 2026-10-30)**. Verify before Stage 2 and keep margin
for a rollback after the soak starts. A historical source archive is **not** an executable rollback by itself; if
neither traffic shift nor a Node 20 redeploy is available, the release must **HOLD**.

## Rollback state machine

Stored grants become honored by the seven updated Functions as soon as Stage 2 completes; the UI only mirrors that.
Roll back in this order, with recorded evidence before each step:

1. **STOP** all further release steps.
2. **Preserve evidence:** Function revisions, ruleset, Hosting version, `production-pages` SHA, IAM state, and
   `userPermissions` / `userPermissionAudit` state.
3. **Keep `setUserPermissionOverrides` deployed** while any updated Function still honors overrides; it is the only
   audited way to reset grants.
4. **Reset grants** created during the release through the audited callable (`null`) and verify role defaults;
   retain `userPermissionAudit`.
5. **Restore the seven existing Functions** to their prior revisions (see *Rollback references*).
6. **Verify** the restored Functions enforce the prior contract: Admin-only create/delete project, Gantt and week
   fields; Admin/PM release; non-Admin denied. (Once restored, stored overrides are inert — including a PM's stored
   Release OFF, so a PM can release again exactly as before the release.)
7. **Roll back the UI and rules as far as the release progressed, UI first:** `production-pages` (revert the PR #40 merge
   to `932c6e2…`), then Firebase Hosting (version `d8b102f996a1366b`, release `1790984982984000`), then Firestore rules
   (ruleset `7ed64612-dc1c-4856-baf1-f627972046b6`).
8. **`setUserPermissionOverrides` has no prior revision.** After step 6 it is functionally inert (no restored Function
   reads overrides, and no UI calls it). Either **leave it deployed but unused**, or **delete it** only after steps 4–7,
   if removing the feature completely: `npx firebase functions:delete setUserPermissionOverrides --region us-central1 --project project-manager-dashboar-a067f`.
   Never delete it while an updated Function still honors overrides.
9. Only after no deployed Function uses the eight runtime identities may the accounts and their
   `roles/datastore.user` bindings be removed.
10. **Never delete `userPermissionAudit`** as normal rollback.

**Rejected sequence:** deleting `setUserPermissionOverrides` while updated Functions remain live (grants honored with
no audited way to reset them).

## Partial-failure paths

All paths stop immediately; none advances "to make state symmetrical".

- **Failure during Stage 1 (identities/IAM):** nothing is deployed; remove only identities created so far, with their
  bindings, after recording evidence.
- **Failure during Stage 2 (some Functions updated):** do not deploy the rest. Reset any grants, restore the updated
  existing Functions to their prior revisions, verify the prior contract, then decide whether to remove
  `setUserPermissionOverrides` (step 8).
- **Failure after Stage 3/4 verification:** same as above; rules, Hosting and Pages have not changed.
- **Failure after rules (Stage 5) or Hosting (Stage 6):** reset grants, restore the seven Functions and verify, roll
  back Hosting to the prior version, then rules to the prior ruleset.
- **Failure after PR #40 (Stage 9 onwards):** reset grants → restore and verify the seven Functions → revert PR #40's
  merge on `production-pages` → roll back Hosting → roll back rules → optionally handle `setUserPermissionOverrides` →
  remove identities last.

## Rollback references (recorded 2026-10-04)

| Surface | Reference |
|---|---|
| `setUserPermissionOverrides` | New Function: no prior revision. Inert/delete per state-machine step 8. |
| `createDashboardWeek` | Prior revision `createdashboardweek-00005-yap`; source generation `1789829964702697`. |
| `saveDashboardWeekFields` | Prior revision `savedashboardweekfields-00005-yul`; source generation `1789829963699468`. |
| `saveDashboardProject` | Prior revision `savedashboardproject-00007-hit`; source generation `1789829926382837`. |
| `deleteDashboardProject` | Prior revision `deletedashboardproject-00005-rix`; source generation `1789829964511063`. |
| `saveDashboardGanttTemplateSettings` | Prior revision `savedashboardgantttemplatesettings-00004-fix`; source generation `1789829964661401`. |
| `saveDashboardGanttWindowSettings` | Prior revision `savedashboardganttwindowsettings-00002-pir`; source generation `1789829964615634`. |
| `setDashboardWeekRelease` | Prior revision `setdashboardweekrelease-00005-qey`; source generation `1789829964752030`. |

Prior revisions are retained as Cloud Run revisions. Preferred restore for each existing Function (revision names
as above; for `createDashboardWeek`, for example):

```bash
gcloud run services update-traffic createdashboardweek --to-revisions=createdashboardweek-00005-yap=100 --region=us-central1 --project=project-manager-dashboar-a067f
```

Fallback: redeploy the reviewed pre-release source (`gs://gcf-v2-sources-842441149281-us-central1/<Function>/function-source.zip`
at the generation above), Node 20 only while allowed.

| Surface | Reference |
|---|---|
| Runtime identities / IAM | Remove the eight `roles/datastore.user` bindings and accounts only at step 9. |
| Invoker | Standard `allUsers` binding; no invoker change is part of this release. |
| Firestore rules | Prior ruleset `7ed64612-dc1c-4856-baf1-f627972046b6`. |
| Firebase Hosting | Prior live version `d8b102f996a1366b` (release `1790984982984000`, "prod d345008"). |
| `production-pages` | Prior head `932c6e2bda17acad9ffc8fc0153421dcd93410dd` (revert the PR #40 merge). |
| Permission data | Reset overrides through `setUserPermissionOverrides` (`null`); never delete `userPermissionAudit`. |

## PR #36 disposition

`SUPERSEDED — DO NOT MERGE`. PR #36 is not modified or closed by this PR.

| PR #36 content | Disposition |
|---|---|
| Manifest concept (move `setUserPermissionOverrides` into the Production allowlist) | partly reusable — carried forward here, with the release plan added |
| Old 3-function selector | obsolete (scope is 8) |
| Old IAM scope (3 identities) | obsolete (8 identities) |
| Old runbook | obsolete/incomplete (no rules/Hosting scope of V2 capabilities, no PR #40 gating, no Executive-preservation assertions) |
| Old rollback scope | obsolete (7 existing Functions with retained revisions plus the new callable) |
| Base `606fe7e` | stale (predates PR #38 and PR #39) — unacceptable |

## Downstream dependency: PR #40

PR #40 (`production-pages`, selective V2 port) is a separate release surface and stays OPEN and unmerged by this PR.
**DO NOT merge PR #40 until:** Functions stage PASS, rules stage PASS, Firebase Hosting PASS, and authenticated
Production backend/Hosting smoke PASS.
