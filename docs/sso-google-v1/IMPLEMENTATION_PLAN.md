# SSO V1 local implementation plan

Approved security design: SECURITY_DESIGN.md (Owner approval received in this chat). Single implementer, no parallel agents. Product contract and cloud boundaries remain unchanged.

- [x] RED/GREEN pure binding contract and identical runtime copies: UID, role, provider, subject, disabled/malformed cases.
- [x] Enforce binding in all Rules profiles, five callable actor loaders and PDF before data reads. Run real local Rules and callable/PDF gate; do not add SSO UI until this passes.
- [x] Implement standard Firebase Google chooser/password fallback/reauthenticated explicit linking and pending approval; no auto role records. Add auth listener/binding listener cleanup and identity display.
- [x] Adapt synthetic fixtures to explicit server-provisioned bindings; preserve historical guard assertions through exact new delta proof. Add targeted auth/session tests and real dual-context emulator/browser tests.
- [x] Relevant regressions including Admin self and S01 draft/publish, both Hosting builds, focused security/full root/Rules, PDF affected tests. Record actual evidence and limitations.
- [x] Commit local branch only after validation; no push/PR/cloud action unless explicitly appropriate and security gate PASS. Publish handoff with staged migration and coordinated rollback constraints.

Validation completed locally. Local commit is the final delivery step; its exact SHA is recorded in the external delivery report after commit. No remote push/PR/deployment.
