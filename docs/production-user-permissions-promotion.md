# Production promotion: User Permissions / `week.manage`

Release runbook for promoting the UAT-validated User Permissions feature to Production
(`project-manager-dashboar-a067f`). **This document performs nothing.** Every step below is a future, separately
authorized action; nothing here has been deployed, granted or created.

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

## Preconditions (Control Plane freeze)

1. Pinned `main` promotion SHA (this candidate after review) and pinned `production-pages` candidate SHA.
2. CI green on both pins; `npm run test:all`, `cd functions && npm test`, `npm run test:rules`,
   `node scripts/build-hosting.mjs --env prod`, `npm run verify:sync-boundary` pass under Node 22 at the pin.
3. Vercel project `nextjs-boilerplate` still disconnected from this repository (no Git-triggered deployments).
4. `@grpc/grpc-js` HIGH (GHSA-m9gg-hp2v-232j) decision recorded (see *Dependency note*).
5. UAT manual grant on `uat-e2e-20260906-astra-other@example.com` resolved through the audited callable.

## Release sequence

Every command names `--project project-manager-dashboar-a067f` explicitly. Stop at the first failed check.

1. **Before-snapshot (read-only).** Functions inventory (name, runtime, revision, update time, runtime SA, state),
   `assertLiveFunctionInventory(manifest, 'prod', live)` → 9 managed + 8 preserved + 0 unexpected; rules release;
   Hosting live version; `userPermissions` / `userPermissionAudit` counts (expected 0 / 0; a missing permission
   document resolves to the role default, so no data migration is required).
2. **Runtime identities and least-privilege IAM** (none exist today). For each of `pmdash-user-perms`,
   `pmdash-create-week`, `pmdash-week-fields`:
   ```bash
   gcloud iam service-accounts create pmdash-user-perms --project=project-manager-dashboar-a067f --display-name="PM Dashboard User Permissions"
   ```
   ```bash
   gcloud projects add-iam-policy-binding project-manager-dashboar-a067f --member="serviceAccount:pmdash-user-perms@project-manager-dashboar-a067f.iam.gserviceaccount.com" --role="roles/datastore.user" --condition=None
   ```
   (repeat for `pmdash-create-week` / `pmdash-week-fields`). Only `roles/datastore.user`; never Owner, Editor,
   Firebase Admin, Project IAM Admin or Service Account Admin; zero user-managed keys. Verify the project IAM diff
   is exactly three added bindings. The deploy principal needs `iam.serviceAccounts.actAs` on the three identities;
   record whether it is inherited (project Owner) or granted narrowly on each service account.
3. **Manifest check.** `buildFunctionsOnlyFlag(manifest, 'prod', [the three names])` returns the selector above.
4. **Deploy `setUserPermissionOverrides` only:**
   ```bash
   npx firebase deploy --only functions:setUserPermissionOverrides --project project-manager-dashboar-a067f --non-interactive
   ```
5. **Verify:** ACTIVE, GEN_2, `us-central1`, `nodejs22`, runtime SA `pmdash-user-perms@…`; Cloud Run service
   `setuserpermissionoverrides` has `allUsers → roles/run.invoker` (Production has no Domain Restricted Sharing
   today); an unauthenticated POST returns HTTP 401 `unauthenticated` (application layer), never a platform 403;
   `userPermissions` / `userPermissionAudit` unchanged.
6. **Deploy exactly the two week Functions:**
   ```bash
   npx firebase deploy --only functions:createDashboardWeek,functions:saveDashboardWeekFields --project project-manager-dashboar-a067f --non-interactive
   ```
7. **Verify:** both ACTIVE, GEN_2, `nodejs22`, runtime SAs `pmdash-create-week@…` / `pmdash-week-fields@…`, existing
   `allUsers` invoker unchanged, unauthenticated probes return 401; deployed source archive equals the pinned SHA;
   every non-selected Function (incl. `setDashboardWeekRelease` and all Executive) has an unchanged revision,
   update time, runtime and runtime SA.
8. **Deploy Production rules only** (`firebase.json` → `firestore.rules`; never `firestore.uat.rules`):
   ```bash
   npx firebase deploy --only firestore:rules --project project-manager-dashboar-a067f --non-interactive
   ```
   Verify the live ruleset is byte-identical to `firestore.rules` at the pin.
