# V2.3 shared metrics implementation plan and ledger

Approved spec: Phase 1A execution request (2026-10-14), following accepted Phase 0A.
Baseline: a12368b739571dcfcc1d632cb082c97789d97927.
Execution: inline; one independent whole-change review before Draft PR.

## Frozen boundaries
Pure authorized-data engine, strict percentages, ISO reporting periods, signed paired deltas;
no cumulative metric, UI/renderers, Firebase, schema, IAM or deployment changes.
The public contract retains every V1 Candidate field.

## Tasks
- [x] Engine: write failing behavioral tests, implement calculateDeliveryTrends, verify.
- [x] Adapter: write failing authorization/provenance/raw-value tests, implement, verify.
- [x] Packaging: write failing parity/import/drift tests, add deterministic PDF copy and prebuild checks, verify.
- [x] Run root/PDF suites and Hosting builds; independently review; commit/push Draft PR.

## Review focus
Mixed ID/code history must never silently merge identities. Duplicate periods must fail closed.
Missing calendar weeks must stay visible. Filtered private details must never reach output.
PDF builds must reject stale generated source before building a deployment artifact.

## Rulings
- User explicitly approved the architecture and said START IMPLEMENTATION NOW; no repeated approval gate.
- Documentation lives beside the shared module within metrics ownership rather than unrelated docs directories.
- Reporting period is ISO week-year/week, supplied explicitly by the authorized caller; labels are not parsed.
- A source window has N displayed calendar slots plus a preceding baseline; absent slots remain unavailable.
- Rebaseline confirmation requires verified evidence tied to both matching baseline IDs; unknown changes stay signed.
- A provisional code match or unverified baseline lowers status to partial; recorded changes remain available.

## Verification ledger
Engine, adapter and packaging: test-first failure observed, then passing. PR50 real renderers checked in /tmp (synthetic positive/zero/negative/null).
Independent Sol High review found duplicate ID/code collision and malformed adapter lists; both reproduced with failing tests then fixed. Nested scalar metadata sanitized. Recheck: no remaining correctness blockers.
Root suite: 1515 passed, 2 skipped before final packaging regression additions. Both Hosting builds passed.

Final focused tests: 43 passed. Root: 1519 passed / 2 skipped / 0 failed. PDF full suite: 398 passed / 0 failed (Node 22 local). Both Hosting builds passed. Final independent review: PASS, no blockers.
Initial native ARM Docker attempt failed existing Chromium x86 launcher (Rosetta ELF loader); retry explicitly targets linux/amd64, matching CI/Cloud Run architecture.

Final packaging proof: linux/amd64 PDF Docker image built successfully; network-disabled container verified source checksum/import and produced delivery-trends/v1, synthetic gain +10pp. No cloud runtime executed.
Draft PR: https://github.com/augusliang23-web/pm-dashboard/pull/51. Existing isolated worktree retained; original main remains 4d297213373255b227e492b0e4a2a0551b99e02d.
