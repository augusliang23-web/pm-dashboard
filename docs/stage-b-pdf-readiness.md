# Stage B PDF Readiness — Current State

This document intentionally avoids pinning itself to any single PR's commit, reviewer verdict, or blocker
description for anything still in flight, so it does not require a new commit every time an open PR receives
another commit or another reviewer finding. What follows is the current durable state:

1. **PR #17's PDF deployment hardening (the clean-tree and upload-boundary guards in
   `pdf-service/scripts/deploy-pdf.mjs` that Gate B5 depends on) has been independently reviewed and approved,
   and PR #17 has been merged into `main`.** That hardening is now part of the current source lineage this
   branch is built on — see CLOSED below.
2. **The authoritative deployment prerequisite remains Gate B5** in `docs/stage-b-pdf-uat-runbook.md`, not this
   document's summary of PR #17's history.
3. **Gate B5's own verification requirement is unchanged by PR #17's merge**: before Gate B5 may run, the exact
   source commit actually being deployed must still be verified, at execution time, to contain that
   independently reviewed deployment hardening merged in, enforcing clean-tree protection (tracked and untracked
   changes alike) and that gcloud's actual source-upload file set is a subset of the git-tracked file set, with
   its own required CI green on that exact commit. "PR #17 merged into `main` at some point in the past" does
   not by itself satisfy this — the commit actually being deployed still has to be checked. See Gate B5's
   Prerequisites for the full, current wording.
4. **Operators must verify live GitHub/branch state at execution time** — which commit is actually about to be
   deployed, and whether it still carries this hardening unmodified — rather than relying on this document.
5. **Stage B is IN PROGRESS.** Recorded state:
   - B1 PASS, B2 PASS, B3 PASS, B4 PASS.
   - **History (preserved as-is, not current state):** the first B5 attempt STOPPED. Reason: the default Compute
     Engine build identity (`317352278230-compute@developer.gserviceaccount.com`) lacked `storage.objects.get` on
     the uploaded source object, so Cloud Build rejected the request at submission. No Cloud Run service or
     revision was created on that first attempt. No Artifact Registry image was pushed on that first attempt. One
     known failed-attempt source zip remains in the auto-created `run-sources` bucket, as known residue only:
     `gs://run-sources-pm-dashboard-uat-20260820-a7f3-asia-southeast1/services/pm-dashboard-uat-pdf/1790372081.858716-5fec0be009b6460eba9482076842fd4b.zip`.
     Cleanup of that residue remains a later, separately authorized decision, unaffected by anything below.
   - **History (preserved as-is, not current state):** the dedicated UAT build identity
     `pm-dashboard-uat-pdf-build@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com` (`roles/run.builder`,
     distinct from the runtime identity) was recorded in reviewed source ahead of being provisioned, exactly as
     `pdf-service/scripts/deploy-pdf.mjs`'s `assertTargetIsDeployable` and Gate B5's prerequisites required.
   - **Current state:** the B5 retry, using that dedicated build identity, has **PASSED**. The UAT PDF Cloud Run
     service (`pm-dashboard-uat-pdf`) exists, is Ready, and is serving 100% traffic on revision
     `pm-dashboard-uat-pdf-00001-7cv`. The successful-attempt source object is
     `gs://run-sources-pm-dashboard-uat-20260820-a7f3-asia-southeast1/services/pm-dashboard-uat-pdf/1790387540.588248-7478efbb375c4b169977d3d0583f9c9a.zip`.
     The runtime identity `pm-dashboard-uat-pdf@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com` holds
     `roles/datastore.viewer` only and has received no build permissions; the build identity holds
     `roles/run.builder` only and is distinct from the runtime identity, as required.
   - **B6 (read-only deployed-service verification) has PASSED**, independently confirming the above against live
     Cloud Run/Cloud Build/IAM state.
   - **B7 (direct UAT service acceptance) is HOLD**, not because of infrastructure/IAM readiness (B5/B6 both
     PASS), but pending a source-level fix identified during B7-PREP: invalid/expired/revoked Firebase ID tokens
     could fall through to a generic `500` instead of `401` (see `pdf-service/src/auth-error.js`). That source
     fix, once reviewed and merged, still requires a **separately authorized UAT PDF redeploy** and an
     **independent B6-equivalent re-verification of the new revision** before B7 may begin — merging the source
     fix alone does not satisfy this. **SOURCE FIX MERGED ≠ LIVE FIX DEPLOYED.**

## CLOSED

