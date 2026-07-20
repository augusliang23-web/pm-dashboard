# PDF Reporting Week Identity Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Overview and Project PDF export from losing the selected reporting week after an in-session week update.

**Architecture:** Preserve the non-persisted Firestore document identity on the confirmed in-memory clone after the write completes. Add a UI-side fallback that derives the canonical document ID from `weekLabel` in both dashboard entry points.

**Tech Stack:** Browser JavaScript modules, Node.js built-in test runner, GitHub Pages.

## Global Constraints

- Deploy only the production v2.1 branch to `origin/main`.
- Apply the same functional change to local `v2.2T` without pushing or deploying it.
- Do not change the PDF service, Firestore schema, or persisted data.

---

### Task 1: Preserve week document identity

**Files:**
- Modify: `tests/sync-core.test.mjs`
- Modify: `sync-core.js`

**Interfaces:**
- Consumes: `confirmWeekMutation(source, changes, write, options)` and a source week with optional non-enumerable `__documentId`.
- Produces: a confirmed clone with the same non-enumerable `__documentId`; the `write(candidate)` payload remains metadata-free.

- [ ] Add a test that defines non-enumerable `__documentId` on the source, asserts it is absent inside the write callback, then asserts it is present and non-enumerable on the returned week.
- [ ] Run `node --test tests/sync-core.test.mjs` and confirm the new test fails because the returned identifier is missing.
- [ ] After the successful write, read the source identifier and attach it to the returned candidate with `Object.defineProperty()`.
- [ ] Run `node --test tests/sync-core.test.mjs` and confirm every test passes.

### Task 2: Add PDF export fallback

**Files:**
- Create: `tests/pdf-week-id.test.mjs`
- Modify: `index.html`
- Modify: `team-2/index.html`

**Interfaces:**
- Consumes: the currently selected week and its `__documentId` or `weekLabel`.
- Produces: a canonical `weekId` for `downloadProfessionalReport()`.

- [ ] Add a source-contract test that reads both dashboards and requires `selectedWeek?.__documentId || selectedWeek?.weekLabel?.replace(/\\s+/g, '-')` in the professional download function.
- [ ] Run `node --test tests/pdf-week-id.test.mjs` and confirm it fails against both dashboards.
- [ ] Update each `downloadProfessionalReport()` to assign `selectedWeek`, then resolve `weekId` from metadata with the `weekLabel` fallback.
- [ ] Run `node --test tests/pdf-week-id.test.mjs tests/sync-core.test.mjs` and confirm all regression tests pass.

### Task 3: Verify, publish v2.1, and update local v2.2T

**Files:**
- Verify all modified production files.
- Apply the production hotfix commit to the existing local `v2.2T` worktree.

**Interfaces:**
- Consumes: a verified v2.1 hotfix commit.
- Produces: deployed `origin/main` and a separate local-only v2.2T commit.

- [ ] Run `node --test *.test.mjs *.test.cjs tests/*.test.mjs` and require zero failures.
- [ ] Review the diff and commit only the spec, plan, tests, and hotfix files.
- [ ] Fetch `origin/main`, verify it is still the hotfix base, and push the tested commit to `origin/main` without force.
- [ ] Wait for GitHub Pages deployment, then verify live Overview and Project PDF export.
- [ ] Cherry-pick the hotfix into the existing local `v2.2T` worktree, resolving only context differences if needed.
- [ ] Run `node --test tests/pdf-week-id.test.mjs tests/sync-core.test.mjs` in v2.2T and leave the commit local and unpushed.
