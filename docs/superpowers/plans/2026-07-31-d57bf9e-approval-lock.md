# d57bf9e UAT Approval-Lock Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the centered `d57bf9e` UAT root page with pending Executive Milestone moves, renames, and deletes locked until their request leaves approval.

**Architecture:** Create a small root-page helper that derives the IDs with pending change requests and answers whether a structural action is locked. Restore deployable files from `d57bf9e`, then wire this helper and a Firestore listener into root `index.html`; no `team-2/` file is restored or modified.

**Tech Stack:** Static HTML and browser ES modules, Firebase Firestore SDK, Node.js built-in test runner, GitHub Pages.

## Global Constraints

- Restore only the UAT root-page implementation to commit `d57bf9e4e2c04f588584a03d7f6a283340582145`.
- Keep the root centered editor contract: `.executive-drawer-overlay` centers `.executive-item-modal`.
- Do not modify any `team-2/` path.
- A pending request blocks move, rename, and delete before a Firestore write; the dialog says it is waiting for approval.

---

### Task 1: Restore the d57bf9e deployment baseline

**Files:**
- Modify: deployment files differing between `d57bf9e` and `main`, restoring their `d57bf9e` content
- Preserve: `docs/superpowers/specs/2026-07-31-d57bf9e-approval-lock-design.md`
- Preserve: `docs/superpowers/plans/2026-07-31-d57bf9e-approval-lock.md`

**Interfaces:**
- Consumes: `git diff --name-only d57bf9e..HEAD`
- Produces: root `index.html` exactly based on `d57bf9e`, with its centered `executive-item-modal` available for Task 2

- [ ] **Step 1: Record the current d57bf9e centered-editor contract**

Run:

```bash
git show d57bf9e:index.html | rg -n 'justify-content:center|executive-item-modal'
```

Expected: the source contains `justify-content:center` and `class="modal executive-item-modal"`.

- [ ] **Step 2: Restore non-document deployment files from d57bf9e**

Run:

```bash
git diff --diff-filter=M --name-only d57bf9e..HEAD -- . ':!docs/superpowers/**' | xargs -I{} sh -c 'git show d57bf9e:"$1" > "$1"' _ {}
git diff --diff-filter=A --name-only d57bf9e..HEAD -- . ':!docs/superpowers/**' | xargs -r git rm --
```

Expected: root deployable files equal d57bf9e; no `team-2/` file is checked out or edited.

- [ ] **Step 3: Verify the centered editor remains intact**

Run:

```bash
rg -n 'justify-content:center|class="modal executive-item-modal"' index.html
git diff --name-only -- team-2
```

Expected: both root editor markers appear; the second command prints no paths.

### Task 2: Specify the pending-request lock with a failing test

**Files:**
- Create: `tests/executive-pending-lock.test.mjs`
- Create: `js/executive-pending-lock.mjs`

**Interfaces:**
- Produces: `pendingExecutiveMilestoneIds(records)` returning `Set<string>` and `isExecutiveMilestoneActionLocked({ action, itemId, pendingIds })` returning `boolean`
- Consumed by: Task 3 root-page action guards

- [ ] **Step 1: Write the failing helper test**

Create `tests/executive-pending-lock.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isExecutiveMilestoneActionLocked,
  pendingExecutiveMilestoneIds,
} from '../js/executive-pending-lock.mjs';

test('only pending Executive Milestone requests lock the matching milestone', () => {
  const pendingIds = pendingExecutiveMilestoneIds([
    { itemId: 'waiting', state: 'pending' },
    { itemId: 'approved', state: 'approved' },
    { itemId: '', state: 'pending' },
  ]);

  assert.equal(isExecutiveMilestoneActionLocked({ action: 'move', itemId: 'waiting', pendingIds }), true);
  assert.equal(isExecutiveMilestoneActionLocked({ action: 'move', itemId: 'approved', pendingIds }), false);
});
```

- [ ] **Step 2: Run the test to verify it fails because the helper does not exist**

Run:

```bash
node --test tests/executive-pending-lock.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `js/executive-pending-lock.mjs`.

- [ ] **Step 3: Implement the minimal helper**

Create `js/executive-pending-lock.mjs`:

```js
export function pendingExecutiveMilestoneIds(records = []) {
  return new Set(records
    .filter(record => record?.state === 'pending' && typeof record?.itemId === 'string' && record.itemId)
    .map(record => record.itemId));
}

