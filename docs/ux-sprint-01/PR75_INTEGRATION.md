# PR75 integration — 2026-10-24

Approved base: PR74 46c8095f3be250bacc1cf29e3eace4b2d8a10fc6; initial PR75 304c38e1ff36ee54552bc6806ae2796f7d3f4a93. Only PR75 may be updated. No main/PR74/PR77, deployment, cloud/IAM/Rules or real data changes.

Plan: merge verified PR74 without rewriting history; preserve all runtime changes and resolve documentation status conflict. RED→GREEN Refresh focus over busy/success/error renders. Verify P2-2 recoverable assignment versus true access-loss and stale concurrent reads. Preserve historical hashes with separate exact PR75 delta reversal ahead of PR74's guard. Run focused/full tests, builds, actual synthetic browser/table/lifecycle checks, approved-hotfix local integration, then exact-SHA CI. Backend hotfix remains an explicit integration dependency.

Implementation/tests/CI: in progress. Independent review/QA not claimed.

## Resolution

The only merge conflict was the Sprint task-status table: kept verified PR74 UX-01/02 rows and existing PR75 UX-03/04 rows. `index.html` and the scenario script merged automatically; native editor shell, loading, Publish control/close protection, generation/lane handling, PR78 classifier and Admin-self owner picker all remain present. PR75 table, three authoritative publication states, SGT timestamps, server order/query scope, New Draft/Refresh, mobile scroll region, labelled overflow lifecycle dialog and role gating remain intact. No backend/Rules/IAM files changed.

### P2-1

Busy rendering removes the focused Refresh node, falls back to the table, and then captures the table as the new focus key. A small deferred key now preserves the original focus through busy/success/error renders; if the user deliberately moves focus outside the workspace, completion does not steal it. Actual Refresh focus, not just `root.contains(activeElement)`, is asserted. Cases include success, network failure, empty list and external focus.

### P2-2

The approved PR78 classifier remains unchanged: assignment-forbidden retains selection/drafts/form values, real authentication or access loss clears them. A parallel read-only source check found that PR74's separate request lanes allowed older list/get successes to refill state after a newer access denial. Four real controller cases reproduced the issue. Access loss now advances generation, clears pending lanes, clears private values and emits the denial immediately; old callbacks/finalizers cannot rehydrate protected data. Recoverable errors do not reset the lanes. Targeted read-only follow-up found no remaining issue in that changed block; this is not final Antigravity browser QA.

### Frozen source protection

All three original expected hashes and PR74's 21-hunk source-delta fixture are unchanged. A separate five-hunk exact PR75 table/lifecycle reversal reproduces verified PR74 raw HTML SHA256 `f2e2d4c51f3fdf4c67daffcfab7ac51ed26b4531af2d040cc0f9cb961fb977c1`; then PR74's guard reproduces original main. Each stage rejects modified/missing/duplicated hunks and leaves unrelated authorization changes visible. These reversals are used only by the legacy hash proofs; actual-source role/behavior tests remain active. No test skip, expected-hash refresh, generic allowlist or security bypass.

## Verification evidence

- Focused P2 suite43/43; delta/historical suite51/51; root1849 pass /3 existing skip /0 fail. No new skips.
- Production and UAT Hosting builds39 assets each; sync boundary and Delivery Trends package parity pass.
- Real Chromium+Auth/Firestore/Functions emulator suite28 groups, pageErrors0. Refresh keyboard focus returns to the Refresh button after both delayed success and network failure. Assignment rejection retains form and draft table. Access revocation clears protected editor. Includes prior cancellation/logout/publish/retry/week cases, table order/SGT, keyboard dialog/delete-confirm cancellation, Admin/PM action visibility and390px scrolling to Actions.
- Disposable local hotfix integration: exact `ed3f81445732f488c163890c1d8f1da8cb15b166` archive, overlay ONLY PR75 `index.html`, controller and drafts-ui modules. All backend bytes remain the approved hotfix; no branch backend changes. Original hotfix E2E11 groups across prod/uat profiles pass, pageErrors0: Admin-self save/publish/reopen/relogin/week/edit, second Admin progress edit preserving owner, PM continuity and rejected other Admin/Deputy/non-authorized assignments.
- Exact-SHA CI must be checked after push: root, rules, PDF/local Linux image smoke, sync boundary and both Hosting profiles. This document records local evidence, not a premature CI PASS.

## Reproduce / QA boundary

Use Node22 + Java21; locked dependencies in root/functions/pdf-service. Standard `firebase.v231-e2e.json` and `scripts/verification/ux-sprint-01-browser.mjs --functional`, demo-pm-dashboard-v22t only; supply a disposable local SPRINT_TEST_PASSWORD. No credentials in reports.

Existing emulator ports were occupied and left untouched. Disposable copies changed only numeric ports: standalone8487/9497/5407/5497 hub5697 log5797; hotfix lab8587/9597/5507/5597 hub5696 log5796. Hotfix harness additionally awaits shell hydration before asserting values. All data writes were synthetic and local. Temporary copies/configs removed from PR75 working tree after testing.

PR75 alone is NOT a full Production candidate: Production's hotfix backend is ahead of main and must stay in any future shipping integration. Do not restore PR75/main's old PM-only backend over it. The local integration manifest pins backend SHA and actual frontend file hashes; this targeted proof is not full merged integration CI/QA. No PR77 delegation, merge to main or deployment occurred. PR74/main/PR77 refs stay unchanged.

Remaining product gate: independent Antigravity final browser QA and Control Plane acceptance. No release readiness or deployment permission is claimed. Historical performance values were not rerun or relabelled as current/cloud latency.
