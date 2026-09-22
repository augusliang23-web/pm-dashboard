# Role Visibility and PM Membership Design

## Goal

Make Draft visibility, project editing, and the **All PMs** filter follow one durable role policy in v2.2T.

## Data model

`users/{uid}` continues to store the account's authorization role in `role`.
Add `isProjectManager` as a separate boolean that represents PM membership. It is not an authorization role.

- A `pm` account is a PM member.
- An `admin` account is a PM member only when `isProjectManager` is `true`.
- `sales`, `bd`, `engineering`, `product`, and `executive` accounts are never PM members.
- Existing Admin accounts have no implied PM membership. The administrator who is also a PM must be explicitly stored with `isProjectManager: true`.

When an account role is changed to a non-PM-capable role, its PM membership is cleared in the same user update. Account deletion removes it from the live list automatically.

## Visibility policy

| Content | Admin | PM | Sales / BD / Engineering / Product / Executive |
| --- | --- | --- | --- |
| Released reporting weeks and their pages | View | View | View |
| Draft reporting weeks and their pages | View | View | No access |
| Project cards, Overview, Single Project, and other released views | View | View | View |

The UI must subscribe non-Admin/non-PM accounts only to weeks where `isReleased == true`. Firestore Rules must enforce the same constraint so a browser query cannot retrieve Draft data outside the UI.

## Editing policy

- Admin can edit every project in any visible Draft week and keeps account-management powers. Admin and PM may release a Draft week or revert a Released week to Draft.
- PM can edit only Draft projects where they are the owner or deputy.
- Sales, BD, Engineering, Product, Executive, and every unknown role are read-only for project content.
- Released weeks remain immutable for every role.

Existing Executive milestone permissions are unchanged by this policy.

## All PMs filter

The dropdown is a live projection of valid PM members only:

- include `role == 'pm'`;
- include `role == 'admin' && isProjectManager == true`;
- exclude every other role, including former PM accounts changed to BD;
- refresh after any `users` collection add, change, or removal.

The selected filter falls back to **All PMs** when its selected user is no longer a valid PM member.

## Error handling

- If a user-document update rejects an invalid `isProjectManager`/role combination, the account-management UI shows the returned error and keeps the existing form state.
- If the PM-membership listener fails, the dropdown keeps its current verified entries rather than inserting a hard-coded fallback list.
- Non-PM roles receiving no Draft weeks see the standard no-data state rather than a Draft release control.

## Verification

Automated coverage must prove:

1. Admin and PM query all weeks; each other role queries only released weeks.
2. Admin retains full project editing; a PM may edit only an owned or deputized Draft project; BD cannot edit.
3. PM membership includes PM users and explicitly PM-enabled Admin users only.
4. A role change or deletion removes a formerly eligible user from the active dropdown and resets an invalid selected filter.
5. Firestore rules contain the matching Draft-read and role-transition protection.
