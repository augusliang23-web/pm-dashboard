# Presence Session Aggregation

The v2.1 client writes login sessions to `presenceSessions`. The scheduled
`aggregatePresenceSessions` function converts closed or timed-out sessions into
daily per-user documents in `presenceDailyRollups`.

## Minimal Production security deployment

Do not run an unscoped `firebase deploy` from this branch. Resolve the Production
project ID from the authorized Production `.firebaserc`, then pass that exact ID
to every command with `--project`; do not change a Firebase alias or global
gcloud configuration.

Deploy only the seven dashboard write Callables first:

```powershell
firebase deploy `
  --only functions:saveDashboardProject,functions:deleteDashboardProject,functions:setDashboardProjectAttention,functions:setDashboardWeekRelease,functions:saveDashboardWeekFields,functions:createDashboardWeek,functions:saveDashboardGanttTemplateSettings `
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

Session detail is retained for 90 days. Daily rollups do not contain an
`expiresAt` field and are therefore retained.

## Required access

Authenticated users need permission to create and update their own
`presenceSessions` document. Admin users need read access to session history.
Only the Admin SDK used by this function should write `presenceDailyRollups`.
