# v2.2T Pending Executive Milestone Lock Design

## Goal

Prevent duplicate or conflicting structural changes to an Executive Milestone while one of its change requests is awaiting Executive Owner approval.

## Scope

The lock applies to a milestone that has a pending Executive change request for any structural action: move, rename, or delete. It applies to every role that could otherwise initiate the action.

When the user tries to start one of those actions for a locked milestone, the dashboard keeps the timeline unchanged and opens a modal message:

> This Executive Milestone is waiting for approval. You can move, rename, or delete it after the request is approved, rejected, or withdrawn.

The existing change-request inbox remains the place to withdraw the request.

## Design

The live change-request listener derives a set of milestone IDs with `state === 'pending'`. The renderer uses that set to mark affected milestone controls as locked. Drag handles are not draggable for locked items, while rename and delete remain available only long enough to open the explanatory modal; this preserves a clear reason instead of silently hiding controls.

Every structural-action entry point performs the same authoritative client-side check before opening the existing request dialog. This covers drag-and-drop moves, the milestone drawer's rename action, and its delete action. The submission path repeats the check so a stale rendered state cannot submit a second request.

The existing server-side request creation remains unchanged for this scoped UI improvement. The Firestore listener and repeated client-side guard ensure that the live dashboard reflects approval, rejection, and withdrawal without a page refresh.

## Error Handling

The lock message is a standard accessible dialog with a single dismissal control. It does not alter the pending request or the milestone. If a request transitions out of pending, the item unlocks automatically on the next listener update.

## Tests

Add focused UI-source regression coverage proving that both dashboard entrypoints:

- derive pending milestone locks from change requests;
- block move, rename, and delete actions with the waiting-for-approval modal;
- prevent a locked milestone's drag handle from initiating a drag;
- re-check the lock immediately before request submission; and
- retain the existing withdrawal flow, which removes the lock when the listener reports no pending request.

## Non-goals

This change does not alter approval permissions, request payloads, Firestore Security Rules, server Functions, or the existing approve/reject/withdraw behavior.
