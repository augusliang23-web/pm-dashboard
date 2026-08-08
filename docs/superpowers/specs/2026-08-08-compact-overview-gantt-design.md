# Compact Overview Project Portfolio Gantt rows

## Purpose

Make the Schedule portion of the Overview PDF Project Portfolio more compact by removing the blank space between consecutive timeline rows.

## Scope

- Applies only to consecutive Gantt workstream rows in Overview PDF → Project Portfolio.
- Keep the Schedule heading, update note, axis, row content, status badges, and measured pagination unchanged.
- Keep the existing spacing before the first timeline row, so the heading remains visually separated from the schedule.
- Do not change Project PDF Gantt rendering or any non-Gantt Overview sections.

## Design

- Retain each workstream as its own measured flow item so existing continuation-page behavior remains intact.
- Apply a Project Portfolio-specific CSS adjustment only where one `project-gantt-row` immediately follows another.
- Consecutive rows visually touch with no white gap; their joined edges use square inner corners to read as one compact schedule.
- Apply the same renderer and print styling in v2.1 and v2.2T.

## Verification

- Add a renderer regression test proving the compact-row selector is present only for adjacent Project Portfolio Gantt rows.
- Run only the relevant Overview renderer and PDF layout tests in both repositories.
- Render a representative PDF and visually inspect the schedule rows and a continuation page.
