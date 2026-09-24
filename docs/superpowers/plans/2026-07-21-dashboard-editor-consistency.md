# Dashboard Editor Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Executive approval interaction and give every v2.2T Dashboard editor the same centered, asynchronous, and unsaved-change-safe behavior.

**Architecture:** Keep the existing single-page architecture and extend the main `index.html` only. Reuse the backend `decisionNote` contract, add small UI state helpers for asynchronous actions, and place one dirty-state guard in front of the existing modal cleanup path so all opted-in editors share the same close behavior.

**Tech Stack:** HTML, CSS, browser JavaScript, Firebase callable functions and Firestore realtime listeners, Node test runner.

## Global Constraints

- Modify and test only the main v2.2T `index.html`; do not modify `team-2/index.html`.
- Do not deploy Hosting or change the production v2.1 page.
- Executive alone can approve or reject; Admin remains audit-only.
- Approval comment is optional; rejection comment is mandatory.
- Existing `decisionNote` is the only persisted decision-comment field.
- Busy animations last only while the real backend operation is pending.
- Read-only, login, notification-only, PDF, and preview overlays are not dirty-tracked.

---

### Task 1: Executive approval comment and role-accurate controls

**Files:**
- Modify: `tests/executive-governance-ui.test.mjs`
- Modify: `functions/test/executive-milestones-source.test.cjs`
- Modify: `index.html` around `renderExecutiveApprovalInbox` and `decideExecutiveChangeRequest`
- Modify: `functions/executive-milestones.js` around `decideExecutiveMilestoneChangeRequest`

**Interfaces:**
- Consumes: `executiveApi.decideRequest({ requestId, decision, decisionNote })` and the existing backend `decisionNote` field.
- Produces: `executiveDecisionComment(requestId)`, role-accurate approval-card markup, backend rejection validation, and an append-only rejection audit record.

- [ ] **Step 1: Write the failing UI tests**

Add main-page assertions that require an Executive-only textarea keyed by request ID, optional approval comments, required rejection comments, and the exact `decisionNote` payload. Also assert that `canDecide` remains `currentRole === 'executive'` and Admin receives no decision controls.

```js
assert.match(rootDashboard, /data-executive-decision-comment=/);
assert.match(rootDashboard, /if \(decision === 'reject' && !decisionNote\)/);
assert.match(rootDashboard, /executiveApi\.decideRequest\(\{ requestId, decision, decisionNote \}\)/);
assert.match(rootDashboard, /const canDecide = currentRole === 'executive'/);
```

Add backend source assertions that a rejection without a trimmed `decisionNote` is rejected and that a successful rejection creates a `rejected-change` audit document containing the same note.

- [ ] **Step 2: Run the targeted test and confirm RED**

Run:

```powershell
node --test tests\executive-governance-ui.test.mjs
```

Expected: FAIL because approval cards do not yet contain a comment field, the handler still uses `window.prompt`, and rejection comments are not yet enforced or audited by the backend.

- [ ] **Step 3: Render the comment control and inline validation**

In `renderExecutiveApprovalInbox`, render this block only when `canDecide` is true:

```html
<label class="executive-decision-comment">
  <span>Approver comment <small>Required when rejecting</small></span>
  <textarea data-executive-decision-comment="REQUEST_ID" maxlength="1200"></textarea>
  <span class="resource-validation error" data-executive-decision-error="REQUEST_ID"></span>
</label>
```

Read the trimmed textarea value in `decideExecutiveChangeRequest`. Reject without text by rendering `Enter a comment before rejecting this request.` and focusing the textarea. Approve may send an empty string.

- [ ] **Step 4: Enforce and audit rejection comments in the callable**

Trim `request.data.decisionNote` once. For `decision === 'reject'`, throw `invalid-argument` when the note is empty. In the same transaction that marks the request rejected, create an `executiveMilestoneAudit` record with `action: 'rejected-change'`, the request identifiers and before/after values, the original request reason, `decisionNote`, actor identity, and timestamp. Approval continues to use `applyApprovedRequest` and its existing audit record.

- [ ] **Step 5: Run the targeted tests and confirm GREEN**

