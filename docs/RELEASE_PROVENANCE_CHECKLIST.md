# PM Dashboard — Release Provenance Checklist & Cloud Run Verification Protocol

**Document Version**: Phase F1 Baseline — Gate A Remediation (2026-10-17)
**Scope**: Mandatory pre-deployment and post-deployment provenance tracking, serving and tagged revision identification, cross-track feature preservation, named Functions governance, and command classification for all UAT (`pm-dashboard-uat-20260820-a7f3`), Production (`project-manager-dashboar-a067f`), and GitHub Pages (`origin/production-pages`) releases.

> **Document Structure & Governance Boundary**:
> - **Part I (Sections 1–5)** defines **Stable Release Provenance & Verification Governance**. These rules apply **only when preparing or verifying a deployment to a shared environment** (UAT or Production). They do **not** restrict independent local development, local worktrees, or routine feature-branch commits/CI.
> - **Part II (Section 6)** records the **Dated UAT Cloud Run PDF Provenance Snapshot (2026-10-16)** and explicitly separates verified Git/manifest comparisons from unverified live container contents (`UNKNOWN — NOT VERIFIED`).

---

# Part I — Stable Release Provenance & Verification Governance

## 1. Core Provenance Governance Rules, Role Responsibilities & Enforcement Boundaries

### 1.1 Provenance Invariants
1. **No Uncommitted or Out-of-Band Cloud Deployments**:
   - Every deployment to UAT or Production (Firebase Hosting, Cloud Run PDF Service, Cloud Functions, or Firestore Rules/Indexes) must originate from a **clean, committed Git checkout** whose exact 40-character Commit SHA is recorded prior to deployment.
   - Deploying synthesized local archives, uncommitted patches, or mixed working trees that do not correspond to a single Git commit SHA creates **Provenance Drift** and risks silent feature regression on subsequent deployments.
2. **Explicit Authorization Gate**:
   - Passing local tests or GitHub Actions CI never authorizes a cloud deployment. Every live deployment (Class C command) requires explicit **Control Plane** gate sign-off and human **Release Approver** authorization of the exact target environment, service, source SHA, release-specific dependency order, cross-track preservation evidence, and rollback reference.

### 1.2 Role Responsibilities in Release Provenance

| Role | Release Provenance Responsibility |
|---|---|
| **Control Plane** | Evaluates candidate SHA readiness, reviews `CROSS_TRACK_FEATURE_PRESERVATION` evidence and release-specific dependency ordering, determines required provenance evidence levels for the gate, and issues `PASS` / `HOLD` decisions. |
| **Development Engineer** | Prepares the candidate commit in an isolated worktree, runs authorized Class A (and, when local mutation is permitted, Class B) verification checks, populates the Release Provenance Checklist (Section 4) and `CROSS_TRACK_FEATURE_PRESERVATION` record (Section 3), and executes Class C deployment commands **only after** explicit approval. |
| **Independent Reviewer** | Audits the completed provenance record, verifies that all active serving revisions (`percent > 0`) and in-scope tagged revisions were inspected via metadata-only queries per Section 2.2, and confirms that Class 1 / Class 2 / Class 3A / Class 3B evidence claims do not overstate what was verified. |
| **Release Approver** | Human operator who reviews the Control Plane decision and completed checklists before granting final execution approval for Class C commands. |

### 1.3 Automated Script Guardrails vs Governance Checklist Requirements
Engineers and reviewers must distinguish between **automated checks already enforced in repository scripts** and **governance checklist controls that require operator/Control Plane verification**:

| Control Surface | Automated Enforcement in Repository Scripts | Governance Checklist & Approval Requirement (Not Enforced Automatically by CLI) |
|---|---|---|
| **Firebase Hosting (`scripts/build-hosting.mjs`, `scripts/deploy-hosting.mjs`)** | Automatically enforces static asset closure (`scripts/hosting-assets.mjs`), `env/<name>.json` target/origin/PDF-registry validation (`scripts/hosting-env.mjs`), opposite-project-ID leak scanning in `dist/` (`assertNoCrossEnvironmentLeak`), tracked dirty-tree rejection (`git status --porcelain --untracked-files=no`), `--confirm-production` flag on `prod`, and `--only hosting --project <projectId>`. | Scripts do **not** know whether the checked-out commit drops another active track's UAT features or whether backend dependencies are already serving. Requires Section 3 (`CROSS_TRACK_FEATURE_PRESERVATION`), release-specific dependency ordering, and Release Approver sign-off. |
| **Cloud Run PDF Service (`pdf-service/scripts/deploy-pdf.mjs`)** | Automatically enforces macOS/Linux platform support (`assertPlatformSupportsRealDeploy`), `--confirm-production` flag on `production`, full working-tree clean check (`git status --porcelain`), `gcloud meta list-files-for-upload` subset check against `git ls-files` (`assertUploadWithinGitTrackedFiles`), and complete `--env-vars-file` replacement from `registry.json` (`--min-instances 0`). | Does **not** prevent an operator from invoking raw `gcloud run deploy` outside `deploy-pdf.mjs`, and does **not** automatically verify cross-track Git ancestry against currently serving revisions. Requires Section 2.2 7-step metadata check and Section 3 checklist. |
| **Cloud Functions & Manifest (`config/deployment-manifest.json`, `scripts/deployment-manifest.mjs`)** | `scripts/deployment-manifest.mjs` provides pure validation and flag-builder functions (`loadDeploymentManifest`, `assertReleasePlan`, `buildFunctionsOnlyFlag`, `buildReleaseFunctionsOnlyFlag`, `assertLiveFunctionInventory`, `assertSnapshotComplete`, `assertBaselineMatchesPinned`, `assertSelectedFunctionsDeployed`, `assertPreservedFunctionsUnchanged`, `assertNonSelectedUnchanged`, `assertFullRollbackVerified`) verified by unit tests (`tests/deployment-manifest.test.mjs`, `tests/production-promotion-v2.test.mjs`). | **`config/deployment-manifest.json` is a governance allowlist only; it does NOT automatically intercept or block arbitrary `firebase` CLI commands run in a shell.** Operators must explicitly assemble named `--only functions:<fn1>,...` arguments from the approved release list, keep Firestore Rules deployments separately scoped, and obtain Release Approver sign-off before execution (Section 5.3). |

