# PDF Weekly Actions and Risk Separation Design

## Goal

Keep Weekly Key Actions separate from Risks & Required Actions in every PDF export.

## Behaviour

- `weeklyActions` remains the source for the independent Weekly Key Actions block.
- Risks & Required Actions reads explicit `riskActions` or `riskPairs`; a stored risk without a dedicated action remains a risk with an empty action.
- A risk/action record is reportable only when it contains a risk or blocker.
- When no reportable risk record exists, omit the entire Risks & Required Actions block; do not render fallback text or reuse a weekly action.
- Apply the same behaviour to Project PDF and the Overview Project Portfolio section.

## Verification

Tests will prove that weekly actions render independently, are absent from risk rows, and that an action-only project emits no risk section.
