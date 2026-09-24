# v2.2T Pending Executive Milestone Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop move, rename, and delete actions for an Executive Milestone while any structural change request for that milestone is pending approval.

**Architecture:** Keep a live `Set` of pending change-request milestone IDs in each dashboard entrypoint, updated by a Firestore listener. Make every structural-action entry point consult one helper that opens a small, accessible lock dialog, and repeat the same check immediately before submission to prevent stale UI state from creating a duplicate request.

**Tech Stack:** Vanilla JavaScript in static HTML, Firebase Firestore client listeners, Node.js built-in test runner.

## Global Constraints

- Apply the identical behavior to `index.html` and `team-2/index.html`.
- A pending move, rename, or delete request locks the corresponding milestone for move, rename, and delete only; adding a different milestone remains available.
- Show this exact user-facing message: `This Executive Milestone is waiting for approval. You can move, rename, or delete it after the request is approved, rejected, or withdrawn.`
- Do not change request payloads, approval roles, Firestore Security Rules, or Firebase Functions.
- Use a failing regression test before production-code changes.

---

### Task 1: Define regression coverage for the pending structural lock

**Files:**
- Create: `js/executive-pending-lock.mjs`
- Test: `tests/executive-pending-lock.test.mjs`
- Modify: `tests/executive-governance-ui.test.mjs`
- Modify: `index.html`
- Modify: `team-2/index.html`

**Interfaces:**
- Consumes: Each dashboard's existing `openExecutiveStructuralAction({ action, itemId, sectionId, quarterKey, targetIndex })` entry point and Firestore `onSnapshot` API.
- Produces: Executable regression coverage for pending request normalization and move/rename/delete lock decisions, plus UI wiring coverage in both dashboard files.

- [ ] **Step 1: Write the failing test**

Create `tests/executive-pending-lock.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingExecutiveMilestoneIds, isExecutiveMilestoneActionLocked } from '../js/executive-pending-lock.mjs';

test('pending requests lock move rename and delete only for their milestone', () => {
  const pendingIds = pendingExecutiveMilestoneIds([
    { state: 'pending', itemId: 'ms-1' },
    { state: 'approved', itemId: 'ms-2' },
    { state: 'pending', itemId: '' },
  ]);
  assert.deepEqual([...pendingIds], ['ms-1']);
  for (const action of ['move', 'rename', 'delete']) {
    assert.equal(isExecutiveMilestoneActionLocked({ action, itemId: 'ms-1', pendingIds }), true);
  }
  assert.equal(isExecutiveMilestoneActionLocked({ action: 'add', itemId: 'ms-1', pendingIds }), false);
  assert.equal(isExecutiveMilestoneActionLocked({ action: 'move', itemId: 'ms-2', pendingIds }), false);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/executive-pending-lock.test.mjs`

Expected: FAIL because `js/executive-pending-lock.mjs` does not exist.

- [ ] **Step 3: Implement the smallest shared UI behavior in both dashboard files**

Create `js/executive-pending-lock.mjs`:

```js
const STRUCTURAL_ACTIONS = new Set(['move', 'rename', 'delete']);

export function pendingExecutiveMilestoneIds(records = []) {
  return new Set((Array.isArray(records) ? records : [])
    .filter(record => record?.state === 'pending')
    .map(record => String(record.itemId || '').trim())
    .filter(Boolean));
}

export function isExecutiveMilestoneActionLocked({ action, itemId, pendingIds }) {
  return STRUCTURAL_ACTIONS.has(String(action || ''))
    && pendingIds instanceof Set
    && pendingIds.has(String(itemId || '').trim());
}
```

Import both functions into each dashboard module. Keep one `let executivePendingMilestoneIds = new Set();` state value in each dashboard, plus:

```js
function showExecutiveMilestonePendingDialog() {
  openAccessibleModal(document.getElementById('executivePendingMilestoneOverlay'));
}
```

Add this markup beside the existing Executive overlays in both files:

```html
<div class="overlay" id="executivePendingMilestoneOverlay" data-editor-overlay role="dialog" aria-modal="true" aria-labelledby="executivePendingMilestoneTitle" onclick="closeProjectOverlayFromBackdrop(event)">
  <div class="modal-card" role="document">
    <h3 id="executivePendingMilestoneTitle">Approval pending</h3>
    <p>This Executive Milestone is waiting for approval. You can move, rename, or delete it after the request is approved, rejected, or withdrawn.</p>
    <div class="modal-actions"><button type="button" class="btn btn-primary" onclick="closeModal('executivePendingMilestoneOverlay', { force: true })">Close</button></div>
  </div>
</div>
```

Start one global `onSnapshot(query(collection(db, 'executiveMilestoneChangeRequests'), where('state', '==', 'pending')))` listener after Firebase is available. On every snapshot, pass `snapshot.docs.map(entry => entry.data())` to `pendingExecutiveMilestoneIds`, compare the returned set with the existing one, replace `executivePendingMilestoneIds`, and call `render()` only when the set changes.

Make all three guards return without mutation:

```js
if (isExecutiveMilestoneActionLocked({ action, itemId: location.item.id, pendingIds: executivePendingMilestoneIds })) {
  showExecutiveMilestonePendingDialog();
  return;
}
```

Place it after `findExecutiveTimelineItem` in the `dragstart` handler; after the `location` check in `openExecutiveStructuralAction` when `action` is `move`, `rename`, or `delete`; and after `buildExecutiveChangePayload()` in `submitExecutiveChangeRequest` using `payload.itemId`. For a locked drag handle, render `draggable="false"` and an `aria-disabled="true"` value; retain its button so an attempted pointer action can show the dialog through its click handler. Do not gate `add`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/executive-pending-lock.test.mjs tests/executive-governance-ui.test.mjs`

Expected: PASS with the new pending-lock test and all pre-existing tests in that file green.

- [ ] **Step 5: Commit the UI and regression test**

```bash
git add js/executive-pending-lock.mjs index.html team-2/index.html tests/executive-pending-lock.test.mjs tests/executive-governance-ui.test.mjs
git commit -m "feat: lock pending Executive milestone changes"
```

### Task 2: Verify the complete v2.2T regression suite

**Files:**
- Verify: `tests/*.test.mjs`
- Verify: `team-2/*.test.mjs`
- Verify: `functions/test/*.test.cjs`

**Interfaces:**
- Consumes: The completed pending-lock UI behavior from Task 1.
- Produces: Evidence that the feature does not regress existing v2.2T dashboard or Functions behavior.

- [ ] **Step 1: Run all root dashboard tests**

Run: `node --test tests/*.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 2: Run maintained team-entrypoint tests**

Run: `node --test team-2/*.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 3: Run Executive Functions tests**

Run: `node --test functions/test/*.test.cjs`

Expected: PASS with zero failures.

- [ ] **Step 4: Inspect the final diff and working tree**

Run: `git diff HEAD~1 --check && git status --short`

Expected: no whitespace errors and no uncommitted files.