9. **Deploy Production Hosting** through the pinned script (dry run first):
   ```bash
   npm run deploy:hosting:prod:dry
   ```
   ```bash
   npm run deploy:hosting:prod
   ```
   Verify `env-config.js` is the Production profile/project and `js/user-permissions-admin.mjs` /
   `js/permission-registry.mjs` match the pin.
10. **Release `production-pages`:** merge the reviewed Pages candidate PR into `production-pages`; verify the GitHub
    Pages build and that the served files equal the pinned Pages SHA.
11. **Bounded authenticated smoke** with temporary Production test identities only if separately authorized
    (Admin grant → delegated Create/Save on one uniquely named temporary week → reset → denial). Clean up temporary
    users, `users` docs, permission doc and temporary week; **retain audit records**.
12. **After-snapshot:** 18 Functions = 10 MANAGED + 8 PRESERVED, 0 unexpected; the three UAT-only sync Functions absent.
13. Start the approved Production soak.

## Invoker fallback

If step 4 fails specifically because the `allUsers` invoker binding is refused, **stop the release** and re-evaluate.
Do not apply UAT's `--no-invoker-iam-check` workaround in Production without a new security review.

## Rollback references (recorded 2026-10-03)

| Surface | Reference |
|---|---|
| `setUserPermissionOverrides` | new Function; rollback = delete it (`npx firebase functions:delete setUserPermissionOverrides --region us-central1 --project project-manager-dashboar-a067f`). Permission data stays (missing/unused overrides are inert). |
| `createDashboardWeek` | prior revision `createdashboardweek-00005-yap`; source `gs://gcf-v2-sources-842441149281-us-central1/createDashboardWeek/function-source.zip` generation `1789829964702697` (= `functions/` at `bab7357`, also `production-pages`). Redeploy from that reviewed source (restores Node 20 + default compute SA). |
| `saveDashboardWeekFields` | prior revision `savedashboardweekfields-00005-yul`; source generation `1789829963699468` (same `bab7357` source). |
| Runtime identities / IAM | remove the three `roles/datastore.user` bindings and, only after rollback of the Functions, the three service accounts. |
| Invoker | standard `allUsers` binding; no invoker change is part of this release. |
| Firestore rules | prior ruleset `7ed64612-dc1c-4856-baf1-f627972046b6` (= `firestore.rules` at `0719238`). |
| Hosting | prior live version `d8b102f996a1366b` ("prod d345008"); earlier `e954f2445df3fa42` ("prod 3c4f35d"). |
| `production-pages` | prior head `932c6e2bda17acad9ffc8fc0153421dcd93410dd`; rollback = revert the release merge. |
| Permission data | reset overrides through `setUserPermissionOverrides` (`null`); **never delete `userPermissionAudit`** as normal rollback. |

## Dependency note

`npm audit --omit=dev` (functions, at `606fe7e`): 1 high, 10 moderate.

- **High — `@grpc/grpc-js@1.14.4`** (GHSA-m9gg-hp2v-232j, `getAuthContext` may report unauthorized peer certificates
  as authorized; affects `>=1.14.0 <1.14.5`). Transitive: `firebase-admin@13.10.0 → @google-cloud/firestore@7.11.6 →
  google-gax@4.6.1 → @grpc/grpc-js`. The Functions use gRPC only as a Firestore client; no dependency outside
  grpc-js calls `getAuthContext` and nothing runs a gRPC server. Fixed in `1.14.5`, inside google-gax's
  `^1.10.9` range (lockfile-only). Classification: **ACCEPT_WITH_RATIONALE_PENDING_SEPARATE_SECURITY_GATE**;
  remediate in a separate lockfile-only dependency PR, not in this release.
- **Moderate:** `uuid`/`teeny-request`/`retry-request`/`google-gax`/`@google-cloud/{firestore,storage}` via
  `firebase-admin` (fix requires `firebase-admin@14`, a major upgrade → separate gate); `qs`/`express` via
  `firebase-functions` (non-major fix available → same separate dependency PR).