---

## 2. Provenance Evidence Classes, Artifact Registry Cost Policy & Cloud Run Revision Identification Protocol

### 2.1 Four Distinct Classes of Provenance Evidence (Never Interchangeable)

When auditing or verifying what is deployed in UAT or Production, engineers must strictly maintain four separate evidence classes and **never treat them as interchangeable**:

| Evidence Class | Definition & What It Proves | What It Does NOT Prove |
|---|---|---|
| **Class 1: Git Source Equivalence** | Cryptographic proof within Git (`git rev-parse`, `git diff`, legacy 3-argument `git merge-tree`, per-file SHA-256 of Git blobs) that a specific branch, commit, or merge tree contains an exact set of source files. | Does **not** prove whether those files were ever built into a container image or deployed to any cloud environment. |
| **Class 2: Preserved Source Manifest Equivalence** | A committed manifest or report (e.g., `docs/rca/pdf-uat-source-preservation.json` in PR #60) recording the SHA-256 hashes of files declared from a baseline archive (`deployedSHA256`) and a patched local candidate (`candidateSHA256`). Proves which Git files match the manifest's declared hashes. | A repository JSON manifest is a **self-reported artifact declaration**. Even 100% (35/35) manifest parity does **not** prove what bytes are currently running inside a live Cloud Run container image or Firebase Hosting release. |
| **Class 3A: Deployed Revision Metadata** | Direct **read-only metadata inspection** of the live cloud control plane and Artifact Registry:<br/>1. Service traffic routing (`status.traffic[]` on Cloud Run Service).<br/>2. Per-revision resource inspection (`gcloud run revisions describe <REVISION_NAME>`) for every serving revision (`percent > 0`) and any in-scope tagged revision.<br/>3. Immutable image digest (`status.imageDigest` / `spec.containers[0].image`) and Artifact Registry metadata (`gcloud artifacts docker images list`, `gcloud artifacts docker tags list`). | Proves which revision(s) and container image digest(s) (`@sha256:...`) are currently reachable or receiving traffic, and their build/registry metadata. **Class 3A is NOT proof of Class 3B** (it does not prove the file-by-file source contents inside the container layers if an image was built from an unversioned archive). |
| **Class 3B: Actual Deployed Image Content** | Direct verification of the actual runtime file contents inside the deployed container image layers (e.g., `/app/src/*` inside the serving image). | Because downloading Artifact Registry image layers to local or external machines is prohibited by `AGENTS.md` cost guardrails (Section 2.2 below), whenever no policy-compliant Class 3B verification mechanism is available, Class 3B must be recorded as **`UNKNOWN — NOT VERIFIED`**. |

### 2.2 Mandatory Artifact Registry Cost Policy (`AGENTS.md` Compliance)

To prevent unexpected Google Cloud billing charges across `pm-dashboard-uat-20260820-a7f3` and `project-manager-dashboar-a067f`, all provenance inspections and release gates must strictly comply with the `AGENTS.md` **GCP Cost & Artifact Registry Guardrails**:

1. **Never Download Container Image Layers from Artifact Registry (`*-docker.pkg.dev`) to Local or External Machines**:
   - Do **not** run `docker pull`, `docker run` (against remote `*-docker.pkg.dev` images), `crane pull`, `skopeo copy`, or any command that downloads or extracts image layers from `asia-southeast1-docker.pkg.dev` (or other regional registries) over the internet.
   - *Rationale*: `pm-dashboard-uat-pdf` / `pm-dashboard-pdf` images bundle Chromium + `fonts-noto-cjk` (~428 MB / `0.418 GiB` compressed). Pulling image layers to a local or external IP incurs non-free **`Artifact Registry Network Internet Egress AsiaPacfic to AsiaPacfic`** charges.
   - Do **not** propose bypassing cost controls to obtain Class 3B evidence.
2. **Standard Provenance Inspection Is Strictly Metadata-Only (Class 3A)**:
   - Use only authorized read-only metadata queries to inspect serving revisions, tagged revisions, and image digests: `gcloud run services describe`, `gcloud run revisions describe`, `gcloud artifacts docker images list`, and `gcloud artifacts docker tags list`.
   - To test PDF rendering locally during development, run `npm --prefix pdf-service run render:samples` (Class B local execution) rather than pulling a remote container image.
3. **Handling Unverified Class 3B Evidence (`UNKNOWN — NOT VERIFIED`) at Release Gates**:
   - **Class 3A is NOT proof of Class 3B.**
   - If no policy-compliant Class 3B verification mechanism is available, always record Class 3B explicitly as:
     **`UNKNOWN — NOT VERIFIED`**
   - Do **not** automatically treat `UNKNOWN — NOT VERIFIED` as sufficient deployment authorization:
     - For **documentation Gate A**, an explicitly recorded `UNKNOWN — NOT VERIFIED` is acceptable to document historical provenance state truthfully.
     - For **future deployment gates**, the required evidence level must be determined by release-specific policy and explicit Control Plane + Release Approver sign-off.
     - If a deployment gate requires provenance assurance that cannot be obtained without violating `AGENTS.md` cost controls, **HOLD the affected deployment** until the Control Plane either approves remediation via a fresh, clean, committed Git deployment (`pdf-service/scripts/deploy-pdf.mjs`) or issues an explicit gate decision.

### 2.3 Three Cloud Run Revision Categories & Mandatory 7-Step Metadata-Only Identification Procedure

> **Critical Rule**: Do **NOT** rely on `spec.template.spec.containers[0].image` or Service-level `metadata.annotations["run.googleapis.com/build-id"]` from `gcloud run services describe` as conclusive proof of what is currently serving in Cloud Run.
> - On a Cloud Run Service resource, `spec.template` defines the **next-revision template** (which can be staged with `--no-traffic` or fail readiness without serving traffic), and Service-level `run.googleapis.com/build-id` annotations can remain stale from an earlier `--source` build when a subsequent revision is deployed via `--image`.
> - Furthermore, Cloud Run supports **split traffic** across multiple revisions simultaneously and **tag-specific URLs** that remain reachable even at `0%` standard traffic.

#### Classification of Cloud Run Revisions
When inspecting a Cloud Run service, distinguish three revision categories:

1. **Category A — Serving Revisions (`percent > 0`)**:
   - Revisions in `status.traffic[]` receiving `>0%` of traffic through the standard service URL (including 100% single-revision routing or multi-revision canary / split-traffic routing).
   - **Verification Requirement**: **Mandatory** for every deployment and provenance audit. Must be inspected individually via `gcloud run revisions describe` to record `(revisionName, trafficPercent, status.imageDigest)`.
2. **Category B — Tagged Revisions (`tag` present in `status.traffic[]`)**:
   - Revisions assigned a traffic tag (`tag: "<name>"`, exposing `url: "https://<tag>---..."`).
   - A tagged revision may receive `0%` of standard service URL traffic (`percent: 0`) and **still be directly reachable** through its tag-specific URL (or it may receive `>0%` standard traffic and belong to both Category A and Category B).
   - **Verification Requirement**: Whenever a tagged URL is active in `status.traffic[]` or within the verification scope of a release/test, operators must inspect the associated revision via `gcloud run revisions describe` and record `(revisionName, tag, tagUrl, trafficPercent, status.imageDigest)`.
3. **Category C — Inactive Historical Revisions (`0%` traffic and no active tag)**:
   - Older revisions returned by `gcloud run revisions list` that receive `0%` of standard service traffic and have no active traffic tag in `status.traffic[]`.
   - **Verification Requirement**: Full metadata inspection is **not** required for every inactive historical revision; only the designated rollback target revision requires pre-deployment verification.

#### Mandatory 7-Step Metadata-Only Identification Procedure
Execute all 7 read-only steps below to identify serving and in-scope tagged revisions accurately without downloading image layers:

1. **Step 1 — Read Service Traffic Configuration (`status.traffic[]`)**:
   - Query `gcloud run services describe <SERVICE_NAME> --region asia-southeast1 --project <PROJECT_ID> --format=json` and inspect `status.traffic[]` and `status.latestReadyRevisionName`.
2. **Step 2 — Identify All Category A (Serving, `percent > 0`) and Category B (Tagged) Revisions**:
   - From `status.traffic[]`, identify:
     - Every entry with `percent > 0` (**Category A — Serving Revisions**), accounting for split-traffic / canary configurations.
     - Every entry with a non-empty `tag` field (**Category B — Tagged Revisions**), even if `percent` is `0` or omitted.
   - If any entry specifies `latestRevision: true` without an explicit `revisionName`, resolve its revision name from `status.latestReadyRevisionName`.
3. **Step 3 — Record Exact Traffic Percentages, Tags, and Tag URLs**:
   - For each identified Category A and Category B entry, record `(revisionName, percent, tag, url)`.
4. **Step 4 — Inspect Each Serving and In-Scope Tagged Revision Individually (`gcloud run revisions describe`)**:
   - For **every** Category A serving revision (`percent > 0`) and every Category B tagged revision in verification scope (plus the designated rollback target revision), run:
     `gcloud run revisions describe <REVISION_NAME> --region asia-southeast1 --project <PROJECT_ID> --format=json`
   - Do not run exhaustive inspections across all other Category C inactive historical revisions.
5. **Step 5 — Resolve the Immutable Image Digest & Build Metadata from the Revision Object**:
   - From each inspected **Revision** JSON object (not the Service template), extract:
     - `status.imageDigest` (the authoritative resolved `sha256:...` digest for that revision)
     - `spec.containers[0].image`
     - `metadata.annotations["run.googleapis.com/build-id"]` and `metadata.annotations["run.googleapis.com/build-source-location"]` (if present on the Revision itself), and optionally cross-check Artifact Registry metadata via `gcloud artifacts docker images list` / `gcloud artifacts docker tags list`.
6. **Step 6 — Record `(revisionName, trafficPercent, tag, imageDigest)` Together**:
   - Record the complete tuple `(revisionName, trafficPercent, tag, status.imageDigest, spec.containers[0].image)` for every serving and in-scope tagged revision in the provenance checklist (Section 4).
7. **Step 7 — Separate Deployed Revision Metadata (Class 3A) from Actual Deployed Image Content (Class 3B)**:
   - Completing Steps 1–6 establishes **Class 3A (Deployed Revision Metadata)**.
   - Because `AGENTS.md` strictly prohibits pulling or extracting container image layers from Artifact Registry to local or external machines, **do not run `docker pull` or download image layers**. Unless a policy-compliant Class 3B mechanism is used, record Class 3B as **`UNKNOWN — NOT VERIFIED`**, and evaluate release gate readiness under Section 2.2 Item 3.

---

## 3. CROSS_TRACK_FEATURE_PRESERVATION (Mandatory for Shared-Environment Deployments)

> **Scope Boundary — Protects Parallel Development Without Blocking Local Work**:
> - This requirement applies **strictly when deploying to shared singleton environments** (UAT Firebase Hosting, UAT Cloud Run PDF Service, UAT Cloud Functions/Rules, Production Firebase Hosting, Production Cloud Run PDF Service, Production Cloud Functions/Rules, or `production-pages`).
> - It **never** blocks independent local development, local worktree creation, local builds/tests, or feature-branch GitHub Actions CI. Active development tracks do **not** need to stop or merge into `main` to continue their own branch work.
> - However, before any candidate branch or commit is deployed to a shared environment currently hosting features from another active track, the deployment must verify that currently deployed features are preserved (unless their removal or rollback is explicitly approved by the Control Plane and Release Approver).

Every shared-environment deployment request must complete items **A through I** below:

| Item | Field | Required Verification & Evidence | Recorded Value |
|---|---|---|---|
| **A** | **Target Deployment Surface** | Exact shared surface (`uat-hosting`, `uat-cloud-run-pdf`, `uat-functions`, `uat-firestore-rules`, `prod-hosting`, `prod-cloud-run-pdf`, `prod-functions`, `prod-firestore-rules`, or `github-pages`) and GCP Project ID. | |
| **B** | **Currently Deployed Feature Tracks** | Identify all feature tracks currently active on the target surface (resolved via Section 2.3 metadata-only inspection for Cloud Run or active release metadata for Hosting/Functions), including their source PR(s) and commit SHA(s). | |
| **C** | **Candidate Feature Tracks** | Identify the feature track(s), PR number(s), and exact 40-character candidate Git commit SHA proposed for deployment. | |
| **D** | **Existing Features That Must Remain** | Enumerate the user-facing and backend behaviors currently active on the target surface from Item B that must remain functional after deploying Item C (e.g., V2.3 Delivery Performance PDF section + PR #60 attention/risk-pagination fixes on `pm-dashboard-uat-pdf`). | |
| **E** | **Evidence That Candidate Preserves Those Features** | Provide Class 1 Git ancestry/diff proof (`git merge-base --is-ancestor`, `git diff`, or committed integration branch SHA) demonstrating that the candidate commit in Item C includes all required files and flags from Item D without regression. | |
| **F** | **Required Integration & Surface Validation Tests** | Exact supported validation commands from `.github/workflows/ci.yml` / `package.json` executed against the candidate commit SHA and their actual pass/fail counts:<br/>- **Frontend & Functions Unit/Contract**: `npm run test:all` (and/or standalone `npm --prefix functions test`)<br/>- **Firestore Rules**: `npm run test:rules` (`test:rules:prod`, `test:rules:uat`, `test:rules:shared-backend`)<br/>- **PDF Service**: `npm --prefix pdf-service test` (`node scripts/run-tests.mjs` in `pdf-service/`) and dry-runs `node pdf-service/scripts/deploy-pdf.mjs --target <uat|production> --dry-run`<br/>- **Sync Boundary**: `npm run verify:sync-boundary`<br/>- **Hosting Build**: `npm run build:hosting:prod` (`node scripts/build-hosting.mjs --env prod`) and `npm run build:hosting:uat` (`node scripts/build-hosting.mjs --env uat`)<br/>*(Never invent nonexistent scripts or claim an unexecuted test suite has passed.)* | |
| **G** | **Explicitly Approved Feature Removals (If Applicable)** | `NONE`, or an explicit list of features from Item B intentionally removed/disabled in this deployment together with the Control Plane + Release Approver sign-off reference. | |
| **H** | **Release-Specific Dependency Order & Rollback Compatibility** | Record the release-specific deployment order (evaluating changed components, dependents, backward compatibility, and authorization boundaries) and confirm that rolling back to the previous revision/version (`Item B`) remains compatible with current Firestore data schemas, Rules, and companion surfaces. | |
| **I** | **Deployment Approval Status** | `HOLD` / `APPROVED` — requires Control Plane gate status + human Release Approver sign-off before executing any Class C deployment command. | |

---

## 4. Mandatory Release Provenance Checklist (Template)

Complete this table (together with Section 3 `CROSS_TRACK_FEATURE_PRESERVATION`) in the release runbook **before** requesting deployment execution, and fill in the post-deployment verification rows immediately after execution:

| # | Provenance Field | Requirement / Validation Rule | Recorded Value |
|---|---|---|---|
| 1 | **Environment** | `uat` (`pm-dashboard-uat-20260820-a7f3`) or `production` (`project-manager-dashboar-a067f` / `production-pages`) | |
| 2 | **Service / Surface** | `hosting`, `cloud-run-pdf`, `functions` (with explicit approved function-name list), `firestore-rules` (separately scoped), or `github-pages` | |
| 3 | **Source Commit SHA** | Full 40-char Git SHA (`git rev-parse HEAD`). Working tree must be clean (`git status --porcelain` empty). Out-of-band unversioned archives are prohibited. | |
| 4 | **Source Repository & Branch** | Repository URL, branch name, and PR number(s) included in the commit ancestry. | |
| 5 | **Build Artifact Identity** | - **Hosting**: `dist/` file count + `env-config.js` target check<br/>- **PDF**: Cloud Build ID (`projects/.../builds/...`) & GCS source object generation (`gs://...#<generation>`)<br/>- **Functions**: Explicit approved function names + `deployment-manifest.json` `sourceTreeDigest` / `sourceZipSha256` | |
| 6 | **Serving & Tagged Revision(s), Traffic Split & Image Digest(s)** *(Cloud Run / Functions Gen 2)* | Resolved via the **7-Step Metadata-Only Procedure (Section 2.3)**: for every Category A serving revision (`percent > 0`) and any in-scope Category B tagged revision (`tag` present in `status.traffic[]`), record `(revisionName, trafficPercent, tag, status.imageDigest)` from `gcloud run revisions describe <REVISION_NAME>` (never rely solely on Service `spec.template.spec.containers[0].image` or Service-level `run.googleapis.com/build-id`). | |
| 7 | **Feature Flags** | Explicit state of environment flags:<br/>- `pdf-service/src/targets/registry.json` (`deliveryPerformanceSection`)<br/>- `js/overview-pdf-selection.mjs` (`DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED`)<br/>- `env/<env>.json` (`dashboardProfile`, `pdfServiceUrl`) | |
| 8 | **Previous Deployed Version** | - **Cloud Run**: All previously serving (`percent > 0`) and active tagged `(revisionName, trafficPercent, tag, status.imageDigest)` tuples<br/>- **Hosting**: Current serving `versionName` (`sites/<site>/versions/<id>`) & release time<br/>- **Functions**: Current revision names per function (for both selected and preserved functions)<br/>- **Rules**: Current active `rulesetId` | |
| 9 | **Release-Specific Order & Rollback Reference** | Confirmed release-specific deployment order, rollback order, and exact pre-verified command to restore the previous version(s) and traffic split (e.g., `gcloud run services update-traffic ... --to-revisions=<prev>=100` or full baseline redeploy for Functions per `deployment-manifest.json`). Verify that the rollback target does not contain a known blocker defect. | |
| 10 | **Cross-Track Preservation & Deployment Approval** | Completed Section 3 (`CROSS_TRACK_FEATURE_PRESERVATION` Items A–I) + Control Plane gate decision + explicit human Release Approver timestamp. | |
| 11 | **Verification Result** | Post-deploy verification:<br/>1. **Class 3A**: Per-revision `gcloud run revisions describe` confirms expected `(revisionName, trafficPercent, tag, status.imageDigest)`<br/>2. **Class 3B**: Actual deployed image content status (`UNKNOWN — NOT VERIFIED` unless a policy-compliant mechanism was used; never pull image layers from Artifact Registry)<br/>3. Smoke / acceptance checklist result (`PASS` / `ROLLED_BACK`) | |

---

## 5. Operational Command Classification (Class A / Class B / Class C) & Named Functions Policy

All inspection, build, test, dry-run, and deployment commands are strictly classified into three operational classes. **Never list Class B or Class C commands inside a strictly read-only (Class A) audit section, and never pull container image layers from Artifact Registry.**

### 5.1 CLASS A — Strictly Read-Only Commands (Zero Local or Remote State Mutation)
Safe to execute during strictly read-only repository and cloud metadata audits. These commands do **not** modify working tree files, `dist/`, `os.tmpdir()`, `.git/refs`, `.git/objects`, or remote cloud state, and do **not** download container image layers:

```bash
# A1. Verify clean local Git checkout & exact 40-character SHA (Local read-only)
git status --porcelain
git rev-parse HEAD

# A2. Inspect local/fetched branch refs and run in-memory 3-way merge check
# (Legacy 3-argument git merge-tree is Class A read-only; it writes zero Git objects)
git for-each-ref --no-merged=origin/main --sort=-committerdate refs/remotes/origin/ \
  --format='%(committerdate:short) | %(refname:short) | %(objectname) | %(subject)'
git merge-tree $(git merge-base <REF_A> <REF_B>) <REF_A> <REF_B>

# A3. Step 1–3 of Cloud Run 7-Step Metadata Procedure: Read Service traffic array & latestReadyRevisionName (Cloud control-plane metadata read-only)
gcloud run services describe <SERVICE_NAME> \
  --region asia-southeast1 \
  --project <PROJECT_ID> \
  --format="json(metadata.name,metadata.generation,metadata.annotations,spec.template.metadata.name,spec.template.spec.containers[0].image,status.latestReadyRevisionName,status.traffic)"

# A4. Step 4–6 of Cloud Run 7-Step Metadata Procedure: Inspect each Category A serving revision (percent > 0) and in-scope Category B tagged revision individually for authoritative status.imageDigest (Cloud control-plane metadata read-only)
gcloud run revisions describe <REVISION_NAME> \
  --region asia-southeast1 \
  --project <PROJECT_ID> \
  --format="json(metadata.name,metadata.annotations,spec.containers[0].image,spec.containers[0].env,spec.serviceAccountName,status.conditions,status.imageDigest)"

# A5. List recent Cloud Run revisions or Artifact Registry image/tag metadata without pulling layers (Cloud metadata read-only)
gcloud run revisions list \
  --service <SERVICE_NAME> \
  --region asia-southeast1 \
  --project <PROJECT_ID> \
  --limit 10
gcloud artifacts docker images list \
  asia-southeast1-docker.pkg.dev/<PROJECT_ID>/cloud-run-source-deploy/<SERVICE_NAME> \
  --include-tags
gcloud artifacts docker tags list \
  asia-southeast1-docker.pkg.dev/<PROJECT_ID>/cloud-run-source-deploy/<SERVICE_NAME>
```

### 5.2 CLASS B — Commands Modifying Local State Only (Use Only When Local-State Modification Is Permitted)
These commands do **not** mutate remote cloud services, but they **do** mutate local filesystem directories (`dist/`, `os.tmpdir()`), spawn local emulators/processes, or write local `.git` refs/objects. **Do not run Class B commands during a strictly read-only audit; use Class B only when local-state modification is permitted:**

```bash
# B1. Fetch remote refs or run modern merge-tree --write-tree (Mutates local .git/refs or writes tree/blob objects to .git/objects)
git fetch origin --prune
git merge-tree --write-tree <REF_A> <REF_B>

# B2. Supported validation & test suites (.github/workflows/ci.yml & package.json)
npm run test:all
npm --prefix functions test
npm run test:rules
npm run verify:sync-boundary
npm --prefix pdf-service test
npm --prefix pdf-service run render:samples

# B3. Hosting build & Hosting deploy dry-run (Deletes and rewrites local ./dist/ directory via buildHosting())
npm run build:hosting:uat
npm run build:hosting:prod
npm run deploy:hosting:uat:dry
npm run deploy:hosting:prod:dry

# B4. PDF deploy dry-run (Creates and removes a temporary directory and env.yaml in local os.tmpdir() via mkdtemp())
node pdf-service/scripts/deploy-pdf.mjs --target uat --dry-run
node pdf-service/scripts/deploy-pdf.mjs --target production --dry-run
```

### 5.3 CLASS C — Commands Modifying Remote or Cloud State (Require Explicit Release Approval & Named Scope)
These commands mutate shared remote repositories or live UAT/Production cloud infrastructure and are **strictly prohibited** without completed Section 3 & Section 4 checklists, Control Plane gate `PASS`, and explicit human Release Approver authorization:

#### Mandatory Policy for Named Functions & Separately Scoped Firestore Rules Deployment
1. **Named Function Deployment Only**:
   - Never run an unscoped `firebase deploy --only functions` or a combined `firebase deploy --only functions,firestore:rules`.
   - Every Functions deployment must specify an **explicit, approved function-name list** for that release (`firebase deploy --only functions:<fn1>,functions:<fn2> --project <PROJECT_ID>`, assembled via `buildFunctionsOnlyFlag()` / `buildReleaseFunctionsOnlyFlag()` in `scripts/deployment-manifest.mjs`).
2. **Preservation of Unrelated Existing Functions**:
   - Unrelated live Functions — including `functionsPreserveExisting` in Production (the 8 Executive Milestone Callables) and `untouchedManagedFunctions` not included in the release's approved subset — must be treated as preserved (`assertPreservedFunctionsUnchanged` / `assertNonSelectedUnchanged`) and must never be deployed, overwritten, or treated as cleanup targets.
3. **Separately Scoped Firestore Rules Deployment**:
   - Firestore Rules must be deployed in a dedicated, separately scoped step pointing to the environment's authoritative Firebase config (`firebase.json` for Production `firestore.rules`, or `firebase.uat.json` for UAT `firestore.uat.rules`), ordered relative to Functions according to the release-specific dependency analysis (see `docs/MULTI_TRACK_INTEGRATION_GOVERNANCE.md` Section 2.1 Item 7).
4. **Role of `config/deployment-manifest.json` (Governance Allowlist)**:
   - `config/deployment-manifest.json` is the repository's source-of-truth **governance allowlist** (`functionsAllowlist`, `functionsPreserveExisting`, `functionsNeverDeploy`) and release plan definition. Being listed in `functionsAllowlist` does **not** authorize deploying every managed Function; each release names its reviewed subset.
   - Furthermore, **`config/deployment-manifest.json` does NOT automatically block arbitrary Firebase CLI commands executed directly in a shell**. Operators must validate live function inventories against `scripts/deployment-manifest.mjs` and obtain explicit release approval before running any Class C command.

```bash
# C1. Live Hosting or PDF Cloud Run deployment (Requires Release Approver authorization)
node scripts/deploy-hosting.mjs --env <uat|prod> [--confirm-production]
node pdf-service/scripts/deploy-pdf.mjs --target <uat|production> [--confirm-production]

# C2. Cloud Run traffic routing / rollback mutation
gcloud run services update-traffic <SERVICE_NAME> \
  --region asia-southeast1 \
  --project <PROJECT_ID> \
  --to-revisions=<REVISION_NAME>=100

# C3. Named Firebase Functions deployment (ONLY explicitly approved function names; never bare `--only functions`)
firebase deploy --only functions:<approvedFn1>,functions:<approvedFn2> --project <PROJECT_ID>

# C4. Separately scoped Firestore Rules deployment (Scoped to environment config; never bundled with unscoped functions)
firebase deploy --only firestore:rules --config <firebase.json|firebase.uat.json> --project <PROJECT_ID>

# C5. Remote Git push or PR merge
git push
gh pr merge
```

---

# Part II — Dated Operational Snapshot

## 6. UAT Cloud Run PDF (`pm-dashboard-uat-pdf`) Provenance Snapshot (Dated: 2026-10-16)

> **Operational Snapshot Notice**: This section records the point-in-time investigation of `pm-dashboard-uat-pdf` from **2026-10-16**, with explicit separation of verified Git/manifest comparisons (Classes 1 & 2), prior Service-level cloud metadata observations (Class 3A partial), and unverified actual deployed image content (Class 3B `UNKNOWN — NOT VERIFIED`).

### 6.1 Summary of Evidence Status by Class (As of 2026-10-17 Gate A Remediation)

| Verification Dimension | Evidence Class | Current Verification Status | Technical Basis & Limitations |
|---|---|---|---|
| **Git Branch & 3-Way Merge Source Comparison** | **Class 1: Git Source Equivalence** | **VERIFIED (Local Git)** | Computed directly from fetched Git commit objects for PR #57 (`7c02e7f`), PR #58 (`0ad9293`), and PR #60 (`a560292`) via 3-argument `git merge-tree` (Class A). |
| **PR #60 Preserved-Source Manifest (`docs/rca/pdf-uat-source-preservation.json`)** | **Class 2: Preserved Source Manifest Equivalence** | **VERIFIED (35/35 Manifest Hashes Match Git)** | All 35 `deployedSHA256` entries match PR #58 (`0ad9293`), and all 35 `candidateSHA256` entries match the 3-way merge of PR #58 (`0ad9293`) + PR #60 (`a560292`). **Does NOT prove live container image content parity.** |
| **Live Cloud Run Serving Revision & Per-Revision Digest** | **Class 3A: Deployed Revision Metadata** | **PARTIALLY OBSERVED ON 2026-10-16; NOT RECONFIRMED IN THIS REVIEW** | On 2026-10-16, Service-level `gcloud run services describe` reported `latestReadyRevisionName: pm-dashboard-uat-pdf-pr60-a560292` (`percent: 100`, no traffic tags) and Service `spec.template.spec.containers[0].image` digest `@sha256:e82b2daac93379a3ecf376b187d706884b3bb87d87dddd36ffd6c31354311f9b`. However, per-revision `gcloud run revisions describe pm-dashboard-uat-pdf-pr60-a560292` (`status.imageDigest`) was not captured separately, and live cloud metadata was **not** re-queried during the 2026-10-17 documentation remediation. **Class 3A is NOT proof of Class 3B.** |
| **Actual Deployed Image Content (`/app/src/*`)** | **Class 3B: Actual Deployed Image Content** | **`UNKNOWN — NOT VERIFIED`** | Per `AGENTS.md` Artifact Registry cost policy (Section 2.2), downloading container image layers from `asia-southeast1-docker.pkg.dev` to local or external machines is prohibited. Because no policy-compliant Class 3B verification mechanism is available for `@sha256:e82b2daac93379a3ecf376b187d706884b3bb87d87dddd36ffd6c31354311f9b`, Class 3B is explicitly recorded as **`UNKNOWN — NOT VERIFIED`**. |

### 6.2 Detailed Breakdown of Prior Observations & Remaining Provenance Gaps

1. **Class 1 (Git Source Equivalence) & Class 2 (Preserved Source Manifest Equivalence)**:
   - Comparing the 35 file entries declared in `origin/codex/pdf-attention-consistency-hotfix:docs/rca/pdf-uat-source-preservation.json` against local Git objects proves:
     - **35 of 35 `deployedSHA256` hashes** (declared as representing revision `pm-dashboard-uat-pdf-00006-tg8`) match `origin/claude/v23-uat-backend-activation` (PR #58, `0ad92930682d86fb009b1a3f9bcbb0e669c348cd` / code commit `7cc502ddbdd9649d757cd96b6f918737bdfe3665`) byte-for-byte. (In PR #57 `7c02e7f`, 34 of 35 files match, with only `src/targets/registry.json` differing because `deliveryPerformanceSection` is `false` in PR #57 and `true` in PR #58.)
     - **35 of 35 `candidateSHA256` hashes** match the in-memory 3-way merge of **PR #58 (`0ad9293`) + PR #60 (`a560292`)** byte-for-byte (`33` unchanged files from PR #58 + `src/measured-paginator.js` and `src/report-model.js` patched by PR #60).
   - **Why 35/35 Manifest Parity Is Not Container Proof**: `docs/rca/pdf-uat-source-preservation.json` is a committed repository file (Class 2). Matching its declared SHA-256 table against Git blobs proves what the manifest author recorded locally, not what bytes exist inside the Artifact Registry image running in Cloud Run.
2. **Point-in-Time Cloud Run Service Observation (Recorded 2026-10-16)**:
   - A Service-level query (`gcloud run services describe pm-dashboard-uat-pdf --region asia-southeast1 --project pm-dashboard-uat-20260820-a7f3 --format=json`) executed on **2026-10-16** reported:
     - **Service URL**: `https://pm-dashboard-uat-pdf-b266ahac7q-as.a.run.app` (Generation `9`)
     - **Traffic Routing (`status.traffic`)**: `100%` routed to `latestRevision: true` (`status.latestReadyRevisionName: pm-dashboard-uat-pdf-pr60-a560292`, Ready at `2026-10-16T03:23:11.457413Z`)
     - **Service Template Image (`spec.template.spec.containers[0].image`)**: `asia-southeast1-docker.pkg.dev/pm-dashboard-uat-20260820-a7f3/cloud-run-source-deploy/pm-dashboard-uat-pdf@sha256:e82b2daac93379a3ecf376b187d706884b3bb87d87dddd36ffd6c31354311f9b`
     - **Prior Revisions Referenced in Repo Docs**: `pm-dashboard-uat-pdf-00006-tg8` (documented in PR #60 `docs/rca/pdf-attention-consistency.md` with `@sha256:a421faf4f5ccaeec0c9756968ad32693e155742858b471f95b3f73870889bf47` and Cloud Build `a45db0d7-169d-4b4c-99a5-6c0f3a134c3d`) and `pm-dashboard-uat-pdf-00005-z6z` (documented in PR #58 `UAT_RELEASE_RUNBOOK.md` on 2026-10-15).
3. **Three Explicit Provenance Gaps & Gate Disposition Rules**:
   - **Gap 1 — No Single Backing Git Commit SHA**: Revision `pm-dashboard-uat-pdf-pr60-a560292` was deployed from an out-of-band composite archive combining PR #58 (`0ad9293`) and PR #60 (`a560292`). Neither branch alone contains that complete source tree.
   - **Gap 2 — Stale Service-Level Build Annotations & Unreconfirmed Revision Object**: On Generation 9 of `pm-dashboard-uat-pdf`, Service-level `run.googleapis.com/build-id` (`a45db0d7-...`) still pointed to revision `00006-tg8`'s build because `pr60-a560292` was deployed via `--image`. Before the next UAT PDF deployment, an operator must run the full 7-step metadata-only procedure in Section 2.3 (including `gcloud run revisions describe pm-dashboard-uat-pdf-pr60-a560292`) to confirm live traffic and revision-level `status.imageDigest`.
   - **Gap 3 — Class 3B Actual Deployed Image Content Is `UNKNOWN — NOT VERIFIED`**: Because downloading Artifact Registry image layers is prohibited by `AGENTS.md`, the actual container layer contents of `@sha256:e82b2daac93379a3ecf376b187d706884b3bb87d87dddd36ffd6c31354311f9b` are recorded as **`UNKNOWN — NOT VERIFIED`**. While acceptable for documentation Gate A, `UNKNOWN — NOT VERIFIED` does **not** automatically authorize future deployments; if a future deployment gate requires verified provenance for `pm-dashboard-uat-pdf`, **HOLD the affected deployment** until the Control Plane and Release Approver authorize replacing the out-of-band revision with a clean, committed Git deployment built from an integrated candidate SHA (`PR #58 + PR #60`).
