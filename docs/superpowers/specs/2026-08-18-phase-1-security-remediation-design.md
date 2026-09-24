# Phase 1 Security Remediation Design

## Status

Approved for UAT-only implementation.  Production deployment and `team-2/`
are explicitly outside this change.

## Goal

Close the Phase 1 paths that let an authenticated but unauthorized browser
write dashboard data or inject unescaped week metadata, while preserving the
existing PM experience: an Admin, project owner, or deputy can still save an
editable draft through the protected callable; VIP remains read-only; released
weeks remain read-only.

## Authorization boundary

The UAT `weeks` document stores all projects in one array.  Firestore Rules
cannot reliably compare an arbitrary array edit to prove that only the
caller's owned/deputized project changed.  The chosen UAT boundary is therefore
deliberately conservative:

- Direct browser SDK writes to `weeks/{weekId}` are denied for every client.
- `saveDashboardProject` is the only project mutation path.  It verifies the
  Firebase token and applies the existing normalized Admin/owner/deputy logic
  on the server.
- Read rules continue to show drafts only to Admin/PM and released weeks to
  every signed-in role.

This preserves the visible editor policy without treating the hidden edit
button as a security boundary.

## Firestore document rules

### Logs

Any signed-in user may append one audit record, but cannot read/write arbitrary
data through the collection.  Creates require exactly the accepted audit
envelope: actor UID/email must match the authenticated principal; server time
must be used; event, week, project and message strings have bounded sizes; and
context is a map.  Client update and delete are denied.

### Presence

Presence writes are scoped to the authenticated email document.  A new record
must contain the bounded top-level dashboard presence schema and the matching
immutable `ownerUid`/`userKey`.  Existing legacy records may establish these
two identity fields once, but once present they cannot change.  Other users
cannot write the document and clients cannot delete it.

`usageBuckets` has date-based dynamic keys.  Phase 1 limits it to 256 entries
and Firestore's document-size limit, but Rules cannot validate every unknown
map member's type or nested shape.  Per-bucket schema validation requires a
subcollection or a fixed key schema plus an explicit data migration, and is
recorded as a later architectural task rather than silently changing presence
storage in this security patch.

## UI escaping

Week selector option labels render `weekLabel` and `weekDate` using `escHtml`.
The Phase 1 audit adds a focused regression test for that selector and a
static guard against new raw data interpolation in `innerHTML` templates.

## Verification

The Firestore Emulator tests prove direct writes fail for Admin, PM owner and
VIP clients; callable tests prove the protected PM path remains authorized.
The Rules test uses an isolated port when a developer's normal Emulator is
already running, and never stops that process.

## Non-goals

- No Firebase project/auth-provider change.
- No Production deployment or live Firestore write.
- No `team-2/` change; the user has retired that UAT surface.
- No data-schema migration or `weeks/{weekId}/projects` subcollection in
  Phase 1.
