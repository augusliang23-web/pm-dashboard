# Continuous Executive milestones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Executive milestones continuously editable from one live roadmap while preserving an immutable snapshot whenever a reporting week is released.

**Architecture:** Store the live roadmap in `executiveMilestoneState/live`; all Executive mutation callables operate on that document and no longer accept a reporting-week identity. The protected reporting-week release callable reads that live document in the same transaction and writes an immutable copy to the released week. Dashboard rendering subscribes to the live document; PDF loading chooses a released-week snapshot, the live roadmap for an unreleased week, or the legacy weekly field as a compatibility fallback.

**Tech Stack:** Firebase Firestore, Firebase Functions v2 callable functions, vanilla browser JavaScript, Node built-in test runner, existing PDF service.

## Global Constraints

- Work only in the `v2.2T` worktree; do not modify or deploy v2.1 production.
- Existing section IDs, quarter IDs, role policies, RAG validation, structural approval, and append-only audit records remain authoritative.
- Project and other weekly data retain Draft/Released locking; only Executive milestones become continuously editable.
- Browser clients may read but never directly write live Executive timeline data or week snapshots.
- A release must atomically persist the live Executive milestone snapshot or fail without changing the release state.

---

## File structure

- `functions/executive-live-timeline.js` — shared live-state reference, normalization, legacy extraction, and snapshot construction.
- `functions/executive-milestones.js` — live update/request/approval/audit and Admin initialization callables.
- `functions/project-dashboard-writes.js` — protected release transaction that captures the live snapshot.
- `functions/index.js` — exports the initialization callable.
- `functions/test/executive-live-timeline.test.cjs` — pure state tests.
- `functions/test/executive-milestones-source.test.cjs` and `functions/test/project-dashboard-writes-source.test.cjs` — backend source contracts.
- `js/executive-api.mjs`, `index.html`, and `firestore.rules` — live subscription, UI sessions, Admin initialization, and client-write denial.
- `pdf-service/src/report-data.js`, `pdf-service/src/server.js`, and `pdf-service/test/report-data.test.mjs` — snapshot-aware PDF source selection.
- `scripts/seed-v2.2t-emulator.mjs` — isolated local lifecycle data only if required.

### Task 1: Add a focused live timeline state boundary

**Files:**
- Create: `functions/executive-live-timeline.js`
- Create: `functions/test/executive-live-timeline.test.cjs`

**Interfaces:**
- Produces: `liveTimelineRef(db)`, `liveTimelineFromWeek(week)`, `normalizeLiveTimelineState(value)`, `liveTimelineAsWeek(state)`, `nextLiveTimelineState(state, timeline, actorEmail, now)`, and `snapshotFromLiveTimeline(state, actorEmail, now)`.
- State shape: `{ timeline, version, initializedAt, initializedBy, updatedAt, updatedBy }`.
- Snapshot shape: `{ timeline, timelineVersion, capturedAt, capturedBy }`.

- [ ] **Step 1: Write the failing state test**

```js
test('builds a versioned live state and independent release snapshot', () => {
  const state = normalizeLiveTimelineState({ timeline: { rows: [{ sectionId: 'customer-engagements', cells: { q1: [] } }] }, version: 4 });
  const next = nextLiveTimelineState(state, { rows: [{ sectionId: 'customer-engagements', cells: { q1: [{ id: 'item-1' }] } }] }, 'bd@example.com', '2026-07-23T00:00:00.000Z');
  const snapshot = snapshotFromLiveTimeline(next, 'pm@example.com', '2026-07-24T00:00:00.000Z');
  assert.equal(next.version, 5);
  assert.equal(snapshot.timelineVersion, 5);
  next.timeline.rows[0].cells.q1[0].id = 'later-change';
  assert.equal(snapshot.timeline.rows[0].cells.q1[0].id, 'item-1');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test functions/test/executive-live-timeline.test.cjs`

Expected: FAIL because the live state module is missing.

