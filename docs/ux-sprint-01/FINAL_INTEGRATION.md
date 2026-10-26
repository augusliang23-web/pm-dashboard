# S01 final integration candidate — QA handoff

This is a development-only candidate. Independent Antigravity QA, Control Plane acceptance, UAT and release authorization remain separate gates. No PR merge, deployment, live data write or infrastructure mutation was performed.

## Product contract and source identities

Combine exact remote main `b3b7a51d5db680cfc87acdf24d06d73a9de2aaac`, complete approved PR76+PR78 hotfix `ed3f81445732f488c163890c1d8f1da8cb15b166`, PR74 `46c8095f3be250bacc1cf29e3eace4b2d8a10fc6` and PR75 `c4ee49417eed4388653ed1491c3ab549c77e3982`. Integration branch: `codex/s01-final-integration`. Final delivery report identifies the merge commit; its parents are exact PR75 and hotfix, both preserved as ancestry. PR74 is already in PR75 history. PR77 is excluded.

Admin retains its role and privileges, may self-select Primary PM, and may save/publish/reopen; other Admin and Admin deputy assignment remain denied. Recoverable assignment rejection retains drafts/form inputs; genuine auth/access loss clears private state and invalidates older reads. Preserve immediate shell/loading, publishing protection, cancel/logout/week generation, My Drafts table/SGT/actions and Refresh keyboard focus. No redesign or new product behavior.

## Four conflict resolutions

1. `index.html`: inspected both implementations. Preserve exact PR75 frontend: it already includes Admin self owner and disabled existing-owner preservation, plus immediate shell, auth-scoped directory cache and generation checks. Do not restore the older per-open user-directory read from hotfix. The backend remains authoritative for assignment eligibility.
2. `js/project-drafts-controller.mjs`: exact PR75 includes PR78's classifier and the newer independent request lanes, pending tracking and cross-lane invalidation after genuine access loss. Retain these; do not revert to hotfix's single global request sequence.
3. `tests/role-contract.test.mjs` and `tests/delivery-trends-integration.test.mjs`: preserve PR75's exact reversal chain and original expected historical hashes.

Actual index/controller/drafts UI bytes equal pinned PR75. Entire `functions/` tree equals approved hotfix, including its Admin-self security tests. Runtime delta relative PR75 is only the reviewed three-line Admin-self backend eligibility change. No additional application source changes.

## Frozen-source proof

The imported hotfix historical guard expected the old frontend and initially failed 2/5 tests. New `s01-integration-source-delta.json` enumerates 24 exact reviewed changes from hotfix HTML to integration HTML. A test-only helper requires every after-block exactly once, then restores approved hotfix raw SHA256 `4f6639a81fc43e47bb7212f8f5c4c1578e1df1934e2352f30a51eece4ecd1320`. The unchanged hotfix helper then proves original main equivalence. Missing, modified and duplicate blocks are rejected; unrelated authorization drift cannot match the target hash.

Original hotfix, PR74 and PR75 fixtures remain unchanged. Three historical rendered hashes remain unchanged. Actual-source role/behavior tests still read the actual candidate. No security tests skipped or widened.

## Validation

- Focused source/security/controller/focus tests: 117 PASS, 0 fail.
- Node22 full root/Functions suite: 1,889 PASS, 0 fail, 3 pre-existing skips (1,892 total).
- Firestore Rules emulators: production 16/16, UAT 17/17, shared backend 17/17. Rules bytes unchanged.
- Both prod and uat Hosting builds: 39 assets each; sync boundary and Delivery Trends package parity PASS.
- Actual Chromium + synthetic Auth/Firestore/Functions: 28 Sprint UX scenario groups PASS, 11 hotfix scenario groups PASS, pageErrors empty in both.
- PDF full suite: 551 PASS, 0 fail/skip; both deploy-script dry-runs and local Linux Docker build/smoke PASS (OPTIONS 403 without Origin, unknown route 404). Dry-runs do not start gcloud. Container built locally from Docker Hub base, no registry push and no Artifact Registry layer downloads. Local container runtime is Node24.21.0 amd64 as in CI; host test runner is Node22, whereas hosted PDF CI uses Node24.21.0.
- Locked installed dependency versions verified: root 726, Functions 756 and PDF 249 package versions, no mismatch. Existing dependency directories reused locally without lockfile changes.
- Bounded read-only source review found no blocker. This does not replace final independent browser QA.

