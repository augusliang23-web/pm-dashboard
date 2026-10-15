# Archive scope restoration — approved product boundary

The user cancelled the proposed Archive permission expansion on 2026-10-15. Archive preserves inactive/completed project history. Draft Publish handles unfinished working content. This decision supersedes contradictory clauses in earlier Draft specifications, plans and reports.

## Requirements and implementation

- No `project.archive.access` capability, selected-PM grant, new Archive role, or permission management toggle. Existing permission registries and role defaults stay unchanged.
- Preserve existing Archive lifecycle, week locks, historical data, Active/All, PM and category filtering. All means the selected reporting week, subject to existing access controls.
- Archive/restore/delete are official-project management operations, separate from My Drafts and the Draft editor. The official project card exposes existing management under existing Admin/project.manage checks. Visibility changes remain Admin-only; deletion retains project.manage. No new authorization is inferred from a working draft.
- Archived official projects retain the original editor/save and existing server authorization, outside Draft Publish. The UAT Draft-only write boundary does not replace original archived-project management. This restores the pre-PR authorization contract; it does not add a special Archive grant. Existing ownership, visibility authority, revision and released-week checks still apply.
- New source-draft conversion of an archived official project is rejected, including Admin. Existing working copies can never change official visibility via Save Draft or Publish.
- Publish rejects an archived/hidden official target and an archived working payload. Once a draft has an official publication, publishing requires that project's existing official identity in the target week. An absent target is not recreated, including a later empty week after Archive excludes the project from carryover. First publication of a genuinely new project is unchanged. Active carryover remains supported.
- Archive does not delete working content or historical snapshots. Save Draft writes only working content. PDF and Overview continue to use official reporting snapshots.
- All product-controlled text is English: Save Draft, Save & Publish, Edit Project, messages, statuses, labels and accessibility text. User-entered project content is preserved.

## Validation and safety

Regression tests exercise actual callable handlers: archived history unchanged by Save Draft; PM and Admin cannot resurrect an archived publication into an empty later week; failed atomic publication preserves working content; archived source conversion rejects; existing archived management still passes original authorization checks and preserves unknown history. UI tests cover Draft-only editing, disabled absent targets, and returning from Draft to the original editor.

No change to Archive permissions, raw-week read rules, Production data, filters, carryover or deployment manifests. Existing whole-week read access is a baseline limitation, not a newly solved isolation guarantee. Broad security hardening is separate scope.

No merge, deploy, production mutation, data recreation or historical copy/backfill. PR #54 stays Draft. Missing Rectifier investigation remains read-only and separate; see the dated report.
