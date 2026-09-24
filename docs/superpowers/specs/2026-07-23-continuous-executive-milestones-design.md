# Continuous Executive milestones design

## Goal

Executive milestones are a continuously maintained management roadmap rather than a field that belongs to a single reporting week. Authorised roles can update the live roadmap at any time. Releasing a reporting week records an immutable snapshot for that week's PDF and historical reporting.

## Scope

This change applies only to Executive milestones. Project, portfolio, resource, budget, and other weekly dashboard data keep their existing Draft and Released rules.

## Live roadmap

- Store the current Executive milestone timeline in one dedicated, callable-write-only document, separate from `weeks/{weekId}`.
- The dashboard Executive milestones view always renders this live document, independently of the selected reporting week.
- Current section view/update policies remain authoritative. They continue to determine which rows are visible and which roles may make monthly RAG and status updates.
- Admin and Executive Owner retain direct structural authority. Other roles retain the existing structural-request and Executive Owner approval workflow.
- Every live update, request, decision, direct structural change, and RAG override remains append-only and auditable. These records reference the live timeline version rather than treating a week ID as the authority boundary.

## Weekly snapshot

- When an Admin or PM releases a Draft reporting week, the protected release transaction copies the entire current Executive timeline into `weeks/{weekId}` as that week's Executive milestone snapshot.
- The snapshot records its capture time and the live timeline version.
- A released-week snapshot is never changed by later Executive milestone updates.
- Reverting a week to Draft does not rewrite its already captured snapshot. Releasing it again replaces the snapshot with the live timeline that exists at that later release decision.

## PDF behaviour

- A PDF for a released week uses that week's captured Executive milestone snapshot.
- A PDF for an unreleased week uses the current live Executive timeline.
- Older released weeks that predate this feature have no captured snapshot. Their PDF continues to use the Executive timeline already stored in that historical week, preserving existing reports instead of substituting later content.

## Migration and compatibility

- The live document is initialised once from the existing Executive timeline when no live document exists. Initialisation is explicit and Admin-controlled so no browser client can select an arbitrary source week.
- Existing weekly timeline fields remain readable as historical compatibility data. New live edits do not rewrite them.
- Existing timeline configuration remains the source of stable section/quarter IDs and role policies.

## Security and errors

- Browser clients remain unable to write either the live Executive timeline or a week snapshot directly.
- Callable Functions reload the authenticated user's live role and the current timeline configuration for every mutation.
- Snapshot creation occurs inside the same protected transaction as the reporting-week release. A failed snapshot prevents release, preventing a released week without a matching historical Executive record.
- If the live timeline has not yet been initialised, the release action returns a clear actionable error to Admin/PM rather than releasing an incomplete snapshot.

## Acceptance criteria

1. A permitted BD, Sales, or Product user can update Customer Engagements after any reporting week is released.
2. A permitted PM or Engineering user can update IoE Product Portfolio after any reporting week is released.
3. A user cannot update a section outside the configured update policy.
4. Releasing a week saves exactly the current live Executive timeline and version as that week's snapshot.
5. Later live updates do not change an already released week's snapshot.
6. PDF export reads a released-week snapshot, an unreleased live timeline, and legacy historical data using the stated fallback order.
7. All related role, release, structural-approval, and audit regression tests pass.
