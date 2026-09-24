# Dashboard Button System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every v2.2T dashboard action button use the approved Primary, Secondary, Danger, or Icon visual language and prevent browser-default regressions.

**Architecture:** Keep the dashboard's single-file CSS and markup structure. Define one `.btn` base for text actions, let semantic modifier classes set colour, and classify the reported native controls plus dynamic Executive action markup. Specialised controls retain their existing component styles when those styles already provide the same interaction affordances.

**Tech Stack:** Static HTML, inline CSS and JavaScript, Node.js built-in test runner.

## Global Constraints

- Change only `index.html` in the v2.2T worktree; do not modify `team-2`.
- Preserve all existing event handlers, role checks, ARIA labels, loading states, and modal-close behaviour.
- Every future v2.2T action button must use `.btn` plus one semantic variant (`.btn-primary`, `.btn-ghost`, or `.btn-danger`), unless it is a documented specialised Icon/component control.
- Do not push or deploy; verify through the local v2.2T URL.

---

## File Structure

- `index.html` — owns the shared button tokens, static modal markup, and dynamic Executive request button markup.
- `tests/dashboard-button-system.test.mjs` — protects the approved button variants and the reported native-button regressions.
- `tests/executive-governance-ui.test.mjs` — existing Executive UI source-test suite; update only if an existing assertion must reflect the shared base class.

### Task 1: Establish the button-system regression test

**Files:**
- Create: `tests/dashboard-button-system.test.mjs`
- Test: `tests/dashboard-button-system.test.mjs`

**Interfaces:**
- Consumes: `index.html` as the v2.2T main dashboard source.
- Produces: Source assertions for `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, and the reported Executive/unsaved-dialog controls.

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('v2.2T defines a shared semantic button system', () => {
  assert.match(dashboard, /\.btn,\s*\.btn-primary,\s*\.btn-ghost,\s*\.btn-danger\s*\{[\s\S]*?font-size:12px;[\s\S]*?border-radius:6px;[\s\S]*?cursor:pointer;/);
  assert.match(dashboard, /\.btn-primary\s*\{[\s\S]*?background:var\(--accent\);[\s\S]*?color:#fff;/);
  assert.match(dashboard, /\.btn-ghost,\s*\.btn\s*\{[\s\S]*?background:var\(--s1\);/);
  assert.match(dashboard, /\.btn-danger\s*\{[\s\S]*?border-color:#E39A9A;[\s\S]*?color:#B35858;/);
});

test('reported confirmation and milestone controls use semantic variants', () => {
  assert.match(dashboard, /class="btn btn-ghost" onclick="keepEditing\(\)"/);
  assert.match(dashboard, /class="btn btn-danger" onclick="confirmDiscardEditorChanges\(\)"/);
  assert.match(dashboard, /class="btn btn-ghost" id="executiveRenameChangeBtn"/);
  assert.match(dashboard, /class="btn btn-danger" id="executiveDeleteChangeBtn"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dashboard-button-system.test.mjs`

Expected: FAIL because `.btn` and `.btn-danger` are not defined and the discard controls lack the shared `.btn` class.

- [ ] **Step 3: Do not change production code in this task**

Keep `index.html` unchanged until Task 2 so the red test remains evidence of the reported regression.

- [ ] **Step 4: Commit the failing test only after review checkpoint**

Do not commit a knowingly failing test. Carry it into Task 2 and commit the complete green behaviour there.

### Task 2: Implement shared semantic text-button tokens

**Files:**
- Modify: `index.html:173-176`
- Modify: `index.html:2007-2008`
- Modify: `index.html:2088`
- Test: `tests/dashboard-button-system.test.mjs`

**Interfaces:**
- Consumes: `.btn`, `.btn-primary`, `.btn-ghost`, and `.btn-danger` class names from static and dynamic dashboard markup.
- Produces: A reusable text-button base and semantic variants that retain `aria-busy` compatibility.

- [ ] **Step 1: Add the shared base and semantic variants**

Replace the existing Primary/Ghost block with this CSS, preserving the surrounding section order:

```css
.btn, .btn-primary, .btn-ghost, .btn-danger {
  display:inline-flex; align-items:center; justify-content:center; gap:6px;
  min-height:32px; padding:6px 12px; border:1px solid transparent; border-radius:6px;
  background:var(--s1); color:var(--text-light); font:inherit; font-size:12px;
  font-weight:700; line-height:1.2; white-space:nowrap; cursor:pointer;
  transition:background .2s, border-color .2s, color .2s, box-shadow .2s;
}
.btn:focus-visible, .btn-primary:focus-visible, .btn-ghost:focus-visible, .btn-danger:focus-visible {
  outline:2px solid var(--accent); outline-offset:2px;
}
.btn:disabled, .btn-primary:disabled, .btn-ghost:disabled, .btn-danger:disabled {
  opacity:.55; cursor:not-allowed;
}
.btn-primary { background:var(--accent); border-color:var(--accent); color:#fff; }
.btn-primary:hover:not(:disabled) { background:var(--accent-hov); border-color:var(--accent-hov); }
.btn-ghost, .btn { background:var(--s1); border-color:var(--border2); color:var(--text-light); }
.btn-ghost:hover:not(:disabled), .btn:hover:not(:disabled) { background:var(--s2); color:var(--text); }
.btn-danger { background:var(--s1); border-color:#E39A9A; color:#B35858; }
.btn-danger:hover:not(:disabled) { background:#FCEDED; border-color:#D98585; color:#9D4242; }
```