- [ ] **Step 3: Implement the minimal state helper**

```js
const { getFirestore } = require('firebase-admin/firestore');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const liveTimelineRef = (db = getFirestore()) => db.collection('executiveMilestoneState').doc('live');
const liveTimelineFromWeek = week => clone(week?.strategyLayer?.executiveMilestoneTimeline || week?.executiveMilestoneTimeline || null);
const normalizeLiveTimelineState = value => ({ timeline: clone(value?.timeline || null), version: Number.isFinite(Number(value?.version)) ? Number(value.version) : 0 });
const liveTimelineAsWeek = state => ({ strategyLayer: { executiveMilestoneTimeline: clone(state.timeline) } });
const nextLiveTimelineState = (state, timeline, actorEmail, now) => ({ ...normalizeLiveTimelineState(state), timeline: clone(timeline), version: normalizeLiveTimelineState(state).version + 1, updatedAt: now, updatedBy: actorEmail });
const snapshotFromLiveTimeline = (state, actorEmail, now) => ({ timeline: clone(state.timeline), timelineVersion: normalizeLiveTimelineState(state).version, capturedAt: now, capturedBy: actorEmail });
module.exports = { liveTimelineRef, liveTimelineFromWeek, normalizeLiveTimelineState, liveTimelineAsWeek, nextLiveTimelineState, snapshotFromLiveTimeline };
```

- [ ] **Step 4: Verify GREEN**

Run: `node --test functions/test/executive-live-timeline.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/executive-live-timeline.js functions/test/executive-live-timeline.test.cjs
git commit -m "feat: add live Executive timeline state"
```

### Task 2: Move Executive callables from weeks to the live roadmap

**Files:**
- Modify: `functions/executive-milestones.js`
- Modify: `functions/index.js`
- Modify: `functions/test/executive-milestones-source.test.cjs`

**Interfaces:**
- Consumes: Task 1 helpers and existing `executive-milestone-core.js`.
- Produces: Existing Executive update/request/decision/direct-change/override callables with no `weekId` input; `initializeExecutiveMilestoneLiveTimeline({ sourceWeekId })` for Admin-only one-time migration.
- Existing history, request, and audit documents retain item and section labels and add `timelineVersion`; they no longer use a week ID as authority.

- [ ] **Step 1: Write failing callable contracts**

```js
test('Executive mutations read and write the live timeline rather than a reporting week', () => {
  const source = read('executive-milestones.js');
  assert.match(source, /liveTimelineRef\(db\)/);
  assert.match(source, /transaction\.get\(liveRef\)/);
  assert.match(source, /transaction\.set\(liveRef,/);
  assert.doesNotMatch(source, /const weekId = requireWeekId\(request\.data\)/);
});

test('only Admin can initialise the live Executive timeline from a selected week', () => {
  const source = read('executive-milestones.js');
  assert.match(source, /const initializeExecutiveMilestoneLiveTimeline = onCall/);
  assert.match(source, /Only administrators can initialize the live Executive timeline/);
  assert.match(read('index.js'), /exports\.initializeExecutiveMilestoneLiveTimeline/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test functions/test/executive-milestones-source.test.cjs`

Expected: FAIL because Executive mutation handlers still use `weeks/{weekId}`.

- [ ] **Step 3: Implement the live wrappers and one-time initialization**

```js
async function readLiveTimeline(transaction) {
  const liveRef = liveTimelineRef(db);
  const snapshot = await transaction.get(liveRef);
  if (!snapshot.exists || !snapshot.data()?.timeline) {
    throw new HttpsError('failed-precondition', 'Executive milestones have not been initialized. Ask an administrator to initialize the live roadmap.');
  }
  return { liveRef, state: normalizeLiveTimelineState(snapshot.data()) };
}

function saveLiveTimeline(transaction, liveRef, state, timeline, actorEmail, now) {
  transaction.set(liveRef, nextLiveTimelineState(state, timeline, actorEmail, now), { merge: true });
}
```

