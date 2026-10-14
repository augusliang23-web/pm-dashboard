# Phase 2A history pipeline contract and execution ledger

Frozen integration foundation: `83a56b1f8f93fafcf23eda4b8395cca991556777`.
Main: `4a8e7ee63cdf40c3699c834b5ff18c7427e307b0`; exact reviewed parents:
PR51 `e8817619538b4399e81932c8e7ac7c0be41edd8a`, PR50 `cd573dc5f0cdc3197e42abf8f3c3a75e1bb89f4b`.
Both are merge ancestors, not squashed or cherry-picked. Foundation verification preceded implementation:
root1536 pass/2 skips, PDF419 pass, both Hosting builds and package checks passed.
The remote foundation branch is frozen. Work is on codex/v23-history-pipeline.

## Implementation plan and decisions

- [x] RED→GREEN: authoritative stored reporting periods, cross-year/date conflicts, raw progress,
  isInAnchorScope, version diagnostics, bounded Browser pagination, missing weeks.
- [x] RED→GREEN: bounded PDF retrieval, auth/publication boundary, scope/selection, engine parity,
  report/model contract, read truncation and anchor revision handling.
- [x] Independent review: reproduce scope-exit mismatch and hidden display leakage; keep authorized
  out-of-scope rows for calculation, use only latest in-scope display metadata. Reproduce/fix null
  project selection crash. No edits to Claude-owned files.
- [x] Final regression/build/package checks. Draft PR targets frozen foundation; remote CI is reported separately.

## Authoritative reporting period

`normalizeDeliveryReportingPeriod(record)` is exported by the single authoritative shared module,
including its generated PDF copy. It accepts validated `reportingPeriod: {year,week}` or exact
stored `W<number> <four-digit ISO-year>` labels. This latter format is produced by existing
`index.html:getIsoWeekData`; it represents numeric ISO week identity, never lexicographic ordering.
No missing year is invented. Explicit period/label conflicts and impossible ISO week53 are rejected.
If weekDate is present, its stored `Mon d - Mon d` endpoints must fall within that ISO calendar week
(including Dec/Jan cross-year boundaries); unsupported/contradictory dates fail closed.
No records are modified. Invalid authorized period evidence produces unavailable metrics rather
than silently dropping that record. The engine selects/sorts calendar slots and retains gaps.

`normalizeDeliveryProjectData(project)` is shared by Browser/PDF. It retains authorized display,
identity, lifecycle and baseline fields, preserves raw progress, strips malformed nested payloads,
and normalizes existing legacy Overview scope defaults (missing/unknown level → system;
visibility trimmed/lowercase, missing → active; malformed truthy visibility → out-of-scope). It does not infer lifecycle or completed state.

## Browser API for Claude

Existing already-authorized loaded weeks can use `createDeliveryTrendsInput(options)`. If a bounded
read is required, use `await loadDeliveryTrendsInput(options)` with the same source/asOf/anchor/
window/scope and explicit canReadWeek/canReadProject predicates plus:

```js
readHistoryPage({cursor, pageSize:50, publicationMode})
  // normal authenticated SDK reader supplied by the UI/data owner
  // returns {weeks:[...], nextCursor:string|null}
```

The caller must enforce normal SDK access and the selected profile's existing draft-read policy;
the adapter grants no access. Publication policy is explicit and validated. Null cursor means
end-of-data; repeated/invalid cursors, malformed pages or >50 records fail closed. Maximum six
pages / 300 documents. Reaching the cap throws a sanitized completeness error, never a complete
contract. No denied week/project details enter output or diagnostics. Authorization predicates
must express read permission, not display scope; the engine handles project scope afterward.

N displayed changes still need N+1 calendar source observations. Do not obtain just seven/thirteen
raw rows before applying authorization/publication. Source must be explicit production/uat/synthetic;
no fallback claims Production. Existing browser allWeeks queries/navigation were not edited here.

