# Production to UAT Sync Remediation Design

## Purpose

Close the five load-bearing integration gaps found after the first complete Production-to-UAT week-sync implementation. This document supplements, and does not weaken, `2026-09-11-production-to-uat-week-sync-design.md`.

The remediation must preserve the existing one-way boundary: Production is read only, UAT is the only write destination, only `weeks` business documents are mirrored, and all cloud/IAM/deploy/live operations remain separately unauthorized.

## Root Causes

1. The UAT Firestore client uses `useBigInt: true` for exact business integer reads. The same setting also returns operational count fields such as `weekCount` as bigint, while the service expects safe JavaScript numbers.
2. `rollback_failed` is represented only as an ordinary run. A later failed restore can become the newest run and hide the still-unresolved critical condition.
3. Restore audit metadata and the status projection do not consistently expose fixed environment IDs and normalized counts.
4. The IAM boundary verifier infers role ownership from nearby prose. That heuristic can associate a role with the wrong environment, miss aliases, and reject valid combined policy text.
5. The UI falls back from `latestCompletedRun` to a failed `latestRun` while labeling the result as successful.

## Chosen Architecture

### Operational metadata codec

Keep one exact-value UAT Firestore client with `useBigInt: true`. Do not convert any value inside `weeks` documents merely because it is a bigint.

At the server-only operational metadata boundary, add explicit field allowlists:

- Count fields: `weekCount`, `sourceWeekCount`, `destinationWeekCount`, `resultWeekCount`, `restoredWeekCount`, `createdCount`, `updatedCount`, and `deletedCount`.
- Each count may arrive as bigint or number. Convert it to a number only after proving it is an integer in the range `0..Number.MAX_SAFE_INTEGER`.
- Reject negative, fractional, non-finite, out-of-range, string, or unknown count values.
- Keep timestamps, IDs, phases, digests, results, and error reasons under their existing closed scalar schemas.

Apply the codec when reading run/snapshot metadata for status, retained-snapshot selection, and snapshot verification. Business payload reads and raw writes continue to preserve Firestore integer versus double type and signed 64-bit integer bounds.

### Durable recovery-required state

Extend `uatProductionWeekSync/control` with server-only recovery fields:

- `recoveryRequired: boolean`
- `rollbackFailedRunId: string | null`
- `rollbackFailedAt: ISO timestamp | null`

When automatic rollback fails, set these fields even if the ordinary run-audit update fails. Status returns a separate closed object:

```js
{
  recoveryRequired: true,
  rollbackFailedRunId: 'run-id',
  rollbackFailedAt: '2026-09-12T00:00:00.000Z'
}
```

Later failed sync or restore attempts must not clear or hide this state. Only a fully verified successful manual restore may clear it. A normal successful Production sync does not clear it because the existing safety instruction explicitly requires a successful restore.

The UI prioritizes the critical no-edit warning whenever `recoveryRequired === true`, regardless of the newest run or lease state.

### Complete audit and status contracts

Every sync run records the fixed Production source project ID and fixed UAT destination project ID. Every restore run records UAT as the snapshot source environment, UAT as the destination, and the fixed Production/UAT environment IDs needed for audit context.

Successful sync metadata includes source read time, source digest, result digest, result count, created/updated/deleted counts, snapshot ID, and completion time. Successful restore metadata includes its own immutable snapshot ID, `restoredFromSnapshotId`, restored digest/count, fixed environment IDs, and completion time.

Status returns three independent concepts:

- current active operation, if its lease is valid;
- `latestCompletedRun`, restricted to verified `succeeded` or `restored` runs;
- `latestRun`, the newest sanitized terminal attempt, without implying success;
- durable recovery-required state;
- latest retained complete snapshot.

The UI's “Last successful operation” row consumes only `latestCompletedRun`. Failed attempts may appear in status messaging but are never labeled successful.

### Machine-readable IAM boundary policy

Replace heuristic role-to-prose parsing with a repository-owned JSON policy file:

