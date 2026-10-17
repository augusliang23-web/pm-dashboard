# Archive scope restoration and separate missing-project investigation

Date: 2026-10-15 (Asia/Singapore). PR: #54, Draft. Validation scope: isolated local checkout; no deployment or Production data mutation.

## Result

Archive permission expansion is CANCELLED. No selected-PM Archive grant was implemented. Existing permission registries and Firestore week-read permissions are unchanged. Archive is again an official lifecycle operation outside Draft Publish. Implementation is ready for review, not live-UAT accepted or authorized for Production.

## Conflicts with the previous PR #54 head (bb5ff69)

| Conflict | Correction |
| --- | --- |
| Archive/restore management launched from Draft editor/My Drafts | Removed; management uses official project cards and existing permission checks |
| Archived official projects entered Draft conversion | Original archived editor/save restored; new archived source conversion rejected |
| A previously published draft could insert an active row into an empty later week | Server rejects any absent target for a previously published draft; no archive resurrection or historical reconstruction |
| Chinese buttons, messages and accessibility labels | Product text changed to English; project-entered data untouched |

Save Draft and Save & Publish remain the two actions for active new/existing project content. Archive keeps its separate established lifecycle and management. Admin may explicitly restore visibility through existing management; neither draft action performs that transition.

## Validation

- Regression RED: four failures reproduced before implementation (cross-week resurrection, archived source conversion, legacy archived editor contract, Draft management UI coupling). GREEN: focused handler/UI tests passed.
- Complete root suite: **1,543 passed, 0 failed, 2 existing emulator-only skips** (1,545 total).
- Explicit Firestore emulator suites: **49 passed, 0 failed, 0 skipped** (Production 15, UAT 17, shared backend 17).
- Production and UAT Hosting builds: PASS. Production frozen rendering contract: PASS. Synchronization boundary and diff check: PASS.
- English text scan: no Han characters in product HTML/JS, draft server modules or generated UAT HTML/JS. User content is not translated.
- No new live browser/UAT cloud acceptance in this revision. Earlier local synthetic Draft UI/PDF acceptance remains historical evidence only. Current-head CI and independent review are reported separately below when available.

## Missing Rectifier: separate read-only evidence

The 2026-10-14 investigation used normal Admin Dashboard access and Firebase Console read-only inspection. These are dated observations, not a fresh Production read on 2026-10-15.

- Found in `weeks/W39-2026.projects`: `H/W-005`, name `3.3kW Bi-Di Rectifier`, Project Manager `Manson`, `visibility: archived`. W39 was released/locked.
- Admin **W39 / All / All PMs / All categories** showed it. W40's raw project array did not contain H/W-005; W40–W42 All views did not show it.
- All operates within the selected reporting week. Existing carryover copies active/default projects, excluding archived projects. Source inspection and local reproduction support this explanation for later-week absence.
- Active intentionally excludes archived projects. PM and category filters can further narrow results; W39 was Module. Non-Admin visibility remains subject to the existing role rules.
- The project was therefore not proven deleted: its archived historical record exists. Recreating it or copying it into a later week is unwarranted and unauthorized.

**Root-cause confidence:** confirmed W39 existence and W40 absence; current-week filtering and Archive exclusion from carryover explain the symptom. The exact historic W40 creation event/operator and Archive timing were not audited, so full historic causality is not claimed.

## Remaining read-only investigation tasks

1. Recheck the current deployed version and W39/W40 state if a fresh live confirmation is required; retain document IDs, not only project names.
2. If available under existing access, inspect W40 creation/audit records and archived-state timing to distinguish normal carryover from a later manual modification.
3. Reproduce the affected account's exact week, Active/All, PM and category selection using its existing access. Do not grant access or bypass released-week locks to run the test.
4. Record the bug as explained by historical-week scope unless those checks contradict the evidence. Do not reconstruct project data.

## Recommendations and boundaries

Keep PR #54 Draft until this revised scope is reviewed. Continue any missing-project investigation as a separate read-only item. Use the original W39 record to inspect preserved history under existing access; do not copy it into current metrics. Do not revive the cancelled Archive grant or introduce cross-week search without a separate product decision.

Existing raw weeks contain multiple projects, and pre-PR server ownership checks do not provide a new per-project Archive privacy boundary. This revision preserves those existing access contracts; it does not claim to fix legacy isolation gaps. Any security hardening requires a separately bounded decision rather than silently expanding this task.

No merge, deploy, Production writes, permission expansion, IAM provisioning, migration, recreation or historical backfill performed.

## Independent review and conflict behavior

The reviewer verified normal Archive → Restore Active keeps the exact original project fingerprint, so it does not prevent subsequent Draft publishing. If official content was edited while archived and then restored, the prior working draft correctly rejects a stale overwrite; automatic rebasing is outside scope. Original Active/Hidden/Archived visibility choices remain available only under the existing Admin control.

Independent review result: **PASS for local scope; no blockers**. Reviewer independently ran **39 focused tests**, zero failures, and an in-memory actual-handler Archive/Restore probe. Live UAT and Production were not reviewed. Current-head CI is pending until this revision is pushed.
