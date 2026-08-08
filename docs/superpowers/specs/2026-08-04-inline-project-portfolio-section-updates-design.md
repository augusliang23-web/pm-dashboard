# Inline Project Portfolio section-update metadata

## Purpose

Make Overview PDF Project Portfolio updates compact and readable by placing each update status in its corresponding section instead of rendering a standalone Section Updates card.

## Scope

Applies to the Overview PDF Project Portfolio flow in v2.1 and v2.2T. Project PDF behavior is unchanged.

## Design

- Remove the standalone `Section updates` flow item entirely.
- Keep the existing compact `Updated · date · editor` format in muted text, aligned with the right edge of the matching section heading.
- Display `No update recorded` in the same position when a section has no saved update metadata.
- Map update fields to content as follows:
  - project identity/status → `status`
  - Highlights → `highlights`
  - Weekly Key Actions → `weeklyActions`
  - Risks & required actions → `riskActions`
  - Next milestone → `milestones`
  - Gantt schedule → `schedule`
  - Resource load → `teamAllocation` and `disciplineHours`
  - Budget snapshot → `budgetPlan` and `actualSpend`, presented separately

## Constraints

- The metadata must stay with its matching heading or snapshot card across measured-page continuations.
- No new persisted data, client input, or report request fields are introduced.
- The two repositories must retain byte-equivalent behavior where their existing report implementations are equivalent.

## Verification

- Renderer tests prove the aggregate Section Updates card is absent.
- Renderer tests prove each mapped section contains only its own metadata.
- Full PDF and dashboard suites pass in both repositories.
