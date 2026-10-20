# Overview provenance hotfix implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore valid Production Overview delivery metrics without weakening the canonical contract.

**Architecture:** Correct the Production snapshot producer's source enum from `prod` to `production`. Leave the engine, PDF service, permissions and stored records unchanged.

**Tech Stack:** Existing JavaScript modules, Node test runner, Firebase emulators and Chromium.

**Spec / Product Contract:** Owner's P1 Production Overview request, 2026-10-20. Authenticated users viewing W42 2026, Active / All PMs, must receive validated metrics and 6/12-week histories when input permits; missing/invalid observations remain unavailable. Existing role/publication boundaries and Overview-wide PM scope remain unchanged. No Production writes, IAM changes, PDF rebuild, merge or deployment is authorized by this hotfix task.

## Evidence and scope

Deployed Hosting release `1792420320290000`, version `9fca21fe1ea40390`, message `prod 4a3448c`; main SHA `4a3448c166f9e8a72689ba5a44fb7ec396485483`. Public index and engine/page modules byte-match source. Production initData supplies `prod`; engine accepts only `production`, `uat`, `synthetic`, returning `invalid-provenance` before inspecting weeks. PDF server supplies `production`. No business-data export is needed to prove this deterministic failure.

## Single bounded hotfix task

- [x] Execute the actual Production snapshot callback with synthetic Firestore-shaped W30–W43 records; establish a failing W42 regression test.
- [x] Correct only Production history provenance values, including empty/error paths.
- [x] Verify 6/12 windows, ordering, gaps, publication boundaries, strict rejection and PDF contract parity.
- [x] Run actual rendered Production/UAT profile browser checks using only isolated synthetic emulator data. Record separately from deployed UAT acceptance.
- [ ] Run required regression/CI checks, inspect focused diff, create hotfix PR without merge/deploy, and return evidence with unresolved gates.

**Release gate:** New hotfix remains unmerged and undeployed. Deployed UAT acceptance and explicit Owner Production authorization are required before release. Report HOLD if required evidence is missing.
