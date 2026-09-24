# Production to UAT Week Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Admin-only UAT action that mirrors Production `weeks` into UAT after a verified snapshot, automatically rolls back failed writes, and restores one of the five newest snapshots without ever writing to Production.

**Architecture:** Add a dependency-injected synchronization core under `functions/`, then bind it to explicit Production-read and UAT-write Firestore adapters in three UAT callable Functions. Add a small browser API/state module and an Admin-only Week Management panel; the existing UAT `onSnapshot` subscription remains the only visible-week refresh path.

**Tech Stack:** Firebase Functions v2, Firebase Admin SDK/Firestore, Firebase Web SDK 10.12.2, Node.js CommonJS backend tests, Node.js ESM frontend tests.

**Spec:** `docs/superpowers/specs/2026-09-11-production-to-uat-week-sync-design.md`

## Global Constraints

- Source project is exactly `project-manager-dashboar-a067f`; destination is exactly `pm-dashboard-uat-20260820-a7f3`.
- Production IAM is exactly `roles/datastore.viewer`; no Production write role is allowed.
- The Production collection allowlist is exactly `weeks`.
- UAT identities, settings, Executive data, logs, presence, usage, and Firebase Authentication are never synchronized or mutated.
- Server authorization requires a signed-in UAT `admin` with a non-empty display name.
- A digest-verified UAT snapshot must exist before the first UAT `weeks` mutation.
- Success means exact Production/UAT week document IDs and canonical contents; UAT-only weeks are deleted.
- Apply or verification failure attempts automatic rollback and never reports partial writes as success.
- Keep the five newest complete snapshots.
- Never execute `scripts/sync-v2.2t-local-data.mjs` or `pdf-service/deploy.ps1`.
- Local implementation does not authorize IAM changes, deploys, pushes, merges, Pages publication, or live sync/restore.

---

### Task 1: Deterministic Mirror Planning

**Files:**
- Create: `functions/production-week-sync-core.js`
- Create: `functions/test/production-week-sync-core.test.cjs`

**Interfaces:**
- Consumes: arrays of `{ id: string, data: object }` week entries.
- Produces: `canonicalizeValue`, `canonicalizeWeekEntries`, `digestWeekEntries`, `validateSourceWeeks`, `planWeekMirror`, `assertSyncEnvironment`, `PRODUCTION_PROJECT_ID`, `UAT_PROJECT_ID`, `SYNC_COLLECTION`, and `SNAPSHOT_RETENTION_COUNT`.

- [ ] **Step 1: Write failing core tests**

Create the test with Node's built-in runner. Include these exact cases:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../production-week-sync-core');

test('environment guard allows only the fixed Production-to-UAT direction', () => {
  assert.doesNotThrow(() => core.assertSyncEnvironment({
    sourceProjectId: 'project-manager-dashboar-a067f',
    destinationProjectId: 'pm-dashboard-uat-20260820-a7f3',
  }));
  assert.throws(() => core.assertSyncEnvironment({
    sourceProjectId: 'pm-dashboard-uat-20260820-a7f3',
    destinationProjectId: 'project-manager-dashboar-a067f',
  }), /fixed Production-to-UAT direction/);
});

test('empty or duplicate Production weeks are rejected', () => {
  assert.throws(() => core.validateSourceWeeks([]), /no reporting weeks/);
  assert.throws(() => core.validateSourceWeeks([
    { id: 'W36-2026', data: {} },
    { id: 'W36-2026', data: {} },
  ]), /duplicate/);
});

