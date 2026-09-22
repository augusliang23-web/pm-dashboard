# Production to UAT Sync Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make retained snapshots restorable with exact Firestore numeric values, preserve unresolved rollback-failure warnings, complete audit/status behavior, and replace heuristic IAM-role parsing with a structured safety policy.

**Architecture:** Add a server-only operational metadata codec that normalizes only allowlisted counters while leaving `weeks` business values exact. Persist recovery-required state independently in the UAT control document, then make status/UI and audit records consume that state. Replace prose role inference with an exact JSON boundary policy plus executable-file guards.

**Tech Stack:** Firebase Functions v2, Firebase Admin SDK 13.10.0, `@google-cloud/firestore` 7.11.6, Node.js CommonJS/ESM tests, Firestore Rules emulator.

**Spec:** `docs/superpowers/specs/2026-09-12-production-to-uat-sync-remediation-design.md`

## Global Constraints

- Production project is exactly `project-manager-dashboar-a067f` and remains read-only.
- UAT project is exactly `pm-dashboard-uat-20260820-a7f3` and is the only write destination.
- Production IAM is exactly `roles/datastore.viewer`; UAT sync IAM is exactly `roles/datastore.user`.
- The Production source collection allowlist is exactly `weeks`.
- Only UAT `weeks` and the two UAT operational sync namespaces may be mutated.
- UAT identities, settings, Executive data, logs, presence, usage, and Firebase Authentication remain untouched.
- Preserve Firestore integer versus double type and signed 64-bit integers in business data.
- Convert only explicit operational count fields from bigint to safe non-negative numbers.
- An unresolved `rollback_failed` warning remains visible until a verified manual restore clears it.
- Never execute `scripts/sync-v2.2t-local-data.mjs` or `pdf-service/deploy.ps1`.
- Local work does not authorize IAM changes, deploys, push, merge, Pages publication, live status, sync, or restore.

---

### Task 1: Operational Metadata Codec and Restore Round Trip

**Files:**
- Create: `functions/production-week-sync-metadata.js`
- Create: `functions/test/production-week-sync-metadata.test.cjs`
- Modify: `functions/production-week-sync.js`
- Modify: `functions/test/production-week-sync-boundary.test.cjs`

**Interfaces:**
- Consumes: Firestore-decoded server-only run/snapshot metadata; `createUatSyncStore(uatDb, options)`.
- Produces: `OPERATIONAL_COUNT_FIELDS`, `normalizeOperationalCount(value, field)`, `normalizeRunMetadata(data)`, and `normalizeSnapshotMetadata(data, snapshotId)`.

- [ ] **Step 1: Write failing codec tests**

Require all eight count fields from the spec and prove bigint normalization without touching nested business payloads:

```js
const input = {
  weekCount: 2n,
  createdCount: 1n,
  resultWeekCount: 2n,
  businessPayload: { exactInteger: 9007199254740993n },
};
const output = normalizeRunMetadata(input);
assert.equal(output.weekCount, 2);
assert.equal(output.createdCount, 1);
assert.equal(output.resultWeekCount, 2);
assert.equal(output.businessPayload.exactInteger, 9007199254740993n);
```

For every allowlisted field, test `0n`, `BigInt(Number.MAX_SAFE_INTEGER)`, and safe numeric integers. Reject `-1n`, `Number.MAX_SAFE_INTEGER + 1n`, fractions, `NaN`, `Infinity`, strings, and objects. Test that unknown numeric-looking keys are not silently converted.

- [ ] **Step 2: Run codec RED**

Run: `node --test functions/test/production-week-sync-metadata.test.cjs`

Expected: FAIL with `Cannot find module '../production-week-sync-metadata'`.

- [ ] **Step 3: Implement the closed codec**

Create the module with this public boundary:

```js
const OPERATIONAL_COUNT_FIELDS = Object.freeze([
  'weekCount', 'sourceWeekCount', 'destinationWeekCount', 'resultWeekCount',
  'restoredWeekCount', 'createdCount', 'updatedCount', 'deletedCount',
]);

function normalizeOperationalCount(value, field) {
  const normalized = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`Invalid operational count: ${field}`);
  }
  return normalized;
}
```

