# Production to UAT Week Sync Design

## Purpose

Add an Admin-only control to the UAT dashboard that replaces UAT reporting-week business data with a complete mirror of Production reporting weeks. The operation must never write to Production, must preserve UAT identities and environment-specific data, and must create a recoverable UAT snapshot before changing any UAT week.

## Scope

The only synchronized Firestore namespace is `weeks/{weekId}`. Each week document includes its nested `projects` array, weekly summary, strategy layer, release state, and other week-level business fields. After a successful sync, UAT must contain exactly the same week document IDs and week document contents as Production.

The following namespaces are never read from Production or replaced in UAT by this feature:

- `users`
- `dashboardSettings`
- `executiveMilestoneConfig`
- `executiveMilestoneState`
- `executiveMilestoneUpdates`
- `executiveMilestoneChangeRequests`
- `executiveMilestoneAudit`
- `logs`
- `presence`
- `presenceSessions`
- `presenceDailyRollups`
- Firebase Authentication users and credentials

Sync-run metadata, locks, and snapshots are UAT-only operational records and are also excluded from synchronization.

## Chosen Architecture

Use Firebase callable Functions in the existing UAT Functions codebase. This reuses the dashboard's existing authenticated callable pattern and does not add a new Cloud Run service or a workstation-dependent operator script.

Deploy the sync callables with a dedicated UAT service account:

`uat-production-sync@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com`

Grant that identity:

- `roles/datastore.user` on `pm-dashboard-uat-20260820-a7f3`, so it can authorize the UAT Admin and manage UAT weeks, snapshots, locks, and run metadata.
- `roles/datastore.viewer` on `project-manager-dashboar-a067f`, so Production Firestore access is read-only at the IAM boundary.

Do not grant the shared default Compute service account Production access. Only the dedicated sync identity may read Production.

The code uses two explicitly named Firestore clients:

- Destination: the default UAT Admin app, whose project must equal `pm-dashboard-uat-20260820-a7f3`.
- Source: a named Admin app configured for `project-manager-dashboar-a067f` with Application Default Credentials.

The source adapter exposes list/get behavior only. It does not expose create, set, update, delete, batch, bulk-writer, or transaction methods. The source collection name is a constant equal to `weeks`.

## Callable Interfaces

### `syncProductionWeeksToUat`

Input: an empty object. Environment IDs and collection names are server constants and cannot be supplied by the caller.

Authorization: require Firebase Authentication, load `users/{normalizedEmail}` from UAT, and require the normalized Dashboard role to be `admin`.

Output on success:

- `runId`
- `sourceProjectId`
- `destinationProjectId`
- `sourceReadTime`
- `sourceWeekCount`
- `createdCount`
- `updatedCount`
- `deletedCount`
- `completedAt`
- `snapshotId`

### `getProductionWeekSyncStatus`

Input: an empty object. Authorization is identical to the sync callable.

Output:

- whether a sync is running
- current phase without business payloads
- latest completed run summary
- latest restorable snapshot ID and creation time

### `restoreUatWeeksSnapshot`

Input: `{ snapshotId }`, where the requested snapshot must be one of the retained snapshots recorded by the UAT backend. Authorization is identical to the sync callable.

The restore operation snapshots the current UAT weeks before restoring the requested snapshot, then makes `weeks` an exact mirror of that snapshot. It never accesses Production.

## UAT Operational Data Model

Use server-only namespaces that remain inaccessible to browser Firestore clients under the default-deny Rules behavior:

- `uatProductionWeekSync/control`: the current lease and active run ID.
- `uatProductionWeekSyncRuns/{runId}`: actor metadata, fixed environment IDs, phase, counts, content digest, timestamps, result, and a sanitized error code/message.
- `uatProductionWeekSyncRuns/{runId}/weeks/{weekId}`: one exact pre-change UAT week document per snapshot entry.

Run phases are:

- `reading_source`
- `validating_source`
- `snapshotting`
- `applying`
- `verifying`
- `succeeded`
- `rolling_back`
- `rolled_back`
- `rollback_failed`
- `restoring`
- `restored`

Keep the five newest complete snapshots. Cleanup happens only after the current sync or restore succeeds. Cleanup failure is recorded as a warning and does not invalidate a verified business-data result.

## Sync Data Flow

1. Verify that the runtime destination project is exactly `pm-dashboard-uat-20260820-a7f3`.
2. Authenticate the caller and require the UAT Dashboard role `admin`.
3. Acquire a UAT Firestore lease. Reject a second operation while a non-expired lease exists.
4. Read all Production `weeks` documents through the read-only source adapter.
5. Reject the operation before any UAT week mutation when the source is empty, a document ID is invalid, a document exceeds Firestore limits, a value cannot be copied safely, or the complete source query is unavailable.
6. Canonicalize Firestore values for deterministic comparison. Preserve Timestamp, GeoPoint, bytes, arrays, maps, and null. Remap any DocumentReference to the same document path in the UAT Firestore client so no UAT document contains a live reference to Production.
7. Read the complete current UAT `weeks` collection and calculate created, updated, unchanged, and deleted IDs.
8. Write every pre-change UAT week to the run's snapshot subcollection. Verify snapshot IDs, count, and digest before changing `weeks`.
9. Apply the mirror in bounded batches: write every Production week to the identical UAT document ID and delete every UAT week ID absent from Production.
10. Re-read UAT `weeks` and require exact ID, count, and canonical-content digest equality with the Production snapshot.
11. Mark the run successful, release the lease, and retain the snapshot for manual restore.
12. The dashboard's existing UAT `onSnapshot` subscription refreshes the displayed weeks automatically.

