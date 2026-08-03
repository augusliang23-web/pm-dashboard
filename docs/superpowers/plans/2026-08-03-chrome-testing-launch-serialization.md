# Chrome for Testing Launch Serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the production and UAT PDF test suites from launching macOS Chrome for Testing concurrently and recreating the confirmed LaunchServices `SIGABRT` crash dialog.

**Architecture:** A test-only atomic lock file in the operating-system temporary directory serializes complete PDF test runs across repositories and worktrees. A Node wrapper acquires that lock, discovers tests deterministically, runs Node with `--test-concurrency=1`, forwards the child result, and releases or recovers the lock without changing runtime PDF behavior.

**Tech Stack:** Node.js 20 ESM, `node:test`, `node:fs/promises`, `node:child_process`, Puppeteer 24.

## Global Constraints

- Apply the same test-runner implementation to `pm-dashboard` and `pm-dashboard-uat`.
- Use the same lock filename in both repositories: `pm-dashboard-pdf-browser-tests.lock` under `os.tmpdir()`.
- Do not change dashboard UI, report data, PDF output, Cloud Run request handling, or production browser lifecycle.
- Use `npm test` as the supported browser-layout test entry point.
- Never remove a live owner's lock; remove only an owned lock or a lock proven stale.
- Do not deploy Pages or Cloud Run for this test-only fix.

---

### Task 1: Add the atomic browser-test lock to v2.1

**Files:**
- Create: `pdf-service/scripts/browser-test-lock.mjs`
- Create: `pdf-service/test/browser-test-lock.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_BROWSER_TEST_LOCK_PATH: string`.
- Produces: `acquireBrowserTestLock(options?) -> Promise<{ waitedMs: number, release(): Promise<void> }>`.
- Options: `{ lockPath, timeoutMs, pollMs, malformedGraceMs }` with production defaults of 600000, 100, and 1000 milliseconds.

- [ ] **Step 1: Write failing behavior tests**

Create tests that dynamically import the not-yet-created helper and fail with an assertion if the module is absent. After import, use a unique file in `mkdtemp()` and assert literal acquisition order:

```js
const first = await acquireBrowserTestLock({ lockPath, pollMs: 10 });
const events = ['first'];
const secondPromise = acquireBrowserTestLock({ lockPath, pollMs: 10 }).then(lock => {
  events.push('second');
  return lock;
});
await delay(50);
assert.deepEqual(events, ['first']);
await first.release();
const second = await secondPromise;
assert.deepEqual(events, ['first', 'second']);
await second.release();
```

Add a second test that writes a lock record with dead PID `99999999`, acquires the same path, and releases it. Add a third test that proves an old release token cannot remove a replacement owner's lock.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/browser-test-lock.test.mjs`

Expected: FAIL with `browser-test-lock.mjs must export acquireBrowserTestLock` because the helper does not exist.

- [ ] **Step 3: Implement the minimal lock helper**

Use `open(lockPath, 'wx')` for atomic acquisition and write JSON containing `pid`, `token: randomUUID()`, and `acquiredAt`. On `EEXIST`, read the owner record. Treat a positive PID as live when `process.kill(pid, 0)` succeeds or returns `EPERM`. If the owner is dead, remove only the exact lock file and retry. If the record is malformed, wait until its `mtimeMs` exceeds `malformedGraceMs` before treating it as stale. Abort after `timeoutMs` with an error containing the lock path and owner PID.

The returned `release()` must reread the record and call `unlink(lockPath)` only when its token equals the acquired token. Ignore `ENOENT`; propagate unexpected filesystem errors.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/browser-test-lock.test.mjs`

Expected: all lock tests PASS with no Chrome process started.

- [ ] **Step 5: Commit Task 1**

```bash
git add pdf-service/scripts/browser-test-lock.mjs pdf-service/test/browser-test-lock.test.mjs
git commit -m "test: serialize PDF browser test ownership"
```

### Task 2: Add and wire the serialized v2.1 test runner

**Files:**
- Create: `pdf-service/scripts/run-tests.mjs`
- Create: `pdf-service/test/test-runner.test.mjs`
- Modify: `pdf-service/package.json`

**Interfaces:**
- Consumes: `acquireBrowserTestLock()` from Task 1.
- Produces: `discoverTestFiles(testDirectory) -> Promise<string[]>`.
- Produces: `buildNodeTestArgs(testFiles) -> string[]`.
- Produces: `runNodeTests({ testFiles, lockPath, stdio? }) -> Promise<number>`.

- [ ] **Step 1: Write failing runner tests**

Assert that discovery returns only sorted `*.test.mjs` files. Assert the exact Node arguments:

```js
assert.deepEqual(buildNodeTestArgs(['/tmp/a.test.mjs', '/tmp/b.test.mjs']), [
  '--test', '--test-concurrency=1', '/tmp/a.test.mjs', '/tmp/b.test.mjs'
]);
```

Create one passing and one failing temporary Node test file. Call `runNodeTests()` with a unique lock path and `stdio: 'pipe'`; assert literal exit codes `0` and `1`. The test must use the real Node child process rather than a spawn mock.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/test-runner.test.mjs`