test('mirror planning classifies every document ID', () => {
  const plan = core.planWeekMirror({
    sourceWeeks: [
      { id: 'W35-2026', data: { projects: [{ code: 'NEW' }] } },
      { id: 'W36-2026', data: { projects: [{ code: 'SAME' }] } },
      { id: 'W37-2026', data: { projects: [] } },
    ],
    destinationWeeks: [
      { id: 'W34-2026', data: { projects: [] } },
      { id: 'W35-2026', data: { projects: [{ code: 'OLD' }] } },
      { id: 'W36-2026', data: { projects: [{ code: 'SAME' }] } },
    ],
  });
  assert.deepEqual(plan.createdIds, ['W37-2026']);
  assert.deepEqual(plan.updatedIds, ['W35-2026']);
  assert.deepEqual(plan.unchangedIds, ['W36-2026']);
  assert.deepEqual(plan.deletedIds, ['W34-2026']);
});
```

Add tests for sorted object keys, Timestamp, GeoPoint, bytes, arrays, null, DocumentReference paths, unsupported values, invalid/slashed IDs, non-object documents, and the 1,000,000-byte ceiling.

- [ ] **Step 2: Run RED**

Run: `node --test functions/test/production-week-sync-core.test.cjs`

Expected: FAIL with `Cannot find module '../production-week-sync-core'`.

- [ ] **Step 3: Implement the core**

Create the module with fixed constants and exports:

```js
const { createHash } = require('node:crypto');

const PRODUCTION_PROJECT_ID = 'project-manager-dashboar-a067f';
const UAT_PROJECT_ID = 'pm-dashboard-uat-20260820-a7f3';
const SYNC_COLLECTION = 'weeks';
const SNAPSHOT_RETENTION_COUNT = 5;

function assertSyncEnvironment({ sourceProjectId, destinationProjectId }) {
  if (sourceProjectId !== PRODUCTION_PROJECT_ID || destinationProjectId !== UAT_PROJECT_ID) {
    throw new Error('Sync is restricted to the fixed Production-to-UAT direction.');
  }
}

