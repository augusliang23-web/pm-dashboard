# Project Section Update Metadata Design

## Goal

Show the last saved time and editor for each tracked project section across the project detail page, Project PDF, Overview Project Portfolio, and Overview PDF.

## Tracked data

Each project stores a `sectionUpdatedAt` map keyed by the following stable section IDs:

- `status`
- `highlights`
- `weekly-actions`
- `risk-actions`
- `milestones`
- `schedule`
- `team-allocation`
- `budget-plan`
- `actual-spend`
- `discipline-hours`

Each entry contains an ISO save timestamp and the current authenticated editor display name. Project details are deliberately excluded.

## Save rules

- Any authorized editor, including Admin and PM, updates the entry for every tracked section whose persisted value changed in that save.
- An unchanged section retains its existing metadata.
- New projects initialise metadata only for populated tracked sections.
- Missing metadata from older projects remains valid and displays as `No update recorded`.

## Presentation

- Use compact, muted-grey text in each section header’s upper-right corner.
- Format: `Updated · 1 Aug 2026 · AUGUS.LIANG`.
- Use `No update recorded` when metadata is absent.
- Do not use cards, backgrounds, icons, or headline-size typography.
- Use the same wording and metadata source on the project detail screen, Project PDF, Overview portfolio, and Overview PDF.

## Verification

- Unit tests cover changed versus unchanged tracked sections and legacy data with no metadata.
- UI and PDF tests verify the compact metadata appears where the corresponding section is rendered.
