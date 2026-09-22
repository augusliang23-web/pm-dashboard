# Phase 1 Security Remediation Plan

> Execute in the isolated UAT worktree only.  Treat this document as the plan;
> the matching design is
> `docs/superpowers/specs/2026-08-18-phase-1-security-remediation-design.md`.

## Global constraints

- Scope is `pm-dashboard-uat` root only; exclude `team-2/` at the user's
  direction.
- Never deploy, push, alter Production, or write live Firebase data.
- Preserve the existing PM UI policy: Admin/owner/deputy save through the
  protected callable; direct Firestore client writes to weeks are denied.
- Released weeks stay read-only, VIP has no draft/project mutation path, and
  all change claims require automated evidence.

## Task 1: Establish an isolated UAT baseline

- Create an isolated `codex/phase1-security-remediation` UAT worktree.
- Record the existing test baseline and preserve unrelated dirty work.

## Task 2: Protect callable project mutations

- Make the server callable validate Admin/owner/deputy authorization using
  normalized identities before a project change is persisted.
- Add focused Functions tests for owner, deputy, Admin, non-owner, VIP and
  released-week paths.

## Task 3: Add live Firestore Rules coverage

- Install only the local Emulator test dependencies.
- Add Rules Emulator tests that establish the expected RED behavior before
  changing the remaining permissive Rules paths.
- Do not alter the developer's existing Emulator process when its ports are
  occupied.

## Task 4: Constrain audit-log and presence client writes

- In `firestore.rules`, keep direct `weeks` writes denied.
- Restrict `logs/{logId}` create to a bounded self-attributed append-only
  envelope; preserve signed-in read access and deny update/delete.
- Restrict `presence/{document}` to the signed-in email document, enforce
  immutable `ownerUid` and `userKey`, support one-time legacy identity
  establishment, deny delete, and bound the dynamic `usageBuckets` map to
  256 entries.  Do not perform an unapproved schema migration solely to type
  every dynamic bucket member.
- Use the existing Emulator tests as RED evidence, implement the smallest
  Rules change, then run the focused Rules suite to GREEN.

## Task 5: Escape week metadata and add a regression guard

- Escape `weekLabel` and `weekDate` in the week-selector `innerHTML` option
  template.
- Add behavior-focused regression coverage for a malicious label and a narrow
  static guard against newly introduced raw Firestore interpolation.
- Audit the affected root `index.html` paths only; do not change `team-2/`.

## Task 6: Re-run UAT authorization and UI regressions

- Repair the confirmed root-only Presence display path where Firestore-backed
  display names enter `innerHTML` without `escHtml`; add a focused regression
  test before the change.  Do not broaden into unrelated HTML rendering.
- Run focused callable, Rules, selector/XSS, and existing PM editor tests.
- Confirm owner/deputy/Admin can use the protected save path, and direct
  Firestore writes are rejected for every client role.

## Task 7: Reconcile scope against Production without modifying it

- Compare the UAT boundary with Production source and document any unported
  risk.  Do not copy, merge or deploy code automatically.

## Task 8: Prepare security and rollback notes

- Summarize changed authorization boundaries, residual risks, test evidence,
  and UAT rollback steps.

## Task 9: Prepare a UAT deployment candidate

- Run the full UAT verification gate and inspect the final diff.
- Do not push or publish; present the candidate for explicit deployment
  authorization.

## Task 10: Final review and handoff

- Perform a branch-level review, record any rulings, and provide the user an
  evidence-backed handoff with deployment options.
