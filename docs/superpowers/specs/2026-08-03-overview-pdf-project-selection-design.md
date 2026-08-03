# Overview PDF project selection

## Goal

Allow users to choose the projects included in an Overview PDF. The selected projects define the data scope for every exported Overview section.

## User flow

1. The existing `Choose Overview sections` dialog remains the first step.
2. Its primary action changes to `Next: choose projects` after at least one section is selected.
3. The second dialog, `Choose projects`, lists every project visible to the signed-in user. Every project is checked initially.
4. The second dialog provides `Select all`, `Clear`, `Back`, and `Export PDF` actions.
5. Export is blocked with an in-dialog error if the user selects no projects.
6. Project selections are session-only. Reopening the export flow selects all currently visible projects again.

## Data and rendering

- Project options are built from the same role- and scope-aware project list used by Overview.
- The PDF request carries the selected project codes as `projectCodes`.
- The PDF service applies `projectCodes` before calculating or rendering every Overview section: portfolio health and focus, weekly trends, executive summary, attention matrix, risk actions, executive milestones, roadmap, project portfolio, resource analytics, and budget overview.
- Executive milestones are global timeline data without project identities. When the selection is a proper subset of currently visible projects, the service omits that section rather than mixing unscoped milestones into a project-filtered report.
- The generated project-portfolio pages contain only the selected projects.
- A project code that is missing or no longer visible is ignored by the service; the client still requires at least one current selection before submitting.

## Accessibility and errors

- Both dialogs retain their existing accessible modal behavior.
- Project checkboxes have visible labels containing each project name and code.
- The export control exposes busy state while the PDF is generated.
- Validation messages are announced in the existing error area.

## Testing

- Unit tests cover normalization of selected project codes, request construction, and omission of Executive milestones for a partial project selection.
- Existing PDF export tests are extended to assert that `projectCodes` is sent only after a non-empty selection.
- The full test suite runs independently in both repositories.

## Deployment

- The same feature is implemented in `pm-dashboard` (v2.1 production) and `pm-dashboard-uat` (v2.2T test).
- Each change is made on `feat/overview-pdf-project-picker`; deployment occurs only after both branches pass verification and are explicitly pushed to their respective repository deployment source.
