> Updated product scope: [Archive restoration](../specs/2026-10-15-archive-scope-restoration.md). Archive management remains outside Draft Publish; English labels replace previous Chinese UI labels. See the 2026-10-15 Archive restoration report for current verification.

# Unified Save Draft / Save and Publish revision

Spec: docs/superpowers/specs/2026-10-14-unified-save-publish-design.md
Base: 86996bb. Scope: update Draft PR #54, UAT only; no merge/deploy.

### Task 1: Existing-project draft origin and access

Extend the existing get/save callable contract with server-validated source {weekId,projectCode,expectedRevision digest}. Stable source draft identity; canonical unique PM resolution, existing editing authority, no create grant for existing owned projects. Lazy read must not write. Preserve all existing official fields on publication. Existing draft IDs may be client-generated for idempotent creation but collisions must enforce ACL.
RED→GREEN actual callable tests for source read/save separation, owned PM no creation grant, unauthorized/ambiguous/forged/stale source, cross-week/access changes and metadata preservation.

### Task 2: Atomic form save and publish, unified server boundary

Extend publish callable with optional current project/assignment and stable draft ID. One transaction builds a new draft revision + official snapshot + audit. Verify stable request-digest retry against exact committed live marker. Block all UAT direct content Save/attention calls, preserve Admin visibility-only lifecycle and Production semantics.
RED→GREEN tests: saved75/current85, rollback, new-project first publication retries, stale/conflicting changes, legacy conversion without duplicate, production/lifecycle boundary. Update old compatibility tests only where user explicitly replaced legacy UAT behavior.

### Task 3: Same two text buttons in every editor

Route editable legacy cards to source-backed draft; managed cards to draft; retain delete-only admin/capability path. Editor title 編輯專案, buttons 存成草稿 / 存檔並發布, visible target week and status, adequate responsive sizing. Publish uses collected current form through atomic callable; preserve dirty baseline and auth/request guards. My Drafts provides resume/edit only. Route quick edits to editor rather than directly changing reporting data. Keep Production rendering untouched.
RED→GREEN adapter/controller/extracted editor tests, then actual local synthetic browser new/existing edit-save-publish and screenshots.

### Task 4: PDF/Overview consistency and final delivery

Actual save/publish boundary tests verify official/PDF values before/after. Run root, Rules, PDF, both Hosting builds, sync boundary, diff checks. One independent review for origin authority, canonical identity, atomicity/idempotency, UI request/auth races, legacy bypass and unknown metadata. One important/critical fix pass with regressions; no second review. Update report/PR, push existing feature branch, verify exact-head CI, keep Draft/no merge/deploy.