Hosted CI is NOT RUN for this new branch: existing `ci.yml` only triggers on pull requests or main push. No workflow changes, new PR or manual cloud release was made. Local equivalent jobs are recorded separately; never call this candidate hosted CI 5/5.

## Reproduce locally

Use Node22, Java21, and the committed lockfiles (`npm ci` in root, functions and pdf-service). Build with `node scripts/build-hosting.mjs --env prod` and `--env uat`. Full tests: `npm run test:all`, `npm run test:rules`, `npm test` in pdf-service, plus CI parity/sync commands. Existing `.github/workflows/ci.yml` contains the exact Linux image and smoke instructions.

Set `SPRINT_TEST_PASSWORD` to a disposable local value without recording it. Ensure standard ports in `firebase.v231-e2e.json` and static port4198 are free; do not kill other services. Run:

```
node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-pm-dashboard-v22t --config firebase.v231-e2e.json --only auth,firestore,functions 'node scripts/verification/ux-sprint-01-browser.mjs --functional && node scripts/verification/admin-self-hotfix-e2e.mjs --functional'
```

These scripts delete/reseed ONLY the explicitly asserted demo emulator database. Never run against a live project. Synthetic emails are sprint.admin@example.test (Admin), sprint.pm@example.test (PM), sprint.other@example.test (PM), sprint.vip@example.test (VIP), and another.admin@example.test. Weeks W30–W43, SOURCE/PUBLISHED/DRAFT projects and releaseCapabilities are generated by scripts. No real account credentials are included.

The hotfix browser script now awaits shell hydration before checking form values; its assertions remain unchanged. Sprint flows cover delayed opening/read failure, duplicate publish, failed publish retry/input retention, cancel/logout/week changes, authoritative publish before slow refresh, recoverable assignment failure and genuine access loss, table data/SGT/order, lifecycle menu permissions, keyboard Refresh success/error and 390px mobile layout. Hotfix flows cover Admin self create/save/publish/reopen/relogin/week, second Admin progress edit preserving original owner, PM continuity and denied assignments with no writes.

Evidence under `final-integration-evidence/` includes byte hashes, both source deltas, actual-browser results and screenshots. Browser result metadata describes precommit tested bytes; final report independently maps those exact bytes to the final commit. Prior performance measurements remain historical; no fresh timing matrix or cloud-latency claim is made.

## PR77 exclusion and rollback provenance

Check PR77 SHA `e40f6e46b8b66bc51e20d3397654d7e018c0ec80` is NOT an ancestor; approved hotfix and PR75 ARE ancestors. Functions tree hash equals hotfix. Protected Rules, permission registries, project-drafts adapter and deployment configuration remain unchanged. Runtime contains no `project.assignment.delegate`, `pendingAssignment`, `lastAssignmentTransfer`, `preparePendingAssignment` or `result.transferred`.

This work preserves source fallback provenance, not a cloud rollback guarantee. The previous approved hotfix source is `ed3f814…`, and PR75 parent `c4ee494…` is UX provenance only: it lacks the hotfix backend and must not be deployed as a complete rollback. Any future release/rollback needs its own live Hosting and serving-Function revision capture and coordinated frontend/backend assessment. No live rollback inventory was queried or changed in this development task. Never roll back to a frontend that can erase Admin-owned assignment or replace the hotfix backend with old main.

## Remaining gates

Implementation/local validation can be handed to Antigravity for independent browser QA at the exact final commit. Control Plane decides acceptance and whether to create an integration PR for hosted CI. UAT deployment and production release are not authorized by this document. No source branch is deleted, existing PR is modified, or live deployment changed.
