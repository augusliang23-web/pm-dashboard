# Cloud execution contract v3 (design; nothing deployed)

Supersedes `imported/.../CLOUD_EXECUTION_CONTRACT.md` where they differ. Reference implementation: `coordinator_v3.py`, `cloud_run_rollback.py`, `acceptance.py`. Cloud draft: `workflows/pr54-recovery-watchdog.yaml` (never compiled or run).

## 1. Architecture

Google Cloud Workflows is the only watchdog. It is the sole writer of one coordinator object in a dedicated GCS bucket and reads everything else. There is no Cloud Build worker, no local process and no AI session in the recovery path, so the watchdog keeps running if Claude Code, Codex or the Mac stops. The forward cutover itself (Cloud Build runner, PR54 deployment) is out of scope here and needs its own authorization.

| Component | Role |
|---|---|
| Workflows execution (`pmdash-pr54-watchdog`) | arms, ticks every 10 s, enforces deadlines, claims and reconciles rollback steps, sole coordinator writer |
| GCS `coord/active.json` | single project-wide coordinator, generation-CAS |
| GCS `manifests/<release>.json` | immutable approved baseline, read pinned by generation |
| GCS `receipts/<release>/{forward,legacy}.json` | authenticated acceptance receipts, written only by the receipt writer |
| Cloud Run `savedashboardproject`, `setdashboardprojectattention` | rollback = traffic pin to the recorded baseline revision |
| Firebase Hosting / Rules | pointer restore to recorded baseline version / ruleset |

## 2. State machine

`ACTIVE -> SUCCEEDED` (authenticated forward receipt + independent readback, before T+30m)
`ACTIVE -> ROLLBACK_REQUESTED` (T+30m without verified success, or T+45m forward stop, or a reported failure)
`ROLLBACK_REQUESTED -> ROLLING_BACK -> ROLLED_BACK` (all seven steps verified, last one by the authenticated legacy receipt)
`* -> RECOVERY_HOLD` (unknown/running provider outcome, or an operator hold)

Rollback order (identical in Python and the workflow; a test compares them): `restore_hosting, restore_save, restore_attention, restore_rules, remove_new_drafts, reopen_legacy, verify_legacy_authenticated`.

## 3. Deadlines

Server-origin only (`sys.now()` at arming, persisted). `target = start+1800`, `forward_stop = start+2700`, `hard = start+3600`. Re-arming by the same owner resumes with the stored values and never resets them. At `hard` without `ROLLED_BACK` the coordinator records an incident and a CRITICAL log; it never claims recovery. A Google API outage can prevent completion inside 60 minutes; no timer fixes that.

## 4. Locking, ownership, idempotency

- **One writer, one slot.** Every change is read-modify-CAS (`ifGenerationMatch`); 412 means reread and revalidate, never overwrite. `inflight` is a single action slot; while it is occupied every claim returns `RECONCILE_REQUIRED`.
- **Owner binding.** State carries the Workflows execution ID, manifest hash and baseline hash. A different owner or changed hash raises `STALE_OWNER` on every operation and cannot adopt the release. Rollover to the next release needs a terminal, fully reconciled previous state and a CAS against its exact generation; the previous generation is recorded.
- **Stable action IDs** `rollback:<release>:<step>`. The slot is never freed by lease expiry.
- **Idempotency.** Pinning traffic to the baseline revision is naturally idempotent; the adapter submits nothing when traffic is already 100 % on the baseline and settled.

## 5. Cloud Run rollback call sequence (per service)

1. Claim the step (CAS). Slot is now occupied.
2. Read baseline revision (must exist, be Ready, and match the approved fingerprint) and the service (`ingress`, invoker setting, IAM policy must match the approved fingerprint; no tagged traffic). Mismatch => **drift**: free the slot (provably unsubmitted), raise an operator hold, stop.
3. Already at baseline => submit nothing; reconcile confirms.
4. `PATCH .../services/{s}?updateMask=traffic&validateOnly=true` with the service `etag`. Evidence of acceptability only, never of success.
5. **Persist `pre_etag` to the coordinator, then** send the real `PATCH ...?updateMask=traffic`. Any failure before this point is provably unsubmitted.
6. Persist the returned operation name (must match `projects/<p>/locations/us-central1/operations/<id>`; URLs are refused).
7. Reconcile (below).

## 6. Reconciliation and failure handling

| Observation | Outcome |
|---|---|
| operation done, no error, service at baseline (spec and observed traffic, not reconciling) | `DONE_VERIFIED` |
| operation done with error | `FAILED_CONFIRMED`, slot freed, retry allowed |
| operation running / not found / provider unreachable | `UNKNOWN`: slot stays fenced, mode `RECOVERY_HOLD`, no competing action |
| no operation recorded, service at baseline | `DONE_VERIFIED` (state equals desired state) |
| no operation recorded, `etag == pre_etag`, **and** etag semantics validated at G2 | `NOT_STARTED_CONFIRMED`; otherwise `UNKNOWN` |
| 401/403 | error surfaced, never treated as absence or success; operator hold `PERMISSION_DENIED` |
| 429/5xx/network | retry next tick; no hold unless the outcome of a persisted submission is ambiguous |

A lost response after an applied mutation is therefore resolved by state readback, not by a second PATCH (tested). A lost request is retried only when etag semantics were empirically validated; otherwise it stays fenced (tested).

## 7. Rollback verification

Per step, authoritative readback of the actual serving state. The final step additionally requires the authenticated legacy receipt (see `AUTHENTICATED_ACCEPTANCE_CONTRACT.md`) plus fresh readback. Traffic rollback "does not re-run deployment health checks" (Cloud Run docs), so Cloud Run readback alone is never accepted as functional recovery.

## 8. What is explicitly not proven

Cloud Run, Hosting, Rules and Storage request/response shapes are modelled from documentation. The workflow is uncompiled. G2 (read-only / validateOnly) exists to replace those assumptions with observation before any drill.
