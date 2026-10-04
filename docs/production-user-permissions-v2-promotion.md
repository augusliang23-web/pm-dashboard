# Production promotion: User Permissions V2

Release runbook for promoting the UAT-validated **User Permissions V2** feature (PR #39) to Production
(`project-manager-dashboar-a067f`). **This document performs nothing.** Every stage below is a future, separately
authorized action; nothing here has been deployed, granted, created, merged or published.

This runbook **supersedes PR #36** (see *PR #36 disposition*). The machine-readable plan lives in
`config/deployment-manifest.json` under `releases.userPermissionsV2` and is pinned by
`tests/production-promotion-v2.test.mjs`.

Rule for every stage: **failure → STOP → roll back to the last verified compatible state** (see *Rollback classification* and
*Rollback states*). There is no automatic recovery; each step advances only on recorded evidence.

## Source and live baseline

| Item | Value |
|---|---|
| Approved runtime target source | `main` @ `57ef1caad37c186adfe8536b6cb22d6302fdfc21` (includes PR #39 and PR #42). **`PRODUCTION_TARGET_SOURCE = 57ef1caad37c186adfe8536b6cb22d6302fdfc21`.** The Production release intentionally includes PR #42. |
| PR #41 release-plan commits | the head of this PR (confirm at freeze). It differs from the runtime target source only by plan files (`docs/`, `tests/`, `config/deployment-manifest.json`, `scripts/deployment-manifest.mjs`). |
| Execution freeze SHA | **recorded and independently verified before the release starts**, after this PR merges (it will necessarily differ from `57ef1caa…` because plan files changed). Verified against the runtime target source as described in Stage 0; any runtime-relevant change after `57ef1caa…` requires another re-baseline. |
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

## Runtime target includes PR #42

The runtime target source (`57ef1caa…`) is `1c2ec79…` plus PR #42 (`fix: enforce project visibility server-side and tighten User Permissions conflict handling`).
Impact on the approved scope, proven from the diff `1c2ec79… → 57ef1caa…`:

- Under `functions/`, PR #42 changes only `functions/project-dashboard-writes.js` (+19 lines: `effectiveVisibility`,
  `assertVisibilityAuthority`, and two calls inside `buildProjectPatch`) and adds a test. No change to `index.js`,
  `user-permissions.js`, `permission-registry.js`, `package.json` or the lockfile.
- `buildProjectPatch` is called by exactly one Function: `saveDashboardProject`. The other seven target Functions run
  the same logic as at `1c2ec79…`; no additional Function is required. **`FINAL_PRODUCTION_FUNCTION_SCOPE = 8` remains valid.**
- PR #42 changes no Firestore rules; Production rules deployment is still required for User Permissions.

**Target `saveDashboardProject` security contract** (runtime source `functions/project-dashboard-writes.js`, pinned
here, not duplicated; exercised by `functions/test/project-visibility-authority.test.cjs`):

- a non-Admin cannot change project visibility (create must start Active; edit must echo the live visibility;
  refusal reason `visibility-admin-only`);
- `project.manage` remains create/delete only and never grants visibility authority;
- ownership-based editing never grants visibility authority;
- Admin behavior is unchanged.

**Target Firebase Hosting contract (PR #42 frontend):** on a revision conflict a successful reload may say the latest
settings are shown; a **failed** conflict reload must not claim fresh settings, hides the stale detail and requires the
Admin to select the user again.

The live Production rollback baseline is **not** changed by this: it describes the currently live source
(`f4244be…`) and remains authoritative unless live Production itself changes.

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
| This PR (`main` promotion) | head SHA of this PR at freeze; base `main` (runtime target source `57ef1caa…`) | GitHub CI **5/5 success at that exact SHA** (`root-tests`, `firestore-rules`, `pdf-tests`, `sync-boundary`, `hosting-builds`) plus local: `npm run test:all`, `cd functions && npm test`, `npm run test:rules`, `node scripts/build-hosting.mjs --env prod` and `--env uat`, `npm run verify:sync-boundary`, `git diff --check` (Node 22). |
| PR #40 (`production-pages`) | head SHA at freeze (`83787c81…` when this was written); base `production-pages` @ `932c6e2…` | **No GitHub CI exists on `production-pages`.** Accepted only on reproducible local evidence at the pinned SHA (570 tests, rules 10/10, binding audit, asset closure). Never describe it as "CI PASS". |

## Production GO prerequisites (unresolved — do not start until each is closed)

1. Independent Control Plane review of this PR and PR #40.
2. Authorization to create the eight Production runtime service accounts.
3. Authorization to grant each exactly `roles/datastore.user`.
4. A fresh Production before-snapshot (Stage 0) matching *Source and live baseline*.
5. Final pinned SHAs for this PR and PR #40.
6. A release window in which the documented FULL rollback path is still executable (Node 20 deployability — see *Full-rollback executability*).
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
**Execution freeze.** Record the freeze SHA (the commit the release will be run from) and verify it against the
approved runtime target source; do not assume it:

```bash
git diff --name-only 57ef1caad37c186adfe8536b6cb22d6302fdfc21 <freeze-sha>
```

Feed the listed paths to `assertExecutionFreeze`. Only `docs/`, `tests/`, `config/deployment-manifest.json` and
`scripts/deployment-manifest.mjs` may differ (planning/runbook/test files, verified here, not assumed). Any other path
— `functions/`, `firestore.rules`, `index.html`, `js/`, build or env scripts, lockfiles, workflows, or anything unknown —
is runtime-relevant and requires a **re-baseline** before the release can continue.

**Snapshot.** Capture the complete Functions snapshot for all 17 live Functions
(`{runtime, revision, serviceAccount, invoker, updateTime}` per Function; an empty field is an explicit token such as
invoker `none`, never a missing property) and validate it with
`assertSnapshotComplete(manifest, 'userPermissionsV2', before, 'before')`: the exact expected set (9 managed + 8
preserved, `setUserPermissionOverrides` absent), every field present and valid. Also record:
`assertLiveFunctionInventory(manifest, 'prod', live)` → 9 managed + 8 preserved + 0 unexpected; ruleset ID; Hosting
live release/version; `production-pages` head; project IAM policy and etag; service-account list; and the
`userPermissions` / `userPermissionAudit` baseline (expected 0 / 0; capture and verify the baseline immediately
before the release, and again before Stage 2).

**Full-rollback executability.** Record the checks in *Full-rollback executability*. If any fails: **STOP**.

### Stage 1 — Runtime identities and least-privilege IAM
Create the eight service accounts (display name `PM Dashboard <purpose>`). Every block fails immediately on any error:

```bash
set -euo pipefail
for sa in pmdash-user-perms pmdash-create-week pmdash-week-fields pmdash-save-project pmdash-delete-project pmdash-gantt-template pmdash-gantt-window pmdash-week-release; do
  gcloud iam service-accounts create "$sa" --project=project-manager-dashboar-a067f --display-name="PM Dashboard $sa" || { echo "FAILED creating $sa" >&2; exit 1; }
done
```

Grant exactly one role to each:

```bash
set -euo pipefail
for sa in pmdash-user-perms pmdash-create-week pmdash-week-fields pmdash-save-project pmdash-delete-project pmdash-gantt-template pmdash-gantt-window pmdash-week-release; do
  gcloud projects add-iam-policy-binding project-manager-dashboar-a067f --member="serviceAccount:$sa@project-manager-dashboar-a067f.iam.gserviceaccount.com" --role="roles/datastore.user" --condition=None --quiet >/dev/null || { echo "FAILED granting $sa" >&2; exit 1; }
done
```

Verify zero user-managed keys on each account (non-zero fails):

```bash
set -euo pipefail
for sa in pmdash-user-perms pmdash-create-week pmdash-week-fields pmdash-save-project pmdash-delete-project pmdash-gantt-template pmdash-gantt-window pmdash-week-release; do
  keys=$(gcloud iam service-accounts keys list --iam-account="$sa@project-manager-dashboar-a067f.iam.gserviceaccount.com" --managed-by=user --format='value(name)' --project=project-manager-dashboar-a067f | wc -l | tr -d ' ')
  [ "$keys" = "0" ] || { echo "$sa has $keys user-managed keys" >&2; exit 1; }
done
```

Verify the project IAM diff is **exactly eight added `roles/datastore.user` bindings** and nothing else. Stop on any
other difference, or if any command above failed partway (no partial continuation: record what exists and go to
State A).

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
capture the complete after-snapshot (`assertSnapshotComplete(…, 'after')`: exactly 10 managed + 8 preserved, all fields valid), then run `assertSelectedFunctionsDeployed`, `assertPreservedFunctionsUnchanged` and `assertNonSelectedUnchanged` against the Stage 0 snapshot (incomplete evidence fails closed): revision,
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
applies immediately." Verify the served `index.html` contains the PR #42 conflict-reload handling (the message "the latest settings could not be loaded" and the cleared selector), that `env-config.js` is the Production profile and project, that **no UAT project ID or UAT
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
  denial/restore, Admin-only boundaries, and post-reset denial, and that a forged non-Admin project visibility on `saveDashboardProject` is refused (`visibility-admin-only`), using one uniquely named temporary week; then clean
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

## Rollback classification

For the seven existing Gen 2 Functions there are two distinct things. They must never be conflated.

### `TRAFFIC_SHIFT = EMERGENCY_MITIGATION_ONLY`

Shifting Cloud Run traffic to the retained prior revision is **EMERGENCY TRAFFIC MITIGATION**: it may restore request
execution to an earlier revision quickly, and it is allowed for that purpose only. It is **not a rollback**, and it
must not be reported as one. Traffic mitigation alone does **not** prove restoration of:

- the Function service template,
- runtime configuration,
- the runtime service account,
- Function control-plane metadata,
- deployment configuration,
- callable integration / invoker configuration.

A Function whose serving revision was only shifted is still managed by the new deployment's control-plane state and
remains **UNVERIFIED**. A traffic shift is therefore followed by the full rollback below; it never replaces it.

Emergency mitigation (example for `createDashboardWeek`; one service at a time, revision names from the manifest):

```bash
set -euo pipefail
gcloud run services update-traffic createdashboardweek --to-revisions=createdashboardweek-00005-yap=100 --region=us-central1 --project=project-manager-dashboar-a067f
```

### FULL rollback = `PINNED BASELINE SOURCE + CONFIG REDEPLOYMENT`

The authoritative complete rollback of each existing Function is a redeployment of the **pinned baseline source with the
baseline configuration**, followed by read-back verification.

**Pinned baseline (reproduced from live evidence, not assumed).** All seven live source archives are byte-identical
(SHA-256 `0138d5864a6f1da3056a032535efdaef33374b1a09a64d1bcade767e70ed3123`) and their file tree is exactly `functions/`
at commit `f4244beedacb9f6cc40addc533c3e8316e56aa96` (also `fa3234b782948ce35651b29f47a6c3e1e3ffe0d1`). Tree digest
(`sourceTreeDigest`): `e4e00a1d17b7f6ceceaf25288a830c220c2be854ff02295487c4bc951bdfcb11`, computed as
`find . -type f | sort | xargs shasum -a256 | shasum -a256` over the extracted source (no `node_modules`).
Deployed generations in `gs://gcf-v2-sources-842441149281-us-central1/<Function>/function-source.zip`:

| Function | Source generation | Baseline revision |
|---|---|---|
| `createDashboardWeek` | `1789829964702697` | `createdashboardweek-00005-yap` |
| `saveDashboardWeekFields` | `1789829963699468` | `savedashboardweekfields-00005-yul` |
| `saveDashboardProject` | `1789829926382837` | `savedashboardproject-00007-hit` |
| `deleteDashboardProject` | `1789829964511063` | `deletedashboardproject-00005-rix` |
| `saveDashboardGanttTemplateSettings` | `1789829964661401` | `savedashboardgantttemplatesettings-00004-fix` |
| `saveDashboardGanttWindowSettings` | `1789829964615634` | `savedashboardganttwindowsettings-00002-pir` |
| `setDashboardWeekRelease` | `1789829964752030` | `setdashboardweekrelease-00005-qey` |

**Baseline configuration (live, all seven):** runtime `nodejs20` (engine `"20"`), Gen 2, `us-central1`, runtime service
account `842441149281-compute@developer.gserviceaccount.com`, invoker `allUsers → roles/run.invoker`, 256Mi / 1 CPU,
timeout 60s, concurrency 80, max instances 20, ingress `ALLOW_ALL`, default `onCall()` options (no custom identity).

**Procedure.** In a clean worktree checked out at `f4244beedacb9f6cc40addc533c3e8316e56aa96` (a worktree separate from
the release source), with its own lockfile, deploy exactly the seven existing Functions by name:

```bash
set -euo pipefail
git worktree add ../prod-rollback-baseline f4244beedacb9f6cc40addc533c3e8316e56aa96
cd ../prod-rollback-baseline/functions && npm ci
cd .. && npx firebase deploy --only functions:createDashboardWeek,functions:saveDashboardWeekFields,functions:saveDashboardProject,functions:deleteDashboardProject,functions:saveDashboardGanttTemplateSettings,functions:saveDashboardGanttWindowSettings,functions:setDashboardWeekRelease --project project-manager-dashboar-a067f --non-interactive
```

**Read-back verification (required before the rollback counts).** For each of the seven, against the Stage 0 baseline
snapshot (`assertFullRollbackVerified`):

- runtime = `nodejs20`;
- runtime service account = the default compute account;
- invoker = `allUsers` (and Cloud Run IAM check not disabled);
- a **new** live revision is serving 100% of traffic (a redeploy happened — the baseline revision name is not accepted);
- source identity: the deployed source archive's `sourceTreeDigest` equals the pinned digest above;
- expected endpoint behavior: an unauthenticated POST returns HTTP 401 `unauthenticated`, a non-Admin is denied
  project create/delete, Gantt and week-field writes, and Admin/PM release behaves as before.

The eight Executive Functions, `aggregatePresenceSessions` and `setDashboardProjectAttention` must be unchanged
throughout (`assertPreservedFunctionsUnchanged`, `assertNonSelectedUnchanged`).

### Full-rollback executability (execution precondition)

Before Production release begins, record **Node 20 deployability** and the other full-rollback prerequisites:

- Node 20 is still deployable: `gcloud functions runtimes list --region=us-central1 --project=project-manager-dashboar-a067f`
  lists `nodejs20` as deployable (at the time of writing it is `DEPRECATED`, not decommissioned; deploys are blocked
  after **2026-10-30**). If `nodejs20` is no longer deployable: **STOP**. Do **not** fall back to traffic-only
  mitigation and call it a rollback; the release does not start until an equivalent reviewed full-rollback path exists.
- the pinned baseline commit is fetchable and `functions/` at that commit reproduces `sourceTreeDigest`;
- the seven baseline source generations are still downloadable and hash to the pinned archive;
- the rollback deploy principal can deploy the seven names (a dry read of IAM and CLI access, not a deployment).

The 2026-10-30 date is a rollback-risk constraint only; it does not change the release scope.

## Permission-state baseline and rollback

The Production `userPermissions` collection is empty today (0 documents), and `userPermissionAudit` is empty. A missing
document means the role default. Do not seed Production permissions.

- **Capture and verify the baseline immediately before the release** (Stage 0 and again before Stage 2): record the
  document count and, if any document exists, its full content. This is the state any rollback restores.
- If a rollback occurs after **any** permission change, restore the collection to that captured baseline **through the
  audited callable** (`setUserPermissionOverrides` with `null` for each key) while the callable is still live and while
  at least the consumers that interpret overrides are still deployed; verify that no stale override remains (every
  `userPermissions/{email}` read shows no override, or the captured baseline). Stale overrides must be gone **before**
  consumers that interpret permissions differently are rolled back.
- Retain `userPermissionAudit`; never delete `userPermissionAudit` as part of rollback.

## Rollback states

Core safety rule: once a user-facing UI that depends on the new backend has been published,
**restore/disable that UI BEFORE removing backend capabilities it depends on.** Keep `setUserPermissionOverrides` available until permission
overrides are restored to the baseline state. After a restored Function no longer reads overrides, stored overrides
are inert (including a PM's stored Release OFF, so a PM can release again exactly as before the release).

Common to every state: **STOP** further release steps; preserve evidence (Function snapshots, ruleset, Hosting
version, `production-pages` SHA, IAM state, `userPermissions` / `userPermissionAudit` state); every Function restore
means **FULL rollback** (never traffic-only), verified by read-back.

### State A — IAM prepared, no Function deployed

No application behavior changed. No UI or rules rollback is required. Either retain the unused identities for a retry
or remove the eight `roles/datastore.user` bindings and accounts (only with Control Plane approval), verifying the IAM
policy returns to etag `BwZcleH3jJo=`.

### State B — Partial Functions deployment

No new UI or rules are exposed yet. Steps: (1) stop; do not deploy the rest. (2) full rollback of every changed
existing Function (those already updated; verify the others are still on the baseline). (3) If `setUserPermissionOverrides`
was created it may remain **inert** until the cleanup is verified (nothing calls it). (4) Then optionally remove it.
(5) Identities last, if the release is abandoned.

### State C — All Functions deployed, rules not deployed

The old UI and old rules are still live. Steps: (1) verify no permission override state was created (`userPermissions`
equals the captured baseline, 0 documents). (2) If rollback is chosen: full rollback of the seven existing Functions
and read-back verification. (3) Then leave the new callable inert or remove it. (4) runtime identities last / optional cleanup.

### State D — Rules deployed, Firebase Hosting not deployed

The old user UI is still live and does not call the new backend, so nothing user-facing depends on it. Compatibility:
the new rules only add `userPermissions` / `userPermissionAudit` rules and the normalized Admin check; the old UI
ignores them. Steps: (1) verify `userPermissions` and snapshot it; restore it to the baseline if necessary, preserving
`userPermissionAudit`. (2) full rollback of the seven existing Functions and verify. (3) restore Production rules to
ruleset `7ed64612-dc1c-4856-baf1-f627972046b6` and verify it is live. (4) Then handle the new callable (inert/delete)
and identities last.

### State E — Firebase Hosting published and smoke fails

The new UI is user-facing. Stop exposure first. Required order:

1. restore Firebase Hosting to the baseline version `d8b102f996a1366b` (release `1790984982984000`);
2. if any other user-facing surface has already published (PR #40 / `production-pages`), restore it too, before moving on;
3. confirm the old UI is being served (served `index.html` has no permission code; no `js/user-permissions-admin.mjs`);
4. keep `setUserPermissionOverrides` live;
5. restore `userPermissions` to the pre-release baseline through the audited callable and verify no stale override remains;
6. preserve `userPermissionAudit`;
7. full rollback of the seven existing Functions, verified by read-back;
8. restore Production rules to `7ed64612-dc1c-4856-baf1-f627972046b6`;
9. only then leave inert or delete `setUserPermissionOverrides` (never while it is still needed to restore permission state);
10. identities cleanup last.

### State F — production-pages publication failure

PR #40 publishes only after backend and Hosting smoke PASS. If the `production-pages` publication itself fails:
first restore the `production-pages` user-facing surface to its baseline (`932c6e2bda17acad9ffc8fc0153421dcd93410dd`, by
reverting the PR #40 merge). Do not roll back the healthy Firebase backend and Hosting unnecessarily unless Control
Plane explicitly chooses a full release rollback. If a full rollback is chosen: restore all user-facing surfaces first
(`production-pages`, then Firebase Hosting), then the permission state (audited callable, baseline restored, audit
retained), then the consumer Functions (full rollback of the seven) and rules, then the permission callable and
identities.

**Rejected sequences:** removing `setUserPermissionOverrides` while any user-facing UI or any Function still depends on
it, or while overrides still differ from the baseline; restoring backend or rules before the published UI.

## Partial-failure paths

Each failure maps to a state above by how far the release progressed: Stage 1 → A; during Stage 2 → B; Stages 3–4 → C;
Stage 5 → D; Stage 6 or 7 (Hosting published, smoke failing) → E; Stage 9 (`production-pages`) → F. All paths stop
immediately and none advances to "make state symmetrical".

## Other rollback references (recorded 2026-10-04)

| Surface | Reference |
|---|---|
| `setUserPermissionOverrides` | `setUserPermissionOverrides` has no prior revision (new Function). Leave inert or delete per the state that applies. |
| Runtime identities / IAM | Remove the eight `roles/datastore.user` bindings and accounts only after nothing uses them (last). |
| Invoker | Standard `allUsers` binding; no invoker change is part of this release. |
| Firestore rules | Prior ruleset `7ed64612-dc1c-4856-baf1-f627972046b6`. |
| Firebase Hosting | Prior live version `d8b102f996a1366b` (release `1790984982984000`, "prod d345008"). |
| `production-pages` | Prior head `932c6e2bda17acad9ffc8fc0153421dcd93410dd` (revert the PR #40 merge). |
| Permission data | Reset overrides through `setUserPermissionOverrides` (`null`); never delete `userPermissionAudit`. |

## Validation notes

During candidate preparation one transient local failure occurred in the Production rules emulator suite (6 of 14
tests), exact cause unknown. It did not reproduce: the candidate and the baseline each passed 14/14 in isolated runs,
the exact-head GitHub `firestore-rules` job passed, and this PR changes no rules source. It is recorded as
non-blocking historical evidence and is not a completed root-cause analysis; treat it as blocking only if it reproduces.

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
