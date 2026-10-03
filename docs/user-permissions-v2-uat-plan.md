# User Permissions v2 — UAT deployment and validation plan

Scope: the ON/OFF switch redesign plus the delegable capabilities `week.release`, `gantt.manage` and
`project.manage` (on top of `week.manage`). **This document performs nothing.** UAT deployment is a separate,
separately authorized step; nothing here touches Production.

## Capability contract

| Capability | Switch label | Role default ON | Grantable (ON) to | What it controls | Server enforcement |
|---|---|---|---|---|---|
| `week.manage` | Manage Weeks | Admin | all non-Admin roles | Week Management modal, Weekly Summary, Create Next Week, draft reads for that workflow | `createDashboardWeek`, `saveDashboardWeekFields` (summary only) |
| `week.release` | Release Week | Admin, PM | PM, Engineering, Business, Sales, BD, Product | Release to audience / Revert to Draft | `setDashboardWeekRelease` |
| `gantt.manage` | Manage Gantt | Admin | all non-Admin roles | Default Gantt templates and the PDF Gantt display window | `saveDashboardGanttTemplateSettings`, `saveDashboardGanttWindowSettings` |
| `project.manage` | Manage Projects | Admin | PM, Engineering, Business, Sales, BD, Product | Add New Project and Delete Project | `saveDashboardProject` (`isNew` only), `deleteDashboardProject` |

- Admin is locked ON for all four; the callable rejects any change to an Admin target (`admin-capability-locked`).
- `week.release` and `project.manage` are not offered to VIP/Executive: their perspective has no release controls and
  sees released (locked) weeks only, so a switch there would do nothing. The switch shows "Not available for this role".
- Out of every capability: editing an existing project (owner/deputy, or Admin), an Admin editing any project, the
  project visibility selector (Admin-only UI), Gantt viewing and per-project schedules, the strategy layer,
  Production→UAT sync/restore, Executive governance and `permissions.manage` (never delegable).
- A `project.manage` holder who may not edit a project gets a delete-only editor (Save hidden, server still refuses
  edits by non-owners).

## UAT deployment scope (when authorized)

Behavior changed in exactly these six callables; the other five dashboard callables are unchanged:

```text
functions:setUserPermissionOverrides,functions:saveDashboardProject,functions:deleteDashboardProject,functions:saveDashboardGanttTemplateSettings,functions:saveDashboardGanttWindowSettings,functions:setDashboardWeekRelease
```

1. **IAM prerequisite (not yet done):** live UAT `setDashboardWeekRelease` still runs the 2026-09-06 deployment as the
   default compute account, and `pmdash-week-release@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com` does not
   exist. Create it with only `roles/datastore.user` and no keys before deploying that Function. The other five
   already have their `pmdash-*` identities.
2. Functions from the pinned SHA with the scoped selector above (never `--only functions`); runtime `nodejs22`;
   verify ACTIVE/GEN_2/us-central1, runtime SA per Function, unchanged invoker (`setUserPermissionOverrides` keeps
   its disabled invoker check; the others keep `allUsers`), unauthenticated probes return 401, non-selected
   Functions unchanged.
3. UAT rules only (`firebase.uat.json`, `firestore:rules`): adds `canReleaseWeeks()` so a `week.release` holder outside
   the PM default can read the draft weeks it releases. Production `firestore.rules` is unchanged by this work.
4. UAT Hosting through `npm run deploy:hosting:uat:dry` then `npm run deploy:hosting:uat`.

## Validation checklist

Admin (UI): the User Permissions button is visible; the list loads with role shown; four switches appear (Manage
Weeks, Release Week, Manage Gantt, Manage Projects); no "Role default / Custom / Reset / Save / revision" wording.
PM and other users: no User Permissions button, and a direct open does nothing.

Per capability, with a temporary UAT-only target user (cleanup afterwards, audit retained):

- switch ON → saves automatically, state shows ON, history shows "Off → On"; the user sees the control after
  reloading the dashboard; the backend call succeeds;
- switch OFF → saves, history shows "On → Off"; the backend call is denied immediately, even before the user reloads;
- `week.release`: a PM starts ON; Admin switches it OFF (denied), then ON again (the stored key is removed);
- failure → the switch returns to its previous value with a plain message; a concurrent edit → latest settings are
  reloaded with a message and nothing is overwritten;
- Admin rows show ON 🔒 and cannot be toggled; VIP/Executive show Release Week and Manage Projects as unavailable.

Negative checks (must stay denied): `permissions.manage`, Production→UAT sync/restore, strategy-layer writes,
editing other users' projects, Executive governance.

Evidence to retain: audit IDs, per-step results, before/after Function inventory, confirmation that Production
(Functions, IAM, rules, Hosting, data) and `production-pages` were not touched.
