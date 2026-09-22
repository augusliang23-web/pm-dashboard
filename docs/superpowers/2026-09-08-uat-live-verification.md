# UAT live verification — 2026-09-08

## Scope and conclusion

ACCEPT WITH CONDITIONS for the tested Phase 1 UAT project-save boundary.
This is not acceptance of every dashboard feature or of Production.

- Repository: `augusliang23-web/pm-dashboard-uat`.
- Merged PR #1 / remote main: `23012c53c4a61f4f8051a721900bcd440b32cf8b`.
- UAT Firebase project: `pm-dashboard-uat-20260820-a7f3`.
- Emulator project: `demo-pm-dashboard-v22t`.
- Follow-up branch: `codex/uat-emulator-binding-followup`.
- Production was not modified in this verification run.

## Fresh evidence

| Check | Result | What it proves |
| --- | --- | --- |
| Public UAT `/team-2/` | HTTP 404 | Retired public entrypoint is unavailable at the time checked |
| UAT Functions inventory | 15 ACTIVE | Deployment state, not functional acceptance of all 15 functions |
| Live authenticated Firebase SDK cases | 36 PASS, 0 FAIL | Role/read/write/revision/released-week behavior below |
| Anonymous Callable probes | All 14 reject with 401 UNAUTHENTICATED when pre-auth parameter checks are satisfied | Application authentication boundary is reachable and enforced for those probes |
| `npm run test:all` on follow-up working tree | 502 PASS, 0 FAIL; exit 0 | Local suite including four new Firebase initialization tests |
| `npm run test:rules` using Homebrew OpenJDK 21 | 6 PASS, 0 FAIL; exit 0 | Rules behavior against the fixed demo project |
| `git diff --check` | PASS | Working diff whitespace validation |

The live SDK cases use five synthetic accounts (admin, owner, deputy, other
PM, VIP), plus a marked draft and released week. The test marker is
`uat-e2e-20260906-astra`. They use `example.com` identities, not real users.
Credentials are not included in this report. Test accounts and data remain
in isolated UAT; they were not deleted as cleanup.

Verified for all five roles: released-week read succeeds, direct browser SDK
week creation/update/deletion fails. Draft reads succeed for admin and PMs,
and fail for VIP. Callable saves succeed for admin/owner/deputy, with returned
progress independently checked against stored Firestore data; saves fail for
other PM and VIP. Stale revisions and released-week saves fail for each of
the three authorized editing roles.

The initial anonymous probe used empty data. Five Executive callables returned
400 INVALID_ARGUMENT before authentication because required input was absent.
After inspection of validation order, supplying the required parameter shapes
produced 401 UNAUTHENTICATED for all five. No source change was made for this
test-harness expectation mismatch. These probes do not authorize or exercise
Executive timeline mutations.

The earlier `saveDashboardProject` INTERNAL result did not reproduce in the
fresh live run. The queried error entries were dated September 6, before this
September 8 verification; do not present those old entries as new failures.
No project-save source fix was necessary in this run.

## Follow-up source change

Explicit localhost Emulator mode now initializes Firebase with the demo
project ID instead of retaining the live UAT project ID. Normal UAT startup
still uses the UAT binding. Four behavior tests execute the actual HTML
initialization fragment for localhost, loopback, and hosted-page cases.
The obsolete assertion requiring unconditional live-project initialization
was removed; this is not removal of the emulator-connection assertions.

This follow-up changes `index.html` separately from the accepted retirement
commit. It does not rename `team2.*` compatibility keys or Gantt settings.
It is not yet evidence that the follow-up has reached public Pages.

## Evidence preservation

Rules testing ran from `/private/tmp/pm-uat-rules-check.GtWpzV`, using copied
configuration, Rules, HTML, and test files and the existing dependency runtime.
It used port 8081; emulator hub/logging selected 4401/4501 because their default
ports were occupied. Existing processes were not stopped.

The original worktree's untracked `firestore-debug.log` SHA-256 was identical
before and after testing:

`5ecf2a0315012f4eb756965fda02fe8da20463e223efaa2f404a59867dc42346`

Local author and committer still resolve to
`Augus Liang <augusliang@AugusdeMacBook-Air.local>`.
No identity configuration or existing commit was amended.

## Remaining gates

- Authenticated browser UI acceptance: actual PM editor open/edit/save/reload,
  role-visible controls, and Gantt preference preservation. SDK success alone
  does not prove these user-visible interactions.
- The follow-up branch still needs its integration authorization and public
  Pages verification against the resulting commit.
- Artifact Registry retention-policy decision is pending. No automatic image
  deletion policy was introduced by this verification run.
- Broader live acceptance of Executive timeline operations and scheduled
  aggregation is not covered by the project-save probe.
- Existing parked design risks (dynamic presence bucket validation and a
  separate shared-backend Rules emulator target) are not closed by these tests.
- Production remediation/deployment remains outside the authorized boundary.

The older August handoff is historical. Its statement that no UAT deployment
had occurred describes that earlier run, not this September verification.