## PDF backend interface for Claude

`server.js` provides `getDeliveryHistory({publicationMode})` via
`createBoundedDeliveryHistoryReader({db,documentIdField:FieldPath.documentId()})`.
It queries up to six pages of50, ordering by document ID only for stable cursor pagination.
It does not interpret that order as reporting-week chronology. Released-only queries add
`where('isReleased','==',true)` before limit/pagination. At an exactly-full final page completeness
is unknown; the result is deliberately incomplete. No new index, field, Rules or IAM is needed.

After token and role/anchor authorization, `loadAuthorizedReport` prepares the new metric only
when sections includes `portfolio-delivery-performance`. Existing `weekly-trend` retrieval and
legacy Overview behavior remain untouched. VIP/executive history remains released-only under
existing PDF policy. Other existing valid PDF roles retain their prior draft access.

Output: `report.deliveryTrends` is one canonical `delivery-trends/v1` object. Default PDF window6;
backend adapters can explicitly select12 through `deliveryTrendsWindowWeeks` (not a new request
field). Source comes from resolved server target (production/uat); unclassified local target
produces unavailable source rather than claiming synthetic or Production data. asOf is supplied
by server request-time provenance, outside the pure engine.

Unavailable reader, read error, truncation, invalid periods or anchor revision mismatch produce
unavailable metrics with safe warnings. No fallback to the legacy six-record query. The fetched
anchor is checked against its selected snapshot's version/projects to avoid mixing concurrent
revisions. Record versions appear as `weeklySeries[].recordVersion`; history is recalculated from
current authorized reads, never assumed immutable.

Authorization remains week/role based. Authorized out-of-scope observations are retained to
separate exitedScope from missingObservation. New hidden names/managers never replace the last
in-scope display metadata in output; current scope metrics remain null/false for these projects.
Selection resolves anchor codes to stable ID keys where present, so ID-backed code changes can
retain their historical comparisons. Lifecycle and progress rules remain the same.

`buildOverviewReportModel({...,deliveryTrends})` validates the version and forwards the same object;
it does not calculate a second metric. Existing models do not gain that property unless supplied.

### Required Claude-owned edits (not performed here)

1. Add/gate `portfolio-delivery-performance` in `report-request.js` using the approved environment policy.
2. In `renderOverviewReportHtml` destructure `deliveryTrends` and pass it to `buildOverviewReportModel`.
3. Render the prepared `model.deliveryTrends`; no formulas or independent history selection.
4. For current project rows use `projects.filter(p=>p.isInAnchorScope)`; missing-progress current
   projects remain visible. Keep the full union available for historical diagnostics.
5. Wire Browser to the same contract and authorized scope; retain the six/twelve-week selection.

The request parser currently rejects the new section and renderer does not forward it; this is
intentional until Claude's separately authorized presentation integration. No UI/navigation/PDF
HTML, production/UAT deployment or database writes are included in Phase2A.

## Data limits

Synthetic fixtures prove code behavior, not real Production label/date quality or identity accuracy.
Code-only matching remains provisional; absent baseline evidence remains unverified. First observed
is not created; disappeared is not completed; progress difference is recorded movement, not proof
of delivered work. Collections exceeding the bounded scan return unavailable until a separately
approved indexing/retention strategy exists. No schema migration is proposed or executed here.

Additional independent-review regression: malformed truthy visibility no longer becomes active;
object/number/boolean sentinels match legacy exclusion and never expose current private metadata.
Final focused regression batch: 151 passed, including legacy report data/model tests. Root final:1544 pass/2 skips.

Final PDF full suite:431 passed/0 failed. Both Hosting builds passed; generated byte/hash parity and
linux/amd64 Docker build passed. A network-disabled container verified synthetic report/model
delivery-trends/v1 with current-scope true and unavailable gain for missing progress.
Final independent boundary review:PASS, no blockers. No live Production data was read.