For each existing mutation, call `readLiveTimeline`, pass `liveTimelineAsWeek(state)` to the unchanged pure core, persist the returned timeline with `saveLiveTimeline`, and return `timelineVersion`. Keep all role and item-version checks. Initialization must require Admin, reject an existing live document, read exactly `sourceWeekId`, require a legacy timeline, and create version 1.

- [ ] **Step 4: Verify GREEN**

Run: `node --test functions/test/executive-milestones-source.test.cjs functions/test/executive-milestone-core.test.cjs`

Expected: PASS; current structural approval and audited override contracts remain covered.

- [ ] **Step 5: Commit**

```bash
git add functions/executive-milestones.js functions/index.js functions/test/executive-milestones-source.test.cjs
git commit -m "feat: make Executive milestones continuous"
```

### Task 3: Snapshot the live roadmap atomically on release

**Files:**
- Modify: `functions/project-dashboard-writes.js`
- Create: `functions/test/project-dashboard-writes-source.test.cjs`

**Interfaces:**
- Consumes: `liveTimelineRef`, `normalizeLiveTimelineState`, and `snapshotFromLiveTimeline`.
- Produces: `strategyLayer.executiveMilestoneTimelineSnapshot` only when an Admin/PM changes a week from Draft to Released.

- [ ] **Step 1: Write the failing source test**

```js
test('releasing a week captures the current live Executive timeline in the same transaction', () => {
  const source = read('project-dashboard-writes.js');
  assert.match(source, /liveTimelineRef\(database\(\)\)/);
  assert.match(source, /transaction\.get\(liveRef\)/);
  assert.match(source, /Executive milestones have not been initialized/);
  assert.match(source, /strategyLayer\.executiveMilestoneTimelineSnapshot/);
  assert.match(source, /snapshotFromLiveTimeline/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test functions/test/project-dashboard-writes-source.test.cjs`

Expected: FAIL because release currently changes only `isReleased`, editor identity, and week version.

- [ ] **Step 3: Add the release-only snapshot patch**

```js
const isReleasing = request.data.isReleased === true;
const patch = { isReleased: isReleasing, lastModifiedBy: actor.email, version: nextWeekVersion(weekSnapshot.data()) };
if (isReleasing) {
  const liveRef = liveTimelineRef(database());
  const liveSnapshot = await transaction.get(liveRef);
  const state = normalizeLiveTimelineState(liveSnapshot.exists ? liveSnapshot.data() : null);
  if (!state.timeline) throw new HttpsError('failed-precondition', 'Executive milestones have not been initialized. Initialize the live roadmap before releasing this week.');
  patch['strategyLayer.executiveMilestoneTimelineSnapshot'] = snapshotFromLiveTimeline(state, actor.email, new Date().toISOString());
}
transaction.update(weekRef, patch);
```

Do not read or write the live document while reverting to Draft. No other weekly write callable may write the snapshot field.

- [ ] **Step 4: Verify GREEN**

Run: `node --test functions/test/project-dashboard-writes.test.cjs functions/test/project-dashboard-writes-source.test.cjs tests/project-dashboard-api.test.mjs tests/firestore-rules-source.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/project-dashboard-writes.js functions/test/project-dashboard-writes-source.test.cjs
git commit -m "feat: snapshot Executive milestones on release"
```

### Task 4: Subscribe the dashboard to the live roadmap

**Files:**
- Modify: `js/executive-api.mjs`
- Modify: `index.html`
- Modify: `firestore.rules`
- Modify: `tests/executive-governance-ui.test.mjs`
- Modify: `tests/executive-access-lock-ui.test.mjs`
- Modify: `tests/firestore-rules-source.test.mjs`

**Interfaces:**
- Consumes: `executiveMilestoneState/live` and the existing live configuration listener.
- Produces: `currentExecutiveTimeline()`, a properly torn-down live subscription, API calls without `weekId`, and an Admin-only initialization action.

