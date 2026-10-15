# PDF Attention consistency hotfix

## Confirmed cause

The Overview classifier in `index.html` uses a valid `attention` category before status fallback. Current editor and server Attention writers store `attentionManual: true` as a flag, separately from the selected category.

PDF normalization instead cleared `attention` before calling its resolver, which also treated the truthy boolean flag as a category. For the recorded synthetic green project `UAT54-R2-OWN` in W1 2000 (`attention: monitor`, `attentionManual: true`, progress 41), this produced `watch`. The same bug exists in main and PR #54; it is not a Draft/Publish regression.

Read-only verification on 2026-10-16 SGT captured UAT service `pm-dashboard-uat-pdf`, region `asia-southeast1`, serving revision `pm-dashboard-uat-pdf-00006-tg8` at 100%. Its immutable source archive generation `1792056548272800` contains the identical faulty Attention resolver and normalization path. Executing that archived source with the recorded input returns `watch`. Archive model SHA-256: `46641ef9987908926756f38ebc930cf93e148ce957f7dfcb7b52dc313d0a7b0f`.

The deployed model differs from main only in unrelated delivery-trends additions. The full deployed source also includes other delivery-trends files and changes. This is evidence of a mixed deployment baseline, not evidence of a triggering Git commit. A main-based full service deployment would remove those changes and is blocked pending an approved integration plan.

## Correction and compatibility

Resolve Attention before clearing its source value. Prefer valid canonical `attention`; ignore boolean flags as category values. Retain the existing PDF resolver's category-string `attentionManual` fallback only when canonical Attention is absent/invalid. No repository writer establishes string flags as current data; no claim is made that such records exist live. This compatibility fallback is PDF-only: Overview itself ignores string flags. Canonical legacy selections without a manual flag match Overview, as do all current boolean-flag records. Status fallback and normalized status handling remain unchanged.

No stored fields, labels, meaning, Archive lifecycle, permissions, Draft/Publish workflow, Functions, or frontend are changed.

## Validation

`pdf-service/test/attention-parity.test.mjs` executes the actual Overview classifier from `index.html`. It covers all four underlying categories with true/false/missing flags, the three reported status/override combinations, invalid/missing selections, old PDF string fallback, canonical precedence, input immutability, and actual Chromium/PDF rendering.

Before the fix, the new suite reports 15 failures / 6 passes. After the fix, all 21 pass. Separate real synthetic Overview PDFs preserve the week, identities, 2-project health total and 41% rounded progress: Monitor Closely changes 0 to 1 and Keep Watching 2 to 1. Extracted PDF text and rendered pages confirm correct placement and no clipping for that two-project fixture.

**HOLD:** The complete PDF suite reports 423 passes / 2 failures (425 tests). Both Production and UAT dense Management Attention layout tests fail the existing one-risk-table-header-per-page assertion. Unchanged main passes the focused baseline checks. Correct category grouping changes the page space preceding the risk table; the existing paginator then fragments the 14-row table into one-row tables with repeated section headings/headers on the same page (7 pages versus 5 at baseline). This is a real observed layout regression, not a browser-launch failure, and the test has not been weakened. A separate paginator/layout correction exceeds the authorized normalization-only source scope and requires a Control Plane decision.

Root regression tests: 1476 pass, 2 skip, 0 fail. Sync boundary and both local Hosting builds pass; these were local builds only. GitHub CI and Rules emulator checks were not run because the complete PDF gate failed. No PR is created: the task permits Draft PR creation only if tests pass. The focused independent review initially found no logic blockers; the dense regression was returned for further review. The candidate must not be deployed or merged.

## Future deployment gate (not authorization)

This PR is a main-based code fix, not a deployment candidate for the currently mixed UAT image. First obtain approval for a separate integration candidate preserving the current deployed delivery-trends content; do not edit V2.3 or PR #54 under this task. Verify that candidate's full source manifest, target registry, runtime/config and CI. Repeat the synthetic parity/render matrix on that integrated source.

After separate UAT PDF-only authorization, capture fresh service/config/traffic and immutable image references, verify UAT project identity `pm-dashboard-uat-20260820-a7f3` / `317352278230`, dry-run the reviewed deployment script, and deploy only the PDF service. No Hosting, Functions, Rules, IAM, Archive or historical-data changes. Use an approved synthetic fixture for authenticated Overview/PDF acceptance and clean up only explicitly authorized test records. PR #54 remains on hold until live parity passes; this fix applies cleanly to its unchanged Attention code but does not validate its Draft workflow.

Rollback must restore the previously captured PDF revision/traffic and any changed service configuration, then verify authenticated export, project/week identity and legacy rendering. Current rollback revision is `pm-dashboard-uat-pdf-00006-tg8`; refresh before use. It deliberately retains the known Attention defect. Do not remove revisions, change IAM, reconstruct records or proceed to Production. Deployment and rollback commands require a separately approved runbook because the current source/registry differs from main.
