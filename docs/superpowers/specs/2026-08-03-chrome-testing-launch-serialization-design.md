# Chrome for Testing Launch Serialization Design

## Problem

The PDF test suite can launch several macOS Chrome for Testing application processes at the same time. The standard command currently uses Node's default test-file concurrency, and running the production and UAT suites together multiplies the launch count.

The macOS crash reports captured at 10:39:47, 10:39:49, 10:39:50, and 10:40:08 on 2026-08-03 identify `node` as the parent process and ChatGPT/Codex as the responsible process. Each process aborted with `SIGABRT` while macOS was executing `RegisterApplication` and `TransformProcessType`. This is a test-runner launch race, not a dashboard, user Chrome, or deployed PDF-service failure.

## Scope

This change affects only the local and CI PDF test runner in both repositories:

- `augusliang23-web/pm-dashboard`
- `augusliang23-web/pm-dashboard-uat`

It does not change dashboard UI behavior, report data, PDF output, Cloud Run request handling, or production browser lifecycle. No Pages or Cloud Run redeployment is required; the repository fixes will be pushed so future standard test runs use the safe runner.

## Design

### Shared cross-process lock

Add a test-only lock helper under `pdf-service/scripts/`. It uses an atomic lock file in the operating system temporary directory. The lock path is intentionally identical in both repositories, so two `npm test` processes started from separate worktrees or repositories cannot launch Chrome for Testing concurrently.

The lock record contains a unique ownership token, process ID, and acquisition time. A waiting runner polls at a short interval. If the recorded owner process no longer exists, the waiter removes the stale record and retries. A live owner is never displaced. Acquisition has a bounded timeout and returns an actionable error instead of waiting forever.

Release removes the lock only when the stored token still belongs to the releasing process. Normal completion, test failure, and handled termination all release the lock. An unhandled process crash is recovered by the next runner through the stale-owner check.

### Serialized Node test runner

Add `pdf-service/scripts/run-tests.mjs` and make `npm test` execute it. The runner:

1. Acquires the shared browser-test lock.
2. Discovers the repository's `test/*.test.mjs` files in stable sorted order.
3. Starts the current Node executable with `--test --test-concurrency=1`.
4. Forwards test output and the child exit code.
5. Releases the lock in a `finally` path.

Serializing test files prevents `measured-paginator.test.mjs` and `pdf-layout.test.mjs` from launching independent Chrome processes together. The cross-process lock additionally prevents production and UAT suites from overlapping.

The supported browser-test entry point becomes `npm test` from `pdf-service`. Focused non-browser unit tests may still use `node --test`, but browser-layout tests must use the package command so the shared lock remains effective.

## Error handling

- A stale lock left by a dead process is recovered automatically.
- A malformed lock record is treated as stale only after it can no longer represent a live owner.
- A live lock that exceeds the bounded wait returns an error naming the lock owner and path.
- A child test failure is preserved as the runner's nonzero exit status.
- The helper never deletes directories or broad paths; it only removes the exact temporary lock file it owns or has proven stale.

## Test strategy

Implementation follows red-green-refactor:

1. Add a lock integration test that starts two independent Node processes against a unique temporary lock path and asserts their critical sections never overlap.
2. Add a stale-owner test that proves a dead owner's lock can be reclaimed.
3. Add runner tests that assert the generated Node arguments include `--test-concurrency=1`, test files are sorted, and child failures propagate.
4. Run the new tests before implementation and confirm they fail because the helper and runner do not exist.
5. Implement the minimum lock and runner behavior, then make the focused tests pass.
6. Run each full PDF suite through `npm test` and then intentionally start the production and UAT package commands together. They must complete serially without overlapping the browser-test lock.
7. Record the newest pre-fix Chrome for Testing crash-report timestamp, run the verification, and confirm no newer report is created.

## Success criteria

- Standard PDF test commands cannot launch Chrome for Testing concurrently across test files, repositories, or worktrees.
- Both complete PDF suites pass without a new Chrome for Testing macOS crash report.
- A killed test runner does not permanently block later test runs.
- Existing dashboard and PDF behavior remains unchanged.

This prevents recurrence of the confirmed concurrent-launch failure. It cannot guarantee that Chrome will never crash for an unrelated browser or operating-system defect; any future crash with a different stack must be diagnosed separately.
