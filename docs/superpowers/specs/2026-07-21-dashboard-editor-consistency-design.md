# Dashboard Editor Consistency Design

## Goal

Make every Dashboard editing surface follow one predictable interaction model while completing the Executive milestone approval workflow.

## Confirmed Rules

- Executive is the only role that can approve or reject Executive milestone change requests.
- Admin can view pending requests and their audit details but cannot approve or reject them.
- An approval comment is optional.
- A rejection comment is mandatory.
- The decision comment is saved with the request and its audit record.
- The rules apply to editing dialogs throughout the main Dashboard only.
- v2.1 remains the sole production version and v2.2T remains the sole test version.
- The legacy `team-2` page is outside this work and will not be modified or tested.

## Executive Approval Experience

Each pending request card shows its action, milestone, human-readable before/after location or title, requester, reason, and current state. Executive users additionally see one comment field and Approve and Reject buttons. Admin users see the same request details without the comment or decision controls.

Approve sends the trimmed comment when present. Reject is blocked until a non-empty comment is entered, with validation beside that request. Existing `decisionNote` data remains the storage contract so the comment is written to the request and audit trail without introducing a parallel field.

## Async Feedback

Submit, Withdraw, Approve, and Reject use the same lightweight busy state:

- the initiating button shows a small spinner and action-specific text;
- related controls are disabled to prevent duplicate operations;
- the dialog stays visible while the backend operation is pending;
- success and failure are announced in the dialog and through the existing toast;
- controls are restored after failure;
- realtime updates remove completed or withdrawn pending cards after confirmation from the backend.

No artificial delay is added. The animation lasts exactly as long as the backend request.

## Centered Executive Milestone Editor

The Executive milestone item editor changes from a right-side drawer to the standard centered modal layout. It retains the same RAG controls, monthly update field, structural actions, validation, and update history. On small screens it uses the existing responsive modal width and height rules rather than reverting to a side drawer.

## Unified Close Guard

A single close controller owns closing behavior for Dashboard editing dialogs. It handles backdrop clicks, close buttons, Cancel buttons, and Escape consistently.

When an editor opens, the controller captures a normalized snapshot of editable form controls inside that overlay. Before closing, it compares the current normalized snapshot with the initial snapshot. Programmatic closes after a successful save bypass the warning because the save operation has completed.

If no editable value changed, the dialog closes immediately. If values changed, a small centered confirmation dialog asks whether to discard unsaved changes:

- `Keep editing` returns to the editor without losing values.
- `Discard changes` closes the editor and clears its session.

Read-only dialogs, notifications, PDF previews, login dialogs, and transient status overlays are excluded because they do not contain unsaved editing state. Existing mutation-in-flight protections remain authoritative and prevent closing during an active save.

Nested dialogs retain their parent dialog state. Closing a child confirmation or structural-change dialog returns focus to its parent without clearing the parent's snapshot.

## Implementation Boundary

The close controller is added only to the main `index.html` using the existing modal infrastructure. Existing editor-specific cleanup remains in `closeModal`; the new guard runs before cleanup and delegates to the existing close path only after closing is allowed.

Editor identification is explicit through an editing-overlay attribute rather than inferred from visual class names. This prevents notifications and read-only dialogs from receiving unnecessary warnings and gives future editors a clear opt-in convention.

## Error Handling and Accessibility

- Busy buttons use `aria-busy="true"` and retain readable text.
- Inline results use the existing live regions.
- The discard confirmation traps focus and restores it to the originating editor.
- Backdrop closing responds only to a primary-button click on the overlay itself.
- Rejection validation focuses the comment field.
- Backend errors preserve all entered values and comments.

## Verification

Automated tests cover the main v2.2T Dashboard and verify:

- Admin never receives approval controls while Executive does.
- approval comments are optional and rejection comments are required;
- the exact comment is sent as `decisionNote`;
- Submit, Withdraw, Approve, and Reject expose and clear busy state;
- the Executive milestone editor uses a centered modal;
- every opted-in editor routes backdrop, close-button, Cancel, and Escape actions through the unified close guard;
- unchanged editors close directly, dirty editors require confirmation, successful saves bypass the warning, and failed saves preserve input;
- read-only and notification dialogs close without a discard prompt.

Local browser verification covers one requester and one Executive session without deploying the frontend.