`config/production-week-sync-boundary.json`

Its exact contract is:

```json
{
  "productionProjectId": "project-manager-dashboar-a067f",
  "productionRoles": ["roles/datastore.viewer"],
  "uatProjectId": "pm-dashboard-uat-20260820-a7f3",
  "uatRoles": ["roles/datastore.user"],
  "sourceCollections": ["weeks"]
}
```

The verifier must parse and validate this file structurally. It must reject missing/extra keys, duplicate roles, any Production role other than `roles/datastore.viewer`, any UAT role other than `roles/datastore.user`, project-ID drift, or any source collection other than `weeks`.

Executable deployment/runtime/config files are scanned independently. Any datastore role string outside the policy file, any caller-selected project/collection, any Production alias or deployment target, any Production write API, or any import of the old local sync utility is a violation. Human-readable README prose is documentation, not an IAM parser input.

Cloud IAM reality remains a separate rollout gate; the local policy file cannot prove deployed IAM bindings.

## Data and Error Flow

1. Production and UAT week reads preserve exact integer/double semantics.
2. Snapshot and mirror raw writes preserve those exact business values.
3. Operational documents are decoded through the metadata codec before service validation or status projection.
4. A rollback failure writes both the terminal run result and the durable recovery-required flag using best-effort independent operations.
5. Status always returns the durable flag independently from latest-run selection.
6. A requested restore validates retained metadata, snapshots current UAT, applies and verifies the selected snapshot, records complete audit metadata, then clears the durable flag.
7. Any failure before verified restore completion leaves the durable flag unchanged.

## Verification Strategy

Follow strict RED then GREEN behavior testing.

Required backend tests:

- round-trip operational metadata through the installed Firestore serializer with `useBigInt: true`, then use the real UAT adapter and service to restore a retained snapshot successfully;
- verify all allowlisted bigint counts normalize to safe numbers in status and snapshot validation;
- reject negative, fractional, unsafe, or malformed operational counts;
- preserve bigint and double values inside week business payloads through source read, snapshot write, mirror write, and digest verification;
- set recovery-required after `rollback_failed`, keep it after later failed sync/restore attempts and lease expiry, and clear it only after verified restore;
- prove restore audit includes fixed environment IDs, immutable snapshot identity, source snapshot ID, digest/count, and completion time;
- parse the machine-readable boundary policy and reject every key/value/role/collection/project deviation;
- prove executable role aliases or role strings outside the policy fail closed while valid README prose does not affect the result.

Required frontend tests:

- critical recovery warning survives reload, lease expiry, and a later failed restore attempt;
- “Last successful operation” renders only `latestCompletedRun`;
- a failed-only environment never displays a successful-operation label;
- existing Admin, confirmation, busy, accessibility, rolled-back, and callable-boundary behavior remains unchanged.

Final local verification must include focused sync tests, all Functions tests, the complete repository suite, both checkout-owned Firestore Rules emulators, the boundary verifier, and `git diff --check`.

## Acceptance Criteria

- A normal retained snapshot remains restorable when Firestore returns operational integer fields as bigint.
- Business integer versus double values and signed 64-bit integers remain exact.
- An unresolved rollback failure can never be hidden by a later attempt or lease expiry.
- Only a verified successful restore clears the critical recovery state.
- Sync and restore audit/status data contain normalized counts and complete fixed environment metadata without business payloads.
- Failed runs are never labeled successful in the UI.
- The local IAM boundary verifier uses the structured policy and has no prose-based role attribution.
- All original Production-read-only, UAT-only-write, preserved-namespace, snapshot-before-mutation, and separate-cloud-gate requirements remain in force.

## Delivery Boundaries

This remediation may modify local UAT repository code, tests, documentation, and create local commits on `codex/uat-production-week-sync`. It may not create or grant a service account, change live IAM, deploy Functions or Rules, publish Pages, push or merge, query live status, run a live sync, run a live restore, or otherwise touch Production or live UAT data.
