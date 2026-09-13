# Final fix report: Production-to-UAT sync remediation

Date: 2026-09-13

## Scope and safety

This was the single local final-review remediation wave on `codex/uat-production-week-sync` from `752c2d6`. No cloud, IAM, Firebase deploy, Pages publish, push, merge, live status, live sync, live restore, old local sync utility, or PDF deploy script was run. Production remains read-only; writes remain callable/Admin-controlled and UAT-only.

## Findings mapped to implementation and tests

1. Deployment-boundary alias bypass
   - `scripts/verify-production-sync-boundary.mjs` now preserves source identities, parses `.firebaserc` `projects` aliases structurally, resolves JavaScript/PowerShell/shell assignments plus quoted variable references, and fails closed when a Firebase deployment target is Production, an alias resolving to Production, or unresolved/not the fixed UAT target.
   - Datastore-role checks now scan each executable source separately, so the violation reports its actual source rather than incorrectly reporting `deployment` for `productionRead`.
   - `tests/production-week-sync-boundary.test.mjs` adds `.firebaserc` Production-alias, shell `SYNC_TARGET`, quoted unresolved target, and source-label behavior fixtures. The shell-continuation fixture now contains a real continuation without the accidental literal `+`.
   - The unrelated PDF `gcloud run` Production target remains allowed by the boundary verifier, while IAM, local-import, caller-selected-boundary, and write signals still fail.

2. Complete successful terminal audit and durable restore recovery
   - `functions/production-week-sync-core.js` retries a complete verified run record (digest, counts, IDs, completion time, and warning) rather than recording only a phase warning. A one-time terminal audit failure therefore cannot erase the verified completion contract.
   - Verified restore now clears durable recovery only after a complete success audit is confirmed persisted. If both audit attempts fail, recovery stays set.
   - `functions/test/production-week-sync-service.test.cjs` covers transient success and cleanup-warning audit failures, restore audit persistence failure, and restore apply/rollback success/failure metadata and recovery state.
   - `functions/test/production-week-sync-boundary.test.cjs` uses the real UAT adapter/status reload path to prove a successful retry exposes a complete `latestCompletedRun` and supersedes an older `rollback_failed` terminal record.

3. Status-message priority
   - `js/uat-production-sync.mjs` now orders durable recovery warning first, valid active operation second, and historical terminal outcomes third.
   - `tests/uat-production-sync.test.mjs` proves an active `applying` or `verifying` operation is shown despite an earlier rolled-back/rollback-failed result.

## TDD evidence

- RED: `node --test tests/production-week-sync-boundary.test.mjs` initially produced five expected failures for source labels, shell assignment, unresolved variable, and `.firebaserc` alias handling.
- GREEN: the same boundary suite passed 54/54 after the verifier change.
- RED: `node --test functions/test/production-week-sync-service.test.cjs` exposed the dropped successful audit fields and premature restore recovery clear (2 expected failures); `node --test tests/uat-production-sync.test.mjs` exposed historical `rollback_failed` incorrectly masking `applying`.
- GREEN: the focused service suite passed 31/31 and UI suite 16/16. The real UAT-adapter reload regression passed 15/15.
- Restore apply-failure tests add the missing successful-rollback and rollback-failed audit/recovery coverage, including requested/current immutable snapshot IDs, fixed environments, terminal fields, and recovery state.

## Final local verification

- Focused sync/boundary/UI tests: 101/101 passed.
- `npm --prefix functions test`: passed (exit 0).
- `npm run test:all`: 644 passed, 0 failed, 1 skipped.
- Java: Homebrew OpenJDK 21.0.12.1 used locally for the emulator.
- `npm run test:rules`: both checkout-owned configurations passed, 7/7 each. Expected denial logs and local hub/logging-port fallbacks occurred; emulator exit was successful.
- `npm run verify:sync-boundary`: passed.
- `git diff --check`: passed.

## Self-review and concerns

- Confirmed the verifier scans executable/config sources only, preserves `.firebaserc` identity, and does not turn the unrelated PDF gcloud target into a sync deployment violation.
- Confirmed terminal records retain exact existing result values; no business-week numeric transformation was added.
- Confirmed restore cannot clear durable recovery unless a complete verified audit write is established.
- Concern: all evidence is local. It does not authorize or prove cloud IAM, deployment, Pages publication, or any live Production/UAT operation.

## Routing audit

- Responsibilities: Terra 100% implementation, test design, verification, and report; Sol 0%; Luna 0%.
- Credit telemetry: per-model N/A; total N/A (not exposed by this environment).
- Delegation: none, as explicitly required; this avoided unnecessary context and coordination overhead.
- Routing efficiency: GOOD.
