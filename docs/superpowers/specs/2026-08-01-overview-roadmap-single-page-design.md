# Overview PDF Roadmap Single-Page Design

## Goal

Improve the Overview PDF so Executive Milestones and the PM Quarterly Roadmap each use a compact, self-contained A4 landscape page whenever their content can fit legibly.

## Scope

- Apply the same renderer, theme, and test behavior to the production and UAT repositories.
- Keep Executive Milestones and Quarterly Roadmap as independent selectable Overview sections.
- Preserve all currently displayed milestone information.

## Layout Behavior

### Executive Milestones

- Render the whole leadership timeline as one dedicated roadmap page rather than independently flowing each category.
- Keep Q1 through Q4 in a single horizontal grid.
- Use a dedicated compact theme for heading, category cards, quarter headers, and milestone rows.

### PM Quarterly Roadmap

- Render the complete project-milestone roadmap as one dedicated page with Q1 through Q4 columns.
- Use a compact card treatment that retains the milestone name, project identity, RAG/progress indicator, and percent complete.

### Overflow

- The first page uses the compact layout before any content is split.
- If measured pagination determines content cannot fit at readable sizes, it starts a new full continuation page for the same section.
- Continuation pages repeat the section title and roadmap context; no category or quarter is split across the bottom of one page and the top of another.

## Implementation Boundaries

- `pdf-service/src/overview-report.js` will emit roadmap pages as explicit measured-flow items with section-level continuation metadata.
- `pdf-service/src/report-theme.js` will define compact Executive and Quarterly roadmap page styles.
- `pdf-service/src/measured-paginator.js` will keep a complete category or quarter-column unit together when allocating overflow pages.
- `pdf-service/test/overview-report.test.mjs` and `pdf-service/test/pdf-layout.test.mjs` will cover markup contracts, first-page compact layout, and continuation behavior.

## Non-goals

- No change to source data, milestone permissions, Executive approval workflow, or browser dashboard layout.
- No forced one-page scaling that makes the report unreadable.
