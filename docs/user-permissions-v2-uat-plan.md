# User Permissions v2 — UAT deployment and validation plan

Scope: the ON/OFF switch redesign plus the delegable capabilities `week.release`, `gantt.manage` and
`project.manage` (on top of `week.manage`), under the least-privilege V1 contract below. **This document performs nothing.** UAT deployment is a separate,
separately authorized step; nothing here touches Production.

## Capability contract

| Capability | Switch label | Role default ON | Grantable (ON) to | What it controls | Server enforcement |
|---|---|---|---|---|---|
| `week.manage` | Manage Weeks | Admin | all non-Admin roles | Week Management modal, Weekly Summary, Create Next Week, draft reads for that workflow | `createDashboardWeek`, `saveDashboardWeekFields` (summary only) |
| `week.release` | Release Week | Admin, PM | PM only (switch OFF, then ON again to return to the default) | Release to audience / Revert to Draft | `setDashboardWeekRelease` |
| `gantt.manage` | Manage Gantt | Admin | all non-Admin roles | Default Gantt templates and the PDF Gantt display window | `saveDashboardGanttTemplateSettings`, `saveDashboardGanttWindowSettings` |
| `project.manage` | Add / Delete Projects | Admin | PM only | Create new projects and delete existing projects (editing project content is not included) | `saveDashboardProject` (`isNew` only), `deleteDashboardProject` |

- Admin is locked ON for all four; the callable rejects any change to an Admin target (`admin-capability-locked`).
- `week.release` and `project.manage` are PM-only in V1. Every other role (Engineering, Business, Sales, BD, Product,
  VIP, Executive) shows "Not available for this role", and the server rejects a stale or forged `true` override for
  them (`role-not-grantable` on write; ignored at resolution). This is deliberate: those workflows act on draft weeks,
  and Firestore rules cannot hide `strategyLayer` inside a week document, so no draft-read rule was widened.
  UAT/shared rules therefore have no `week.release`/`project.manage` condition.
- The capabilities are independent: `project.manage` implies neither `week.manage`, `week.release` nor draft reads.
- Out of every capability: editing an existing project (owner/deputy, or Admin), an Admin editing any project, the
  project visibility (Active / Hidden / Archived: Admin-only in the editor **and enforced by the server** — a non-Admin
  may save a project only with its current visibility, new projects start Active, otherwise
  `permission-denied` / `visibility-admin-only`), Gantt viewing and per-project schedules, the strategy layer,
  Production→UAT sync/restore, Executive governance and `permissions.manage` (never delegable).
- A PM holding `project.manage` who may not edit a project (not owner/deputy, not Admin) gets a delete-only editor
  (Save hidden; the server still refuses edits by non-owners). Released weeks stay locked for create and delete.

## UAT deployment scope (when authorized)

Behavior changed in exactly these six callables; every other Function is unchanged:

```text
functions:setUserPermissionOverrides,functions:saveDashboardProject,functions:deleteDashboardProject,functions:saveDashboardGanttTemplateSettings,functions:saveDashboardGanttWindowSettings,functions:setDashboardWeekRelease
```

1. **IAM prerequisite (not yet done):** live UAT `setDashboardWeekRelease` still runs the 2026-09-06 deployment as the
   default compute account, and `pmdash-week-release@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com` does not
   exist. Create it with only `roles/datastore.user` and no keys before deploying that Function. The other five
   callables in this list already have their `pmdash-*` identities.
2. Functions from the pinned SHA with the scoped selector above (never `--only functions`); runtime `nodejs22`;
   verify ACTIVE/GEN_2/us-central1, runtime SA per Function, unchanged invoker (`setUserPermissionOverrides` keeps
   its disabled invoker check; the others keep `allUsers`), unauthenticated probes return 401, non-selected
   Functions unchanged.