## Failure and Recovery

No UAT business-data mutation occurs before the snapshot is complete and verified.

If applying or verification fails, change the run to `rolling_back`, replace UAT `weeks` with the verified pre-change snapshot, and verify the restored IDs, count, and digest. Report failure only after rollback succeeds, using the state `rolled_back` so the UI can explain that UAT was protected.

If automatic rollback also fails, mark the run `rollback_failed`, retain the lease until its expiry, preserve the snapshot, and show a critical message instructing the Admin not to edit UAT weeks until the restore callable succeeds. Never report a partial write as success.

Use a bounded lease with heartbeat/renewal and ownership by `runId`. A stale lease can be reclaimed only after expiry. Releasing a lease requires the same `runId` that acquired it.

Every error returned to the browser uses an actionable, sanitized reason. Logs and run metadata contain document counts and digests but never project business content, Firebase tokens, or Production credentials.

## User Interface

Add an Admin-only `Production Data Sync` panel to Week Management.

The panel contains:

- `Sync from Production` button.
- Last successful sync timestamp and counts, when available.
- `Restore Last Snapshot` button when a retained snapshot exists.

The sync confirmation dialog states:

> This will replace every UAT reporting week and its projects with the current Production data. UAT-only weeks will be deleted. UAT users, permissions, settings, Executive workflow, and usage records will not be changed. A restorable UAT snapshot will be created first. Production is read-only.

While an operation runs, disable both actions and show the server-reported phase. On success, show created, updated, and deleted counts. On a safely rolled-back failure, explicitly state that the original UAT weeks were restored. On `rollback_failed`, show the critical recovery instruction from the previous section.

Non-Admin roles do not see the panel. Server authorization remains mandatory even if a caller invokes the callable outside the UI.

## Verification Strategy

Follow test-driven development. Add pure core tests before implementation and verify that they fail because the behavior is absent.

Backend unit and integration-style tests must cover:

- exact Production and UAT project-ID guards;
- Admin success and unauthenticated/non-Admin rejection;
- source adapter exposes no write capability;
- collection allowlist is exactly `weeks`;
- empty, incomplete, or invalid source aborts before UAT week mutation;
- `projects` nested inside each week are mirrored with the week;
- UAT-only weeks are deleted;
- matching weeks are unchanged and differing weeks are replaced;
- every excluded namespace remains untouched;
- snapshot completion and digest verification precede the first week mutation;
- apply failure triggers verified automatic rollback;
- rollback failure is never reported as success;
- manual restore produces an exact snapshot mirror;
- simultaneous operations are rejected and expired leases can be recovered safely;
- the newest five complete snapshots are retained;
- audit records exclude business payloads and credentials;
- Timestamp, GeoPoint, bytes, arrays, maps, null, and DocumentReference values copy safely.

Frontend source-contract and behavior tests must cover:

- only Admin sees the panel;
- confirmation copy names the destructive UAT-only-week deletion and preserved data;
- duplicate clicks are blocked;
- running, success, rolled-back failure, and critical rollback-failure states are understandable;
- API adapters call only the three intended callable names;
- the existing week subscription remains the sole renderer refresh path.

Deployment guards must assert that:

- sync functions target only the UAT project;
- their dedicated service account is configured explicitly;
- the Production project ID appears only in the read-only source configuration and safety tests;
- no deployment command targets Production;
- existing Production-only utilities are not reused or executed.

Before any cloud change, run the complete local UAT test suite and Functions tests from the feature branch. Cloud rollout requires a separate explicit gate covering creation of the dedicated service account, the two IAM grants, UAT Functions deployment, UAT Pages publication, and live read-only verification. No sync is executed automatically during deployment.

## Acceptance Criteria

- An authenticated UAT Admin can start one complete Production-to-UAT `weeks` mirror from the UAT dashboard.
- Production cannot be written by the sync identity at the IAM boundary.
- The backend never reads or copies a Production collection other than `weeks`.
- After success, UAT and Production `weeks` have identical document IDs and canonical contents.
- UAT-only weeks are deleted.
- UAT identities, permissions, environment settings, Executive workflow/history, logs, presence, and usage records are preserved.
- A verified pre-change snapshot always exists before the first UAT week mutation.
- Apply failures restore the pre-change snapshot automatically when recovery succeeds.
- Admin can restore one of the five retained complete snapshots.
- Every outcome is auditable without logging business content or secrets.
- Deployment does not trigger a sync; the first live sync remains an explicit Admin action.

## Delivery Boundaries

Implementation work may modify the UAT repository, add tests, and create local commits on the feature branch. It may not grant IAM roles, deploy Functions, publish GitHub Pages, execute a live sync, restore live UAT data, push, merge, release, or touch any Production data without the corresponding explicit cloud or publication authorization.
