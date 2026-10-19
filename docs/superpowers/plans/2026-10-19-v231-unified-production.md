# V2.3.1 Unified Production Implementation Plan

> Execute inline with superpowers:executing-plans; one fresh security reviewer after implementation. Owner explicitly requests continuous execution without routine approval pauses.

**Goal:** Promote only approved A–E features to Production while preserving permissions and existing editing during staging.

**Spec:** Owner's original Unified Release assignment and 2026-10-19 “Backup Gate Removed” amendment. The latter removes all backup prerequisites and prohibits adding recovery infrastructure.

**Architecture:** Existing callable Functions and UI remain the implementation. `releaseCapabilities/v231` in the same project is a server-only activation record, bound to project ID and schema version. Production defaults inactive. Separate Draft capability, Archive capability and legacy enforcement; authenticated capability discovery drives UI. All write handlers read activation inside their transaction. No client activation writes and no new cloud service.

**Tech stack:** Existing Firebase Admin/Web SDKs, Node 22, Firestore transactions, static HTML/modules, Auth/Firestore/Functions emulators and Chromium.

## Constraints and review focus

- Explicit Production/UAT/demo-emulator allowlists; conflicting or unknown identities fail closed.
- Old Hosting plus staged backend must save as before. New UI remains legacy-compatible while capabilities are disabled.
- Active enforcement rejects stale legacy content paths; lifecycle operations retain their independent permissions.
- Archive source revision, latest target, duplicate code, transaction retries and history preservation require coverage.
- Draft publication must reject historical targets and case-insensitive duplicate codes, including first publication.
- No Production test fixtures, restore, publish or backup resources. No remote image downloads or PDF rebuild.
- Gates: full relevant tests, real isolated browser/callable/transaction/PDF E2E, fresh security review, required GitHub CI/reviews, scoped IAM, executable application rollback and current live-state reconciliation. HOLD on failure.

## Tasks

1. [ ] Backend activation and write integrity: first add failing capability/callable tests; implement environment/config resolution, authenticated capability callable, transactional activation reads, Archive stale-source/audit metadata and Draft target/code safeguards. Run focused tests then root suite.
2. [ ] Frontend promotion: add profile/capability tests, promote individually named Archive/Draft blocks, integrate auth-safe capability loading, My Drafts entry, editor routing and archive revisions. Preserve UAT-only Sync/executive workflows. Run profile/UI regressions and both builds.
3. [ ] Real E2E: launch isolated demo Auth/Firestore/Functions with Production Rules. Execute actual authenticated callables and browser Save/Resume/Publish/Archive paths; verify persistence, denial/conflict cases, history/audits, 6/12-week Overview and real PDF rendering. Never send fixtures to live projects.
4. [ ] Full validation and one independent security review of exact diff/evidence. Fix blocking findings and rerun affected validation. No self-approval.
5. [ ] One PR on `release/v231-unified-production`, inspect external deployment triggers, required CI/review; merge only if gates permit. Use final merged SHA thereafter. Provision only approved least-privilege IAM after verifying identity permissions.
6. [ ] Reconcile live deployment and application rollback targets; deploy required Functions inactive, verify old-client compatibility, cut over verified existing PDF candidate, deploy Hosting, then activate same-project capabilities. Verify live stack without business writes. Update the final Traditional Chinese report; owner write acceptance stays pending.

## Deployment configuration contract

Activation record: `{schemaVersion:1, projectId:<actual project>, drafts:true, archiveRecovery:true, enforceDraftPublish:true}`. Missing, mismatched or malformed records disable Production capabilities. The record is changed only at the reviewed activation point after Hosting; rollback disables enforcement before returning to legacy Hosting. UAT retains existing behavior when no override record exists. Test emulator uses the explicit demo ID, never live project credentials.

Application rollback is separate from data recovery. No mechanism in this plan reverses users' committed Firestore writes.
