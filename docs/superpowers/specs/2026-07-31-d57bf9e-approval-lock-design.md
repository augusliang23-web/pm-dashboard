# d57bf9e UAT Approval-Lock Integration Design

## Goal

Deploy the UAT root page from commit `d57bf9e4e2c04f588584a03d7f6a283340582145` while retaining the Executive Milestone approval-lock behavior added on 2026-07-31.

## Scope

- Restore the UAT repository's deployable root-page code to the `d57bf9e` baseline.
- Preserve the baseline's centered Executive Milestone editor (`.executive-item-modal`).
- Add the approval-lock behavior only to the root page and its root JavaScript helper.
- Do not modify the `team-2/` page or promote other v2.2T changes.

## Behavior

1. The page observes pending `executiveMilestoneChangeRequests` for Executive Milestones.
2. If a milestone has a pending request, a later move, rename, or delete attempt is stopped before any write is made.
3. The user sees a dialog explaining that the milestone is waiting for approval and becomes editable after approval, rejection, or withdrawal.
4. All other d57bf9e UI, Firebase configuration, data behavior, and permissions remain unchanged.

## Implementation Boundary

- `index.html` supplies the centered editor UI and invokes the pending-lock guard at each structural action.
- `js/executive-pending-lock.mjs` owns the pure pending-request lookup and lock predicate.
- `tests/executive-pending-lock.test.mjs` verifies the helper behavior.
- `tests/executive-governance-ui.test.mjs` verifies that the root page uses the lock guard and retains the centered editor contract.

## Validation

- Tests first demonstrate that the d57bf9e baseline lacks the pending-lock module and action guards.
- Focused root governance and lock tests pass after the implementation.
- The public UAT root page is checked after GitHub Pages deploys, and `team-2/` is not changed.

## Non-goals

- No changes to the `team-2/` UI or scripts.
- No migration of post-d57bf9e v2.2T interface, configuration, test, or deployment changes beyond the approval lock.