export function isExecutiveMilestoneActionLocked({ action, itemId, pendingIds }) {
  return ['move', 'rename', 'delete'].includes(action) && Boolean(itemId && pendingIds?.has(itemId));
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run:

```bash
node --test tests/executive-pending-lock.test.mjs
```

Expected: PASS with 1 test.

### Task 3: Guard root Executive structural actions

**Files:**
- Modify: `index.html`
- Modify: `tests/executive-governance-ui.test.mjs`
- Create: `js/executive-pending-lock.mjs` (from Task 2)

**Interfaces:**
- Consumes: `pendingExecutiveMilestoneIds(records)` and `isExecutiveMilestoneActionLocked({ action, itemId, pendingIds })`
- Produces: a Firestore-backed `Set` of pending milestone IDs and guard calls for move, rename, and delete

- [ ] **Step 1: Add a failing root UI source test**

Add assertions to `tests/executive-governance-ui.test.mjs` requiring:

```js
assert.match(source, /from ['"]\.\/js\/executive-pending-lock\.mjs['"]/);
assert.match(source, /This Executive Milestone is waiting for approval\./);
assert.match(source, /isExecutiveMilestoneActionLocked\(/);
assert.match(source, /\.executive-drawer-overlay\s*\{\s*justify-content:center/);
assert.match(source, /class="modal executive-item-modal"/);
```

- [ ] **Step 2: Run the UI source test to verify it fails**

Run:

```bash
node --test tests/executive-governance-ui.test.mjs
```

Expected: FAIL because d57bf9e does not import or use the pending-lock helper.

- [ ] **Step 3: Implement the root-page listener and guards**

In `index.html`:

```js
import { isExecutiveMilestoneActionLocked, pendingExecutiveMilestoneIds } from './js/executive-pending-lock.mjs';

let executivePendingMilestoneIds = new Set();

function showPendingExecutiveMilestoneLock() {
  alert('This Executive Milestone is waiting for approval. You can move, rename, or delete it after the request is approved, rejected, or withdrawn.');
}
```

Subscribe to `executiveMilestoneChangeRequests` using the existing Firestore listener pattern, assigning `executivePendingMilestoneIds = pendingExecutiveMilestoneIds(snapshot.docs.map(doc => doc.data()))`. Before each move, rename, and delete write path, call `isExecutiveMilestoneActionLocked({ action, itemId, pendingIds: executivePendingMilestoneIds })`; if true, call `showExecutiveMilestonePendingDialog()` and return before the write.

- [ ] **Step 4: Run focused root tests to verify them passing**

Run:

```bash
node --test tests/executive-pending-lock.test.mjs tests/executive-governance-ui.test.mjs
```

Expected: PASS with all tests green.

### Task 4: Verify, commit, push, and confirm the UAT deployment

**Files:**
- Modify: root deployment files restored in Task 1, `index.html`, `js/executive-pending-lock.mjs`, and root tests
- Do not modify: `team-2/**`

**Interfaces:**
- Consumes: the focused passing test suite
- Produces: a pushed `main` branch whose Pages root deploys the d57bf9e-centered UI plus the pending lock

- [ ] **Step 1: Run all relevant root and Team 2 regression tests**

Run:

```bash
node --test tests/executive-pending-lock.test.mjs tests/executive-governance-ui.test.mjs
node --test team-2/*.test.mjs
```

Expected: both commands pass; the Team 2 tests prove its unchanged page was not accidentally broken.

- [ ] **Step 2: Verify the diff excludes Team 2**

Run:

```bash
git diff --name-only d57bf9e..HEAD -- team-2
```

Expected: no output.

- [ ] **Step 3: Commit the deployable integration**

Run:

```bash
git add index.html js/executive-pending-lock.mjs tests/executive-pending-lock.test.mjs tests/executive-governance-ui.test.mjs
git add -u
git commit -m "fix: restore d57bf9e UAT with approval lock"
```

Expected: one commit that restores the root baseline and adds the approval lock.

- [ ] **Step 4: Push main and check GitHub Pages**

Run:

```bash
git push origin main
curl -fsSL https://augusliang23-web.github.io/pm-dashboard-uat/ | rg 'executive-item-modal|executive-pending-lock'
```

Expected: push succeeds; after Pages finishes, the public root includes the centered-modal marker and pending-lock module reference.
