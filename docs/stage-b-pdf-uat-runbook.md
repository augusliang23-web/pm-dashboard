# Stage B — First UAT PDF Cloud Run Deployment Runbook

Status: **STAGE B NOT STARTED.** This document is a plan for future cloud work. It authorizes nothing by
existing; each gate below still requires an explicit, separate Control Plane decision before its state change is
executed.

Scope: this runbook covers only the **UAT PDF Cloud Run service** (`pm-dashboard-uat-pdf`, project
`pm-dashboard-uat-20260820-a7f3`). It never authorizes any change to the Production PDF service
(`pm-dashboard-pdf`, project `project-manager-dashboar-a067f`), Production Hosting, Production Firestore, or any
Executive Function.

Companion tooling: `scripts/stage-b-pdf-preflight.mjs` (source-only, no cloud access) — run its `predeploy` phase
before B5 and its `postdeploy` phase after B8's config PR, per the gates below. See
`docs/stage-b-pdf-readiness.md` for current overall program status.

## Golden rule: one cloud state change at a time

Every gate below performs **at most one** state-changing action, in this order:

1. **Precheck** — confirm prerequisites, using read-only evidence.
2. **State change** — the one action this gate exists to perform.
3. **Independent verification** — evidence gathered after the change, from a source other than "the command
   exited 0" (a fresh read-only query, a test suite, a probe).
4. **Control Plane decision** — a human (or the process the Control Plane has delegated to) reviews the evidence
   and explicitly says "proceed to the next gate" before it starts.

**Never combine** API enablement, Artifact Registry creation, IAM changes, Cloud Run deployment, URL source
integration, and Hosting deployment into one step, one command, or one PR. Each is its own gate below specifically
so that a mistake in one is caught before the next gate compounds it.

## Hard requirements that apply to every gate

- Every `gcloud` command names its target explicitly with `--project <id>`. No command relies on an ambient
  `gcloud config` default project — a wrong ambient default is exactly the failure mode this rule exists to catch.
- No `firebase deploy` without `--only <specific-target>`. A bare `firebase deploy` or `firebase deploy --only
  functions` is never authorized by this runbook, matching the existing rule already enforced for the dashboard's
  own Functions deployment (`config/deployment-manifest.json`, `scripts/deployment-manifest.mjs`).
- No Production PDF mutation at any point during Stage B. `pdf-service/deploy.ps1` and
  `pdf-service/scripts/deploy-pdf.mjs --target production` are never invoked by this runbook.
- No Production Hosting/frontend cutover. This runbook only ever touches the UAT Hosting site.
- No coupling to Executive Function release. The Executive Functions preserved by PR #18's governance policy
  (`functionsPreserveExisting`) are untouched by every gate below; Stage B and Executive rollout are independent
  decisions.
- No reversal of the Production-to-UAT week sync boundary (`scripts/verify-production-sync-boundary.mjs` must
  still pass unchanged after every gate).
