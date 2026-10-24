# S01 final integration implementation plan

**Goal:** Reproducible development candidate containing exact PR75/PR74 UX and complete PR76/PR78 hotfix history, excluding PR77.
**Product contract:** Admin retains Admin role, may self-select primary PM, cannot select other Admin or Admin deputy; recoverable assignment errors preserve inputs, real access loss clears protected state. Existing fast shell, publish safety, table/SGT/action permissions/focus remain unchanged. No redesign or cloud changes.
**Architecture:** Merge exact hotfix history into exact PR75. Preserve reviewed PR75 frontend/controller where it already supersedes the hotfix, and exact hotfix backend bytes. Native HTML/CSS/JS, no dependency changes.

- [x] Verify remote main/PR74/PR75/PR78 source identities; preserve dirty existing checkouts.
- [x] Create isolated integration branch. Inspect each of four conflicts against source histories.
- [x] Preserve PR75 frontend/controller and source guards; retain hotfix backend and history. Record each behavioral overlap.
- [x] Adapt imported historical hotfix guard via exact integration delta, rejecting missing/modified/duplicate hunks; preserve original frozen hashes and actual-source authorization assertions.
- [x] Run root/functions, rules, PDF tests, sync/parity, prod/uat builds, synthetic Sprint browser and Admin-self browser against actual integrated tree. Capture source and rollback provenance, exclude PR77 by ancestry and backend identity.
- [x] Review changed behavior and prepare commit/push of only the dedicated development branch after successful validation. Exact final commit/push evidence is recorded in the external delivery report; no PR creation/merge or deployment.

**Gate:** Report implementation/test status separately from pending independent QA and deployment authorization. Hosted CI will not run for development branch push because current CI triggers PR or main; do not change triggers or open a PR without need. Record local CI-equivalent evidence and any environment limits precisely.