3. **No Firestore rules deployment is required for this UAT step.** PR #39 does not itself change any rules file: the
   UAT/shared rules files and the Production `firestore.rules` are the same as on `main`.
   **This is a statement about the source diff, not about live Production.** Live Production (Hosting Release #3, ruleset
   `7ed64612-dc1c-4856-baf1-f627972046b6`) predates the `userPermissions` / `userPermissionAudit` rules and the
   normalized Admin-role check that are already on `main`. The eventual Production promotion therefore **does** require
   deploying the current Production `firestore.rules` (its own stage, with the prior ruleset recorded as the rollback
   reference); it is not a no-op. Nothing in this document deploys rules.
4. UAT Hosting through `npm run deploy:hosting:uat:dry` then `npm run deploy:hosting:uat`.

## Validation checklist

Admin (UI): the User Permissions button is visible; the list loads with role shown; four switches appear (Manage
Weeks, Release Week, Manage Gantt, Add / Delete Projects); no "Role default / Custom / Reset / Save / revision" wording.
PM and other users: no User Permissions button, and a direct open does nothing.

Per capability, with a temporary UAT-only target user (cleanup afterwards, audit retained):

- switch ON → saves automatically, state shows ON, history shows "Off → On"; the backend call succeeds immediately (the user's own controls appear on their next
  dashboard load);
- switch OFF → saves, history shows "On → Off"; the backend call is denied immediately, even before the user reloads;
- `week.release`: a PM starts ON; Admin switches it OFF (denied), then ON again (the stored key is removed);
- failure → the switch returns to its previous value with a plain message; a concurrent edit → latest settings are
  reloaded with a message and nothing is overwritten;
- Admin rows show ON 🔒 and cannot be toggled; every non-PM role shows Release Week and Add / Delete Projects as
  unavailable.
- `project.manage` (PM): create and delete a project on a draft week succeed; both are refused on a released week;
  editing another owner's project is still refused.

Negative checks (must stay denied): `permissions.manage`, Production→UAT sync/restore, strategy-layer writes,
editing other users' projects, setting a project to Hidden/Archived as a non-Admin (even with `project.manage`),
Executive governance.

Evidence to retain: audit IDs, per-step results, before/after Function inventory, confirmation that Production
(Functions, IAM, rules, Hosting, data) and `production-pages` were not touched.

## Authenticated E2E contract (revised)

The E2E is split into three layers; only the first two are in scope for PR #39.

1. **Capability authorization (in scope).** For each capability, with a temporary UAT-only target user and the same
   session throughout: ON succeeds, OFF is refused immediately, ON again succeeds. Server enforcement reads the current
   Firestore permission state on every request, so a change applies immediately (no reload or re-login). The page says
   "Saved. The permission change applies immediately."
2. **Release business prerequisite (in scope as authorization evidence only).** `setDashboardWeekRelease` also needs the
   UAT Executive live timeline (`executiveMilestoneState/live`), which UAT does not have. That absence predates
   PR #39 and is independent of it; **it is not initialized for this work and no Executive global state is changed.**
   - PM with Release Week ON releasing an isolated temporary week may return `FAILED_PRECONDITION` (missing Executive
     milestone state). That is accepted as authorization evidence because it is the known business precondition and
     not `PERMISSION_DENIED`.
   - PM with Release Week OFF, in the same session, must return `PERMISSION_DENIED` before reaching that prerequisite.
   - After switching ON again, the same session must again reach the business layer (the same known precondition).
   A full successful Release-to-audience is therefore **not** claimed by this E2E.
3. **Executive global state (out of scope).** Initializing or changing the Executive timeline is a separate change.

Release Revert success and released-week project protection are proven on an isolated, uniquely prefixed temporary
released-week fixture, created only for that run (its own `isReleased = true`, never an existing business week) and
deleted afterwards:

- Revert to Draft succeeds for a PM with Release Week ON and is refused with it OFF;
- create project and delete project on that released week are refused for a PM holding `project.manage`.

The final targeted E2E proves: the Release permission gate ON/OFF/ON live, a successful Revert on the isolated released
fixture, and released-week create/delete protection on the same fixture. Audit records from earlier E2E runs are
retained; presence artifacts of temporary identities are removed by exact identity only.