- [ ] **Step 1: Write failing UI and rules contracts**

```js
test('v2.2T subscribes to a live Executive roadmap and no longer locks it by selected week', () => {
  assert.match(dashboard, /doc\(db, 'executiveMilestoneState', 'live'\)/);
  assert.match(dashboard, /executiveLiveTimelineState/);
  assert.doesNotMatch(dashboard, /canChangeStructure = canChangeExecutiveStructure\(currentRole\) && !isWeekReleased/);
  assert.doesNotMatch(dashboard, /weekId: session\.weekId,[\s\S]*?executiveApi\.addUpdate/);
});

test('live Executive state is readable to signed-in users and never client-writable', () => {
  assert.match(rules, /match \/executiveMilestoneState\/\{stateId\}/);
  assert.match(rules, /allow read: if isSignedIn\(\);/);
  assert.match(rules, /allow write: if false;/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/executive-governance-ui.test.mjs tests/executive-access-lock-ui.test.mjs tests/firestore-rules-source.test.mjs`

Expected: FAIL because rendering and sessions still derive their Executive data and release lock from the selected week.

- [ ] **Step 3: Implement live UI wiring**

```js
let executiveLiveTimelineState = null;
let executiveLiveTimelineUnsub = null;

function currentExecutiveTimeline() {
  return normalizeExecutiveMilestoneTimeline(executiveLiveTimelineState?.timeline || {});
}

function subscribeExecutiveLiveTimeline() {
  executiveLiveTimelineUnsub?.();
  executiveLiveTimelineUnsub = onSnapshot(doc(db, 'executiveMilestoneState', 'live'), snapshot => {
    executiveLiveTimelineState = snapshot.exists() ? { ...snapshot.data(), version: Number(snapshot.data().version || 0) } : null;
    renderApp();
  });
}
```

