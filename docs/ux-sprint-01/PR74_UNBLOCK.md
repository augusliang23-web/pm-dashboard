# PR74 unblock — 2026-10-24

Scope: finish existing UX-01/02 on PR74 only. Preserve Production hotfix ed3f814 behavior in future integration; no PR75/main/PR77 changes, cloud actions or live writes.

Plan:
1. Reproduce exact-SHA CI failures; retain all three historical hashes.
2. RED→GREEN tests for cached-directory Admin-self eligibility/current Admin-owner preservation and PR78 structured assignment-error recovery versus real access loss. Keep backend hotfix as a separate integration dependency.
3. Record an exact context-checked Sprint source delta. Normalize only this enumerated delta for the three legacy hash assertions; prove original main bytes and reject missing/duplicated/modified hunks, permissions drift and unrelated changes. Do not alter actual-source behavior tests or old expected hashes.
4. Run focused/full regressions, both Hosting builds and synthetic emulator/browser scenarios. Build a temporary local integration candidate with ed3f814 and verify the hotfix survives. Never push that integration candidate.
5. Update PR74 only after validation; collect exact-SHA CI and handoff. Independent final QA remains Antigravity, not self-approval.

Status: in progress. Initial root failure: three original hashes; initial fourth local failure was absent Functions dev dependency, fixed by locked full npm ci without source changes. GitHub prior CI4/5, root failed. No new GitHub review comments; previous week-roundtrip cancellation fix already present in c1d652c.

## Changes and verification

- Cached Admin opening includes exactly the current Admin as Primary PM, never as Deputy; existing non-PM owner remains selected as a disabled current-assignment option. No backend logic was changed on PR74.
- Ported the approved PR78 structured error classifier, retaining PR74 request lanes. Only `assignment-forbidden` is recoverable; actual auth/role/draft/ownership loss clears private state. A later denial cannot reuse an earlier reason.
- Source review's previous W43→W42→W43 cancellation repair was already in the starting HEAD. Added actual logout-during-open browser coverage; old delayed responses cannot reopen private editor content after relogin.
- Original frozen values remain `25cd73c6…`, `64600743…`, `d2b7cc05…`. The new test-only fixture enumerates 21 exact raw-source hunks. All normalized bytes hash back to original main `7753c50a…`. Modified/missing/duplicated hunks fail closed; unrelated permission changes survive normalization and fail equivalence. Actual-source role/behavior tests continue using actual source. No test skip, blind expected-hash refresh, protected Production inventory expansion, or guard removal.
- Focused 68/68 pass; full root 1,828 pass / 3 existing skips / 0 fail; both Hosting profiles build (39 assets), sync boundary and Delivery Trends package parity pass. Final exact-SHA CI must be read from PR checks after push; local evidence is not a CI claim.
- Synthetic Auth/Firestore/Functions browser flows:22 groups, pageErrors0. Includes immediate loading/cancel, week-roundtrip invalidation, logout cancellation/relogin, real revision conflict, real assignment validation, network failure/retry, publish validation, double-click protection, slow list refresh, pending week transition, Save Draft persistence through logout/login, Overview/Delivery Trends/PDF selection. Real access revocation intentionally clears private values; recoverable validation/network/conflict keeps inputs. No deployed acceptance claim.

## Mandatory future integration dependency

Production is ahead of main at exact approved hotfix `ed3f81445732f488c163890c1d8f1da8cb15b166`. PR74 does NOT replace that backend and must not be promoted by itself over Production. Preserve its exact backend, especially `functions/project-drafts-core.js` Admin self-only Primary PM rule. Preserve PR74's generation guards/lane concurrency and the shared PR78 access-loss classifier when resolving frontend overlap. Do not import PR77 delegation.

A disposable candidate was assembled from `git archive ed3f814…`, overlaying ONLY this PR74 `index.html` and `js/project-drafts-controller.mjs`. All other runtime bytes remain the approved hotfix's. Original hotfix emulator E2E passed11 groups across Production/UAT profiles: Admin-self create/save/publish/reopen/republish/relogin/week navigation, second Admin progress editing without changing owner, PM continuity and denied other-Admin/Deputy/invalid-role/missing-auth assignments. Evidence JSON records exact backend SHA and frontend file hashes. This is a targeted local integration proof, not a merged candidate or full integration CI/QA PASS.

PR75 remains at `304c38e1ff36ee54552bc6806ae2796f7d3f4a93`, stacked on the prior PR74 commit. Its code is untouched; its owner must reconcile the new PR74 base and rerun its table/lifecycle checks before acceptance. Neither PR may merge/deploy based on this report alone.

## Reproduction / Antigravity handoff

Use Node22 and Java21, locked npm ci in root/functions/pdf-service. `firebase emulators:exec --config firebase.v231-e2e.json --project demo-pm-dashboard-v22t --only auth,firestore,functions "node scripts/verification/ux-sprint-01-browser.mjs --functional"` runs the synthetic scenario suite; set a disposable `SPRINT_TEST_PASSWORD` locally, never put it in reports. Default ports8188/9198/5108/4198/hub4468/log4568 must be unused.

During this run another local emulator owned those ports; it was left untouched. A disposable harness copy changed only numeric ports to8287/9297/5207/4297/hub4497/log4597. The integration harness used8387/9397/5307/4397/hub4496/log4596 and awaited editor loading completion for PR74's immediate shell. No source/callable behavior was changed in those harness copies. All emulator writes used demo-pm-dashboard-v22t synthetic data. No credentials are recorded.

Independent QA scope: verify four opening entries, slow read feedback, publish commit-before-close, retry/input retention versus true access-loss clearing, double click, slow refresh, cancel/logout/week transitions. Validate the approved hotfix integration dependency before any combined candidate can ship. Existing benchmark JSON remains historical and was not rerun or represented as fresh deployed timings.

Status: READY FOR independent QA after exact-SHA CI passes; Antigravity final QA NOT RUN. No merge or deployment authority.
