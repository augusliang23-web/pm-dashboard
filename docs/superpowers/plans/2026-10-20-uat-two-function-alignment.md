# PR #73 UAT two-function contract alignment plan

> **For agentic workers:** Use superpowers:executing-plans; one bounded final independent review. Stop before Production.

**Goal:** Align only UAT getDashboardProjectDraft and saveDashboardProject with the Unified Release frontend, preserving old Hosting compatibility and server security.

**Product Contract:** Owner Option B authorizes exactly these two UAT callables and one UAT Hosting candidate; no other function, IAM, SA, rules, index, Auth provider, capability document, billing, business record, PDF or Production changes. Synthetic emulator writes and live read-only acceptance are separate. Preserve the three Overview source fixes, authenticated server-authoritative capability discovery, PM ownership, delegated Archive, latest unreleased target, latest historical source, source preservation, atomic restore and source fingerprint validation. UAT old clients may retain their existing no-fingerprint contract; supplied fingerprints remain mandatory to validate and Production still requires them.

**Architecture / bounded design:** Reuse existing main get/save handlers. Preserve the old UAT always-enabled Draft/Archive/write-enforcement policy even if a capability document is present or misconfigured; explicit activation remains Production-only. No client fallback or other runtime feature changes. Verify actual old list/save-draft/publish source generations alongside the two new handlers. Package only the two named exports and preserve each existing runtime configuration and identity.

## Execution ledger

- [x] Reverify PR9a92802, both live revisions, 25-function inventory and Hosting baselines; no drift.
- [ ] RED/GREEN regression for UAT policy under absent/disabled/malformed/cross-project capability configuration; Production semantics unchanged.
- [ ] Complete matrix, C01–C24 real authenticated mixed-version E2E, old/new Hosting browser compatibility.
- [ ] Focused/archive/draft/Overview/rules/full regressions, both Hosting builds, final-SHA CI5/5 and independent review.
- [ ] Exact named deployment/rollback preflight, IAM/actAs/current baseline and both artifacts verified; no cloud mutation before all gates pass.
- [ ] Deploy only two UAT callables, verify both identities/auth and other functions unchanged.
- [ ] One UAT Hosting deployment, asset hashes and live read-only acceptance; restore compatible three-component combination on failure.
- [ ] Update report and Draft PR evidence, stop before Production.

**Ruling:** Existing main Archive already accepts a validated supplied fingerprint and permits only UAT/emulator legacy omission. Reuse it rather than rewrite Archive. Newly identified UAT configuration-policy drift is within the explicit legacy-save gate; preserve original UAT policy instead of adding a client override. Any additional required Function or missing live acceptance/rollback evidence means HOLD.
