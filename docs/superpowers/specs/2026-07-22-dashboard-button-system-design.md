# v2.2T Dashboard Button System

## Purpose

Make every actionable control in the v2.2T main dashboard use one coherent visual language. No action button should fall back to browser-default styling.

## Scope

- Change only the v2.2T main dashboard entry point, `index.html`.
- Cover visible action buttons in page content and dashboard dialogs, including the Executive milestone flows and unsaved-changes confirmation.
- Keep existing role rules, click handlers, keyboard behaviour, and loading states unchanged.
- Do not change `team-2` or deploy the branch.

## Button variants

1. **Primary** — solid dashboard green for the single positive or committing action in a context: Save, Submit, Approve, Export, Apply.
2. **Secondary** — white surface with the standard grey border for neutral actions: Cancel, Keep editing, Rename, Move.
3. **Danger** — white surface with a restrained red border and red text for destructive or negative actions: Delete, Discard, Reject, Withdraw.
4. **Icon** — existing compact square-outline treatment for utility controls such as close, notification, and navigation icons.

Every text action receives a shared base class for size, typography, border radius, pointer behaviour, focus ring, disabled state, and asynchronous busy state. Variant classes only control semantic colour.

This is the permanent v2.2T design language for future work: every newly introduced actionable button must use the shared base and exactly one semantic variant, unless it is a documented Icon control or belongs to an existing specialised component with equivalent styling. New functionality must add or update a source test when it introduces a new action button.

## Application rules

- Existing `.btn-primary` and `.btn-ghost` controls continue to render with their current semantic appearance, but inherit the shared base rules.
- Introduce a complete danger variant so no `.btn-danger` control can render as a native browser button.
- Add the shared classes to currently unclassified actionable buttons in dialogs and dynamic Executive request cards.
- Preserve intentionally unstyled controls that are part of a specialised component only when that component already supplies a matching interaction style (for example drag handles and inline text editors).
- Ensure native `<button>` elements used in dynamic markup always receive a variant class.
- Treat an unclassified, browser-default action button as a regression in all future v2.2T changes.

## Accessibility and interaction

- Maintain visible keyboard focus for all variants.
- Disabled and `aria-busy` states remain readable and non-clickable.
- No control text, ARIA label, handler, or confirmation behaviour changes.

## Verification

- Automated source tests assert the shared base, semantic variants, and the key native-button regressions from the reported screenshots.
- Existing Executive governance and editor-close tests continue to pass.
- Local browser check confirms the unsaved-changes dialog and Executive milestone editor show the expected variants without browser-default buttons.