`normalizeRunMetadata` copies metadata without recursively converting business values and normalizes only present allowlisted fields. `normalizeSnapshotMetadata` additionally derives immutable `snapshotId` from its document ID.

- [ ] **Step 4: Write failing real-serialization adapter/service test**

In `production-week-sync-boundary.test.cjs`, use the installed Firestore serializer with `{ useBigInt: true }` to round-trip a complete retained snapshot metadata document and a completed run containing every count field. Feed those decoded values through the real `createUatSyncStore` boundary.

Require:

```js
assert.equal(typeof decoded.weekCount, 'bigint');
assert.equal(status.latestCompletedRun.resultWeekCount, 1);
assert.equal(typeof status.latestCompletedRun.resultWeekCount, 'number');
assert.equal((await service.restore({ actor, snapshotId: 'before-sync' })).phase, 'restored');
```

The same test includes a week with `9007199254740993n`, double `1.0`, and `-0`; snapshot/apply raw writes and verification must retain their integer/double canonical tags.

- [ ] **Step 5: Run integration RED**

Run: `node --test functions/test/production-week-sync-metadata.test.cjs functions/test/production-week-sync-boundary.test.cjs`

Expected: FAIL because the current UAT adapter passes bigint operational counts into status and restore validation.

- [ ] **Step 6: Integrate codec at every operational read boundary**

Use `normalizeRunMetadata(document.data())` in `readStatus`. Use `normalizeSnapshotMetadata(document.data(), document.id)` in `readSnapshot` and `listCompleteSnapshots`. Keep `listWeeks()` unchanged so all business bigint/double values remain exact.

Do not change the public raw-write mechanism or replace business bigint values with numbers.

- [ ] **Step 7: Run GREEN and regressions**

Run:

```bash
node --test functions/test/production-week-sync-metadata.test.cjs functions/test/production-week-sync-boundary.test.cjs functions/test/production-week-sync-core.test.cjs functions/test/production-week-sync-service.test.cjs
npm --prefix functions test
```

Expected: all tests pass with zero failures.

- [ ] **Step 8: Commit**

```bash
git add functions/production-week-sync-metadata.js functions/production-week-sync.js functions/test/production-week-sync-metadata.test.cjs functions/test/production-week-sync-boundary.test.cjs
git commit -m "fix: normalize UAT sync operational metadata"
```

---

### Task 2: Durable Recovery State, Complete Audit, and Truthful UI

**Files:**
- Modify: `functions/production-week-sync-core.js`
- Modify: `functions/production-week-sync.js`
- Modify: `functions/test/production-week-sync-service.test.cjs`
- Modify: `functions/test/production-week-sync-boundary.test.cjs`
- Modify: `js/uat-production-sync.mjs`
- Modify: `tests/uat-production-sync.test.mjs`
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 1 normalized operational metadata; existing sync/restore state machine.
- Produces: destination methods `setRecoveryRequired({ runId, failedAt })` and `clearRecoveryRequired({ runId })`; status fields `recoveryRequired`, `rollbackFailedRunId`, and `rollbackFailedAt`; complete sync/restore audit metadata.

- [ ] **Step 1: Write failing recovery-state service tests**

Extend the memory destination with durable recovery state. Test this sequence:

1. sync apply and rollback both fail;
2. `setRecoveryRequired` records the rollback-failed run and time even when `updateRun(rollback_failed)` throws;
3. lease expires;
4. a later restore fails before apply;
5. status still reports the original recovery-required state;
6. a later verified restore clears it;
7. successful sync alone does not clear it.

Require best-effort audit behavior: failure to set the durable flag still returns `rollback_failed` and retains the lease, but must never report success.

- [ ] **Step 2: Run recovery RED**

Run: `node --test functions/test/production-week-sync-service.test.cjs`

Expected: FAIL because the service has no durable recovery-state methods.

- [ ] **Step 3: Implement durable recovery state and audit contracts**

In `recoverOrFail`, after rollback verification fails, call:

