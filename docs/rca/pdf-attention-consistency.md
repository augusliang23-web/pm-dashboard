# PDF Attention and risk-table pagination hotfix

## Confirmed defects

Overview prefers canonical `attention`. Current writers store `attentionManual` as a boolean flag. PDF normalization cleared the category before its resolver, which also treated the flag as a category. The recorded green/monitor/manual=true synthetic project therefore became watch. This bug exists in main and PR54, not just Draft/Publish code.

Read-only UAT provenance connects serving revision `pm-dashboard-uat-pdf-00006-tg8` (100%, asia-southeast1) to image `sha256:a421faf4f5ccaeec0c9756968ad32693e155742858b471f95b3f73870889bf47`, Cloud Build `a45db0d7-169d-4b4c-99a5-6c0f3a134c3d` and immutable source generation `1792056548272800`. Downloaded source SHA256 matches Cloud Build's hash. Executing this deployed source reproduces the defect. No triggering Git commit is inferred.

The first fix preserves canonical categories, ignores booleans as categories and retains the existing PDF-only string override fallback when canonical attention is absent/invalid. Overview ignores string-only flags; this intentional compatibility exception is explicitly tested. No live legacy string record is claimed.

Correct classification exposed a latent paginator defect: it calculated all risk-table fragments using the small remaining space after Attention cards. Multiple one-row fragments with repeated section headings and headers were then packed on the same page. Both original dense layout checks pass main before the Attention fix and fail after it; the splitter weakness existed previously but was masked for those fixtures by incorrect category grouping.

The separate pagination correction moves an overflowing risk table onto a fresh page before splitting. Tables that already fit stay in place. Existing continuation headings and table headers repeat legitimately on new pages. Other item types retain the original partial-page splitting path. No paginator replacement, styling or unrelated section changes.

## Validation

- Attention RED:6 pass/15 fail; corrected21/21 pass.
- New risk pagination RED:2 pass/3 fail; corrected5/5 pass. Empty, short, dense14, multi-page38 and long-wrapping12-project fixtures assert ordered exact risk/action text, unique row count, one section/table header per affected page, continuation labels, footer clearance and no cell width overflow.
- Complete PDF suite:430/430 pass, including both formerly failing checks. No tests weakened.
- Root suite:1476 pass/2 skip/0 fail. Sync boundary, both local Hosting builds, UAT PDF deploy dry-run and diff check pass. No deploy performed.
- Independent reviewer reran5/5 browser tests and verified the35-file UAT source comparison; no actionable findings.
- Actual before/after synthetic PDFs: monitor2 projects1 page unchanged; dense14 projects6 to5 pages; long6 projects5 to4 pages. Every risk/action marker occurs exactly once. All10 after pages rendered and visually inspected, including all risk continuation pages. No risk heading duplication, lost/reordered rows or clipping. Long-text auto table sizing still wraps narrow project/status columns heavily, as before; no CSS change is included. Attention card continuation layout is also unchanged.

## UAT feature preservation

The current deployed source includes functionality absent from main. Do not deploy this PR's main-based service tree directly over UAT. A separate local candidate was constructed from the exact deployed35-file archive with only these two patches. The33 remaining files are byte-identical; no files removed or added. See `pdf-uat-source-preservation.json` for per-file hashes. Candidate ZIP and visual/test evidence are retained in the execution report, outside the deployment source tree.

Preserved differences from main:

| Deployed files | Preserved capability |
| --- | --- |
| Dockerfile, verify-delivery-trends-package.mjs, generated module/checksum | Canonical metrics packaging and build validation |
| server.js, report-data.js | Bounded history reader, role/released-week filtering, provenance, incomplete-history and anchor-revision fail-closed handling, selected-project history scope |
| report-model.js | delivery-trends/v1 validation and model passthrough; only Attention block patched |
| overview-report.js, delivery-performance-report.js, report-theme.js | Portfolio Delivery Performance page, chart, tables, warnings, selected-scope presentation |
| report-request.js, environment.js, targets/registry.json | Explicit UAT-only delivery section feature gating; production configuration byte-identical to deployed source |

All other UAT features, including executive timeline, project brief/update, authentication and authorization adapters remain byte-identical. Generated package integrity verifier passes. Candidate synthetic validation:82/83 pass. The remaining warning-dictionary equality test also fails on untouched deployed source: PDF defines additional fail-closed history/authorization warning codes absent from the referenced browser view. This existing discrepancy was not fixed or suppressed; feature preservation is proved by source bytes and differential reproduction, not by claiming83/83 success. It remains a separate UAT acceptance issue.

## Future deployment boundary

No UAT or Production deployment, IAM, Cloud Run, Firestore or Archive changes are authorized here. PR54/56/57 and production deployment configuration are unchanged.

Before any deployment, review the separate preserved-source candidate and its hash, publish its source through an approved reproducible integration path, rerun required integrated CI, and resolve or explicitly disposition the inherited warning-dictionary discrepancy and long-text column readability. This PR's GitHub CI checks only its main-based tree, not the extracted UAT artifact. Recheck the serving baseline for drift and require separate authorization for PDF-only deployment and rollback. The source deployment script uses `--allow-unauthenticated`; invocation/org-policy handling must be explicitly reviewed rather than repeated blindly.

An approved deployment must preserve current UAT feature flags, service/runtime identities, runtime limits, CORS and invocation settings; update only the PDF image/service after capturing rollback references. Use authorized synthetic fixtures for authenticated Overview/PDF acceptance. Do not deploy Functions, Hosting or Rules. Rollback restores captured revision/traffic/configuration and verifies legacy authenticated export; current reference is revision00006-tg8, which retains the original Attention defect. No commands were executed against cloud configuration.