- [ ] **Step 2: Classify the screenshot regressions**

Use these exact markup replacements:

```html
<button type="button" class="btn btn-ghost" id="executiveRenameChangeBtn" onclick="openExecutiveStructuralActionFromDrawer('rename')">Rename</button>
<button type="button" class="btn btn-ghost" onclick="keepEditing()">Keep editing</button>
<button type="button" class="btn btn-danger" onclick="confirmDiscardEditorChanges()">Discard changes</button>
```

Keep `executiveDeleteChangeBtn` as `class="btn btn-danger"`.

- [ ] **Step 3: Run the focused test to verify it passes**

Run: `node --test tests/dashboard-button-system.test.mjs`

Expected: PASS with 2 tests and 0 failures.

- [ ] **Step 4: Commit the complete base-system change**

```bash
git add index.html tests/dashboard-button-system.test.mjs
git commit -m "fix: unify dashboard button variants"
```

### Task 3: Audit dynamic Executive actions and run regression verification

**Files:**
- Modify: `index.html:6701`
- Modify: `tests/dashboard-button-system.test.mjs`
- Test: `tests/dashboard-button-system.test.mjs`
- Test: `tests/editor-close-guard.test.mjs`
- Test: `tests/executive-governance-ui.test.mjs`

**Interfaces:**
- Consumes: semantic CSS classes created in Task 2.
- Produces: Dynamic approval actions that use the same variants and source tests that reject future unclassified text actions in the protected Executive paths.

- [ ] **Step 1: Extend the test for dynamic action variants**

Append this test:

```js
test('dynamic Executive request actions use the same semantic button variants', () => {
  assert.match(dashboard, /class="btn btn-danger executive-withdraw-btn"/);
  assert.match(dashboard, /class="btn btn-danger" onclick="decideExecutiveChangeRequest/);
  assert.match(dashboard, /class="btn btn-primary" onclick="decideExecutiveChangeRequest/);
  assert.match(dashboard, /'reject',this/);
  assert.match(dashboard, /'approve',this/);
});
```

- [ ] **Step 2: Run the new assertion to verify it fails**

Run: `node --test tests/dashboard-button-system.test.mjs`

Expected: FAIL because the current dynamic Withdraw and Reject buttons use `.btn-ghost` without the shared `.btn` base or danger semantic class.

- [ ] **Step 3: Update dynamic request-button markup**

In `renderExecutiveChangeRequests`, keep all handlers and request IDs unchanged, and use:

```js
${canWithdraw ? `<button class="btn btn-danger executive-withdraw-btn" onclick="withdrawExecutiveChangeRequest('${escHtml(record.requestId)}',this)">Withdraw request</button>` : ''}
${canDecide ? `<button class="btn btn-danger" onclick="decideExecutiveChangeRequest('${escHtml(record.requestId)}','reject',this)">Reject</button><button class="btn btn-primary" onclick="decideExecutiveChangeRequest('${escHtml(record.requestId)}','approve',this)">Approve</button>` : ''}
```

- [ ] **Step 4: Run the focused and related source tests**

Run: `node --test tests/dashboard-button-system.test.mjs tests/editor-close-guard.test.mjs tests/executive-governance-ui.test.mjs`

Expected: all tests pass with 0 failures.

- [ ] **Step 5: Inspect page-specific controls and preserve specialised components**

Run: `rg --pcre2 -n '<button(?![^>]*\\bclass=)' index.html`

Expected: remaining results are explicitly styled component controls only: RAG selectors, login, week navigation, scope tabs, Gantt row controls, evidence removal, and row-level delete/reorder controls. Do not convert those controls to text-button variants when their component CSS already defines their visual role.

- [ ] **Step 6: Commit the dynamic-action audit**

```bash
git add index.html tests/dashboard-button-system.test.mjs
git commit -m "fix: align executive action buttons"
```

### Task 4: Local visual verification

**Files:**
- Verify: `index.html`
- Verify: `tests/dashboard-button-system.test.mjs`

**Interfaces:**
- Consumes: the local v2.2T server at `http://127.0.0.1:4173/`.
- Produces: evidence that source assertions and rendered controls match the approved visual language.

- [ ] **Step 1: Run the complete relevant regression suite**

Run:

```bash
node --test tests/dashboard-button-system.test.mjs tests/editor-close-guard.test.mjs tests/executive-governance-ui.test.mjs tests/v2-baseline.test.mjs
git diff --check
```

Expected: every test passes and `git diff --check` reports no whitespace errors.

- [ ] **Step 2: Verify local render in the v2.2T dashboard**

Open `http://127.0.0.1:4173/`, reload once, then confirm:

1. The unsaved-changes dialog renders Keep editing as Secondary and Discard changes as Danger.
2. The Executive milestone dialog renders Rename as Secondary, Delete milestone as Danger, and Save monthly update as Primary.
3. No native browser-default button appears in either reported dialog.

- [ ] **Step 3: Commit verification-only changes only if source files changed**

If Task 4 changed no files, do not create an empty commit.
