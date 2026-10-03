# Node 22 migration candidate

Status: local validation PASS; READY FOR REVIEW. No deployment or cloud mutation performed.
Source baseline: `0db63dfcef466864353ce47c7d25ff58836e7942` (main, PR #33 and #34 already merged).

## Source changes

- `functions/package.json`: Node engine 20 → 22.
- `functions/package-lock.json`: matching root-package engine metadata only. All resolved dependency entries remain identical to baseline.
- `.github/workflows/ci.yml`: root-tests, firestore-rules, sync-boundary and hosting-builds use Node 22. The entire PDF job remains unchanged on Node 24.21.0.

Firebase configs have no Functions runtime override: `firebase.json` and `firebase.uat.json` use this Functions source engine. `firebase.shared-backend.json` is rules-only.
No handler, role/permission contract, runtime service-account declaration, manifest, rules, environment binding, UI or PDF source changed.
Production still forbids `setUserPermissionOverrides`; its eight preserved Executive Functions and three forbidden sync Functions retain their existing policy.

The existing lock resolves firebase-functions 6.6.0, firebase-admin 13.10.0 and Functions-local firebase-tools 15.29.0. No dependency upgrade was needed for the local Node 22 checks.

## Local evidence — 2026-10-03

All listed Node checks ran with **Node v22.23.3 / npm 10.9.9**, macOS arm64. Rules emulators used the installed OpenJDK 21 and only the demo project `demo-pm-dashboard-v22t`.
The official Node archive SHA-256 was verified before use. The machine's default Node installation was not changed.

| Check | Result |
|---|---|
| Baseline `npm run test:all` under Node 22 | 1,214 PASS; 0 FAIL; 2 existing skips |
| Baseline `npm test` in Functions | 164/164 PASS |
| Candidate `npm ci` at root and Functions | Both PASS; no engine mismatch warning |
| Candidate `npm run test:all` | 1,214 PASS; 0 FAIL; same 2 skips |
| Candidate `npm test` in Functions | 164/164 PASS |
| `npm run test:rules` | Production 14/14; UAT 15/15; shared-backend 15/15 PASS |
| `node scripts/build-hosting.mjs --env prod` | PASS; 28 assets; expected Production project |
| `node scripts/build-hosting.mjs --env uat` | PASS; 28 assets; expected UAT project |
| `npm run verify:sync-boundary` | PASS |
| Real Firebase SDK/index module load | PASS; all 21 exports load; the three selected callable/SA metadata values are correct; no handler invoked |
| Engine/config/parsed CI/lock parity checks | PASS; PDF CI job byte-equivalent in parsed form; no dependency-entry drift |
| `git diff --check` | PASS |

Root-test skips: the placeholder requiring separately managed rules emulators (covered by the actual emulator run), and the pre-existing legacy deployment-instructions assertion. Neither skip was added or altered.
Local logs are retained in this worktree's ignored `tmp/node22-validation/` directory.
GitHub CI has not run for this local candidate. Linux CI, live Node 22 startup, live IAM/invoker behavior and authenticated cloud E2E are **NOT VERIFIED** by these local checks.

Install audit warnings existed in the unchanged dependency graph: root 26 (13 moderate, 13 high), Functions 28 (19 moderate, 9 high), including development tooling.
The additional Functions `npm audit --omit=dev --json` returned exit 1: 11 production-dependency findings (10 moderate, 1 high). The high finding is in transitive `@grpc/grpc-js`; dependency remediation was not included in this runtime-only candidate. Review/triage this separately before Production approval. Test PASS does not mean security-audit PASS.

## Later scoped UAT validation — separate authorization required

Fixed project: `pm-dashboard-uat-20260820-a7f3`; region: `us-central1`.
The only eligible Functions in that later task are:

| Function | Expected UAT runtime service account |
|---|---|
| `setUserPermissionOverrides` | `pmdash-user-perms@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com` |
| `createDashboardWeek` | `pmdash-create-week@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com` |
| `saveDashboardWeekFields` | `pmdash-week-fields@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com` |

Required selector (documentation only; not executed):

```text
--only functions:setUserPermissionOverrides,functions:createDashboardWeek,functions:saveDashboardWeekFields
--config firebase.uat.json
--project pm-dashboard-uat-20260820-a7f3
```

Do not use an all-Functions or manifest-wide UAT selector: the UAT allowlist includes 21 Functions and is broader than this gate.
Do not include `setDashboardWeekRelease`, Executive, sync, Hosting, rules, indexes or PDF deployments.

Before deployment, pin the reviewed candidate commit and capture live revision, source/build, Node runtime, service account, traffic and invoker configuration for the three Functions. Recheck the approved org-policy/invoker procedure; UAT previously required disabling the permission callable's invoker IAM check. A CLI invoker-binding error remains HOLD until the resulting service and application authorization are verified. Do not automatically treat it as success or change other services.

After deployment, verify all three are ACTIVE on `nodejs22`, with the exact SAs above. Confirm every other Function's revision/update time is unchanged.
Repeat authenticated pre-grant denial → Admin grant/revision/audit → delegated draft read, Create Week and Save Summary → Admin-only boundary denial → reset → immediate server denial. Check strategy-layer, other-user permission/audit access and Release/Revert preserve their existing contract. Check unauthenticated callable rejection and reload UI behavior. Use only approved test identities/resources, clean those resources, retain audit evidence, and leave unrelated UAT grants untouched.
No new grants or other data changes are authorized by this document.

## Rollback boundaries

- **Local source:** discard/revert this candidate's three configuration changes to the baseline; this does not roll back a cloud runtime.
- **Later UAT backend rollback:** redeploy only these three Functions from a previously reviewed, tested source artifact with the intended prior behavior. Prefer a prevalidated Node 22 rollback artifact. For this runtime-only candidate, handlers are unchanged; that artifact preserves the same behavior but cannot by itself cure a Node-22-specific platform incompatibility.
- **Node-22-specific failure:** stop the later release and investigate. A Node 20 rollback is conditional on Firebase accepting it at that date and on separate approval; it is not a guaranteed fallback. Prepare and approve the runtime fallback before a later cloud deployment.
- **Cloud configuration:** source revert does not restore runtime SA, invoker settings or traffic. Restore only explicitly approved captured settings, then reverify authorization. Do not remove existing SAs or resources as automatic cleanup.
- **Permission data:** reset validation grants via the normal audited callable before cleanup; never erase audit history. Backend/source rollback does not remove grants.

Changing this engine declares Node 22 for any future selected Function deployment; it does not update undeployed live Functions. Production and Executive runtime migrations remain separate gates. This candidate is neither READY FOR PRODUCTION nor DEPLOYED.

References: [Firebase Functions runtime management](https://firebase.google.com/docs/functions/manage-functions), [Cloud Run functions runtime lifecycle](https://docs.cloud.google.com/functions/docs/runtime-support).
