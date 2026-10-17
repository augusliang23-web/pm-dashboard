# Authenticated acceptance contract

A deployment or rollback is never "successful" because Hosting changed, a worker says so, or a boolean flips. Success requires a **receipt** written by a trusted, separately approved attester using a real normal login, plus **independent fresh readback** of the serving state. Reference validator: `acceptance.py` (pure, no I/O); the workflow re-implements it as `receipt_ok` and a test keeps the check lists identical.

## Forward (PR54 cutover) receipt, valid only before T+30m

All must be exactly `true`: `firebase_auth`, `pm_ownership`, `legacy_pm_save`, `attention`, `save_draft`, `save_publish`, `overview_pdf`, `released_protection`, `archive_preservation`, `backend_operation`, `unauthorized_rejected`, `no_unexpected_mutation`, `versions_match`.

## Legacy (after rollback) receipt, required for `ROLLED_BACK`

`firebase_auth`, `pm_ownership`, `legacy_pm_save`, `attention`, `unauthorized_rejected`, `no_unexpected_mutation`, `versions_match`, `pdf_preserved`, `archive_preservation`. PR54-only Draft endpoints are deliberately **not** required: they do not exist after rollback.

## Binding and integrity fields (both kinds)

- `kind`, `release_id`, `nonce`, `manifest_hash`, `source` equal the armed values (replay and cross-release receipts rejected).
- `roles` is exactly `{Admin, PM}`.
- `started_at <= completed_at <= now < deadline` and `started_at >= armed start`.
- `versions` (hosting, rules, save, attention) equal the manifest's candidate (forward) or baseline (legacy) versions. Hosting alone is never enough.
- `mutation_ledger`: `unexpected_writes == 0`, `historical_or_archive_writes == 0`, `synthetic_ids_only == true`.
- `evidence_ids` non-empty; `attester` non-empty, on the approved list, and not a worker principal.

## What it does not prove

IAM isolation stops workers writing receipts; it cannot prove the attester ran the tests honestly. No credential extraction, cookie export, custom-token login or authentication bypass is used or permitted anywhere. Real PM saves write data, so they need separately approved synthetic record IDs (G4); G3 uses a receipt only for a zero-mutation drill.

## Missing attester

If the cloud restores configuration but no valid legacy receipt arrives, the coordinator stays in `RECOVERY_HOLD` with the final step unfulfilled and alerts. That state is "restored, awaiting authentication", never PASS.
