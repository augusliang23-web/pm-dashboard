# PM Dashboard

DCDC portfolio and weekly status dashboard. The `v2.2T` branch is the test candidate for Executive milestone governance.

## v2.2T role rollout

Supported roles are `admin`, `executive` (shown as Executive Owner), `pm`, `engineering`, `sales`, `bd`, and `product`. Unknown roles fail closed.

Before preview UAT, use Firebase Console to update the department-head user document from `role: 'vip'` to `role: 'executive'`. Confirm there are no `business` role documents; assign `sales` or `bd` explicitly where required. This repository does not automate user-role writes.

- Admin and Executive Owner can view and update all three Executive milestone sections and make audited structural changes directly.
- PM and Engineering can view and update only IoE Product Portfolio.
- Sales, BD, and Product can view all sections and update only Customer Engagements.
- Non-leadership structural edits are submitted to the in-dashboard Executive Owner approval inbox.

Phase 1 does not configure or send approval email. The single Executive approval mailbox remains deferred.

## Security and deployment handoff

Client authorization checks are defense-in-depth. Before UAT, review the
included Functions, Firestore Security Rules, and indexes, then run the local
verification suite. Any Firebase/Google Cloud deployment or live-data action
requires a separate, explicit authorization gate; this repository's runbook
does not provide copy-paste cloud or IAM mutation commands. See
`functions/README.md` for the non-executing sync checklist.

### Production-to-UAT week sync boundary

The only callable entry points are `syncProductionWeeksToUat`,
`getProductionWeekSyncStatus`, and `restoreUatWeeksSnapshot`. They use the
dedicated service account
`uat-production-sync@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com`:
`roles/datastore.viewer` in the fixed Production project and
`roles/datastore.user` in UAT. Production is read-only and exposes only the
`weeks` collection; the browser cannot select a project, collection, or write
destination.

`config/production-week-sync-boundary.json` is the machine-readable local
source of truth for that sync boundary. Its verifier checks repository files;
it does not grant IAM or prove deployed IAM. Cloud authorization remains a
separate explicit gate.

Before applying a mirror, the service creates and verifies a snapshot. Five
complete snapshots are retained. Apply or verification failures trigger
automatic restore and verification; an unverified rollback is surfaced as
`rollback_failed` and requires a separately authorized restore review. Restore
never reads Production and snapshots current UAT weeks first.

The operational records (`uatProductionWeekSync` and
`uatProductionWeekSyncRuns`, including snapshot subcollections) are explicitly
denied to every browser role by Rules. The sync preserves users, permissions,
settings, Executive workflow, usage records, and the legacy namespaces
`team2.portfolioScope`, `team2.overviewScope.*`, and
`dashboardSettings/team-2-portfolio`.

Service-account creation, IAM grants, Functions/Rules/index deployment, TTL
configuration, live status probing, and the first live sync or restore are
separate cloud authorization gates and are intentionally not performed by
local verification.

Deployment blockers: the current `weeks` schema embeds all three Executive sections in one document. Firestore Security Rules cannot redact individual fields from a readable document, so the role-based section visibility is enforced by the dashboard UI but is not yet a confidentiality boundary against direct API reads. The schema also has no authoritative active-week marker; callables reject released weeks, but cannot distinguish the current draft from an older unreleased draft. Do not expose v2.2T to restricted-role users until the Executive sections are migrated to separately protected documents (or an equivalent server-filtered read model) and mutations validate a protected active-week setting.

## Mac local verification

Local development runs on macOS with the Firebase Emulator Suite. Windows users only consume the deployed web dashboard and do not need this local setup.

```bash
npm ci --prefix functions
npm run local:start
```

Open `http://127.0.0.1:4173/?emulator=1` and sign in with the test account printed by the starter. The local page uses Auth, Firestore, and Functions emulators together; a localhost page without `?emulator=1` does not connect to any emulator. Stop the stack with `npm run local:stop`.

Before requesting any deployment authorization, run:

```bash
npm run verify:local
```

The local verification command does not deploy or push. Any release
publication requires a separately approved release workflow. v2.1 remains a
separate repository and is only changed when an explicit v2.1 sync is
requested.

The local emulator starter seeds only the demo project `demo-pm-dashboard-v22t`
and does not restore a Production snapshot. `scripts/sync-v2.2t-local-data.mjs`
is a separate, explicit Production-only snapshot import utility; it is not part
of `npm run local:start`, `npm run local:seed`, `npm run test:local`, or UAT
verification. The PDF service deploy script is likewise Production-only and is
not a UAT deployment command.

The root dashboard intentionally retains the legacy persistence namespaces
`team2.portfolioScope`, `team2.overviewScope.*`, and
`dashboardSettings/team-2-portfolio`. They are data-compatibility identifiers,
not deployment entry points or source-path dependencies. Renaming them requires
a separately reviewed data migration so existing UAT preferences and Gantt
settings do not disappear.
