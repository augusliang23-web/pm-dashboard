# PR76 R6 Assignment Error Implementation Plan

> Execute inline with superpowers:executing-plans; one bounded source/security review at the end.

**Goal:** Preserve the editor and unsaved input only for structured backend assignment-forbidden rejections.
**Architecture:** Share one frontend access-loss classifier between the existing controller and editor callback. Carry structured errorReason in controller state; keep generic/auth/access-loss cleanup fail-closed. No backend or capability protocol changes.
**Tech Stack:** Existing native HTML/JS, node:test, real old Functions artifacts and local Auth/Firestore/Functions emulators, Chromium.
**Spec:** Owner task PR76_R6_ROLLBACK_UI_HOTFIX, base ce01cb0a4dac7d5de7b8b1a472b50ee9ac5a18ab.

## Global constraints

Independent branch targeting PR76; preserve PR76/77 refs; no delegation changes, backend changes, merge, deploy, cloud modifications or live writes. Production/UAT browser profiles only use synthetic local emulators.

## Review focus

- unauthenticated must clear even if details contain assignment-forbidden.
- missing/malformed details on permission-denied must clear.
- role/draft/ownership revocation must clear selected data and editor.
- assignment error must preserve every typed field and selection, show inline error and no success toast.
- PR77 overlap must not import lane concurrency/delegation logic.

## One bounded task

- [x] Add controller/editor behavioral regression tests; observe RED.
- [x] Reproduce original R6 with authentic old backend and base Hosting; preserve RED evidence.
- [x] Add shared classifier + errorReason; wire existing editor callback; preserve exact historical-source guards using narrowly reviewed deltas, never replace frozen hashes.
- [x] Run affected controller/editor/API/source guard tests and both Hosting builds.
- [x] Re-run R1–R7 on actual old artifacts; verify Production/UAT R6 input retention and real auth/role/access loss cleanup.
- [x] Review diff for security and PR77 overlap; record exact candidate/evidence and permitted/forbidden rollback combinations.
- [ ] Commit, push only the new branch, create one Draft PR targeting codex/hotfix-admin-pm-self-assignment, attach it and collect exact-SHA CI.

## Design / rulings

Owner supplied the complete error contract; no new product choice is inferred. Use one classifier instead of repeating PR77's broader reason exception, so unauthenticated always wins. Existing linked worktree was clean at the exact base; create a new branch there without modifying the original PR refs. Run only affected local tests and both Hosting builds; repository CI may execute its existing complete jobs once.