- Source Gate
- Security Gate
- Stage A UAT Hosting
- A2A browser read-only acceptance
- A2B controlled write acceptance
- A2C Function alignment
- Stage A.5 Gantt Callables
- Production Executive governance (PR #18, merged as `472e102`)
- PDF deployment source hardening (PR #17: clean-tree and gcloud-upload-boundary guards in
  `pdf-service/scripts/deploy-pdf.mjs`, plus the Windows real-deploy fail-closed / dry-run-still-supported
  behavior) — independently reviewed, approved, and merged into `main`
- Dedicated build identity: source merge, provisioning, and fresh predeploy lock (Gate B5 prerequisite)
- First UAT PDF Cloud Run deployment (Gate B5) — **PASS**
- Read-only deployed-service verification (Gate B6) — **PASS**

## PENDING

- B7-PREP auth-error-boundary source remediation (this document's companion PR) — review and merge only; no
  deployment
- A separately authorized UAT PDF redeploy carrying the B7-PREP fix, followed by an independent B6-equivalent
  re-verification of the new revision
- Direct service acceptance (Gate B7) — HOLD until the above two items are both complete
- Source URL integration (Gate B8)
- Second UAT Hosting release (Gate B9)
- 36–48 hour soak (Gate B10)
- Stage B closure decision (Gate B11)

## Current source-of-truth state (verified, not asserted)

Running `node scripts/stage-b-pdf-preflight.mjs --phase predeploy` against this repository's current source
returns `OVERALL: PASS`, including:

- `pdf-service/src/targets/registry.json`'s `targets.uat.serviceUrl` is `null`
- `env/uat.json`'s `pdfServiceUrl` is `null`
- both `registry.json` and `env/uat.json` parse as JSON **and** have the required top-level object shape — these
  are checked as two distinct things (`registry-shape-valid`, `env-uat-shape-valid`), not inferred from
  truthiness, so a syntactically valid but wrongly-typed top-level value (e.g. `null`, `false`, an array) fails
  closed rather than silently skipping validation
- UAT and Production identity (Firebase project, service name, runtime service account, allowed origins) are all
  independently well-formed and mutually distinct where required, **and** each independently matches the known,
  anchored expected identity for that environment (not merely "distinct from the other environment") — this
  closes the gap where two coordinated wrong values could otherwise pass every relative check

This is the expected state before Gate B5. If a future run of this same command reports either URL as non-null
before Gate B5 has actually happened, that is configuration drift and must be investigated before proceeding —
do not silently treat it as "someone must have deployed it already."

## Technical Debt Register

| Item | Classification | Basis |
|---|---|---|
| PDF service base image is not digest-pinned (tag `node:24.21.0-bookworm-slim` only) | **NON-BLOCKING** | Deliberate, documented scope decision in PR #17 (avoid expanding that PR into full supply-chain hardening); does not block a correct first UAT deploy |
| apt dependency versions inside the Dockerfile are not pinned | **NON-BLOCKING** | Same category as above; a rebuild could resolve slightly different Debian package versions, but this has been true since before Stage B work began and is not a regression |
| Container runs as root with `--no-sandbox` for Chromium | **FOLLOW-UP** | Documented in the Stage B0.6 audit as a real, but non-urgent, defense-in-depth reduction; not caused by or blocking this pack |
| `pdf-service/deploy.ps1`'s Windows wrapper behavior has not been proven against a real `pwsh` runtime | **FOLLOW-UP** | No PowerShell environment was available in either the authoring sandbox or the existing CI workflow (which only runs `ubuntu-latest`); the wrapper was reviewed statically and by its own regression test (`deploy.ps1 is a thin wrapper that delegates...`), which passed on real CI, but a real-Windows run remains unverified |
| Cloud Functions runtime is still Node 20 | **FOLLOW-UP** | Explicitly out of scope for the PDF Stage B lane per the original B0.5-R2/B0.6 task boundary; a separate migration project |
| The current CI container smoke test (`pdf-tests` job) does not prove authenticated PDF rendering | **BLOCKING for Gate B7, not for merging this pack** | It proves only container startup and basic HTTP behavior (`403`/`404`) in the service's own local mode, as stated plainly in this pack's runbook (Auth/CORS section); real authenticated acceptance can only come from Gate B7 against a live deployed service, which this pack does not and cannot perform |

None of these items are fixed by this PR. They are recorded here so Stage B execution does not silently assume
more coverage exists than actually does.

## Adversarial self-review record (see the accompanying PR description for the full pass)

Before this pack was proposed, the following failure modes were explicitly checked and found not to apply:

- An operator cannot reach a real deploy path with the wrong project: `deploy-pdf.mjs`'s `assertTargetIsDeployable`
  ties project/service/region/service-account together from the registry; this preflight pack adds an
  independent, source-only second check of the same invariants before any deploy is even attempted.
- The shared GitHub Pages browser origin (`https://augusliang23-web.github.io`) appearing in both UAT's and
  Production's `allowedOrigins` is explicitly documented, in both the runbook and the preflight tool's own check
  logic, as expected and not a boundary violation — the real environment boundary is the Firebase-project-bound
  ID token, not Origin uniqueness.
- The runbook explicitly separates B1 (APIs) / B4 (Artifact Registry) / B5 (deploy) into distinct gates specifically
  so an operator cannot combine them into one large, harder-to-audit step.
- The runbook explicitly states that Gate B8 (URL integration) never happens before Gate B7 (acceptance) — an
  unreviewed service URL cannot reach tracked source ahead of acceptance.
- The Auth/CORS section explicitly warns against conflating CORS's `403` with application-authorization's `403`,
  and against citing the current CI container smoke as proof of live authenticated rendering.
- **(Historical, at the time this self-review record was written)** the runbook stated in its own header that
  Stage B was IN PROGRESS (B1–B4 complete, first B5 attempt stopped, B5 retry on HOLD); neither claimed B5 had
  passed, and the soak had NOT begun. **This is no longer the current state** — see the current-state section
  above, which now records B5 PASS, B6 PASS, and B7 HOLD pending the B7-PREP auth-error-boundary source fix and
  its subsequent deployment/re-verification. The soak (B10) still has NOT begun.
