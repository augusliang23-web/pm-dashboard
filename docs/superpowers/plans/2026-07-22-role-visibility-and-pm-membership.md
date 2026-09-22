# Role Visibility and PM Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Restrict Draft reporting weeks to Admin and PM, keep project writes role-safe, and maintain a live All PMs list that includes only valid PM members.

**Architecture:** A browser access module owns the role predicates and PM-membership normalization. The dashboard consumes it for live user-list subscriptions and queries. Authenticated Functions own protected project and release writes; Firestore Rules deny direct week writes and hide Draft week documents from non-Admin/non-PM accounts.

**Tech Stack:** Static HTML/ES modules, Firebase Web SDK 10.12, Cloud Functions v2, Firebase Admin SDK, Node test runner, Firestore Rules v2.

## Global Constraints

- v2.2T is the sole test branch; do not modify \`team-2\` production files.
- Admin keeps global project editing, project creation/deletion, and account-management powers. Admin and PM may release a Draft week or revert a Released week to Draft.
- PM may edit only owner/deputy projects in Draft weeks.
- Sales, BD, Engineering, Product, Executive, and unknown roles are project read-only and see Released weeks only.
- PM membership means \`role == 'pm'\` or \`role == 'admin' && isProjectManager == true\`.
- Tests must fail before implementation and pass afterward.
- Do not deploy or push without a separate user request.

---

### Task 0: Isolated v2.2T Firebase Emulator environment

**Files:**
- Modify: `firebase.json`
- Create: `.firebaserc`
- Create: `scripts/start-v2.2t-emulator.ps1`
- Create: `scripts/seed-v2.2t-emulator.mjs`
- Create: `tests/emulator-config.test.mjs`
- Modify: `index.html:2768-2785`

**Interfaces:**
- Local dashboard URL `http://127.0.0.1:4173/?emulator=1` connects only to Auth, Firestore, and Functions emulators.
- `.firebaserc` fixes the emulator project identifier to `demo-pm-dashboard-v22t`; it has no production project alias.
- Seed script creates explicit local-only Admin/PM/BD test accounts and one Draft plus one Released reporting week.

- [ ] **Step 1: Write the failing emulator configuration test**

```js
test('v2.2T local preview can only opt into the isolated Firebase Emulator project', async () => {
  const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
  const aliases = JSON.parse(await readFile(new URL('../.firebaserc', import.meta.url), 'utf8'));
  assert.equal(aliases.projects.default, 'demo-pm-dashboard-v22t');
  assert.equal(config.emulators.firestore.port, 8080);
  assert.equal(config.emulators.auth.port, 9099);
  assert.equal(config.emulators.functions.port, 5001);
  assert.match(dashboard, /new URLSearchParams\(window\.location\.search\)\.get\('emulator'\) === '1'/);
  assert.match(dashboard, /connectFirestoreEmulator\(db, '127\.0\.0\.1', 8080\)/);
});
```

- [ ] **Step 2: Run the configuration test to verify it fails**

Run: `node --test tests/emulator-config.test.mjs`

Expected: fail because the project currently has no emulator alias, ports, or browser connection switch.

- [ ] **Step 3: Add isolated configuration and local seed/start scripts**

```json
{
  "projects": { "default": "demo-pm-dashboard-v22t" }
}
```

```json
{
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

The browser must connect to emulators only for `?emulator=1`; ordinary local preview keeps existing behavior. The seed script must create clearly labelled `TEST / DO NOT DELETE` accounts and data only against the demo project. The start script sets the installed Java executable in its process path, starts `firebase emulators:start`, seeds the demo data, and launches the static preview on port 4173.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/emulator-config.test.mjs && npm.cmd --prefix functions exec firebase -- emulators:exec --only firestore,auth "node scripts/seed-v2.2t-emulator.mjs"`

Expected: configuration test passes and the seed command completes against the demo project only.

- [ ] **Step 5: Commit**