function digestWeekEntries(entries) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeWeekEntries(entries)))
    .digest('hex');
}
```

Implement `canonicalizeValue` with tagged representations `{ __firestoreType, ... }`, recursively sorted map keys, and rejection of `undefined`, functions, symbols, cyclic values, and non-finite numbers. Implement `validateSourceWeeks` and return sorted ID arrays plus source/destination digests from `planWeekMirror`.

- [ ] **Step 4: Run GREEN and regressions**

Run: `node --test functions/test/production-week-sync-core.test.cjs && npm --prefix functions test`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

```bash
git add functions/production-week-sync-core.js functions/test/production-week-sync-core.test.cjs
git commit -m "feat: define safe UAT week mirror plan"
```

---

### Task 2: Snapshot, Apply, Verify, Rollback, and Restore Workflow

**Files:**
- Modify: `functions/production-week-sync-core.js`
- Create: `functions/test/production-week-sync-service.test.cjs`

**Interfaces:**
- Consumes: Task 1 helpers; `sourceStore.listWeeks()`; destination methods `acquireLease`, `renewLease`, `releaseLease`, `createRun`, `updateRun`, `readStatus`, `listWeeks`, `writeSnapshot`, `readSnapshot`, `applyMirror`, `listCompleteSnapshots`, and `deleteSnapshot`.
- Produces: `createWeekSyncService({ sourceStore, destinationStore, clock, idFactory })` returning async `sync({ actor })`, `status({ actor })`, and `restore({ actor, snapshotId })`.

- [ ] **Step 1: Write failing workflow tests**

Use an in-memory destination that records method order. Define:

```js
const week = (id, code) => ({ id, data: { weekLabel: id, projects: [{ code }] } });
const admin = () => ({ uid: 'admin-1', email: 'admin@example.com', role: 'admin', displayName: 'Admin' });
```

Test exact mirroring and require `writeSnapshot` before `applyMirror`. Add separate tests for: invalid source before mutation; snapshot digest failure before mutation; apply failure with verified rollback; rollback failure ending `rollback_failed`; active and expired leases; restore snapshotting current weeks before restore; restore never calling Production; sanitized status; five-snapshot retention; and metadata containing no week payload or credential.

- [ ] **Step 2: Run RED**

Run: `node --test functions/test/production-week-sync-service.test.cjs`

Expected: FAIL because `createWeekSyncService` is not exported.

- [ ] **Step 3: Implement the workflow**

Add this public shape:

```js
function createWeekSyncService({ sourceStore, destinationStore, clock, idFactory }) {
  async function sync({ actor }) {
    return runSync({ sourceStore, destinationStore, clock, idFactory, actor });
  }
  async function status({ actor }) { return destinationStore.readStatus({ actor }); }
  async function restore({ actor, snapshotId }) {
    return runRestore({ destinationStore, clock, idFactory, actor, snapshotId });
  }
  return { sync, status, restore };
}
```

Implement private `runSync` and `runRestore` functions using this order:

1. acquire 15-minute lease;
2. create run as `reading_source`;
3. read and validate source;
4. list destination and calculate plan;
5. mark `snapshotting`, write snapshot, re-read and verify snapshot digest;
6. mark `applying`, renew lease, apply in bounded batches;
7. mark `verifying`, re-read destination and compare IDs/count/digest;
8. mark `succeeded`, release owned lease, prune after success;
9. on apply/verify failure mark `rolling_back`, restore and verify; finish `rolled_back` or `rollback_failed` without returning success.

Restore must acquire its own lease, require `snapshotId` among retained complete snapshots, snapshot current weeks, exactly mirror the chosen snapshot, verify it, and finish `restored`. Export the service factory.

- [ ] **Step 4: Run GREEN and regressions**

Run: `node --test functions/test/production-week-sync-core.test.cjs functions/test/production-week-sync-service.test.cjs && npm --prefix functions test`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

```bash
git add functions/production-week-sync-core.js functions/test/production-week-sync-service.test.cjs
git commit -m "feat: protect UAT week sync with snapshots"
```

---

### Task 3: Firebase Adapters and UAT Callable Functions

**Files:**
- Create: `functions/production-week-sync.js`
- Create: `functions/test/production-week-sync.test.cjs`
- Create: `functions/test/production-week-sync-boundary.test.cjs`
- Modify: `functions/index.js:1-145`

**Interfaces:**
- Consumes: Task 1/2 core exports.
- Produces: `syncProductionWeeksToUat`, `getProductionWeekSyncStatus`, `restoreUatWeeksSnapshot`, `authenticatedSyncAdmin`, `createProductionReadStore`, `createUatSyncStore`, `SYNC_FUNCTION_OPTIONS`.

- [ ] **Step 1: Write failing adapter and source-boundary behavior tests**

Test unauthenticated, missing user, missing display name, non-Admin, and Admin authorization. Test closed request schemas: `{}` for sync/status and `{ snapshotId }` for restore. Test 200-operation destination batches and remapping DocumentReferences onto UAT by path.

In the boundary test, exercise the real Production adapter against a fake database whose only collection supports `get()`. Assert the adapter requests literal `weeks`, returns the snapshot documents, and exposes no write method:

```js
const requested = [];
const store = createProductionReadStore({
  collection(name) {
    requested.push(name);
    return { get: async () => ({ docs: [{ id: 'W36-2026', data: () => ({ projects: [] }) }] }) };
  },
});
assert.deepEqual(Object.keys(store), ['listWeeks']);
assert.deepEqual(await store.listWeeks(), [{ id: 'W36-2026', data: { projects: [] } }]);
assert.deepEqual(requested, ['weeks']);
```

Require `functions/index.js` and assert its three callable properties are functions. Exercise request validators to prove callers cannot choose a source/destination project or collection. Review the explicit dedicated-service-account options as part of the task diff rather than adding a constant-value change detector.

- [ ] **Step 2: Run RED**

Run: `node --test functions/test/production-week-sync.test.cjs functions/test/production-week-sync-boundary.test.cjs`

Expected: FAIL because the Firebase module and exports do not exist.

- [ ] **Step 3: Implement Firebase boundaries**

Use these fixed definitions:

```js
const SYNC_SERVICE_ACCOUNT =
  'uat-production-sync@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com';
