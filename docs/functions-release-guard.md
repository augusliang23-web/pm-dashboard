# Functions release guard (P0)

## Why

S02 R2 was authorised for **24** callable Functions. An unscoped `firebase deploy --only functions` updated **all 25**
managed Functions (including the scheduled `aggregatePresenceSessions`) and moved 13 Functions from Node 20 to 22.
`config/deployment-manifest.json` already says "never an unscoped deployment", but the rule was only prose.

## Model

| Artifact | Meaning |
|---|---|
| `config/deployment-manifest.json` `functionsAllowlist` | **Eligible** for that environment. Not authorisation. |
| `config/release-contracts/<release>.json` | The reviewed, committed approval for **one** release: which Functions, how many, what is excluded. |
| `scripts/deploy-functions.mjs` | The only repository path that builds a Functions deploy command. Dry-run by default. |

```
node scripts/deploy-functions.mjs --env uat --project <firebase-project-id> \
  --contract config/release-contracts/<release>.json            # prints the command, starts nothing
node scripts/deploy-functions.mjs ... --execute                 # starts the Firebase CLI (Production also needs --confirm-production)
```

The wrapper accepts only `--env`, `--project`, `--contract`, `--execute`, `--confirm-production`. It never accepts
`--only`, `--force`, `--except` or any raw Firebase flag, and the only command it can produce is

```
firebase deploy --only functions:nameA,functions:nameB,... --project <id> --message "<releaseId> <sha7>"
```

## Release contract (version 1; every key required, unknown keys rejected)

```json
{
  "contractVersion": 1,
  "releaseId": "s02-uat-24-callables",
  "environment": "uat",
  "firebaseProjectId": "pm-dashboard-uat-20260820-a7f3",
  "sourceSha": "<full 40-character commit that is checked out>",
  "functions": ["...every Function this release may update..."],
  "expectedFunctionCount": 24,
  "exclusions": ["aggregatePresenceSessions"],
  "scheduledFunctionsApproved": [],
  "authorizationRef": "<reference to the Owner authorisation for THIS release>"
}
```

The guard fails closed unless **all** of these hold:

1. Environment and Firebase project are explicit and agree across `--env`, `--project`, the contract and the
   manifest. No inference, no default project, no Production/UAT crossover.
2. The contract file is a tracked file under `config/release-contracts/` (reviewable in git) and the working tree has no
   uncommitted tracked changes.
3. `sourceSha` is a full SHA equal to the checked-out `HEAD`.
4. Every Function name is a plain name (no wildcards, groups, prefixes or lists), is in the manifest allowlist for
   that environment, is not preserved or never-deploy, and is exported by `functions/index.js`.
5. `expectedFunctionCount` equals the number of named Functions.
6. **Every manifest-eligible Function is either named or explicitly listed in `exclusions`.** Nothing can be
   skipped or added silently, which is exactly what R2 got wrong (the 25th Function).
7. A **scheduled** Function (detected as `exports.X = onSchedule(` in `functions/index.js`) can be updated only if it is
   named in both `functions` and `scheduledFunctionsApproved`. A list alone never implies a scheduler update.
8. `authorizationRef` is present. (The guard cannot verify who wrote it; it records that a release approval exists
   and ties it to a reviewed commit.)

The generated argument list is validated a second time by `assertScopedFunctionsDeployArgs`, which also rejects the
unsafe shapes directly: `--only functions`, `--only functions --project <id>`, no `--only`, no `--project`,
`functions:*`, group syntax, extra targets, `--force`, `--except`, `--config`, `--non-interactive`.

## Limitations (read these)

- **A wrapper cannot prevent someone from invoking the Firebase CLI directly.** This guard covers repository-managed
  releases and creates a reviewable approval record. It is not a sandbox and is not enforced for external CLI paths
  (a shell, another tool, the Firebase console). Treat any Functions deploy that did not go through this wrapper as
  out of process.
- The guard does not enumerate live Functions, so it does not prove the live inventory matches the manifest. Keep the
  manifest's "read-only enumerate live Functions first" step.
- `authorizationRef` is a free-text reference; its authenticity is a process matter, not something code can check.
- `buildFunctionsOnlyFlag(manifest, env)` in `scripts/deployment-manifest.mjs` still **defaults to the whole
  allowlist** when called without names (for UAT that includes the scheduler). It is unchanged here because existing
  tests pin it; release tooling must use this guard instead and never call it without an explicit list.
- A Firebase `predeploy` hook cannot see the `--only` argument, so it cannot enforce this either.

## What this does not touch

No Firebase project, IAM, Artifact Registry, Cloud Build, runtime (Node version) or Function configuration is changed
by this guard, and the tests use a mock runner (the real Firebase CLI is never started by tests).