Start the listener after authenticated configuration loading and stop it on logout/session replacement. Use `currentExecutiveTimeline()` in roadmap rendering, item lookup, drag/drop, RAG overrides, and history refresh. Remove selected-week release checks from Executive controls but retain all role predicates. Add `initializeLiveTimeline({ sourceWeekId })` to `executiveApi`; when the document is missing, show only Admin a confirmed primary initialization action based on the selected week. Other roles receive a neutral unavailable state and cannot write legacy data.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/executive-governance-ui.test.mjs tests/executive-access-lock-ui.test.mjs tests/executive-governance.test.mjs tests/firestore-rules-source.test.mjs`

Expected: PASS; each role retains its configured section limit and valid Executive actions remain available after releases.

- [ ] **Step 5: Commit**

```bash
git add js/executive-api.mjs index.html firestore.rules tests/executive-governance-ui.test.mjs tests/executive-access-lock-ui.test.mjs tests/firestore-rules-source.test.mjs
git commit -m "feat: render live Executive milestones"
```

### Task 5: Use snapshots for PDF source selection

**Files:**
- Modify: `pdf-service/src/report-data.js`
- Modify: `pdf-service/src/server.js`
- Modify: `pdf-service/test/report-data.test.mjs`

**Interfaces:**
- Consumes: selected week, optional `strategyLayer.executiveMilestoneTimelineSnapshot`, and `adapters.getLiveExecutiveTimeline()`.
- Produces: a cloned report week whose existing `strategyLayer.executiveMilestoneTimeline` is replaced only for the Executive PDF section.

- [ ] **Step 1: Write failing report-data tests**

```js
test('uses a released-week Executive snapshot instead of current live content', async () => {
  const report = await loadAuthorizedReport({ request: { mode: 'overview', weekId: 'W28', sections: ['executive-milestones'] }, idToken: 'pm@example.com', adapters: {
    ...adapters,
    getWeekById: async () => ({ isReleased: true, strategyLayer: { executiveMilestoneTimeline: { title: 'legacy' }, executiveMilestoneTimelineSnapshot: { timeline: { title: 'snapshot' }, timelineVersion: 3 } }),
    getLiveExecutiveTimeline: async () => ({ timeline: { title: 'live' }, version: 4 }),
  }});
  assert.equal(report.week.strategyLayer.executiveMilestoneTimeline.title, 'snapshot');
});

test('uses current live Executive content for an unreleased week', async () => {
  const report = await loadAuthorizedReport({ request: { mode: 'overview', weekId: 'W30', sections: ['executive-milestones'] }, idToken: 'pm@example.com', adapters: {
    ...adapters,
    getWeekById: async () => ({ isReleased: false, strategyLayer: { executiveMilestoneTimeline: { title: 'legacy draft' } }),
    getLiveExecutiveTimeline: async () => ({ timeline: { title: 'live current' }, version: 5 }),
  }});
  assert.equal(report.week.strategyLayer.executiveMilestoneTimeline.title, 'live current');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test pdf-service/test/report-data.test.mjs`

Expected: FAIL because the service currently reads only the weekly timeline field.

- [ ] **Step 3: Implement source-priority selection**

```js
function executiveTimelineForReport(week, liveState) {
  const snapshot = week?.strategyLayer?.executiveMilestoneTimelineSnapshot;
  if (week?.isReleased === true && snapshot?.timeline) return snapshot.timeline;
  if (week?.isReleased !== true && liveState?.timeline) return liveState.timeline;
  return week?.strategyLayer?.executiveMilestoneTimeline || week?.executiveMilestoneTimeline || null;
}
```

Call `getLiveExecutiveTimeline` only for an unreleased report that includes `executive-milestones`. Clone the week before injecting the selected timeline. Add the Firestore live-state adapter to `server.js`. The legacy weekly field is the only fallback for released historical weeks without a snapshot.

- [ ] **Step 4: Verify GREEN**

Run: `node --test pdf-service/test/report-data.test.mjs pdf-service/test/report-model.test.mjs pdf-service/test/overview-report.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pdf-service/src/report-data.js pdf-service/src/server.js pdf-service/test/report-data.test.mjs
git commit -m "feat: export Executive milestone snapshots"
```

### Task 6: Verify the isolated local lifecycle

**Files:**
- Modify if needed: `scripts/seed-v2.2t-emulator.mjs`
- Test: All focused function, UI, rules, and PDF test files listed below.

- [ ] **Step 1: Add only necessary local seed data**

Seed `executiveMilestoneState/live` with a Firestore-safe Customer Engagements item owned by `test.bd@pm-dashboard.local`. The seed must remain explicitly `TEST / DO NOT DELETE` and must not write production data.

- [ ] **Step 2: Run the complete focused suite**

Run: `node --test functions/test/executive-live-timeline.test.cjs functions/test/executive-milestone-core.test.cjs functions/test/executive-milestones-source.test.cjs functions/test/project-dashboard-writes.test.cjs functions/test/project-dashboard-writes-source.test.cjs tests/executive-governance.test.mjs tests/executive-governance-ui.test.mjs tests/executive-access-lock-ui.test.mjs tests/firestore-rules-source.test.mjs tests/project-dashboard-api.test.mjs pdf-service/test/report-data.test.mjs pdf-service/test/report-model.test.mjs pdf-service/test/overview-report.test.mjs`

Expected: PASS.

- [ ] **Step 3: Verify through the local emulator**

Run: `scripts\\start-v2.2t-emulator.cmd`

Expected lifecycle: Admin initializes once; BD updates Customer Engagements; PM/Admin releases a Draft week; BD updates again; the released-week PDF still renders the pre-update snapshot.

- [ ] **Step 4: Finish safely**

Run: `git diff --check` and `git status --short`.

Commit only tracked files created or changed by this feature. Do not stage `.superpowers/`, emulator logs, `tmp/`, `output/`, or dependency folders.