const SYNC_FUNCTION_OPTIONS = Object.freeze({
  region: 'us-central1', timeoutSeconds: 540, memory: '512MiB',
  serviceAccount: SYNC_SERVICE_ACCOUNT,
});
```

Initialize the named Production app with `applicationDefault()` and `projectId: PRODUCTION_PROJECT_ID`. Give its adapter only `listWeeks()`. Build the UAT adapter around default `getFirestore()`, the two operational namespaces in the spec, 200-write batches, native Firestore type reconstruction, lease ownership, digest verification, and retention cleanup.

`authenticatedSyncAdmin` must load normalized `users/{email}` from UAT and require `role === 'admin'`, UID, email, and display name. Use stable `HttpsError.details.reason` values. Before constructing the service, require the runtime Google Cloud project to equal `UAT_PROJECT_ID`.

Export callables with `onCall(SYNC_FUNCTION_OPTIONS, handler)` and add to `functions/index.js`:

```js
exports.syncProductionWeeksToUat = productionWeekSync.syncProductionWeeksToUat;
exports.getProductionWeekSyncStatus = productionWeekSync.getProductionWeekSyncStatus;
exports.restoreUatWeeksSnapshot = productionWeekSync.restoreUatWeeksSnapshot;
```

- [ ] **Step 4: Run GREEN and Functions regressions**

Run: `node --test functions/test/production-week-sync*.test.cjs && npm --prefix functions test`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

```bash
git add functions/production-week-sync.js functions/index.js functions/test/production-week-sync.test.cjs functions/test/production-week-sync-boundary.test.cjs
git commit -m "feat: expose Admin-only UAT sync callables"
```

---

### Task 4: Admin Week Management UI

**Files:**
- Create: `js/uat-production-sync.mjs`
- Create: `tests/uat-production-sync.test.mjs`
- Modify: `index.html:2700-2750,2844-2868,4538-4578,10682-10714`

**Interfaces:**
- Consumes: browser `functions`, `httpsCallable`, `currentRole`, and Week Management lifecycle.
- Produces: `createUatProductionSyncApi`, `createUatProductionSyncController`, `canUseProductionWeekSync`, `formatProductionSyncResult`, plus window actions for confirm, sync, status, and restore.

- [ ] **Step 1: Write failing browser module and UI tests**

Require Admin-only behavior and exact calls:

```js
const calls = [];
const api = createUatProductionSyncApi({
  functions: {},
  httpsCallable: (_functions, name) => async data => {
    calls.push({ name, data });
    return { data: { ok: true } };
  },
});
await api.sync();
await api.status();
await api.restore('run-1');
assert.deepEqual(calls, [
  { name: 'syncProductionWeeksToUat', data: {} },
  { name: 'getProductionWeekSyncStatus', data: {} },
  { name: 'restoreUatWeeksSnapshot', data: { snapshotId: 'run-1' } },
]);
```

Test `createUatProductionSyncController` with a real controller and fake external API/view boundary. Require Admin-only actions, exact warning copy from the spec, disabled actions during work, status refresh, rolled-back and rollback-failed messages, restore confirmation, and no direct week mutation callback.

- [ ] **Step 2: Run RED**

Run: `node --test tests/uat-production-sync.test.mjs`

Expected: FAIL because the module and UI panel do not exist.

- [ ] **Step 3: Implement pure browser helpers**

Create:

```js
export function canUseProductionWeekSync(role) {
  return String(role || '').trim().toLowerCase() === 'admin';
}

export function createUatProductionSyncApi({ functions, httpsCallable }) {
  const call = name => httpsCallable(functions, name);
  return {
    sync: () => call('syncProductionWeeksToUat')({}).then(result => result.data),
    status: () => call('getProductionWeekSyncStatus')({}).then(result => result.data),
    restore: snapshotId => call('restoreUatWeeksSnapshot')({ snapshotId }).then(result => result.data),
  };
}