Run:

```powershell
node --test tests\executive-governance-ui.test.mjs functions\test\executive-milestones-source.test.cjs functions\test\executive-milestone-core.test.cjs
```

Expect PASS.

---

### Task 2: Consistent asynchronous feedback for request actions

**Files:**
- Modify: `tests/executive-governance-ui.test.mjs`
- Modify: `index.html` CSS and the Submit, Withdraw, Approve, and Reject handlers

**Interfaces:**
- Consumes: the initiating button plus its action label.
- Produces: `setAsyncActionState(button, busy, busyLabel)` with `disabled`, `aria-busy`, spinner, and restored label behavior.

- [ ] **Step 1: Write failing busy-state tests**

Require `.async-action-spinner`, `aria-busy`, action-specific labels (`Submitting…`, `Withdrawing…`, `Approving…`, `Rejecting…`), and restoration in `finally` blocks.

- [ ] **Step 2: Run the targeted test and confirm RED**

Expected: FAIL because Withdraw and decision actions currently only disable buttons and provide no visible progress animation.

- [ ] **Step 3: Add one lightweight busy helper**

Implement:

```js
function setAsyncActionState(button, busy, busyLabel = 'Working…') {
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent.trim();
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="async-action-spinner" aria-hidden="true"></span>${escHtml(busyLabel)}`;
    return;
  }
  button.disabled = false;
  button.removeAttribute('aria-busy');
  button.textContent = button.dataset.idleLabel || button.textContent;
  delete button.dataset.idleLabel;
}
```

Apply it to the initiating button for Submit, Withdraw, Approve, and Reject. Keep related buttons disabled during the operation, preserve dialog values after failure, and let realtime snapshots remove completed cards only after backend confirmation.

- [ ] **Step 4: Run the targeted test and confirm GREEN**

Run `node --test tests\executive-governance-ui.test.mjs` and expect PASS.

---

### Task 3: Convert the Executive item drawer to a centered editor

**Files:**
- Modify: `tests/executive-governance-ui.test.mjs`
- Modify: `index.html` CSS and `executiveItemDrawerOverlay` markup

**Interfaces:**
- Consumes: all existing Executive item editor element IDs and handlers.
- Produces: a centered `.executive-item-modal` without changing update, history, RAG, or structural-action contracts.

- [ ] **Step 1: Write the failing layout test**

Assert that `executiveItemDrawerOverlay` contains a standard modal element, that `.executive-drawer-overlay` no longer right-aligns content, and that the centered editor has bounded width and height.

- [ ] **Step 2: Run the targeted test and confirm RED**

Expected: FAIL because the current overlay uses `justify-content:flex-end` and a full-height `<aside>`.

- [ ] **Step 3: Apply the centered modal structure**

Keep all existing IDs. Replace the full-height side drawer shell with a centered modal shell, use `width:min(760px,94vw)` and `max-height:90vh`, retain a scrollable content area and fixed action footer, and preserve the current mobile width rules.

- [ ] **Step 4: Run the targeted test and confirm GREEN**

Run the targeted test and expect PASS.

---

### Task 4: Unified close guard for every Dashboard editor

**Files:**
- Create: `tests/editor-close-guard.test.mjs`
- Modify: `index.html` editor-overlay markup, modal opening functions, `closeExecutiveItemDrawer`, `closeModal`, backdrop handling, and Escape handling

**Interfaces:**
- Consumes: overlays marked `data-editor-overlay`, existing `openAccessibleModal`, and existing editor-specific cleanup.
- Produces: `captureEditorBaseline`, `editorHasUnsavedChanges`, `requestCloseModal`, `confirmDiscardEditorChanges`, and `closeModal(id, { force })`.

- [ ] **Step 1: Write failing close-guard tests**

Cover the exact editing overlays:

```js
const editingOverlays = [
  'executiveItemDrawerOverlay',
  'executiveChangeRequestOverlay',
  'executiveApprovalInboxOverlay',
  'executiveRagOverrideOverlay',
  'executiveTimelineSettingsOverlay',
  'changePwdOverlay',
  'projEditOverlay',
  'weekManageOverlay',
  'strategyOverlay',
  'ganttTemplateOverlay',
];
```

Assert that backdrop clicks, ×, Cancel, and Escape call the guarded close path; successful saves use `{ force: true }`; dirty editors open `unsavedChangesOverlay`; unchanged editors close directly; read-only and PDF overlays are not marked as editors.

- [ ] **Step 2: Run the new test and confirm RED**

Run:

```powershell
node --test tests\editor-close-guard.test.mjs
```

Expected: FAIL because the unified guard and discard dialog do not exist.

- [ ] **Step 3: Add normalized editor snapshots**

Mark only the listed overlays with `data-editor-overlay`. At the end of `openAccessibleModal`, store a stable JSON snapshot of enabled editable controls. Serialize text/select values, checked radio/checkbox values, and contenteditable text; omit empty unchecked controls and elements marked `data-editor-ignore-dirty`.

Convert direct editor openings (`changePwdOverlay`, `strategyOverlay`, `projEditOverlay`, and `weekManageOverlay`) to `openAccessibleModal` so every baseline is captured after initial values are populated.

- [ ] **Step 4: Add one discard-confirmation dialog and guarded close path**

Add `unsavedChangesOverlay` with:

```html
<button class="btn-ghost" onclick="keepEditing()">Keep editing</button>
<button class="btn-danger" onclick="confirmDiscardEditorChanges()">Discard changes</button>
```

Implement `requestCloseModal(id)` to compare snapshots. Clean editors call `closeModal(id, { force: true })`; dirty editors open the confirmation and retain their session. Successful save/delete paths for the listed editors explicitly call `closeModal(id, { force: true })`. Existing in-flight mutation blocks run before any close.

- [ ] **Step 5: Route all user closing gestures through the guard**

Use `requestCloseModal` for close buttons, Cancel buttons, primary-button backdrop clicks, and Escape. Preserve focus on `Keep editing`; restore original opener focus after a confirmed close. Nested Executive structural dialogs return to the parent editor without clearing the parent's stored baseline.

- [ ] **Step 6: Run close-guard and regression tests and confirm GREEN**

Run:

```powershell
node --test tests\editor-close-guard.test.mjs tests\executive-governance-ui.test.mjs tests\project-mutations.test.mjs tests\gantt-template-admin.test.mjs tests\v2-baseline.test.mjs
```

Expected: all tests PASS.

---

### Task 5: Full local verification and handoff

**Files:**
- Modify only tests if verification exposes an uncovered regression.

**Interfaces:**
- Consumes: completed v2.2T local implementation.
- Produces: verified local commit for user testing; no deployment.

- [ ] **Step 1: Run the complete relevant automated suite**

```powershell
node --test tests\executive-governance-ui.test.mjs tests\editor-close-guard.test.mjs tests\executive-api.test.mjs tests\project-mutations.test.mjs tests\gantt-template-admin.test.mjs tests\v2-baseline.test.mjs functions\test\executive-milestone-core.test.cjs functions\test\executive-milestones-source.test.cjs
git diff --check
```

Expected: all tests PASS and `git diff --check` reports no errors.

- [ ] **Step 2: Verify the local browser flow**

On `http://127.0.0.1:4173/`, verify:

1. PM Submit shows a spinner and success result.
2. PM Withdraw shows a spinner and the request disappears after backend confirmation.
3. Admin sees the pending card without comment or decision controls.
4. Executive sees the pending card, can approve without a comment, and cannot reject without one.
5. A saved decision retains its exact comment in the request/audit data.
6. The Executive item editor is centered.
7. One simple editor and the project editor both close directly when unchanged and display the discard dialog when changed.
8. Keep editing retains values; Discard changes closes; a successful save closes without another warning.

- [ ] **Step 3: Commit only the scoped implementation**

```powershell
git add -- index.html functions/executive-milestones.js functions/test/executive-milestones-source.test.cjs tests/executive-governance-ui.test.mjs tests/editor-close-guard.test.mjs
git commit -m "feat: unify dashboard editor interactions"
```

Do not stage unrelated working-tree files and do not push or deploy.