```js
await recordRecoveryBestEffort(destinationStore, {
  runId,
  failedAt: nowIso(clock),
});
```

The UAT adapter stores these fields on `uatProductionWeekSync/control` with merge semantics. Neither lease release nor later acquire/renew operations may erase them. `clearRecoveryRequired` checks the current recovery flag and clears it only after the service has fully verified a manual restore.

Every run includes `productionProjectId` and `uatProjectId`. Sync uses `sourceProjectId: PRODUCTION_PROJECT_ID` and `destinationProjectId: UAT_PROJECT_ID`. Restore uses `sourceProjectId: UAT_PROJECT_ID`, `destinationProjectId: UAT_PROJECT_ID`, its own immutable `snapshotId`, and `restoredFromSnapshotId`.

Terminal sync metadata always includes `sourceReadTime`, `sourceDigest`, `resultDigest`, `resultWeekCount`, created/updated/deleted counts, and `completedAt`. Terminal restore metadata always includes `restoredFromSnapshotId`, `restoredDigest`, `restoredWeekCount`, the fixed environment fields, and `completedAt`.

- [ ] **Step 4: Write failing adapter and UI sequence tests**

Using the real UAT adapter with fake Firestore boundaries, test that recovery fields survive lease expiry and a newer failed run. Test that verified restore clears them but verified sync does not.

In browser tests require:

```js
assert.equal(formatProductionSyncStatus({
  recoveryRequired: true,
  rollbackFailedRunId: 'failed-run',
  latestRun: { phase: 'restoring', result: 'failed' },
}), ROLLBACK_FAILED_MESSAGE);
```

Add an exported pure helper `getLatestSuccessfulOperation(status)` returning only `status.latestCompletedRun` when its phase is `succeeded` or `restored`; otherwise return `null`. Make `index.html` render “Last successful operation” only from that helper and never fall back to `latestRun`.

- [ ] **Step 5: Run adapter/UI RED**

Run:

```bash
node --test functions/test/production-week-sync-boundary.test.cjs functions/test/production-week-sync-service.test.cjs tests/uat-production-sync.test.mjs
```

Expected: FAIL because recovery state is not independent and failed-only status is still labeled successful.

- [ ] **Step 6: Implement status and UI behavior**

`readStatus` returns normalized closed fields from control independently of `latestRun`. `formatProductionSyncStatus` checks `recoveryRequired` before active phase or latest-run errors. Publish and render `latestCompletedRun` separately; preserve the existing Admin, confirmation, local/server busy, accessible-dialog, and callable-only behavior.

- [ ] **Step 7: Run GREEN and regressions**

Run:

```bash
node --test functions/test/production-week-sync-core.test.cjs functions/test/production-week-sync-service.test.cjs functions/test/production-week-sync.test.cjs functions/test/production-week-sync-boundary.test.cjs tests/uat-production-sync.test.mjs
npm --prefix functions test
npm run test:all
```

Expected: all tests pass with zero failures except the existing explicit unmanaged-Rules skip in `test:all`.

- [ ] **Step 8: Commit**

```bash
git add functions/production-week-sync-core.js functions/production-week-sync.js functions/test/production-week-sync-service.test.cjs functions/test/production-week-sync-boundary.test.cjs js/uat-production-sync.mjs tests/uat-production-sync.test.mjs index.html
git commit -m "fix: preserve UAT sync recovery state"
```

---

### Task 3: Structured IAM Boundary Policy and Final Local Verification

**Files:**
- Create: `config/production-week-sync-boundary.json`
- Modify: `scripts/verify-production-sync-boundary.mjs`
- Modify: `tests/production-week-sync-boundary.test.mjs`
- Modify: `README.md`
- Modify: `functions/README.md`

**Interfaces:**
- Consumes: repository runtime/deployment files and the exact Task 3 JSON policy.
- Produces: `parseProductionSyncBoundaryPolicy(text)` and `verifyProductionSyncBoundary(sources)` with `sources.policy`, `sources.runtime`, `sources.imports`, `sources.productionRead`, and `sources.deployment`.