Expected: FAIL with `run-tests.mjs must export buildNodeTestArgs` because the runner does not exist.

- [ ] **Step 3: Implement the runner**

Discover files with `readdir(testDirectory, { withFileTypes: true })`, retain file entries ending in `.test.mjs`, convert them to absolute paths, and sort them. Acquire the shared lock before spawning `process.execPath` with the exact arguments from `buildNodeTestArgs()`. Use `stdio: 'inherit'` in CLI execution. Resolve `0` for child success and `1` for a signal or missing exit code; preserve any explicit nonzero child exit code. Release in `finally`.

Execute the CLI main function only when `import.meta.url` matches the invoked script path, and set `process.exitCode` from `runNodeTests()`.

- [ ] **Step 4: Wire the package command**

Change `pdf-service/package.json`:

```json
"test": "node scripts/run-tests.mjs"
```

- [ ] **Step 5: Run focused and complete tests**

Run: `node --test test/browser-test-lock.test.mjs test/test-runner.test.mjs`

Expected: all focused tests PASS without launching Chrome.

Run outside the restricted sandbox: `npm test`

Expected: every v2.1 PDF test PASS; browser-bearing files run one at a time.

- [ ] **Step 6: Commit Task 2**

```bash
git add pdf-service/package.json pdf-service/scripts/run-tests.mjs pdf-service/test/test-runner.test.mjs
git commit -m "test: run PDF browser tests serially"
```

### Task 3: Mirror the tested runner into v2.2T

**Files:**
- Create: `pm-dashboard-uat/pdf-service/scripts/browser-test-lock.mjs`
- Create: `pm-dashboard-uat/pdf-service/scripts/run-tests.mjs`
- Create: `pm-dashboard-uat/pdf-service/test/browser-test-lock.test.mjs`
- Create: `pm-dashboard-uat/pdf-service/test/test-runner.test.mjs`
- Modify: `pm-dashboard-uat/pdf-service/package.json`

**Interfaces:** Identical to Tasks 1 and 2. The lock filename must remain identical so separate repositories coordinate.

- [ ] **Step 1: Add the same failing lock and runner tests to UAT**

Run before implementation: `node --test test/browser-test-lock.test.mjs test/test-runner.test.mjs`

Expected: FAIL because the UAT helper and runner do not exist.

- [ ] **Step 2: Copy the reviewed production implementation into UAT**

Use the same source and test files without role-, page-, or report-specific differences. Change the UAT package test script to `node scripts/run-tests.mjs`.

- [ ] **Step 3: Verify UAT focused and complete tests**

Run: `node --test test/browser-test-lock.test.mjs test/test-runner.test.mjs`

Expected: all focused tests PASS.

Run outside the restricted sandbox: `npm test`

Expected: every v2.2T PDF test PASS.

- [ ] **Step 4: Compare the mirrored files**

Run `cmp` for both scripts, both new test files, and the package test-script value. Expected: no unintended differences.

- [ ] **Step 5: Commit Task 3**

```bash
git add pdf-service/package.json pdf-service/scripts/browser-test-lock.mjs pdf-service/scripts/run-tests.mjs pdf-service/test/browser-test-lock.test.mjs pdf-service/test/test-runner.test.mjs
git commit -m "test: serialize UAT PDF browser tests"
```

### Task 4: Prove cross-repository serialization and absence of recurrence

**Files:**
- Verify only; no runtime files.

**Interfaces:** Consumes the shared lock and package commands from Tasks 1–3.

- [ ] **Step 1: Record the pre-fix crash baseline**

List `~/Library/Logs/DiagnosticReports/Google Chrome for Testing-*.ips`, capture the newest modification time and filename, and do not delete any reports.

- [ ] **Step 2: Start both package commands concurrently**

Start `npm test` in both `pdf-service` directories at the same time. Expected behavior: one runner acquires the shared lock while the other waits; both eventually complete with exit code `0` and no simultaneous Chrome launch.

- [ ] **Step 3: Verify no new crash report**

List the diagnostic reports again. Expected: the newest Chrome for Testing report is still the pre-fix baseline; no new `.ips` file exists.

- [ ] **Step 4: Run non-browser dashboard regressions**

Run `node --test tests/*.test.mjs` in both repositories. Expected: all dashboard tests PASS.

- [ ] **Step 5: Verify repository state and publish**

Run `git diff --check`, `git status --short --branch`, and compare `HEAD` with the intended local commits. Push both `main` branches only after all tests and crash-log checks pass. No GitHub Pages or Cloud Run deployment is triggered by runtime changes because only docs and PDF test tooling changed.

