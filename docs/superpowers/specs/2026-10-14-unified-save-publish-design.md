> Scope update (2026-10-15): [Archive scope restoration](2026-10-15-archive-scope-restoration.md) governs Archive and English UI. Archived projects retain their existing management/editor and authorization, outside Draft Publish. Active projects use **Save Draft** and **Save & Publish**. Historical Chinese-label acceptance below is superseded.

# Unified project editing — user-directed revision

User instruction (2026-10-14) replaces the previous new/legacy split: every editable new or existing project has two visible text buttons in the same editor: **存成草稿** and **存檔並發布**. PDF and Overview read the same official reporting data. This is the governing scope for PR #54, superseding contradictory clauses in the original Draft design/plan.

## Behavior and boundaries

- 存成草稿 saves incomplete working content persistently without changing official weeks, Overview, PDF, counts, progress, risk, budgets, trends or carryover.
- 存檔並發布 saves the submitted form and publishes it atomically to the selected unreleased week. Neither write commits on failure. The action submits the current form, not a previously saved/unseen draft. Save responses never clear later typing.
- Both buttons are real text controls, with adequate width and spacing, no floppy-disk icons. Short title 編輯專案, explicit draft/official state and publication target. My Drafts is an optional resume list, not a required publication detour.
- Existing projects lazily acquire a draft on first save; no bulk migration, no official mutation merely by opening/saving a working draft. Server reads the source project, derives a stable source identity, checks existing ownership and canonical PM directory assignment. Ambiguous name-only identities fail closed; Admin can explicitly resolve assignment. Unknown official metadata is preserved when publishing.
- Existing owned projects do not require the new-project creation grant. Creation of genuinely new projects retains project.manage. Draft editing remains Admin/assigned PM only; a project.manage user without edit ownership retains existing lifecycle/delete rights, not content editing.
- Existing legacy drafts bind to their original reporting week until first publication; carried-over managed identity continues existing semantics. Server compares recorded official digests and CAS, rejects restored/changed/deleted/duplicate/released/historical targets. Archive/Hidden remain Admin lifecycle actions and cannot be silently reactivated through content publication.
- Existing general Save/attention callables cannot bypass the unified workflow in UAT. Production keeps its current behavior and release subset. No merge, deploy, IAM/account provisioning, production permission/data mutation or historical recreation.
- Four existing UAT draft callables are extended; no additional cloud entry point. Save-and-publish retries use a stable draft ID plus actor/request digest, and validate that the committed official marker still matches before returning idempotent success.

## Acceptance

1. New and existing editable project forms show both Chinese text buttons; no regular Save Changes path in UAT.
2. Existing official40 → Save Draft75 leaves official/PDF40; reopen retains75; 存檔並發布85 publishes current85 in one transaction; both official/PDF become85.
3. First legacy draft save does not add publication metadata or mutate any official week. Only Publish attaches the draft identity to the existing project; never creates a duplicate.
4. New drafts remain across weeks with no official row until Publish. Target selection is visible; published weeks remain locked.
5. Anonymous/other-role/other-PM/stale/ambiguous identity/forged origin/unauthorized assignment/old write bypass/restore/history cases reject without partial writes or leaks.
6. Audit failure rolls back draft + official changes; identical timeout retry produces one publication audit, changed payload/stale revision conflicts.
7. Official Overview/PDF models match at the same reporting scope; working data never becomes report input. Root/Rules/PDF/build/sync checks and actual local UI smoke cover the final behavior.

Routing: Codex continues in the existing isolated clone; no provider/model switch. One independent engineering/security review after implementation. User explicitly directed this replacement design and implementation; proceed without repeating product approval gates. No production authorization is inferred.