export function formatProductionSyncResult(result = {}) {
  return `Production sync completed: ${Number(result.createdCount || 0)} created, ${Number(result.updatedCount || 0)} updated, ${Number(result.deletedCount || 0)} deleted.`;
}
```

Add tested phase labels, safe rolled-back/rollback-failed messages, and `createUatProductionSyncController({ api, getRole, view })`. The controller owns confirm/status/busy/result state and calls only the three API methods; the view owns DOM rendering.

- [ ] **Step 4: Implement accessible Admin UI**

Add `.admin-only` `Production Data Sync` panel IDs `productionWeekSyncPanel`, `productionWeekSyncStatus`, `productionWeekSyncButton`, and `restoreUatWeekSnapshotButton`. Add accessible sync and restore confirmation overlays. Recheck `currentRole === 'admin'`, disable both buttons for every request, never mutate `allWeeks`, and call status when Admin opens Week Management. The existing `onSnapshot` callback refreshes the dashboard after server writes.

- [ ] **Step 5: Run GREEN and full browser-side suite**

Run: `node --test tests/uat-production-sync.test.mjs && npm run test:all`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit**

```bash
git add js/uat-production-sync.mjs index.html tests/uat-production-sync.test.mjs
git commit -m "feat: add UAT Production sync controls"
```

---

### Task 5: Rules, Deployment Guards, Documentation, and Final Verification

**Files:**
- Modify: `firestore.rules:122-207`
- Modify: `firestore.shared-backend.rules:122-207`
- Modify: `tests/firestore-rules-emulator.test.mjs`
- Create: `scripts/verify-production-sync-boundary.mjs`
- Create: `tests/production-week-sync-boundary.test.mjs`
- Modify: `package.json`
- Modify: `functions/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: explicit browser denial for sync records, an executable deployment-boundary verifier, and a non-executing rollout runbook.

- [ ] **Step 1: Write failing isolation tests**

Extend the Rules emulator test so signed-in Admin and non-Admin clients are denied read/write access to `uatProductionWeekSync/control` and `uatProductionWeekSyncRuns/run-1`, including the snapshot subcollection.

Create a real boundary verifier that returns violations from supplied repository sources and checks the live checkout when run as a command. Test it with one safe fixture and mutations containing a Production write role, caller-selected project ID, a second source collection, an old local-sync runtime import, and a Production Firebase deploy target. Each mutation must cause a non-zero violation result.

The Rules implementation contains:

```text
match /uatProductionWeekSync/{document=**} {
  allow read, write: if false;
}
match /uatProductionWeekSyncRuns/{document=**} {
  allow read, write: if false;
}
```

Add `"verify:sync-boundary": "node scripts/verify-production-sync-boundary.mjs"` to root package scripts. Run the verifier against the actual repository during full verification.

- [ ] **Step 2: Run RED**

Run: `node --test tests/production-week-sync-boundary.test.mjs tests/firestore-rules-emulator.test.mjs`

Expected: FAIL because the verifier and explicit Rules behavior are absent. If the Rules test requires its emulator harness, run the new boundary test first for RED and run `npm run test:rules` after adding the Rules cases.

- [ ] **Step 3: Add Rules and runbook**

Add the two exact default-deny blocks to both Rules files. Implement the verifier with exported `verifyProductionSyncBoundary(sources)` and a CLI that reads the planned runtime/deployment files, prints every violation, and exits 1 on violations. Document the three callables, dedicated service account, UAT `roles/datastore.user`, Production `roles/datastore.viewer`, five-snapshot behavior, automatic rollback, preserved namespaces, and separate cloud gate. Do not add executable IAM mutation commands.

- [ ] **Step 4: Run all local verification**

```bash
node --test tests/production-week-sync-boundary.test.mjs
npm run test:rules
npm run verify:sync-boundary
npm --prefix functions test
npm run test:all
git diff --check
```

Expected: every test passes and diff check has no output.

- [ ] **Step 5: Review repository boundaries**

```bash
git diff --name-only 2e42f594db6ab155ebef28df0091eb018ebf3883...HEAD
rg -n "project-manager-dashboar-a067f|pm-dashboard-uat-20260820-a7f3|roles/datastore" functions js index.html README.md tests firestore.rules firestore.shared-backend.rules
```

Require Production ID only in the read-only source constant, tests, spec, and prose IAM boundary. Require no Production deployment target or Production write role.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules firestore.shared-backend.rules tests/firestore-rules-emulator.test.mjs scripts/verify-production-sync-boundary.mjs tests/production-week-sync-boundary.test.mjs package.json functions/README.md README.md
git commit -m "test: guard Production to UAT sync boundary"
```

- [ ] **Step 7: Independent final review and stop before cloud mutation**

Run fresh Functions and full suites, inspect every changed file, and report authentication, project direction, source API, snapshot ordering, rollback, lease, batches, UI, and preserved-namespace findings. Keep these actions explicitly unexecuted: service-account creation, IAM grants, Functions/Rules deploy, Pages publication, push/merge, live status probe, and first live sync/restore.
