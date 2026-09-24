# Employee Name Mapping Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove fixed employee-name lookups from current public UAT and Production source while preserving authorized project edits.

**Architecture:** Both frontends resolve labels from the authenticated Firestore `users` directory through a session-scoped email-keyed cache. Production Functions continue to derive identity from the server-read user document, but no longer contain legacy aliases. Production user-document migration and every release action remain separate live gates.

**Tech Stack:** Vanilla browser JavaScript modules, Node `node:test`, Firebase Auth/Firestore, Firebase Functions v2, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-17-employee-name-mapping-removal-design.md` in the UAT repository.

## Global Constraints

- Work in clean isolated UAT and Production worktrees; do not edit the dirty Production checkout.
- No real employee names or email addresses in new tests, the plan, or release logs.
- UAT first; no live Production user-document write, PR merge, or Firebase deploy as part of local implementation.
- Preserve current role and project-owner semantics, `System` handling, and generic fallback for absent names.
- Only authorized, signed-in users may read the user directory; client writes remain denied.
- Escape all display names at HTML sinks, but compare plain normalized names for ownership.
- Prove each behavior RED then GREEN before committing it.

---

### Task 1: UAT session-scoped display-name directory

**Files:**
- Create: `js/display-name-directory.mjs`
- Create: `tests/display-name-directory.test.mjs`

**Interfaces:**
- Produces `createDisplayNameDirectory()` returning `{ replace(accounts), set(email, account), resolve(email), clear() }`.
- `accounts` entries are `{ id?: string, email?: string, displayName?: unknown }`; `resolve` returns a plain-text label.

- [ ] **Step 1: Write failing tests** for stored-label precedence, case-insensitive email keys, missing/oversized/control-character name fallback, `System`, and cache clearing. Use synthetic labels such as `Robin`, `Kai`, and `<img src=x>`.

  ```js
  const directory = createDisplayNameDirectory();
  directory.replace([{ id: 'robin@example.test', displayName: ' Team Lead ' }]);
  assert.equal(directory.resolve('ROBIN@EXAMPLE.TEST'), 'Team Lead');
  directory.clear();
  assert.equal(directory.resolve('robin@example.test'), 'Robin'); // generic fallback
  ```
- [ ] **Step 2: Run** `node --test tests/display-name-directory.test.mjs`. Expected: module-not-found RED.
- [ ] **Step 3: Implement** `createDisplayNameDirectory`. Use a private `Map`, normalize email with `String(value || '').trim().toLowerCase()`, accept only trimmed string labels of 1–128 characters without control characters, use the historical first-dot email-prefix capitalization as generic fallback, and let `replace` atomically swap the map.

  ```js
  export function createDisplayNameDirectory() {
    let labels = new Map();
    const key = value => String(value || '').trim().toLowerCase();
    const set = (email, account) => {
      const name = typeof account?.displayName === 'string' ? account.displayName.trim() : '';
      if (key(email) && name.length > 0 && name.length <= 128 && !/[\u0000-\u001f\u007f]/.test(name)) {
        labels.set(key(email), name);
      }
    };
    return {
      set,
      replace(accounts) { labels = new Map(); accounts.forEach(a => set(a.id || a.email, a)); },
      resolve(email) {
        if (!email || email === 'System') return 'System';
        const prefix = key(email).split('@')[0];
        const first = prefix.split('.')[0];
        return labels.get(key(email)) || first.charAt(0).toUpperCase() + first.slice(1);
      },
      clear() { labels.clear(); },
    };
  }
  ```
- [ ] **Step 4: Run** the focused test, then `npm run test:all`; both must pass.
- [ ] **Step 5: Commit** the helper and tests with `feat: resolve dashboard names from user directory`.

### Task 2: UAT frontend integration and session safety

**Files:**
- Modify: `index.html` near imports, auth transition, `getUserDisplayName`, and `startProjectManagerSubscription`
- Modify: `tests/dashboard-access.test.mjs`
- Modify: `tests/auth-session.test.mjs`
- Modify: `tests/dashboard-role-visibility-ui.test.mjs`

**Interfaces:**
- Consumes `createDisplayNameDirectory()` from Task 1.
- Existing `getUserDisplayName(email)` remains the callers' interface.

- [ ] **Step 1: Add a failing integration test** that feeds synthetic `users` entries with `displayName` to `buildProjectManagerList(records, directory.resolve)` and expects stored labels only for PM and PM-enabled Admin. Add a failing auth-transition test proving old labels cannot survive `clear()`.

  ```js
  directory.replace([{ id: 'robin@example.test', role: 'pm', displayName: 'Team Lead' }]);
  assert.deepEqual(buildProjectManagerList(records, directory.resolve), ['Team Lead']);
  ```
- [ ] **Step 2: Run** the affected tests; verify failures express missing stored-label/cache wiring, not syntax errors.
- [ ] **Step 3: Import and instantiate** the directory in `index.html`; replace the hardcoded map in `getUserDisplayName` with `directory.resolve(email)`. In the `users` snapshot callback, call `directory.replace(accounts)` only after `isCurrentSession()` succeeds, then derive `PM_LIST`. Clear the directory in `quiesceDashboardForAuthTransition` and on logout. Keep `System` and generic fallback in the module.

  ```js
  if (!isCurrentSession()) return;
  const accounts = snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }));
  displayNameDirectory.replace(accounts);
  PM_LIST = buildProjectManagerList(accounts, getUserDisplayName);
  ```
- [ ] **Step 4: Run** affected tests and `npm run test:all`; validate the HTML module syntax and `git diff --check`.
- [ ] **Step 5: Commit** UAT integration with `fix: remove public UAT employee name aliases`.

### Task 3: Production frontend directory and safe rendering

**Files (Production repository):**
- Create: `js/display-name-directory.mjs`
- Create: `tests/display-name-directory.test.mjs`
- Modify: `index.html` near imports, auth transition, `getUserDisplayName`, `fetchDynamicPMList`, `renderOnlineUsers`, and PM selector creation
- Modify: `tests/auth-session.test.mjs`

**Interfaces:**
- Same `createDisplayNameDirectory()` contract as Task 1; no data is copied from UAT at runtime.
- `fetchDynamicPMList` must return directory records or a list without mutating a stale auth session; only the current auth generation may replace the cache.

- [ ] **Step 1: Write the same failing directory tests** in Production, plus behavior tests for a failed directory read returning no fixed names and malicious stored labels rendering as text (not markup) in presence and PM options.

  ```js
  directory.replace([{ id: 'kai@example.test', displayName: '<img src=x>' }]);
  assert.equal(directory.resolve('kai@example.test'), '<img src=x>');
  assert.equal(renderedHtml.includes('<img src=x>'), false);
  ```
- [ ] **Step 2: Run** focused tests and verify RED against the current source.
- [ ] **Step 3: Add the directory module** and replace the fixed `getUserDisplayName` map. Clear it on auth transition/logout. Populate it only after the current-session guard following the `users` read; seed the authenticated user from the verified `userDoc`. Keep existing non-VIP PM-list membership behavior. On `getDocs` failure return `[]` plus a recoverable warning, never the fixed four-name list. Escape labels in `renderOnlineUsers` and PM option markup.

  ```js
  const accounts = snap.docs.map(entry => ({ id: entry.id, ...entry.data() }));
  if (!isCurrentAuthInitialization()) return;
  displayNameDirectory.replace(accounts);
  PM_LIST = accounts.filter(account => normalizeRole(account.role) !== 'vip')
    .map(account => getUserDisplayName(account.id));
  const badgeHtml = `<div class="online-badge">${escHtml(name)}</div>`;
  const optionHtml = `<option value="${escHtml(name)}">${escHtml(name)}</option>`;
  ```
- [ ] **Step 4: Run** focused tests, `npm run test:all`, HTML syntax validation, and `git diff --check`.
- [ ] **Step 5: Commit** with `fix: resolve Production names from authorized users`.

### Task 4: Production Functions identity parity

**Files (Production repository):**
- Modify: `functions/project-dashboard-writes.js`
- Modify: `functions/test/project-dashboard-writes.test.cjs`

**Interfaces:**
- `buildAuthenticatedActor({ uid, email }, { role, displayName })` returns an actor whose name is the stored label or generic email prefix.
- Ownership checks keep their current server-trusted actor and project comparison.

- [ ] **Step 1: Replace real-alias tests** with failing synthetic tests: stored `Robin` on an unrelated email permits editing `owner: 'Robin'`; missing name falls back to the email prefix and cannot edit `owner: 'Robin'`; similar names do not match; Admin role remains authorized without a stored name.

  ```js
  const actor = buildAuthenticatedActor(
    { uid: 'uid-robin', email: 'member@example.test' },
    { role: 'pm', displayName: 'Robin' },
  );
  assert.equal(ownerOrDeputyMatches({ owner: 'Robin' }, actor), true);
  assert.equal(ownerOrDeputyMatches({ owner: 'Robina' }, actor), false);
  ```
- [ ] **Step 2: Run** `node --test functions/test/project-dashboard-writes.test.cjs` and verify RED for legacy alias behavior.
- [ ] **Step 3: Remove** `LEGACY_DISPLAY_NAME_BY_EMAIL_PREFIX` and its conditional branch. Keep stored-name-first and generic-prefix fallback; do not accept a client-supplied name.

  ```js
  function resolveActorDisplayName(email, storedDisplayName) {
    const explicitName = String(storedDisplayName || '').trim();
    return explicitName || normalized(email).split('@')[0];
  }
  ```
- [ ] **Step 4: Run** focused tests and `npm run test:all` in Production.
- [ ] **Step 5: Commit** with `fix: remove server legacy employee aliases`.

### Task 5: Local release evidence and live gates

**Files:**
- Modify: this plan only to record checkboxes/results; no migration manifest or real identifiers in either repository.

- [ ] **Step 1: Run** `npm run test:all` in both repositories and `npm run test:rules` under Java 21. Record pass/fail separately.
- [ ] **Step 2: Inspect** current tracked frontend and Functions sources for the legacy mapping and fixed fallback; inspect generated public HTML. Record any remaining employee-name fixtures/docs as residual exposure, not a passed purge.
- [ ] **Step 3: Verify** each repository's clean branch, exact base ancestry, file diff, `git diff --check`, and no Firebase project-ID binding drift. Request independent code review before any PR.
- [ ] **Step 4: Open separate UAT and Production PRs only after review; do not merge/deploy or write Production data in this local implementation stage.
- [ ] **Step 5: At later explicit live gates**, follow the spec's UAT merge/live verification, guarded four-document Production update, Production merge/Pages, seven-Function deployment, and authorized live checks in that order. Report unperformed stages as pending.
