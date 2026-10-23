# PM Dashboard — Multi-Track Integration Governance Framework

**Document Version**: Phase F2 Baseline — Gate A Remediation (2026-10-17)
**Canonical Baseline SHA (`main`)**: `4a8e7ee63cdf40c3699c834b5ff18c7427e307b0` (PR #49)
**Companion Architecture Baseline**: [`docs/ARCHITECTURE_AND_INVARIANTS.md`](./ARCHITECTURE_AND_INVARIANTS.md)
**Companion Release Provenance Protocol**: [`docs/RELEASE_PROVENANCE_CHECKLIST.md`](./RELEASE_PROVENANCE_CHECKLIST.md)

> **Purpose & Non-Interference Principle**:
> This document establishes a lightweight, practical integration governance framework for PM Dashboard so multiple parallel development tracks can progress safely without stepping on one another or regressing shared UAT/Production environments.
> - **Feature Development Remains Independent**: Individual tracks develop, test, and iterate freely in their own isolated Git branches and worktrees without waiting on integration gates.
> - **Governance Gates Apply Only at Integration & Shared-Environment Boundaries**: Cross-track readiness checks, ephemeral integration branches, and provenance gates are triggered **only** when combining tracks for shared UAT/Production deployment or merging into `main` / `production-pages`.
> - **No Duplicate Architecture Specification**: System architecture, five-layer authorization rules, and Cloud Run metadata-only revision inspection procedures are defined in [`docs/ARCHITECTURE_AND_INVARIANTS.md`](./ARCHITECTURE_AND_INVARIANTS.md) and [`docs/RELEASE_PROVENANCE_CHECKLIST.md`](./RELEASE_PROVENANCE_CHECKLIST.md) and are referenced by section below.

---

## 1. Active Development Tracks & Dependency Snapshot (Dated: 2026-10-17)

> **Dated Snapshot Notice**: Branch states, commit SHAs, and PR readiness evolve continuously as parallel tracks progress. The table below reflects verified repository refs as of **2026-10-17**. Never assume branch status remains static; always run the Class A read-only inspection commands in [`docs/ARCHITECTURE_AND_INVARIANTS.md` Section A.4](./ARCHITECTURE_AND_INVARIANTS.md#a4-classified-commands-for-refreshing-this-inventory-class-a-vs-class-b) before executing any integration step.

### 1.1 Track Inventory, Dependencies & Integration Risks (Snapshot: 2026-10-17)

| Track ID & Name | Primary Branches / PRs & Verified HEAD SHA (2026-10-17) | Base SHA | Touched Runtime Pillars | Cross-Track Dependencies & Integration Risks |
|---|---|---|---|---|
| **Track A**<br/>**PDF Attention & Risk Pagination Hotfix** | **PR #60**: `origin/codex/pdf-attention-consistency-hotfix` (`a560292beca4746e8cdec240103b20752395f2dd`) | `4a8e7ee` (`main`) | `pdf-service/` (`report-model.js`, `measured-paginator.js`), `docs/rca/` | - **Code Overlap**: Shares `pdf-service/src/report-model.js` with Track C (PR #57); 3-way `git merge-tree` auto-merges with `0` textual conflicts.<br/>- **Shared UAT Cloud Run Dependency**: `pm-dashboard-uat-pdf` was observed on 2026-10-16 running an out-of-band composite of PR #58 + PR #60 (`pm-dashboard-uat-pdf-pr60-a560292`; Class 3B actual deployed image content `UNKNOWN — NOT VERIFIED` per `AGENTS.md` Artifact Registry cost policy). Deploying Track A or Track C alone to UAT Cloud Run would regress the other. |
| **Track B**<br/>**Unified Project Draft / Publish & Cutover Ops** | - **PR #54**: `origin/codex/new-project-draft-publish` (`4be45fb07dfc6656fcfebedb4874e2488b41e801`)<br/>- **Ops Watchdog**: `claude/pr54-cloud-watchdog-v3` (`eed0882`)<br/>- **Short Cutover Plan**: `claude/pr54-short-cutover-plan` (`afa5a54`) | `4a8e7ee` (`main`) | `index.html`, `js/project-drafts-*.mjs`, `functions/project-drafts*.js`, `firestore.uat.rules`, `firestore.shared-backend.rules`, `config/deployment-manifest.json`, `ops/pr54-watchdog/`, `docs/pr54-short-cutover/` | - **Textual & Semantic Conflict with Track C**: Conflicts with PR #57/#59 in `index.html` (`initData` week sorting & empty-week `buildPrototypeWeeks()` guard) and `tests/role-contract.test.mjs` (`originalUatHash`), and breaks PR #57's full-file stripping hash assertion in `tests/delivery-trends-integration.test.mjs`.<br/>- **Backend Surface**: Adds 4 UAT-only callables (`listDashboardProjectDrafts`, `getDashboardProjectDraft`, `saveDashboardProjectDraft`, `publishDashboardProjectDraft`) and fail-closed rules on `/projectDrafts/{document=**}` and `/projectDraftPublicationAudit/{document=**}`. |
| **Track C**<br/>**V2.3 Delivery Performance** | - **PR #57 (Gate 2 Closeout)**: `claude/v23-gate2-closeout` (`7c02e7f44e4aac72c9a1a948512ea2bdbcdbd940`)<br/>- **PR #58 (UAT Backend Flag)**: `claude/v23-uat-backend-activation` (`0ad92930682d86fb009b1a3f9bcbb0e669c348cd`)<br/>- **PR #59 (UAT Frontend Flag)**: `claude/v23-uat-frontend-activation` (`1473475e78e5ff0ae9a466398ae98d35a588e117`)<br/>- **Upstream Stacked PRs**: `#50` (`cd573dc`), `#51` (`e881761`), `#52` (`c8cd5d8`), `#53` (`e06da6e`), `#55` (`669ab2d`), `#56` (`aed4e72`), `integration/v23-foundation` (`83a56b1`), `integration/v23-e2e-candidate` (`aed4e72`) | `4a8e7ee` (`main`) | `index.html`, `shared/delivery-trends.mjs`, `js/delivery-trends-*.mjs`, `js/week-order.mjs`, `js/overview-pdf-selection.mjs`, `pdf-service/src/`, `scripts/package-delivery-trends.mjs` | - **Internal Stack Order**: PR #57 consolidates PRs #50–#56 with feature flags OFF. PR #58 enables the UAT backend flag (`deliveryPerformanceSection: true` in `pdf-service/src/targets/registry.json`); PR #59 enables the UAT frontend flag (`DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED = true` in `js/overview-pdf-selection.mjs`).<br/>- **Deploy Order Dependency**: UAT PDF Backend (PR #58 + PR #60) must be verified serving before UAT Hosting Frontend (PR #59) is deployed.<br/>- **Shared File Hotspots**: `index.html`, `tests/role-contract.test.mjs`, `pdf-service/src/report-model.js`. |
| **Track D**<br/>**User Permissions Governance** | - **Merged V2 Baseline**: On `main` (`4a8e7ee`, via PRs #35, #38, #39, #41, #42, #46) and `production-pages` (`9c42541`, via PR #40)<br/>- **Open V1 PR #36**: `claude/production-user-permissions-promotion` (`3a9a728`, base `606fe7e`)<br/>- **Open V1 PR #37**: `claude/production-pages-user-permissions` (`febf2cf`, base `932c6e2`)<br/>- **Local V2 Worktree Refs**: `claude/production-user-permissions-v2-promotion` (`5b41859`), `claude/user-permissions-v2-remediation` (`3f563ac`), `claude/user-permissions-toggle-v2` (`b355e6c`) | Varies (`606fe7e` / `932c6e2` / `main`) | `index.html`, `js/permission-registry.mjs`, `functions/user-permissions.js`, `config/deployment-manifest.json`, `firestore*.rules` | - **V2 Already in Baseline**: User Permissions V2 is already integrated into `main` (`4a8e7ee`) and `production-pages` (`9c42541`).<br/>- **V1 PR Conflict Hazard**: Open PRs #36 and #37 target pre-V2 bases and have 3–4 textual conflict blocks against `main` (`config/deployment-manifest.json`, `tests/deployment-manifest.test.mjs`) and `production-pages` (`index.html`). Must not be merged without Control Plane disposition; local worktree `5b41859` contains 1 ahead commit to preserve until reviewed. |
| **Track E**<br/>**UCG V2 (Usage & Cost Guard)** | `origin/feat/ucg-v2-uat-integration` (`16b8dfb675823ebca0d48c0271f5ef85e8cf9933`, merges `origin/claude/gifted-bardeen-1m9ugt` `3eba2f9`) | `0da8d85` (2026-09-28) | `index.html`, `js/usage-cost-guard*.mjs`, `functions/`, `tests/dashboard-profile-invariants.test.mjs` | - **Pre-Baseline Divergence**: Branched from `0da8d85` prior to User Permissions V2 and One-Paste Weekly Update merges on `main`.<br/>- **Hotspot Overlap**: Modifies `index.html` and `tests/dashboard-profile-invariants.test.mjs` (`DELIBERATE_PRODUCTION_EXCEPTIONS`). Requires a dedicated future rebase/merge-tree assessment onto `main` when scheduled by the Control Plane. |
| **Other Tracked Branches** | - `claude/observed-state-builder-remediation` (`5a49e96`)<br/>- `origin/codex/selected-functions-max-instances` (`a9aa9dc`)<br/>- `origin/codex/production-snapshot-model-remediation` (`7e08425`)<br/>- Risk terminology refs (`4b9c41d`, `e785142`, `8da1a7c`, `82dea1d`) | `3c4f35d` ~ `8ceb42d` | `scripts/`, `functions/`, `pdf-service/`, `tests/` | Historical or targeted remediation branches; retained untouched under branch governance rules (Section 6). |

---

## 2. Integration Readiness & Recommended Waves

### 2.1 Seven Integration Readiness Criteria
Two or more development tracks may be combined into an integration candidate **only** when all seven readiness criteria below are evaluated:

1. **Feature Readiness**:
   - Each participating track has completed its intended feature scope for the target gate and passes its own branch unit/integration test suite in isolation.
2. **Dependency Readiness**:
   - All upstream stacked branches or branch-specific package generators required by the track (such as `node scripts/package-delivery-trends.mjs --check` in Track C PR #57) are present and verified in the candidate commit ancestry.
3. **Git Conflict Pre-Screening (Class A 3-Argument `git merge-tree` vs Class B `--write-tree`)**:
   - A non-destructive 3-argument `git merge-tree $(git merge-base <A> <B>) <A> <B>` simulation (**Class A**, strictly read-only, writes zero Git objects) has been executed and all overlapping files and conflict hunks are enumerated.
   - *(Note: `git merge-tree --write-tree <A> <B>` writes synthesized tree/blob objects into `.git/objects/` and is classified as **Class B**; use `--write-tree` only when local-state modification is permitted.)*
4. **Semantic & Invariant Compatibility**:
   - Even when `git merge-tree` reports `0` textual conflicts, engineers must verify that combining the tracks does not create behavioral contradictions across:
     - `index.html` state initialization (`initData`), week sorting, or view toggling (`render`, `renderNormal`, `renderExec`),
     - Full-file hash assertions (`originalUatHash` in `tests/role-contract.test.mjs` and feature-stripping hashes in `tests/delivery-trends-integration.test.mjs`),
     - Production Function baseline invariants (`tests/dashboard-profile-invariants.test.mjs`), or
     - Shared data contracts (`weeks/{weekId}`, `dashboardSettings/team-2-portfolio`, `userPermissions/{email}.overrides`).
5. **Security & Authorization Boundary Preservation**:
   - The combined candidate preserves all five server-side authorization layers documented in [`docs/ARCHITECTURE_AND_INVARIANTS.md` Section 6](./ARCHITECTURE_AND_INVARIANTS.md#6-authorization-architecture-across-all-five-enforcement-layers) (Role Recognition, Capability Overrides, Firestore Read Rules, Firestore Direct Write Rules, and Callable / PDF Authorization) and introduces no cross-environment leakage.
6. **Combined Validation Suite Requirements (Authoritative Source: `.github/workflows/ci.yml`)**:
   - `.github/workflows/ci.yml` (`root-tests`, `firestore-rules`, `pdf-tests`, `sync-boundary`, `hosting-builds`) together with `package.json`, `functions/package.json`, and `pdf-service/package.json` define the **only supported validation commands**. Do **not** invent nonexistent scripts (such as root `npm test`, `npm run test:uat`, `npm run test:hosting-build`, or PDF `npm run test:uat`), and never claim an unavailable or unexecuted test suite has passed.
   - Distinguish **strictly read-only inspection (Class A)** from **builds and test executions that modify local files/directories or spawn emulators (Class B)**; run Class B commands only when local-state modification is permitted:

   | Target Surface / Pillar | Authoritative CI Job (`.github/workflows/ci.yml`) | Verified Supported Commands (`package.json` / Subpackages) | Operational Class & Local State Impact |
   |---|---|---|---|
   | **Frontend (Production & UAT Profiles, Invariants & Contracts)** | `root-tests` | `npm run test:all`<br/>*(Executes `node --test *.test.cjs *.test.mjs $(find tests -maxdepth 1 -name '*.test.mjs' ! -name 'firestore-rules-emulator.test.mjs' -print) functions/test/*.test.cjs`, covering both Production and `.uat.test.mjs` frontend suites in memory via `tests/helpers/dashboard-source.mjs`.)* | **Class B** (Test process execution; use when local test execution is permitted) |
   | **Cloud Functions (`functions/`)** | `root-tests` | `npm --prefix functions test` (`node --test test/*.test.cjs` in `functions/`)<br/>*(Also executed as part of root `npm run test:all`.)* | **Class B** (Test process execution) |
   | **Firestore Security Rules (`firestore.rules`, `firestore.uat.rules`, `firestore.shared-backend.rules`)** | `firestore-rules` | - Emulator suite: `npm run test:rules` (runs `npm run test:rules:prod`, `npm run test:rules:uat`, and `npm run test:rules:shared-backend`; requires Java 21+, authoritative in Ubuntu CI when local macOS lacks Java)<br/>- Source contract tests: `node --test tests/firestore-rules-source.test.mjs tests/firestore-rules-source.uat.test.mjs` (included in `npm run test:all`) | **Class B** (Spawns local Firestore emulator on ports `8081`/`8082`) |
   | **PDF Service (`pdf-service/`)** | `pdf-tests` | - Unit/integration suite: `npm --prefix pdf-service test` (`node scripts/run-tests.mjs` in `pdf-service/`)<br/>- Deploy script dry-runs: `node pdf-service/scripts/deploy-pdf.mjs --target uat --dry-run` and `node pdf-service/scripts/deploy-pdf.mjs --target production --dry-run`<br/>- Local sample render check: `npm --prefix pdf-service run render:samples`<br/>- Track C branch-specific package check (when integrating PR #57/#58): `node scripts/package-delivery-trends.mjs --check` & `node pdf-service/src/verify-delivery-trends-package.mjs`<br/>- Linux CI container build & smoke test: `docker build --tag pdf-service-ci:${{ github.sha }} pdf-service` (builds locally in CI; never pulls from Artifact Registry) | **Class B** (Dry-runs create/remove temp dir in `os.tmpdir()`; `render:samples` writes sample outputs) |
   | **Production-to-UAT Sync Boundary** | `sync-boundary` | `npm run verify:sync-boundary` (`node scripts/verify-production-sync-boundary.mjs`) | **Class B** (Validation script execution) |
   | **Hosting Build & Asset/Leak Verification (`uat` & `prod`)** | `hosting-builds` | `npm run build:hosting:prod` (`node scripts/build-hosting.mjs --env prod`)<br/>`npm run build:hosting:uat` (`node scripts/build-hosting.mjs --env uat`)<br/>*(Or dry-run wrappers `npm run deploy:hosting:prod:dry` and `npm run deploy:hosting:uat:dry`.)* | **Class B** (Deletes and rewrites local `./dist/` directory) |

7. **Release-Specific Dependency Order (No Universal Mandatory Sequence)**:
   - There is **no** universal mandatory deployment order (such as `Functions -> Rules/Indexes -> PDF -> Hosting -> Pages`) across every release. Do **not** require deploying services that are unrelated to the release.
   - Instead, **every release must determine its own Release-Specific Dependency Order** by evaluating items **A through G**:
     - **A. Changed Components**: Exactly which runtime components (`functions`, `firestore-rules`, `cloud-run-pdf`, `hosting`, `production-pages`) are modified by the release.
     - **B. Dependent Components**: Which existing or newly modified components depend on those changes at runtime.
     - **C. Backward Compatibility**: Whether the changes remain backward compatible with currently active clients, backend services, and existing Firestore documents during rollout.
     - **D. Authorization Boundaries**: Which server-side authorization invariants (`docs/ARCHITECTURE_AND_INVARIANTS.md` Section 6) must be preserved at each transition step.
     - **E. Required Deployment Order**: The exact sequence of surface deployments derived from A–D (deploying only the surfaces that changed or require coordinated update).
     - **F. Verification Checkpoints**: The specific Class 3A metadata checks and functional smoke checks required after each step before advancing to the next dependent step.
     - **G. Rollback Order & Compatibility**: The reverse or pinned-baseline rollback sequence and confirmation that rolling back leaves Firestore data schemas, Rules, and companion surfaces compatible.
   - **Application of Release-Specific Dependency Rules**:
     - **Verified PDF Backend $\rightarrow$ Frontend Dependency (Track C + Track A)**: PR #58 UAT PDF backend verification (`pm-dashboard-uat-pdf` serving with `deliveryPerformanceSection: true` plus PR #60 fixes) must precede enabling the dependent PR #59 UAT frontend functionality (`DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED = true` on UAT Hosting).
     - **Functions vs Firestore Rules Ordering**: Determine the safe order from actual authorization and compatibility contracts rather than assuming one universal order:
       - *Case 1 (Client Write Migration to Callable)*: When replacing an active direct client write with a Callable Function and locking down client writes in Rules, deploy and verify the named Callable Function first so active clients can use the Callable before the restrictive Rule denies direct client writes.
       - *Case 2 (Fail-Closed Admin-SDK Collection Rules or Rule Tightening)*: When adding a fail-closed rule block for an Admin-SDK-only collection (such as `/projectDrafts/{document=**}` and `/projectDraftPublicationAudit/{document=**}` with `allow read, write: if false;` in Track B PR #54, where Cloud Functions use the Admin SDK and bypass Firestore Security Rules) or tightening an overly permissive rule that no active client depends on, deploying the fail-closed Rule first (or independently) is safe and prevents any window without explicit deny rules. Before enabling the frontend UI that calls new Callables (`listDashboardProjectDrafts`, `getDashboardProjectDraft`, `saveDashboardProjectDraft`, `publishDashboardProjectDraft`), those named Callables must be deployed and verified live.
     - **GitHub Pages (`production-pages`) Dependency**: When a Production release modifies the frontend, `production-pages` is updated only after all release-specific Production backend and Firebase Hosting dependencies have been deployed and verified (e.g., `productionPages.mergeOnlyAfter: ["functions", "rules", "hosting", "authenticatedSmoke"]` in `releases.userPermissionsV2`).

### 2.2 Recommended Integration Waves (Advisory & Reorderable by Control Plane)

> **Flexibility Rule**: The waves below are **engineering recommendations** based on current conflict density and shared UAT surface dependencies. They are **not** a rigid or mandatory schedule. The **ChatGPT Control Plane** may reorder, split, or defer any wave at any time without requiring changes to this governance framework.

| Recommended Wave | Candidate Tracks | Rationale & Surface Scope | Key Preconditions |
|---|---|---|---|
| **Wave 1 (Recommended First): UAT PDF & V2.3 Provenance Convergence** | **Track A (PR #60)** + **Track C (PR #57 + PR #58 + PR #59)** | - **0 Textual Conflicts**: PR #60 (`a560292`) and PR #57/`#58`/`#59` auto-merge cleanly (`0` conflict blocks in `pdf-service/src/report-model.js`).<br/>- **Eliminates UAT Cloud Run Provenance Drift**: Replaces the unversioned out-of-band composite on `pm-dashboard-uat-pdf` with a single committed Git SHA containing both V2.3 Delivery Performance and PR #60's attention/pagination fixes.<br/>- **Unblocks V2.3 Gate 3B UAT Acceptance**: Allows PR #58 (PDF backend) + PR #60 and PR #59 (UAT frontend) to complete live UAT acceptance in release-specific dependency order (PDF backend verified before frontend flag activation) without regressing either track. | Complete `CROSS_TRACK_FEATURE_PRESERVATION` for `pm-dashboard-uat-pdf` and `uat-hosting`; verify 7-step Cloud Run metadata digest before enabling frontend flag. |
| **Wave 2: Canonical `main` Promotion of Flag-Off / Verified Foundations** | **Track A (PR #60)** and/or **Track C Base (PR #57, flags OFF)** $\rightarrow$ `main` | - Merging PR #60 and PR #57 (where Delivery Performance flags remain `false` by default in `registry.json` and `js/overview-pdf-selection.mjs`) into `main` establishes a single updated baseline (`main` vNext) before integrating other `index.html`-heavy tracks. | All 5 GitHub Actions CI checks green; Control Plane merge approval. |
| **Wave 3: Track B (PR #54 Unified Draft / Publish) Integration & UAT Cutover** | **Track B (PR #54 `4be45fb` + Cutover/Watchdog ops)** onto updated baseline | - Isolates the 2 textual conflicts and semantic week-sorting / `originalUatHash` resolution (Section 5) into a single clean step after V2.3's `index.html` changes are settled (or vice versa if Control Plane prioritizes Track B first).<br/>- Gives PR #54 dedicated UAT Functions + UAT Firestore Rules + UAT Hosting validation using its short cutover plan (`claude/pr54-short-cutover-plan`) and watchdog (`claude/pr54-cloud-watchdog-v3`). | Explicit resolution of `initData` week sorting, `originalUatHash`, and `delivery-trends-integration.test.mjs` stripping baseline per Section 5. |
| **Wave 4: Future Feature & Housekeeping Tracks** | **Track E (UCG V2 `16b8dfb`)**; disposition of **PR #36 / #37** | - Rebase/integrate UCG V2 from `0da8d85` onto the current `main` baseline in an isolated candidate worktree when scheduled by Control Plane.<br/>- Review and disposition superseded V1 User Permissions PRs (#36, #37) once V2 (`5b41859`) diff audit is confirmed. | Separate Control Plane scheduling decision. |

---

## 3. Cross-Track Feature Preservation Policy for Shared Environments

> **Core Invariant**: **A clean Git merge (`0` conflict blocks) never proves functional compatibility or runtime preservation.** Before deploying any candidate commit to a shared singleton environment (UAT Cloud Run PDF, UAT Firebase Hosting, UAT Functions/Rules, or Production), the engineer must complete the mandatory `CROSS_TRACK_FEATURE_PRESERVATION` checklist (Items **A–I**) in [`docs/RELEASE_PROVENANCE_CHECKLIST.md` Section 3](./RELEASE_PROVENANCE_CHECKLIST.md#3-cross_track_feature_preservation-mandatory-for-shared-environment-deployments).

### 3.1 Concrete Preservation Matrix for Current Shared UAT Surfaces (Snapshot: 2026-10-17)

| Preservation Dimension | Shared Surface 1: UAT Cloud Run PDF (`pm-dashboard-uat-pdf`) | Shared Surface 2: UAT Firebase Hosting (`pm-dashboard-uat-20260820-a7f3.web.app`) | Shared Surface 3: UAT Cloud Functions & Firestore Rules (`pm-dashboard-uat-20260820-a7f3`) |
|---|---|---|---|
| **1. Currently Deployed Features (Baseline to Protect)** | - Service-level metadata observed on 2026-10-16 reported revision `pm-dashboard-uat-pdf-pr60-a560292` (Class 3B actual deployed image content `UNKNOWN — NOT VERIFIED`; Class 2 manifest `docs/rca/pdf-uat-source-preservation.json` matches PR #58 `0ad9293` + PR #60 `a560292`).<br/>- Active capabilities: V2.3 Delivery Performance PDF section (`deliveryPerformanceSection: true` for `uat`) **plus** PR #60 attention boolean-override fix (`report-model.js`) and risk-table pagination split fix (`measured-paginator.js`). | - `main` (`4a8e7ee`) UAT profile features (User Permissions V2 Admin page, One-Paste Copilot Weekly Update, Executive Milestone Governance, PR #49 `Project Manager` labels) **or** any active V2.3 / PR #54 UAT candidate deployed during an approved test window. | - 21 `main` (`4a8e7ee`) Functions (including 8 `userPermissionsV2` callables, 8 Executive callables, 3 UAT sync callables) and `firestore.uat.rules` (`canReadDraftWeeks()`, `canManageWeeks()`, Executive Milestone collections, Admin Gantt template envelope). |
| **2. Candidate Features (When Deploying New Wave)** | Combined candidate commit integrating **PR #58 (`0ad9293`) + PR #60 (`a560292`)** (or any subsequent PDF candidate). | Candidate commit for **Track C (PR #59 `1473475`)**, **Track B (PR #54 `4be45fb`)**, or a combined UAT integration candidate. | Candidate Functions/Rules (e.g., **PR #54** adding 4 `projectDrafts` callables and `/projectDrafts` + `/projectDraftPublicationAudit` fail-closed rules). |
| **3. Features That Must Remain** | 1. `deliveryPerformanceSection: true` in `pdf-service/src/targets/registry.json` (`uat`).<br/>2. F-1 draft-history restriction (`admin`/`pm` only) and 2-column footnotes from PR #57/#58.<br/>3. `attentionFor()` / `normalizeProjectForReport()` parity and `measured-paginator.js` risk-table splitting from PR #60.<br/>4. Existing Overview, Project, One-Pager, and Executive Brief PDF rendering. | 1. All `main` (`4a8e7ee`) UAT capabilities.<br/>2. Any active UAT feature track currently undergoing acceptance testing on UAT Hosting, unless the Control Plane explicitly approves a window switch. | 1. All 21 existing Functions on `main` (`4a8e7ee`).<br/>2. All existing `firestore.uat.rules` read/write boundaries (`weeks` draft read protection, `userPermissions/{email}.overrides`, `executiveMilestone*`, `dashboardSettings/team-2-portfolio`). |
| **4. Evidence of Preservation** | - Class 1 Git ancestry check (`git merge-base --is-ancestor a560292 <CANDIDATE_SHA>` and `git merge-base --is-ancestor 7cc502d <CANDIDATE_SHA>`).<br/>- Track C branch-specific package check `node scripts/package-delivery-trends.mjs --check` passes. | - Class 1 Git ancestry/diff check against `4a8e7ee` and any co-deployed UAT track.<br/>- `tests/dashboard-profile-invariants.test.mjs` and `tests/role-contract.test.mjs` pass. | - Named Function deployment list (`firebase deploy --only functions:<fn1>,functions:<fn2> --project pm-dashboard-uat-20260820-a7f3`) verified against `config/deployment-manifest.json`; unrelated existing Functions treated as preserved; Firestore Rules deployed in a separately scoped command (`--only firestore:rules --config firebase.uat.json`). |
| **5. Required Regression Tests** *(Class B when local mutation is permitted)* | `npm --prefix pdf-service test` (`node scripts/run-tests.mjs` in `pdf-service/`, including `delivery-parity.test.mjs`, `delivery-performance-report.test.mjs`, `attention-parity.test.mjs`, `risk-pagination.test.mjs`) and `node pdf-service/scripts/deploy-pdf.mjs --target uat --dry-run`. | `npm run test:all`, `npm run build:hosting:uat` (`node scripts/build-hosting.mjs --env uat`), and `npm run build:hosting:prod` (`node scripts/build-hosting.mjs --env prod`). | `npm --prefix functions test` (or `npm run test:all`), `npm run test:rules` (`test:rules:prod`, `test:rules:uat`, `test:rules:shared-backend`), and `npm run verify:sync-boundary`. |
| **6. Explicitly Approved Removals** | `NONE` (unless Control Plane explicitly authorizes disabling a feature flag). | `NONE` (or explicit Control Plane window-switch sign-off if swapping UAT Hosting between mutually exclusive candidates). | `NONE`. |
| **7. Release-Specific Order & Rollback Compatibility** | Record previous serving `(revisionName, trafficPercent, tag, status.imageDigest)` via the 7-step metadata-only procedure in [`docs/RELEASE_PROVENANCE_CHECKLIST.md` Section 2.3](./RELEASE_PROVENANCE_CHECKLIST.md#23-three-cloud-run-revision-categories--mandatory-7-step-metadata-only-identification-procedure). Verify PDF backend before enabling dependent frontend flags. Note: rolling back to `00006-tg8` would regress PR #60; rolling back to `pr60-a560292` restores the composite image. | Record current Firebase Hosting `versionName` (`sites/pm-dashboard-uat-20260820-a7f3/versions/<id>`) prior to deploy; verify data and backend compatibility before switching Hosting. | Determine Functions vs Firestore Rules order from the release's authorization and compatibility contracts (Section 2.1 Item 7); pre-capture Firestore snapshot and active `rulesetId` (see `docs/pr54-short-cutover/ROLLBACK_PROCEDURE.md` when executing Track B). |
| **8. Deployment Approval** | Control Plane gate `PASS` + human Release Approver sign-off. | Control Plane gate `PASS` + human Release Approver sign-off. | Control Plane gate `PASS` + human Release Approver sign-off. |

---

## 4. Lightweight End-to-End Integration Workflow

To keep day-to-day engineering fast while protecting shared environments, all tracks follow an 8-stage progression where **Stages 1–4 are purely local/CI** and **Stages 5–8 require Control Plane / Release Approver gates**:

```text
[1. Feature Development]          (Independent branch/worktree; zero cross-track blocking)
          │
          ▼
[2. Integration Readiness]        (Class A 3-arg git merge-tree + 7 readiness checks in Section 2.1)
          │
          ▼
[3. Isolated Integration Candidate] (Ephemeral branch `integration/<scope>` in dedicated worktree)
          │
          ▼
[4. Combined Validation]          (Resolve hotspots per Section 5; run verified CI/local test suites)
          │
          ▼
[5. Control Plane Gate]           (Review readiness, A–G dependency order & preservation -> PASS/HOLD)
          │
          ▼
[6. Approved UAT Deployment]      (Release Approver authorizes Class C deploy in release-specific order)
          │
          ▼
[7. UAT Acceptance]               (7-step metadata-only Class 3A check + functional smoke QA)
          │
          ▼
[8. Production Release Gate]      (Merge to `main` -> Deploy changed Prod surfaces in release-specific order -> `production-pages` if frontend changed)
```

### Key Operational Rules for the Workflow
1. **Stage 1 Never Waits on Stages 5–8**: Developers working on Track B, Track C, Track E, or new features continue committing and testing in their own branches/worktrees at all times.
2. **Stage 3 Uses Ephemeral Gate-Scoped Branches Only**:
   - When two tracks must be combined (e.g., `integration/uat-pdf-v23-pr60` combining PR #58 and PR #60, or `integration/v23-pr54-candidate`), create a fresh ephemeral branch from the target base in a separate worktree.
   - **Never** mutate, rebase, or force-push the original author branches (`codex/*` or `claude/*`).
   - Once the constituent PRs are merged into `main`, the ephemeral `integration/<scope>` branch is retired.

---

## 5. Practical Conflict Resolution Procedures (Reference Playbook for Future Integration)

> **Execution Boundary**: Do **not** execute these conflict resolutions during Phase F2 / Gate A documentation governance. Follow these exact procedures when the Control Plane authorizes creating a Stage 3 integration candidate.

### 5.1 `index.html` Shared Modifications & Week Sorting Semantic Conflict (PR #54 vs PR #57)
- **Where the Conflict Occurs**:
  In `index.html` inside `initData()` (`onSnapshot(weeksQuery)` handler, around lines 6135–6210):
  - On `main` (`4a8e7ee`):
    ```javascript
    if (!fetchedWeeks.length) fetchedWeeks = buildPrototypeWeeks();
    allWeeks = sortWeeksByLabel(fetchedWeeks);
    ```
  - **Track B (PR #54 `4be45fb`)** removes `if (!fetchedWeeks.length) fetchedWeeks = buildPrototypeWeeks();` so an empty official `weeks` collection stays empty (preventing unpublished drafts from mixing with synthetic prototype weeks), while keeping `allWeeks = sortWeeksByLabel(fetchedWeeks);`.
  - **Track C (PR #57 `7c02e7f`)** retains `if (!fetchedWeeks.length) fetchedWeeks = buildPrototypeWeeks();`, replaces `sortWeeksByLabel(fetchedWeeks)` with `const previouslySelectedWeekId = allWeeks[currentIdx]?.__documentId; allWeeks = sortWeeksChronologically(fetchedWeeks);` (imported from `./js/week-order.mjs`), selects `latestValidWeekIndex(allWeeks)` on initial load, and preserves `previouslySelectedWeekId` across snapshot refreshes.
- **Step-by-Step Resolution Procedure**:
  1. **Preserve Chronological Week Sorting (`sortWeeksChronologically`) and Selected-Week Retention**: Track C requires `sortWeeksChronologically(fetchedWeeks)`, `latestValidWeekIndex(allWeeks)`, and `previouslySelectedWeekId` retention for multi-week Delivery Trends and year-rollover (`W52` $\rightarrow$ `W1`) accuracy.
  2. **Reconcile Empty-Store Prototype Behavior Explicitly**:
     - Verify whether any Track C test in `tests/delivery-trends-integration.test.mjs` or browser E2E suite relies on `if (!fetchedWeeks.length) fetchedWeeks = buildPrototypeWeeks();` vs Track B's `tests/project-draft-isolation.test.mjs` ("drafts never fill an empty official portfolio or PDF").
     - Note that `tests/project-draft-isolation.test.mjs` tests `getOverviewProjects(official().projects, 'all')` and `loadAuthorizedReport` against an empty `projects: []` array inside an existing week `weeks/W1`, while `fetchedWeeks.length === 0` only occurs when the entire `weeks` collection has zero documents.
     - If both behaviors are needed, gate prototype week fallback behind `!hasActiveProjectDrafts` or align the single line with the Control Plane's chosen merge order and update `revertWeekOrdering()` in `tests/delivery-trends-integration.test.mjs` to match the exact surrounding context lines.
  3. **Verify Production Profile Invariance**: Run `node --test tests/dashboard-profile-invariants.test.mjs` (Class B) to confirm that resolving `initData()` in UAT introduces zero unauthorized changes to `dashboardSource('production')`.

### 5.2 `originalUatHash` Conflicts in `tests/role-contract.test.mjs`
- **Why It Conflicts**:
  - `tests/role-contract.test.mjs` (line 20/25) pins `const originalUatHash = '<sha256>'`, computed as:
    `createHash('sha256').update(normalizeProjectManagerLabelsForBaseline(dashboardSource('uat'))).digest('hex')`
  - On `main` (`4a8e7ee`), `originalUatHash` is `e83cb180ae5888fe33b4f93a642bb9a612decd30897007d2f07f85415b0c4479`.
  - On PR #54 (`4be45fb`), `originalUatHash` is `8f942b55f03c8476cda4b0a93dca83596136ae55ccbf08499fa1a660c4a41a14`.
  - On PR #57 (`7c02e7f`), `originalUatHash` is `9e526abdf0d7cbc99ade1f5599b739b42c9e761c16897484fc91123993ffb2e9`.
- **Step-by-Step Resolution Procedure**:
  1. Never pick either branch's hash string blindly when merging two branches that both modify `index.html`; neither branch's standalone SHA-256 will match the combined `index.html`.
  2. First complete and review all `index.html` conflict resolutions in the isolated integration worktree.
  3. Combine the provenance comment lines above `originalUatHash` in `tests/role-contract.test.mjs` so both features' audit trails are preserved.
  4. Recompute the exact combined UAT hash deterministically using:
     ```bash
     node --input-type=module -e "
       import { createHash } from 'node:crypto';
       import { dashboardSource, normalizeProjectManagerLabelsForBaseline } from './tests/helpers/dashboard-source.mjs';
       console.log(createHash('sha256').update(normalizeProjectManagerLabelsForBaseline(dashboardSource('uat'))).digest('hex'));
     "
     ```
  5. Update `originalUatHash` to that recomputed digest and run `node --test tests/role-contract.test.mjs` (or `npm run test:all`).

### 5.3 Delivery Trends Feature-Stripping Tests (`tests/delivery-trends-integration.test.mjs`)
- **Why It Breaks Semantically When Combined with Other UAT `index.html` Tracks**:
  - In PR #57 (`7c02e7f`), `tests/delivery-trends-integration.test.mjs` (lines 151–177) strips only the V2.3 Delivery Trends `@uat-only` blocks (`weekOrderImport`, `deliveryPdfImport`, `deliveryTrendsLogoutReset`, `deliveryTrendsButton`, `deliveryTrendsContainer`, `deliveryPerformanceOption`, `deliveryTrendsView`, `deliveryTrendsRawHistoryReset`, `deliveryTrendsRawHistorySnapshot`, `deliveryTrendsRawHistoryError`, `deliveryTrendsErrorCleanup`, `deliveryTrendsAuthCleanup`) and asserts that the remaining UAT-rendered `index.html` equals `e83cb180ae5888fe33b4f93a642bb9a612decd30897007d2f07f85415b0c4479` (`main` @ `4a8e7ee`).
  - If PR #54 (or UCG V2) is already present in `index.html`, stripping only Delivery Trends leaves PR #54's UAT changes in `index.html`, producing PR #54's UAT hash (`8f942b55...`) instead of `e83cb180...`.
- **Step-by-Step Resolution Procedure**:
  - **Case 1 — Track C (PR #57) Merges to `main` Before Track B (PR #54)**:
    - PR #57 merges cleanly against `4a8e7ee` with no change needed to `e83cb180...`.
    - When Track B (PR #54) integrates afterward on top of the new `main`, either:
      - Update the baseline hash constant in `tests/delivery-trends-integration.test.mjs` from `e83cb180...` to PR #54's pre-Delivery-Trends UAT hash (`8f942b55f03c8476cda4b0a93dca83596136ae55ccbf08499fa1a660c4a41a14`) with a documented comment, **or**
      - Strip PR #54's `@uat-only` blocks in the baseline-reproduction helper before asserting `e83cb180...`.
  - **Case 2 — Track B (PR #54) Merges to `main` Before Track C (PR #57)**:
    - When rebasing/merging PR #57 onto `main` (which now has `originalUatHash = '8f942b55...'`), update the expected pre-Delivery-Trends baseline hash in `tests/delivery-trends-integration.test.mjs` (line 176) to `8f942b55f03c8476cda4b0a93dca83596136ae55ccbf08499fa1a660c4a41a14` and update the intermediate Gate 2 hash (line 156) accordingly.

### 5.4 PDF Service Shared Modules (`pdf-service/src/*`)
- **Hotspot Files**:
  - `pdf-service/src/report-model.js` (modified by both PR #60 `a560292` and PR #57 `7c02e7f`)
  - `pdf-service/src/measured-paginator.js` (modified by PR #60 `a560292`)
  - `pdf-service/src/targets/registry.json` (modified by PR #58 `0ad9293` to set `deliveryPerformanceSection: true` in `uat`)
  - `pdf-service/test/delivery-feature-gate.test.mjs` (modified by both PR #58 and PR #59)
- **Step-by-Step Resolution Procedure**:
  1. Run 3-argument `git merge-tree $(git merge-base <A> <B>) <A> <B>` (Class A read-only) between the candidate PDF branches to confirm `0` textual conflicts.
  2. When local-state modification is permitted (Class B), run `node scripts/package-delivery-trends.mjs --check` and `node pdf-service/src/verify-delivery-trends-package.mjs` in the Track C integrated tree to ensure `pdf-service/src/generated/delivery-trends.mjs` and `.sha256` match `shared/delivery-trends.mjs`.
  3. Run `npm --prefix pdf-service test` (`node scripts/run-tests.mjs` in `pdf-service/`) and root `npm run test:all` in the integrated tree to verify that PR #60's `attention-parity.test.mjs` and `risk-pagination.test.mjs` pass alongside PR #57/#58's `delivery-parity.test.mjs` and `delivery-performance-report.test.mjs` (which also resolves the 1/83 root warning-dictionary mismatch observed when PR #60 was run against a tree lacking PR #57's root warning dictionary).

### 5.5 Deployment Manifests & Named Functions Governance (`config/deployment-manifest.json` & `tests/deployment-manifest.test.mjs`)
- **Hotspot & Governance Mechanism**:
  - `config/deployment-manifest.json` is the repository's **governance allowlist** defining `environments.prod` and `environments.uat` Function classifications (`functionsAllowlist`, `functionsPreserveExisting`, `functionsNeverDeploy`) and reviewed release plans (`releases.userPermissionsV2`).
  - Being listed in `functionsAllowlist` does **not** authorize deploying every managed Function; each release must specify an **explicit, approved function-name list** (such as `releases.userPermissionsV2.functions`), and only those explicitly approved named Functions may be deployed (`firebase deploy --only functions:<fn1>,functions:<fn2> --project <PROJECT_ID>`, assembled via `buildFunctionsOnlyFlag()` / `buildReleaseFunctionsOnlyFlag()` in `scripts/deployment-manifest.mjs`).
  - Unrelated existing Functions (`functionsPreserveExisting` such as the 8 Executive Functions in Production, and `untouchedManagedFunctions` outside a release's scope) are treated as preserved and must never be deployed or deleted by an unrelated release.
  - Firestore Rules deployments must always be separately scoped (`firebase deploy --only firestore:rules --config <firebase.json|firebase.uat.json> --project <PROJECT_ID>`), never combined into an unscoped `functions,firestore:rules` command.
  - **Important Enforcement Boundary**: `config/deployment-manifest.json` does **not** automatically intercept or block arbitrary `firebase` CLI commands executed directly in a shell. Explicit Control Plane gate sign-off and human Release Approver authorization are required before any deployment.
  - **Branch Specifics**: PR #54 (`4be45fb`) adds `projectDrafts` (`listDashboardProjectDrafts`, `getDashboardProjectDraft`, `saveDashboardProjectDraft`, `publishDashboardProjectDraft`) to `environments.uat.functionsAllowlist` and to `environments.prod.functionsNeverDeploy.projectDrafts`. Older V1 PR #36 (`3a9a728`) conflicts with `main` because `main` replaced the V1 `releases.userPermissions` block with `releases.userPermissionsV2`.
- **Step-by-Step Resolution Procedure**:
  1. Never downgrade `releases.userPermissionsV2` on `main` back to V1 (`PR #36`).
  2. When integrating a track with new UAT-only callables (such as PR #54's `projectDrafts`), add those callables to **both** `environments.uat.functionsAllowlist` and `environments.prod.functionsNeverDeploy` so manifest validation fails closed if any release plan attempts to include UAT draft callables in Production.
  3. Run `node --test tests/deployment-manifest.test.mjs tests/production-promotion-v2.test.mjs` (or `npm run test:all`) to verify manifest invariants.

### 5.6 Firestore Authorization Boundaries (`firestore.rules`, `firestore.uat.rules`, `firestore.shared-backend.rules`)
- **Step-by-Step Resolution Procedure**:
  1. Keep `firestore.uat.rules` and `firestore.shared-backend.rules` synchronized when adding UAT collection rules (e.g., PR #54's `match /projectDrafts/{document=**} { allow read, write: if false; }` and `match /projectDraftPublicationAudit/{document=**} { allow read, write: if false; }`).
  2. Do **not** add UAT-only collections or UAT direct-write rules (such as `/dashboardSettings/team-2-portfolio` Admin create/update) to Production `firestore.rules` until that feature passes a dedicated Production promotion gate.
  3. Verify against the 5-layer authorization model in [`docs/ARCHITECTURE_AND_INVARIANTS.md` Section 6](./ARCHITECTURE_AND_INVARIANTS.md#6-authorization-architecture-across-all-five-enforcement-layers) and run `node --test tests/firestore-rules-source.test.mjs tests/firestore-rules-source.uat.test.mjs` (included in `npm run test:all`) plus `npm run test:rules` in CI.

---

## 6. Branch Lifecycle Governance & Non-Destructive Disposition Policy

### 6.1 Five Branch Lifecycle Classifications
Every branch in the repository is classified into one of five governance states. **No branch or PR may be deleted, closed, force-pushed, or modified without explicit Control Plane and user authorization.**

| Classification | Definition | Handling & Protection Rule |
|---|---|---|
| **`ACTIVE`** | Currently under development, review, or UAT release preparation; represents the authoritative tip of a feature, hotfix, or ops track. | **Strictly Protected**: Never modify, rebase, or overwrite another agent's or developer's `ACTIVE` branch or worktree. |
| **`STACKED`** | An upstream phase branch whose commits are already fully ancestors of (or consolidated into) a higher-level closeout PR in the same track. | **Protected / Do Not Merge Out-of-Order**: Keep open and untouched until the consolidating closeout PR merges or the Control Plane authorizes stack cleanup. |
| **`SUPERSEDED`** | An earlier version of a feature or promotion PR (e.g., V1) whose scope has been replaced by a newer merged or active V2 implementation on `main` / `production-pages`. | **Protected Pending Disposition**: Do not merge (merging would regress V2 invariants), and do not delete or close until the Control Plane and user explicitly authorize disposition after confirming zero unported commits. |
| **`HISTORICAL`** | Older branches whose commits are already merged into `main` / `production-pages` (or verified patch-equivalent via `git cherry`), retained for audit history. | **Read-Only Archive**: Leave untouched; never deploy from `HISTORICAL` branches. |
| **`UNKNOWN`** | Any branch or worktree whose ownership, purpose, or current activity has not been explicitly confirmed. | **Protected as `ACTIVE` by Default**: Never assume a branch is abandoned because of commit age; treat `UNKNOWN` branches with full `ACTIVE` protection until confirmed. |

### 6.2 Classified Repository Branch Inventory (Dated Snapshot: 2026-10-17)

| Lifecycle State | Branches / PRs (Verified 2026-10-17) | Governance Notes |
|---|---|---|
| **`ACTIVE`** | - `docs/architecture-foundation-f1` (Phase F1/F2 governance worktree)<br/>- **PR #60**: `origin/codex/pdf-attention-consistency-hotfix` (`a560292`)<br/>- **PR #54**: `origin/codex/new-project-draft-publish` (`4be45fb`)<br/>- **PR #54 Ops/Cutover**: `claude/pr54-cloud-watchdog-v3` (`eed0882`), `claude/pr54-short-cutover-plan` (`afa5a54`)<br/>- **PR #57**: `claude/v23-gate2-closeout` (`7c02e7f`)<br/>- **PR #58**: `claude/v23-uat-backend-activation` (`0ad9293`)<br/>- **PR #59**: `claude/v23-uat-frontend-activation` (`1473475`)<br/>- **UCG V2**: `origin/feat/ucg-v2-uat-integration` (`16b8dfb`) & `origin/claude/gifted-bardeen-1m9ugt` (`3eba2f9`) | Active feature, release-candidate, and operations tracks. All associated branches and worktrees remain untouched. |
| **`STACKED`** | - **V2.3 Upstream PRs**: PR #50 `claude/v23-delivery-presentation` (`cd573dc`), PR #51 `codex/v23-shared-metrics-engine` (`e881761`), PR #52 `codex/v23-history-pipeline` (`c8cd5d8`), PR #53 `claude/v23-product-integration` (`e06da6e`), PR #55 `claude/v23-browser-e2e-hardening` (`669ab2d`), PR #56 `integration/v23-e2e-candidate` (`aed4e72`), and `origin/integration/v23-foundation` (`83a56b1`) | All commits in these branches are consolidated into **PR #57 (`7c02e7f`)**. Use PR #57 (plus PR #58/#59) as the integration base for Track C. |
| **`SUPERSEDED`** *(Candidate for Control Plane Disposition)* | - **PR #36**: `claude/production-user-permissions-promotion` (`3a9a728`, V1 promotion targeting `main`)<br/>- **PR #37**: `claude/production-pages-user-permissions` (`febf2cf`, V1 port targeting `production-pages`) | Superseded by merged User Permissions V2 PRs (#40 `015e8b2` on `production-pages`; #41 `fb956ef` and #46 `8301b2b` on `main`). Retained untouched until Control Plane disposition. |
| **`HISTORICAL`** | - Merged feature branches (`origin/claude/weekly-update-one-paste-uat` `479855e`, `origin/claude/weekly-one-paste-production-pages` `e221c61`, `origin/fix/owner-to-project-manager-labels-20261014` `4d2c94a`, `origin/codex/user-permissions-v2-runtime-rebaseline` `8301b2b`, `origin/codex/selected-functions-max-instances` `a9aa9dc`, `origin/codex/production-snapshot-model-remediation` `7e08425`)<br/>- Patch-equivalent risk terminology refs (`origin/integrate/risk-mitigation-actions-current-main` `8da1a7c`, `origin/fix/risk-mitigation-actions-label` `82dea1d`, `origin/release/risk-mitigation-terminology-prod` `e785142`) | Already in `main` or `production-pages` ancestry (or verified patch-equivalent). Retained untouched. |
| **`UNKNOWN`** *(Protected as `ACTIVE`)* | - Local worktree branches with unmerged commits or unconfirmed disposition: `claude/production-user-permissions-v2-promotion` (`5b41859`, 1 commit ahead of `origin`), `claude/observed-state-builder-remediation` (`5a49e96`), `origin/release/pdf-risk-mitigation-terminology-prod` (`4b9c41d`), and any other local worktree in `/Users/augusliang/Developer/worktrees/*` or `.claude/worktrees/*`. | Treated as protected `ACTIVE` worktrees/branches until explicitly reviewed and dispositioned by the Control Plane. |

---

## 7. Milestone-Based Review Gates

To avoid review bottlenecks and unnecessary back-and-forth cycles, PM Dashboard uses a **three-tier Milestone-Based Review policy**:

| Review Tier | Scope of Changes | Required Validation & Sign-Off | Independent Codex Review Required? |
|---|---|---|---|
| **Tier 1: Developer Self-Validation** | - Routine feature-branch commits and local worktree iterations<br/>- Minor documentation wording/link corrections and dated snapshot refreshes<br/>- Class A read-only conflict simulations (3-argument `git merge-tree`) and Class B local test runs (when local mutation is permitted) | - Developer verifies against actual source files and runs relevant supported test suites.<br/>- No cloud mutation (Class C) permitted. | **NO** *(Do not request independent Codex review after every small edit or routine correction.)* |
| **Tier 2: Control Plane Gate Review** | - Selecting or reordering Integration Waves (Section 2.2)<br/>- Authorizing creation of a Stage 3 isolated integration candidate (`integration/<scope>`)<br/>- Reviewing `CROSS_TRACK_FEATURE_PRESERVATION` (Items A–I) and Release-Specific Dependency Order (Items A–G) for a shared UAT deployment window | - Development Engineer submits concise readiness summary to **ChatGPT Control Plane**.<br/>- Control Plane issues `PASS` / `HOLD` decision. | **OPTIONAL** *(At Control Plane discretion based on conflict complexity.)* |
| **Tier 3: Formal Milestone & Release Gate** | - **Gate A**: Phase F1 + F2 Architecture & Integration Governance closeout<br/>- **Gate B**: Combined multi-track integration candidate ready for shared UAT deployment or `main` merge<br/>- **Gate C**: Production promotion (`main` $\rightarrow$ changed Production surfaces in release-specific dependency order $\rightarrow$ `production-pages` when applicable)<br/>- Any change altering Firestore Security Rules, Callable/PDF authorization logic, `config/deployment-manifest.json`, or `DELIBERATE_PRODUCTION_EXCEPTIONS` | - Full combined validation suite verification (Section 2.1 Item 6).<br/>- **Independent Codex Review** at the milestone boundary.<br/>- **Control Plane** gate sign-off + human **Release Approver** authorization before any Class C command. | **YES (Mandatory at Milestone Boundary)** |