- [ ] **Step 1: Write failing policy parser tests**

Create the exact safe policy fixture from the spec. Require the parser to return a frozen normalized object. For each mutation below, require a structured violation:

- missing or extra top-level key;
- changed Production or UAT project ID;
- empty, duplicate, extra, or write-capable Production role;
- empty, duplicate, or extra UAT role;
- source collections missing `weeks`, duplicated, or containing any second value;
- invalid JSON, non-object root, or non-string array member.

- [ ] **Step 2: Write failing executable-source guard tests**

Remove role prose from safe deployment fixtures. Require any `roles/datastore` string outside `sources.policy` to fail, including same-line, multiline, variable alias, object config, and `grant('Production', role)` forms. Also retain tests for dynamic collection, caller-selected project IDs, source aliases/writes, old local sync imports, `.firebaserc` Production aliases, and Production deploy targets.

Prove README prose is not part of executable scanner input and that this valid policy passes:

```json
{
  "productionProjectId": "project-manager-dashboar-a067f",
  "productionRoles": ["roles/datastore.viewer"],
  "uatProjectId": "pm-dashboard-uat-20260820-a7f3",
  "uatRoles": ["roles/datastore.user"],
  "sourceCollections": ["weeks"]
}
```

- [ ] **Step 3: Run RED**

Run: `node --test tests/production-week-sync-boundary.test.mjs`

Expected: FAIL because the structured policy file/parser do not exist and the verifier still parses role prose heuristically.

- [ ] **Step 4: Implement the structured boundary**

Read the JSON policy directly in CLI mode. Validate exact keys and exact singleton arrays. Remove nearest-marker and carried-scope role parsing completely.

The executable scan rejects:

```js
if (/roles\s*\/\s*datastore/i.test(executableDeploymentText)) {
  violations.push(violation(
    'datastore-role-outside-policy',
    'Datastore roles must be declared only in the structured sync boundary policy.',
    'deployment',
  ));
}
```

Keep the existing dedicated Production-read-module checks and recursive runtime/deployment file discovery. Exclude documentation and the policy file from executable role scanning; do not exclude actual deploy scripts, Firebase configs, package scripts, shell files, or PowerShell files.

- [ ] **Step 5: Update non-executing documentation**

Document that `config/production-week-sync-boundary.json` is the local policy source of truth and that it does not grant IAM. Preserve the separate explicit cloud authorization gate and do not add executable IAM/deploy commands.

- [ ] **Step 6: Run all fresh local verification**

```bash
node --test functions/test/production-week-sync-metadata.test.cjs functions/test/production-week-sync-core.test.cjs functions/test/production-week-sync-service.test.cjs functions/test/production-week-sync.test.cjs functions/test/production-week-sync-boundary.test.cjs tests/uat-production-sync.test.mjs tests/production-week-sync-boundary.test.mjs
npm --prefix functions test
npm run test:all
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home/bin:$PATH npm run test:rules
npm run verify:sync-boundary
git diff --check
```

Expected: focused, Functions, full, both managed Rules suites, verifier, and diff checks all succeed; `test:all` may contain only the explicit unmanaged-Rules skip.

- [ ] **Step 7: Review preserved boundaries**

Inspect the complete branch diff from `2e42f594db6ab155ebef28df0091eb018ebf3883`. Require no write API in the dedicated Production read module, no executable Production deployment target or IAM command, no browser direct write to `weeks` or operational sync namespaces, and no changes to the excluded UAT namespaces.

- [ ] **Step 8: Commit**

```bash
git add config/production-week-sync-boundary.json scripts/verify-production-sync-boundary.mjs tests/production-week-sync-boundary.test.mjs README.md functions/README.md
git commit -m "test: make UAT sync boundary policy explicit"
```

- [ ] **Step 9: Independent final review and stop before cloud mutation**

Run one fresh whole-branch review focused on the remediation acceptance criteria and original one-way sync specification. Keep service-account creation, IAM grants, Functions/Rules deployment, Pages publication, push/merge, live status, first live sync, and live restore explicitly unexecuted.
