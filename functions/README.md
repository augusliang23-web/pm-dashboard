# Firebase Functions

The v2.1 client writes login sessions to `presenceSessions`. The scheduled
`aggregatePresenceSessions` function converts closed or timed-out sessions into
daily per-user documents in `presenceDailyRollups`.

## Minimal Production security deployment

Do not run an unscoped `firebase deploy` from this branch. Resolve the Production
project ID from the authorized Production `.firebaserc`, then pass that exact ID
to every command with `--project`; do not change a Firebase alias or global
gcloud configuration.

Deploy only the eight dashboard write Callables first:

```powershell
firebase deploy `
  --only functions:saveDashboardProject,functions:deleteDashboardProject,functions:setDashboardProjectAttention,functions:setDashboardWeekRelease,functions:saveDashboardWeekFields,functions:createDashboardWeek,functions:saveDashboardGanttTemplateSettings,functions:saveDashboardGanttWindowSettings `
  --project <production-project-id>
```

Verify those functions are active before publishing the matching root Pages
asset. Deploy `firestore.rules` immediately after the new root is verified so
direct browser writes are denied without leaving the dashboard in a prolonged
read-only gap:

```powershell
firebase deploy --only firestore:rules --project <production-project-id>
```

The existing Executive milestone Callables and scheduled presence aggregator
are deliberately outside this minimal deployment target and must not be
deleted, redeployed, or otherwise changed by this patch.

## Presence Session Aggregation

The existing `aggregatePresenceSessions` scheduled function converts closed or
timed-out sessions into daily per-user documents in `presenceDailyRollups`.
This patch does not redeploy that function.

If its TTL policy must be administered in a separately authorized operation:

```powershell
gcloud firestore fields ttls update expiresAt `
  --collection-group=presenceSessions `
  --project=<production-project-id> `
  --enable-ttl
```
## Executive milestone callables

- `addExecutiveMilestoneUpdate`
- `createExecutiveMilestoneChangeRequest`
- `decideExecutiveMilestoneChangeRequest`
- `applyDirectExecutiveMilestoneChange`
- `setExecutiveRagOverride`

Each callable reloads the authenticated user's role inside its transaction. Released weeks are immutable. Update history, change requests, and audit records are client read-only.

## UAT dashboard callables

The UAT dashboard backend exposes these eight protected Callable selectors:

- `saveDashboardProject`
- `deleteDashboardProject`
- `setDashboardProjectAttention`
- `setDashboardWeekRelease`
- `saveDashboardWeekFields`
- `createDashboardWeek`
- `saveDashboardGanttTemplateSettings`
- `saveDashboardGanttWindowSettings`

Each selector has a distinct source-level runtime service-account shorthand.
No IAM change or deployment was performed by this local change. A future,
separately authorized UAT deployment must select exactly these eight Callables;
it must not include Rules, Hosting, the UAT-only sync Callables, Executive
milestone Callables, or presence aggregation without a separate authorization.
The eight runtime identities and their least-privilege grants must be created
and independently verified before that deployment; this source change does not
prove that either prerequisite exists in UAT. The separately authorized deploy
principal must also have `iam.serviceAccounts.actAs` (Service Account User) on
each selected runtime identity; do not replace that narrow grant with a
project-wide role.

## Deployment and Production-to-UAT sync runbook

This is a review checklist, not an executable deployment or IAM script. Run
the local verification suite first, then stop for a separately recorded cloud
authorization gate before any Firebase/Google Cloud action. The gate must
identify the exact UAT project, reviewed Rules and Functions, and the person
authorizing the action. Do not copy commands from this document into a shell.
The reviewed Firebase target is `--project pm-dashboard-uat-20260820-a7f3`;
there is no Production deployment target.

The three UAT-only callable entry points are `syncProductionWeeksToUat`,
`getProductionWeekSyncStatus`, and `restoreUatWeeksSnapshot`. They run under
the dedicated service account
`uat-production-sync@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com`.
The service account has `roles/datastore.user` in UAT and only
`roles/datastore.viewer` in Production. The Production client is read-only,
uses the fixed Production project, and reads only `weeks`; callers cannot
choose a project, collection, or write destination.

`../config/production-week-sync-boundary.json` is the machine-readable local
source of truth for this boundary. Local verification reads it to check checked
in executable surfaces only; it neither grants IAM nor proves deployed IAM.
The separate cloud authorization gate remains required.

Each sync creates and verifies a complete UAT snapshot before applying the
mirror. Five complete snapshots are retained. Apply or verification failure
automatically restores and verifies the prior snapshot; a failed rollback
returns `rollback_failed` and requires an authorized restore review. Restore
also snapshots current UAT weeks first and never reads Production.

The sync records and snapshots live under `uatProductionWeekSync` and
`uatProductionWeekSyncRuns`; Firestore Rules deny browser reads and writes for
Admins and all other roles. Existing users, permissions, settings, Executive
workflow, usage records, and the legacy compatibility namespaces
`team2.portfolioScope`, `team2.overviewScope.*`, and
`dashboardSettings/team-2-portfolio` are preserved.

Cloud steps remain separate gates: service-account creation, IAM grants,
Functions/Rules/index deployment, TTL configuration, a live status probe, and
the first live sync or restore are all intentionally unexecuted by local
verification.

## Required access

Authenticated users need permission to create and update their own
`presenceSessions` document. Admin users need read access to session history.
Only the Admin SDK used by this function should write `presenceDailyRollups`.

## Role migration before UAT

In Firebase Console, update the designated department-head account from `vip` to `executive`. Verify no account retains `business`; use `sales` or `bd`. The application intentionally has no permanent compatibility alias and no browser-based role migration.

Approval email configuration and delivery are not part of v2.2T Phase 1.

## Visibility architecture blocker

The current `weeks` document embeds all Executive sections. Firestore Rules can protect whole documents, but cannot return a field-filtered version to PM or Engineering. The UI applies the approved visibility matrix; it must not be treated as server-enforced confidentiality until the three sections move to independently protected documents or are served through an equivalent filtered backend read model. The schema also lacks a protected active-week marker, so callables reject released weeks but cannot distinguish the current draft from an older unreleased draft. Keep this candidate undeployed to restricted-role users until both migrations are complete.
