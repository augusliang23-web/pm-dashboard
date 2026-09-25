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
5. **Stage B remains NOT STARTED.** No UAT PDF Cloud Run service exists. Gate B5 has not run and has not
   passed. No cloud action of any kind has been taken by this document, the preflight tool, or the runbook it
   accompanies.

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

## PENDING

- This Stage B UAT PDF preflight pack's own review and merge
- Stage B cloud preflight (Gates B1–B4 in `docs/stage-b-pdf-uat-runbook.md`)
- First UAT PDF Cloud Run deployment (Gate B5)
- Direct service acceptance (Gate B7)
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
- The Auth/CORS section explicitly warns against mistaking a `403` (CORS) for an auth failure, and against citing
  the current CI container smoke as proof of live authenticated rendering.
- The runbook states in its own header that Stage B is not started by its existence, and the readiness document
  above states the same; neither claims a soak has begun.