- UAT is validated end-to-end before any Production PDF change is even proposed as a follow-on piece of work.
- Source verification (the preflight tool, this runbook's own evidence requirements) happens **before** any
  URL is integrated into tracked source (B8) — never after.
- Any UAT or Production **business write** (creating/editing a real project, week, or milestone as opposed to a
  synthetic acceptance-test fixture) requires its own separate authorization outside this runbook. This runbook
  authorizes infrastructure and acceptance-testing steps only.

## Gate B1 — Read-only cloud inventory

- **Objective:** establish the actual current state of the UAT GCP project before assuming anything.
- **Prerequisites:** a human with read access to `pm-dashboard-uat-20260820-a7f3`.
- **Allowed state change:** none. This gate is entirely read-only.
- **Exact evidence required:**
  - `gcloud services list --project pm-dashboard-uat-20260820-a7f3 --enabled` — which of Cloud Run, Cloud Build,
    Artifact Registry, IAM, Firestore are already enabled.
  - `gcloud artifacts repositories list --project pm-dashboard-uat-20260820-a7f3 --location asia-southeast1` —
    whether any Artifact Registry repository already exists in the target region.
  - `gcloud iam service-accounts list --project pm-dashboard-uat-20260820-a7f3` — whether
    `pm-dashboard-uat-pdf@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com` already exists.
  - `gcloud run services list --project pm-dashboard-uat-20260820-a7f3 --region asia-southeast1` — confirm no
    `pm-dashboard-uat-pdf` service already exists (if one does, STOP — see below).
- **PASS condition:** all four commands return successfully and their output is recorded in the gate's evidence
  log.
- **STOP condition:** `pm-dashboard-uat-pdf` already exists as a live Cloud Run service. That contradicts this
  runbook's premise (first deployment) and requires a Control Plane decision on how the existing service got
  there before proceeding.
- **Rollback:** not applicable (read-only).
- **Forbidden actions:** creating, enabling, or changing anything.

## Gate B2 — UAT PDF runtime service-account readiness

- **Objective:** confirm (or create) the runtime service account the PDF service will run as, with only the
  documented Firestore role.
- **Prerequisites:** B1 evidence reviewed; Control Plane decision to proceed.
- **Allowed state change:** create the service account
  `pm-dashboard-uat-pdf@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com` **only if B1 showed it does not
  already exist**, and grant it `roles/datastore.viewer` on the UAT project — nothing broader.
- **Exact evidence required:** `gcloud iam service-accounts describe
  pm-dashboard-uat-pdf@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com --project
  pm-dashboard-uat-20260820-a7f3` succeeds; `gcloud projects get-iam-policy pm-dashboard-uat-20260820-a7f3
  --flatten="bindings[].members" --filter="bindings.members:pm-dashboard-uat-pdf@..."` shows exactly
  `roles/datastore.viewer` and no other role bound to this identity.
- **PASS condition:** the service account exists with exactly that one role.
- **STOP condition:** the account already has a broader role (e.g. `roles/datastore.user`,
  `roles/editor`) — do not proceed until that is deliberately corrected as its own reviewed change.
- **Rollback:** delete the service account only if it was created in this gate and nothing else references it
  yet (verified by B1's Cloud Run inventory showing no dependent service).
- **Forbidden actions:** granting any role beyond `roles/datastore.viewer`; creating any other service account;
  touching the Production runtime service account.

## Gate B3 — Required API readiness

- **Objective:** ensure Cloud Run, Cloud Build, and Artifact Registry APIs are enabled **explicitly**, as their
  own reviewed step — never silently, as a side effect of `gcloud run deploy --source`'s `--quiet` flag skipping
  the interactive enablement prompt.
- **Prerequisites:** B1 evidence reviewed.
- **Allowed state change:** `gcloud services enable run.googleapis.com cloudbuild.googleapis.com
  artifactregistry.googleapis.com --project pm-dashboard-uat-20260820-a7f3`, and only for APIs B1 showed were not
  already enabled.
- **Exact evidence required:** re-run `gcloud services list --project pm-dashboard-uat-20260820-a7f3 --enabled`
  and confirm all three now appear.
- **PASS condition:** all three APIs enabled, confirmed by a fresh list call (not just the enable command's exit
  code).
- **STOP condition:** an enable command fails or a required API remains absent after the call.
- **Rollback:** `gcloud services disable <api>` for any API this gate itself enabled, if the decision is made not
  to proceed further. Do not disable an API another workload in the same project already depended on before this
  gate ran (check B1's evidence first).
- **Forbidden actions:** enabling any API not in this exact list; enabling anything on the Production project.

## Gate B4 — Artifact Registry readiness

- **Objective:** create the Artifact Registry repository the deploy will use, with a deliberate retention policy,
  as its own checkpoint — not as an implicit side effect of the first `gcloud run deploy --source` invocation.
- **Prerequisites:** B3 complete.
- **Allowed state change:** create one Docker-format Artifact Registry repository in
  `asia-southeast1` in the UAT project (naming it `cloud-run-source-deploy` matches gcloud's own default and
  avoids surprising later tooling, but the exact name is a Control Plane choice to record here once made), and
  attach a cleanup policy (keep the latest 5 untagged images; do not delete any image referenced by a live
  revision).
- **Exact evidence required:** `gcloud artifacts repositories describe <name> --project
  pm-dashboard-uat-20260820-a7f3 --location asia-southeast1` succeeds and shows the cleanup policy attached.
- **PASS condition:** repository exists with the intended retention policy, confirmed by a fresh describe call.
- **STOP condition:** a repository with a conflicting name/format already exists unexpectedly (per B1) —
  resolve the naming conflict as a Control Plane decision before creating another.
- **Rollback:** delete the repository only while it holds no images referenced by a live Cloud Run revision.
- **Forbidden actions:** creating a repository in any region other than `asia-southeast1`; creating it in the
  Production project.

## Gate B5 — First UAT Cloud Run deployment

- **Objective:** perform the actual first deployment.
- **Prerequisites:** B1–B4 all PASS; `node scripts/stage-b-pdf-preflight.mjs --phase predeploy` returns
  `OVERALL: PASS` against the reviewed source at the exact commit being deployed; working tree clean (per
  `pdf-service/scripts/deploy-pdf.mjs`'s own dirty-tree guard, which this gate relies on unchanged); **and**, as a
  durable precondition independent of any single pull request number, the exact source commit being deployed
  must demonstrably contain a `pdf-service/scripts/deploy-pdf.mjs` deployment-hardening guard that:
  1. has been **independently reviewed and approved** (not merely authored) as its own change, separate from this
     runbook and separate from this gate's own execution;
  2. is **actually merged into the exact commit being deployed** — a guard that exists only on an unmerged branch,
     or on `main` but not yet in the commit this gate is about to deploy, does not satisfy this requirement;
  3. includes a **clean-tree guard**: the deploy refuses to run against a dirty working tree (tracked modified,
     staged, deleted, renamed, *and* untracked paths — not merely tracked changes);
  4. includes an **upload-boundary guard**: the set of files `gcloud run deploy --source .` will actually upload
     is verified to be a subset of the git-tracked file set, so a git-ignored file cannot reach the built image
     undetected by the clean-tree guard above (a `.gitignore`/`.gcloudignore` mismatch is exactly the failure mode
     this closes);
  5. has its own **required CI check green** on that exact commit (not merely "was green once, on some earlier
     commit of the same branch").
  As of this runbook's last update, **PR #17 is the current implementation vehicle** for that guard — but PR #17
  is cited here only as *where the guard currently lives*, not as *the requirement itself*. If PR #17 is
  superseded, split, renumbered, or re-opened as a different PR, this prerequisite is unchanged and still applies
  to whichever commit actually carries the guard; do not treat "PR #17 merged" as sufficient on its own without
  re-confirming, at the time B5 is actually executed, that items 1–5 above hold against the literal commit being
  deployed. See `docs/stage-b-pdf-readiness.md` for the current snapshot of PR #17's own state — that document's
  snapshot can go stale the moment PR #17 gets another commit; this gate's prerequisite does not.
- **Allowed state change:** run
  `node pdf-service/scripts/deploy-pdf.mjs --target uat` (no `--dry-run`). This is the single command that
  performs the build, push, service/revision creation, traffic assignment, and public-invoker grant — it is one
  compound platform action by construction (see the Stage B0.6 audit's Atomicity Finding), which is exactly why
  B1–B4 exist to strip its more surprising implicit side effects (API enablement, registry auto-creation with
  default settings) out into their own reviewed gates first.
- **Exact evidence required:** the command exits 0; `gcloud run services describe pm-dashboard-uat-pdf --project
  pm-dashboard-uat-20260820-a7f3 --region asia-southeast1` shows status Ready, the expected runtime service
  account, and traffic 100% on the new revision.
- **PASS condition:** service Ready with the correct identity, confirmed by the describe call (not merely the
  deploy command's own exit code).
- **STOP condition:** the deploy command fails, or the resulting service does not show the expected runtime SA,
  region, or env vars — do not retry blindly, re-read the failure before a second attempt; **or**, before the
  deploy command is even run, the durable deployment-hardening evidence required above (items 1–5) is absent,
  unmerged into the exact commit being deployed, or unverified. Absence of that evidence is itself a STOP: this
  gate must not proceed to the actual first deployment while it is missing, whatever B1–B4's own state is.
- **Rollback:** if this is genuinely the *first* revision, "rollback" means deleting the Cloud Run service
  entirely (there is no prior revision to fall back to) — `gcloud run services delete pm-dashboard-uat-pdf
  --project pm-dashboard-uat-20260820-a7f3 --region asia-southeast1`. On any *later* Stage-B-adjacent redeploy,
  Cloud Run's normal per-revision traffic rollback applies instead.
- **Forbidden actions:** `--target production`; any manually-assembled `gcloud run deploy` command that bypasses
  `deploy-pdf.mjs` (that bypass is exactly the historical failure mode `deploy.ps1` used to represent); running the
  deploy command at all while the durable deployment-hardening evidence above is absent, regardless of how many
  other gates have otherwise passed.

## Gate B6 — Read-only deployed-service verification

- **Objective:** confirm the deployed service's configuration matches the intended Cloud Run Configuration
  Matrix (below) before any traffic is sent to it deliberately.
- **Prerequisites:** B5 PASS.
- **Allowed state change:** none. Read-only.
- **Exact evidence required:** `gcloud run services describe` output confirming: 1 CPU, 1 GiB memory, timeout
  120s, concurrency 1, min instances 0, max instances 1, ingress all, `--allow-unauthenticated` (public invoker),
  and the exact runtime service account from B2. Also confirm via Cloud Logging that the container's own startup
  log shows no `PdfEnvironmentError` (i.e. `src/environment.js`'s own fail-closed startup validation passed for
  real, not just that the container process is running).
- **PASS condition:** every value matches; no startup error in the logs.
- **STOP condition:** any mismatch — a mismatch here means either the deploy command's arguments were wrong or
  Cloud Run silently applied a platform default this runbook did not intend (see the Stage B0.6 audit's flagged
  gaps: execution environment and CPU-allocation mode were not pinned anywhere in source).
- **Rollback:** same as B5.
- **Forbidden actions:** sending any real request to the service yet — that is B7's job, with its own evidence
  requirements.

## Gate B7 — Direct UAT service acceptance

- **Objective:** prove the live service behaves correctly against real HTTP requests, before any dashboard code
  is pointed at it. See the acceptance matrix in the Auth/CORS and B7 sections below. This gate requires a human
  with a real UAT Firebase login — it cannot be scripted end-to-end from a CI runner.
- **Prerequisites:** B6 PASS.
- **Allowed state change:** none against the service's configuration. The requests themselves are read-heavy
  (PDF generation reads Firestore) but do not write.
- **Exact evidence required:** every row of the B7 acceptance matrix below, each with its actual observed HTTP
  status/behavior recorded.
- **PASS condition:** every row of the matrix behaves as specified.
- **STOP condition:** any row does not match — do not proceed to source integration with a partially-working
  service.
- **Rollback:** not applicable (no state changed).
- **Forbidden actions:** using a Production Firebase ID token against this service, or vice versa (should be
  structurally impossible per `verifyIdToken`'s project binding, but the acceptance matrix explicitly tests this
  rather than assuming it).

## Gate B8 — Source integration of the UAT service URL

- **Objective:** record the accepted service's URL in tracked source, as a small, reviewable, source-only PR —
  never as a manual edit applied directly to a running environment.
- **Prerequisites:** B7 PASS.
- **Allowed state change:** a PR changing exactly two lines: `pdf-service/src/targets/registry.json`'s
  `targets.uat.serviceUrl` and `env/uat.json`'s `pdfServiceUrl`, both set to the exact URL from B5/B6 (obtained
  from `gcloud run services describe`, not retyped from memory).
- **Exact evidence required:** `node scripts/stage-b-pdf-preflight.mjs --phase postdeploy` returns
  `OVERALL: PASS` against the PR's branch; the existing test `tests/hosting-build.test.mjs` /
  `tests/hosting-pdf-endpoint-boundary.test.mjs` suite still passes (these already assert the registry and
  `env/uat.json` must name the same URL).
- **PASS condition:** preflight postdeploy PASS, existing hosting-boundary tests PASS, PR reviewed and merged.
- **STOP condition:** the URL in the two files does not match exactly, or the URL is not HTTPS — the preflight
  tool fails closed on both before this PR could even be proposed as PASS.
- **Rollback:** revert the PR (both values return to `null`) — Hosting simply serves "NOT READY FOR RELEASE" for
  PDF export again, exactly as it does today.
- **Forbidden actions:** editing `env/prod.json` or `registry.json`'s `production` block in this PR; deploying
  Hosting from this PR directly (that is B9's separate step).

## Gate B9 — Second UAT Hosting build/deploy

- **Objective:** publish the integrated source to the UAT Hosting site, from a fresh build of the reviewed,
  merged B8 commit — never by reusing an old `dist/` artifact.
- **Prerequisites:** B8 merged.
- **Allowed state change:** `node scripts/build-hosting.mjs --env uat` followed by
  `node scripts/deploy-hosting.mjs --env uat` (never a bare `firebase deploy`; `deploy-hosting.mjs` already
  scopes to `--only hosting`).
- **Exact evidence required:** the build log's `PDF release ready: true` line (proving `pdfReleaseReady` flipped
  from the current `false`); the Firebase CLI's own deploy success output naming the new Hosting version.
- **PASS condition:** both commands succeed; the new Hosting version is confirmed live via the Firebase console
  or `firebase hosting:channel:list`.
- **STOP condition:** the build reports `PDF release ready: false` (meaning B8 did not actually land as expected)
  — do not deploy a build that still shows the old state.
- **Rollback:** `firebase hosting:rollback` to the prior UAT Hosting version (a manual/console step, matching
  the current UAT baseline this runbook was written against).
- **Forbidden actions:** deploying to `--env prod`; any unscoped `firebase deploy`.

## Gate B10 — 36–48 hour soak

- **Objective:** observe real usage before declaring Stage B closed.
- **Prerequisites:** B9 PASS.
- **Allowed state change:** none (observation only).
- **Exact evidence required (see Soak Gate section below for the full checklist):** normal UAT dashboard PDF
  export working for real users across the window; no unexpected Cloud Run errors in logs; no request in
  Production's logs referencing the UAT origin or vice versa; no Production mutation of any kind; resource usage
  within the expected Cost Guard envelope.
- **PASS condition:** the full soak checklist is satisfied across the full 36–48 hour window.
- **STOP/HOLD condition:** per the Soak Gate criteria below.
- **Rollback:** `firebase hosting:rollback` (as B9) if the soak reveals a user-facing regression; Cloud Run
  service deletion (as B5) only for a service-level failure severe enough to warrant full removal.
- **Forbidden actions:** starting this gate's clock before B9 is actually live; treating a partial or shortened
  window as sufficient.

## Gate B11 — Stage B closure decision

- **Objective:** a single, explicit Control Plane decision that Stage B is done.
- **Prerequisites:** B1–B10 all PASS.
- **Allowed state change:** none — this gate is a decision record, not a technical action.
- **Exact evidence required:** a written closure note referencing each prior gate's evidence, plus an explicit
  statement of what (if anything) remains as follow-up work (see Technical Debt Register in
  `docs/stage-b-pdf-readiness.md`).
- **PASS condition:** Control Plane records Stage B as closed.
- **STOP condition:** any open item from B1–B10 remains unresolved.
- **Rollback:** not applicable.
- **Forbidden actions:** declaring closure while any earlier gate's STOP condition was worked around rather than
  resolved.

## Expected UAT PDF Cloud Run configuration (target, not yet live)

| Setting | Expected value |
|---|---|
| Firebase/GCP project | `pm-dashboard-uat-20260820-a7f3` |
| Service | `pm-dashboard-uat-pdf` |
| Region | `asia-southeast1` |
| CPU | 1 |
| Memory | 1 GiB |
| Timeout | 120s |
| Concurrency | 1 |
| Min instances | 0 |
| Max instances | 1 |
| Ingress | all |
| Authentication | public Cloud Run endpoint (`--allow-unauthenticated`) + application-level Firebase ID-token verification |

These are **expected deployment targets** derived from `pdf-service/src/targets/registry.json` and
`pdf-service/scripts/deploy-pdf.mjs`'s current source. None of them are live yet. Do not present this table as
evidence of a live service — Gate B6 is what produces that evidence.

## Auth / CORS acceptance semantics

The deployed service's own middleware order (`pdf-service/src/server.js`) is: CORS check first, then the
Bearer-token/auth check. This runbook's acceptance testing must respect that order rather than treating a `403`
as proof of anything about authentication:

| Request | Expected result | What it proves |
|---|---|---|
| Bad or missing `Origin` header | `403` (from CORS, before auth ever runs) | CORS is enforcing an exact allow-list; says nothing about auth |
| Allowed UAT `Origin` + missing `Authorization` header | `401` | The auth path is reached and correctly rejects a missing token |
| Allowed UAT `Origin` + invalid/expired token | rejected (auth failure, not `200`) | `verifyIdToken` is actually being called and actually rejects a bad token |
| Allowed UAT `Origin` + valid UAT-project token, authorized role | `200` with a PDF (or HTML for the preview route) | The full authenticated path works end-to-end |

**Do not mistake a `403` for an authentication failure** — it can only ever mean the Origin didn't match, which is
tested and passed in isolation, before the Bearer token is even inspected.

**The current CI container smoke test (in PR #17's `pdf-tests` job) proves only that the built container starts,
binds its port, and returns real HTTP responses (`403` on an unmatched-Origin preflight, `404` on an unregistered
route) in the service's own documented local mode.** It does not exercise a real Firebase project, a real token,
or Firestore, and must never be cited as evidence of authenticated PDF rendering. That evidence can only come from
Gate B7, against the real deployed service.

## Gate B7 direct-service acceptance matrix (to execute at B7, not before)

| # | Check | Evidence |
|---|---|---|
| 1 | Service reports status Ready | `gcloud run services describe` |
| 2 | Expected revision is serving 100% traffic | same |
| 3 | Runtime service account matches B2 | same |
| 4 | Env vars (`PDF_ENVIRONMENT`, `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGIN`) match the registry exactly | `gcloud run services describe --format` on the env section, or Cloud Logging startup line |
| 5 | Wrong/missing Origin → `403` | direct HTTP probe |
| 6 | Allowed Origin + missing Bearer token → `401` | direct HTTP probe |
| 7 | Allowed Origin + invalid token → rejected | direct HTTP probe with a deliberately invalid token |
| 8 | Allowed Origin + valid token, authorized role → `200` | requires a real UAT login |
| 9 | Project report generation succeeds | same, `/v1/reports/project` |
| 10 | Overview report generation succeeds | same, `/v1/reports/overview` |
| 11 | One-pager HTML preview endpoint succeeds | same, `/v1/reports/one-pager-preview` |
| 12 | Firestore access is read-only in practice (no write side effect observed) | inspect the returned data and Firestore state before/after |
| 13 | No Production project is reachable from this service's identity | attempt (in a controlled way) to confirm the runtime SA has no Production IAM binding, per B2's evidence |
| 14 | No cross-environment identity acceptance | a Production-issued token against this UAT URL is rejected (structurally guaranteed by `verifyIdToken`'s project binding, but tested here rather than assumed) |

Items 8–11 require a human with UAT login credentials; they cannot be scripted from an unattended session.

## Future URL integration (Gate B8 detail)

Known current source locations for the UAT PDF service URL:

- `pdf-service/src/targets/registry.json` → `targets.uat.serviceUrl`
- `env/uat.json` → `pdfServiceUrl`

Both must be set to the exact same HTTPS URL, and only after B7 acceptance — never edited speculatively ahead of
a real, accepted deployment. `scripts/hosting-env.mjs`'s existing cross-check already fails the Hosting build
closed if these two ever disagree; Gate B8's own `postdeploy` preflight run is a second, independent check of the
same invariant before the PR is even proposed.

## Future second UAT Hosting release (Gate B9 detail)

After B8 lands, a **new** Hosting build/deploy is required — the existing `dist/` (if any survives from an
earlier, unrelated build) must not be reused blindly. `scripts/build-hosting.mjs --env uat` always rebuilds from
the current source tree, so this is naturally satisfied as long as B9 is actually run rather than skipped. Never
substitute a full unscoped `firebase deploy` for the scoped `deploy-hosting.mjs --env uat`.

## Soak Gate (B10) criteria

- **PASS:** across the full 36–48 hour window — normal UAT dashboard PDF export works for real users; Cloud Run
  logs show no unexpected 5xx; no request in Production's logs references the UAT PDF origin or vice versa; no
  Production mutation of any kind occurred; instance count never exceeded the configured max (1); Cloud Build/
  Artifact Registry cost behavior matches the Cost Guard expectations below (idle when not deploying, one
  service's worth of usage-based Cloud Run cost, no runaway image accumulation).
- **HOLD:** an isolated, already-understood 4xx (e.g. a legitimate auth rejection in the matrix above) — keep
  observing, do not roll back for an expected rejection.
- **STOP/rollback trigger:** any unexplained 5xx correlated with a request that should succeed; any
  `PERMISSION_DENIED` from Firestore (would indicate B2's IAM grant is wrong); any evidence of cross-environment
  request bleed; any Production log entry that shouldn't exist.

This runbook does **not** start a soak, automate one, or claim one has started. B10 is executed only after B9 is
genuinely live.

## Cost Guard (informational, no change authorized here)

| Component | Expected behavior |
|---|---|
| Cloud Run idle (min-instances 0) | Zero cost between requests |
| Cloud Run active | Usage-based, capped by max-instances 1 |
| Cloud Build (per deploy) | Usage-based, only on `deploy-pdf.mjs` invocations |
| Artifact Registry storage | Persistent — the one item that grows unless the B4 retention policy prunes it |
| Logs | Usage-based, expected within free tier at UAT volume |

## Cross-environment guards this runbook relies on (already enforced in source, not re-implemented here)

- `pdf-service/src/environment.js` fails closed at container startup if `PDF_ENVIRONMENT`, `FIREBASE_PROJECT_ID`,
  `ALLOWED_ORIGIN`, or `K_SERVICE` don't all match the registry's UAT target exactly.
- `pdf-service/scripts/deploy-pdf.mjs`'s `assertTargetIsDeployable` ties project/service/region/service-account
  together as one registry-derived unit, and rejects a runtime service account belonging to the wrong Firebase
  project.
- `scripts/hosting-env.mjs` fails the Hosting build closed if `env/uat.json`'s `pdfServiceUrl` doesn't match the
  registry's registered UAT `serviceUrl` exactly.
- `scripts/stage-b-pdf-preflight.mjs` (this PR) adds a source-only, pre-flight-time check of the same invariants,
  runnable before any of the above would otherwise catch a mistake at build or deploy time.

None of these guards are new claims — they are cited here as the mechanisms this runbook's gates rely on, each
already covered by its own existing test suite.