```bash
git add firebase.json .firebaserc scripts/start-v2.2t-emulator.ps1 scripts/seed-v2.2t-emulator.mjs tests/emulator-config.test.mjs index.html functions/package.json functions/package-lock.json
git commit -m "feat: add isolated v2.2T emulator"
```

---

### Task 1: Shared access predicates

**Files:**
- Create: \`js/dashboard-access.mjs\`
- Create: \`tests/dashboard-access.test.mjs\`

**Interfaces:**
- Produces \`normalizeDashboardRole\`, \`canReadDraftWeeks\`, \`isProjectManagerAccount\`, \`buildProjectManagerList\`, and \`reconcileProjectManagerFilter\`.
- Consumed by \`index.html\`.

- [ ] **Step 1: Write failing tests**

~~~js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectManagerList, canReadDraftWeeks,
  isProjectManagerAccount, reconcileProjectManagerFilter,
} from '../js/dashboard-access.mjs';

test('only Admin and PM can read Draft weeks', () => {
  assert.equal(canReadDraftWeeks('admin'), true);
  assert.equal(canReadDraftWeeks('pm'), true);
  for (const role of ['sales', 'bd', 'engineering', 'product', 'executive', 'unknown']) {
    assert.equal(canReadDraftWeeks(role), false);
  }
});

test('PM list includes PM and explicitly PM-enabled Admin only', () => {
  const records = [
    { id: 'pm@example.com', role: 'pm' },
    { id: 'admin-pm@example.com', role: 'admin', isProjectManager: true },
    { id: 'admin@example.com', role: 'admin' },
    { id: 'former@example.com', role: 'bd', isProjectManager: true },
  ];
  assert.deepEqual(buildProjectManagerList(records, value => value.split('@')[0]), ['admin-pm', 'pm']);
  assert.equal(isProjectManagerAccount(records[3]), false);
  assert.equal(reconcileProjectManagerFilter('former', ['admin-pm', 'pm']), 'all');
});
~~~

- [ ] **Step 2: Verify RED**

Run: \`node --test tests/dashboard-access.test.mjs\`

Expected: fail with \`ERR_MODULE_NOT_FOUND\`.

- [ ] **Step 3: Implement the minimum module**

~~~js
const VALID_ROLES = new Set(['admin', 'pm', 'sales', 'bd', 'engineering', 'product', 'executive']);

export function normalizeDashboardRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return VALID_ROLES.has(value) ? value : '';
}
export function canReadDraftWeeks(role) {
  return ['admin', 'pm'].includes(normalizeDashboardRole(role));
}
export function isProjectManagerAccount(account = {}) {
  const role = normalizeDashboardRole(account.role);
  return role === 'pm' || (role === 'admin' && account.isProjectManager === true);
}
export function buildProjectManagerList(accounts = [], displayName = value => value) {
  return [...new Set(accounts.filter(isProjectManagerAccount)
    .map(account => String(displayName(account.id || account.email || '')).trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
export function reconcileProjectManagerFilter(value, list = []) {
  return value === 'all' || list.includes(value) ? value : 'all';
}
~~~

- [ ] **Step 4: Verify GREEN**

Run: \`node --test tests/dashboard-access.test.mjs\`

Expected: 2 passing tests.

- [ ] **Step 5: Commit**

Run:
~~~text
git add js/dashboard-access.mjs tests/dashboard-access.test.mjs
git commit -m "feat: define dashboard access predicates"
~~~

### Task 2: Live PM filter, Draft query, and all-role navigation

**Files:**
- Modify: \`index.html:2763-2838, 4133-4474, 4516-4530, 7763-7832\`
- Create: \`tests/dashboard-role-visibility-ui.test.mjs\`

**Interfaces:**
- Produces \`startProjectManagerSubscription\`, \`stopProjectManagerSubscription\`, and \`syncProjectManagerFilterOptions\`.
- Replaces \`fetchDynamicPMList\` with a live \`users\` collection subscription.

- [ ] **Step 1: Write failing UI tests**

~~~js
test('uses role-safe week queries and a live PM-only list', () => {
  assert.match(dashboard, /canReadDraftWeeks\(currentRole\)\s*\?\s*query\(weeksRef, orderBy\('weekLabel'\)\)\s*:\s*query\(weeksRef, where\('isReleased', '==', true\)\)/);
  assert.match(dashboard, /projectManagerUnsub\s*=\s*onSnapshot\(collection\(db, 'users'\)/);
  assert.match(dashboard, /PM_LIST\s*=\s*buildProjectManagerList\(/);
  assert.match(dashboard, /currentPMFilter\s*=\s*reconcileProjectManagerFilter\(currentPMFilter, PM_LIST\)/);
});

test('only Admin and PM can edit and Executive retains portfolio navigation', () => {
  const start = dashboard.indexOf('function canEditProject(');
  const end = dashboard.indexOf('const RELEASED_WEEK_PROJECT_EDIT_MESSAGE', start);
  assert.match(dashboard.slice(start, end), /if \(currentRole !== 'pm'\) return false/);
  assert.match(dashboard, /const isExecutivePerspective = \(\) => currentRole === 'admin' && isAdminExecutivePreview;/);
});
~~~

- [ ] **Step 2: Verify RED**

Run: \`node --test tests/dashboard-role-visibility-ui.test.mjs\`

Expected: fail because the page currently uses a one-time user query, exposes Drafts to BD, and permits non-PM owners to edit.

- [ ] **Step 3: Implement client policy**

Import Task 1 helpers. Add \`projectManagerUnsub\` state. Use this implementation shape:

~~~js
function stopProjectManagerSubscription() {
  if (projectManagerUnsub) projectManagerUnsub();
  projectManagerUnsub = null;
}

function syncProjectManagerFilterOptions() {
  const selector = document.getElementById('topPmSelect');
  currentPMFilter = reconcileProjectManagerFilter(currentPMFilter, PM_LIST);
  selector.innerHTML = '<option value="all">👥 All PMs</option>' + PM_LIST
    .map(name => '<option value="' + escHtml(name) + '">' + escHtml(name) + '</option>').join('');
  selector.value = currentPMFilter;
}

function startProjectManagerSubscription(authGeneration, authUser) {
  stopProjectManagerSubscription();
  return new Promise((resolve, reject) => {
    let initial = true;
    projectManagerUnsub = onSnapshot(collection(db, 'users'), snapshot => {
      if (!isAuthInitializationCurrent(authSessionGeneration, authGeneration, currentUser, authUser.uid, getEmailKey(authUser))) return;
      PM_LIST = buildProjectManagerList(snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() })), getUserDisplayName);
      syncProjectManagerFilterOptions();
      if (allWeeks.length) render();
      if (initial) { initial = false; resolve(PM_LIST); }
    }, error => { if (initial) reject(error); });
  });
}
~~~

Stop this subscription during auth transitions and logout. Replace the one-time list load. Query \`weeks\` with ordered full access only when \`canReadDraftWeeks(currentRole)\` is true; otherwise use \`where('isReleased', '==', true)\`. In \`canEditProject\`, return Admin immediately, reject every non-PM role, then run the existing ownership check. Change \`isExecutivePerspective\` to Admin preview only so Executive users can open normal project cards and toggle Overview, while retaining Executive-specific approval controls.

- [ ] **Step 4: Verify GREEN**

Run: \`node --test tests/dashboard-access.test.mjs tests/dashboard-role-visibility-ui.test.mjs tests/auth-session.test.mjs tests/v2-baseline.test.mjs\`

Expected: all pass; no \`team-2\` source change.

- [ ] **Step 5: Commit**

Run:
~~~text
git add index.html tests/dashboard-role-visibility-ui.test.mjs
git commit -m "feat: restrict drafts and synchronize PM filter"
~~~

### Task 3: Callable project and release writes

**Files:**
- Create: \`functions/project-dashboard-writes.js\`
- Modify: \`functions/index.js:1-126\`
- Create: \`functions/test/project-dashboard-writes.test.cjs\`
- Create: \`js/project-dashboard-api.mjs\`
- Create: \`tests/project-dashboard-api.test.mjs\`
- Modify: \`index.html:2766, 4407-4438, 8180-8190, 8541-8668, 10024-10133, 10413-10442\`

**Interfaces:**
- Produces callable handlers \`saveDashboardProject\`, \`deleteDashboardProject\`, \`setDashboardProjectAttention\`, and \`setDashboardWeekRelease\`.
- Every handler reloads the caller role from \`users/{email}\` inside its Firestore transaction.
- Produces \`createProjectDashboardApi({ functions, httpsCallable })\` for the browser.

- [ ] **Step 1: Write failing callable tests**

~~~js
test('project authority permits Admin globally and PM ownership only', () => {
  assert.equal(canMutateProject({ role: 'admin', project, email: 'admin@example.com' }), true);
  assert.equal(canMutateProject({ role: 'pm', project, email: 'owner@example.com' }), true);
  assert.equal(canMutateProject({ role: 'pm', project, email: 'other@example.com' }), false);
  assert.equal(canMutateProject({ role: 'bd', project, email: 'owner@example.com' }), false);
});

test('released weeks reject writes and only PM or Admin changes release state', () => {
  assert.throws(() => assertDraftWeek({ isReleased: true }), /Released reporting weeks/);
  assert.equal(canSetWeekRelease('admin'), true);
  assert.equal(canSetWeekRelease('pm'), true);
  assert.equal(canSetWeekRelease('bd'), false);
});
~~~

- [ ] **Step 2: Verify RED**

Run: \`node --test functions/test/project-dashboard-writes.test.cjs\`

Expected: fail because the callable module is absent.

- [ ] **Step 3: Implement protected transactions**

Create the callable module with these exported pure predicates and use them in each \`onCall\` handler:

~~~js
function canMutateProject({ role, project, email }) {
  if (role === 'admin') return true;
  return role === 'pm' && ownerOrDeputyMatches(project, email);
}
function assertDraftWeek(week) {
  if (week.isReleased === true) throw new HttpsError('failed-precondition', 'Released reporting weeks cannot be changed.');
}
function canSetWeekRelease(role) {
  return ['admin', 'pm'].includes(role);
}
~~~

Each handler must validate the authenticated email, read the live user role and live week, check \`expectedWeekVersion\`, check the action authority, update only its intended fields, and increment the week version. Export all four handlers from \`functions/index.js\`. The browser API must call each exact callable name and return \`.data\`. Replace direct browser \`runTransaction\`, \`updateDoc\`, and \`setDoc\` writes that mutate a week/project or release state with this API. Presence writes remain direct and unchanged.

- [ ] **Step 4: Verify GREEN**

Run: \`node --test functions/test/project-dashboard-writes.test.cjs tests/project-dashboard-api.test.mjs tests/project-mutations.test.mjs\`

Expected: all pass, including rejected BD and released-week mutations.

- [ ] **Step 5: Commit**

Run:
~~~text
git add functions/project-dashboard-writes.js functions/index.js functions/test/project-dashboard-writes.test.cjs js/project-dashboard-api.mjs tests/project-dashboard-api.test.mjs index.html
git commit -m "feat: enforce project writes through callables"
~~~

### Task 4: Firestore Rules boundary

**Files:**
- Modify: \`firestore.rules:5-43\`
- Modify: \`tests/firestore-rules-source.test.mjs\`

**Interfaces:**
- Rule predicate \`canReadDraftWeeks()\` mirrors Task 1.
- Browser clients may not write directly to \`weeks\`.

- [ ] **Step 1: Write failing Rules tests**

~~~js
test('weeks restrict Draft reads and deny direct writes', async () => {
  const rules = await readRules();
  assert.match(rules, /function\s+canReadDraftWeeks\(\)\s*\{[\s\S]*?dashboardRole\(\)\s+in\s+\['admin', 'pm'\]/);
  assert.match(rules, /match\s+\/weeks\/\{weekId\}[\s\S]*?allow read:\s*if isSignedIn\(\) && \(canReadDraftWeeks\(\) \|\| resource\.data\.isReleased == true\);/);
  assert.match(rules, /match\s+\/weeks\/\{weekId\}[\s\S]*?allow write:\s*if false;/);
});
~~~

- [ ] **Step 2: Verify RED**

Run: \`node --test tests/firestore-rules-source.test.mjs\`

Expected: fail because every signed-in user currently reads and updates \`weeks\`.

- [ ] **Step 3: Implement the minimum Rules change**

~~~text
function canReadDraftWeeks() {
  return dashboardRole() in ['admin', 'pm'];
}

match /weeks/{weekId} {
  allow read: if isSignedIn() && (canReadDraftWeeks() || resource.data.isReleased == true);
  allow write: if false;
}
~~~

Do not loosen \`/users\` rules. Account provisioning remains protected; a role change to BD is excluded from the live PM list even if its stale data still contains \`isProjectManager: true\`.

- [ ] **Step 4: Verify GREEN**

Run: \`node --test tests/firestore-rules-source.test.mjs tests/dashboard-role-visibility-ui.test.mjs functions/test/project-dashboard-writes.test.cjs\`

Expected: all pass.

- [ ] **Step 5: Commit**

Run:
~~~text
git add firestore.rules tests/firestore-rules-source.test.mjs
git commit -m "fix: enforce draft visibility in Firestore"
~~~

### Task 5: Complete access-matrix verification

**Files:**
- Modify: \`tests/v2-baseline.test.mjs\` only if its old Executive-only navigation assertion conflicts with the approved all-role navigation policy.

**Interfaces:**
- Consumes Tasks 1-4.
- Produces a verified local v2.2T branch; no deployment.

- [ ] **Step 1: Add a failing assertion for Executive normal navigation if absent**

~~~js
test('v2.2T does not force Executive users away from normal project navigation', () => {
  assert.ok(dashboard.includes("const isExecutivePerspective = () => currentRole === 'admin' && isAdminExecutivePreview;"));
});
~~~

- [ ] **Step 2: Verify RED**

Run: \`node --test tests/v2-baseline.test.mjs\`

Expected: fail only while the obsolete forced-Executive-view expectation exists.

- [ ] **Step 3: Update the obsolete baseline expectation only**

Replace the old expectation with the approved all-role navigation assertion; do not change unrelated v2.1 baseline checks.

- [ ] **Step 4: Run the full relevant suite**

Run: \`node --test tests/dashboard-access.test.mjs tests/dashboard-role-visibility-ui.test.mjs tests/project-dashboard-api.test.mjs tests/project-mutations.test.mjs tests/firestore-rules-source.test.mjs tests/auth-session.test.mjs tests/v2-baseline.test.mjs functions/test/project-dashboard-writes.test.cjs functions/test/executive-milestone-core.test.cjs functions/test/executive-milestones-source.test.cjs\`

Expected: all pass with zero failures.

- [ ] **Step 5: Scope check and final commit**

Run:
~~~text
git diff --check
git status --short
git add tests/v2-baseline.test.mjs
git commit -m "test: cover role visibility policy"
~~~

## Plan self-review

- Tasks 1-2 cover PM identity, live dropdown changes, Draft visibility, all-role pages, and UI edit gates.
- Tasks 3-4 provide the server and Rules boundary required to prevent BD from retrieving Drafts or bypassing the UI to edit.
- The plan intentionally does not add a new account-management screen. The existing protected provisioning process sets \`role\` and \`isProjectManager\`; the browser list reacts live to every user document change.
- Every role predicate uses the same Admin/PM definition. A stale \`isProjectManager\` flag never grants a non-PM role access.
