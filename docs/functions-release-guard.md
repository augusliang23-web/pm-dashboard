# Functions release guard (P0, v2)

## Why

S02 R2 was authorised for **24** callable Functions. A Firebase CLI deploy with a bare `--only functions` scope
updated **all 25** managed Functions (including the scheduled `aggregatePresenceSessions`) and moved 13 Functions from
Node 20 to 22. `config/deployment-manifest.json` already says "never an unscoped deployment", but nothing enforced it.

## What changed in v2 (independent review found three design blockers)

| Blocker | v1 | v2 |
|---|---|---|
| Approval was free text (`authorizationRef`) | any non-empty string passed | An **Ed25519 signature** by an Owner-controlled key over the exact release payload, verified against a **pinned, root-owned trust anchor**. No anchor or no valid signature => `--execute` fails closed. |
| The contract had to contain the SHA of its own commit | circular | The approval is a **separate artifact created after the source commit exists** and stored **outside** the repository. A commit never contains its own SHA. |
| Untracked files could enter the upload | deployed from the working tree | The package is **rebuilt from the approved commit's tree** into a private temp directory, verified against the tree, and the Firebase CLI runs against **that** directory. |

## Model

| Artifact | Meaning |
|---|---|
| `config/deployment-manifest.json` allowlist | **Eligible**. Not authorisation. |
| Source commit (frozen after independent QA) | **What** may be released. |
| Owner-signed approval (outside the repo) | **Authorisation** for exactly this commit/tree, environment, project, Function list, count, exclusions and validity window. |
| Trust anchor (root-owned file outside the repo) | The public key(s) that make a signature count. |
| `scripts/deploy-functions.mjs` | The only repository path that builds a Functions deploy command. Dry-run by default. |

The signed payload (`contractVersion: 2`; every key required, unknown keys rejected, name lists canonically sorted):
`releaseId, environment, firebaseProjectId, sourceSha, sourceTree, functions, expectedFunctionCount, exclusions,
scheduledFunctionsApproved, notBefore, expiresAt` (window at most 14 days). Changing any field invalidates the signature.

## Rules enforced before anything runs

1. The approval file exists, is **outside the repository**, and is exactly `{schema, payload, keyId, signature}` (no free-text fields).
2. The trust anchor is an absolute path outside the repository, a regular file (no symlink), **owned by root, not
   group/other-writable, in a root-owned non-writable directory**, and lists only Ed25519 keys whose `keyId` equals the key fingerprint.
3. The signature verifies for a key in the anchor over the canonical payload.
4. The approved **source commit exists locally**; the manifest, `functions/index.js` and `firebase.json` are read **from that commit**.
5. `sourceSha` equals the checked-out `HEAD`, `sourceTree` equals that commit's tree, and there are no uncommitted tracked changes.
6. Environment and Firebase project are explicit and agree across `--env`, `--project`, the payload and the manifest (no Production/UAT crossover).
7. Every Function is a plain name, is in that environment's allowlist, is not preserved/never-deploy, is exported by `functions/index.js`, and the count matches.
8. **Every eligible Function is either named or explicitly excluded.**
9. A **scheduled** Function is only updated if it is in both `functions` and `scheduledFunctionsApproved`.
10. The approval is inside its validity window.
11. Production `--execute` additionally needs `--confirm-production`.
12. The generated argument list is re-validated: individually named `functions:<name>` only, one explicit `--project`, no `--force`, `--except`, wildcards or other targets.

## Immutable source package

`git ls-tree` of the approved tree under `firebase.json` and `functions/` is the **only** input. Every blob is written into a
fresh `0700` temp directory (`pmdash-functions-package-*`); symlinks, submodules, odd paths and `.git` segments in the commit
are refused; `firebase.json` must keep `functions.source = "functions"` and may not define `predeploy`/`postdeploy` hooks.
The export is re-read and must equal the tree (paths, object ids, no extra files, no links); the approval file name must not
appear in it. Dependencies are installed **inside the package** with `npm ci --ignore-scripts`; the Firebase CLI runs with the package as
its working directory. The user's working tree is never modified or cleaned, and only the package directory this tool created is removed.

## Commands

```
# Agent (read-only): derive an UNSIGNED plan from the frozen commit and print its digest for the Owner.
node scripts/release-approval-cli.mjs plan --env uat --project <id> --source-sha <40-hex> --functions a,b,c --release-id <id> [--hours 24] [--approve-scheduled name] [--out plan.json]

# Owner only, on an Owner-controlled device (the Agent must never hold the key):
node scripts/release-approval-cli.mjs sign --plan plan.json --key /secure/owner.pem --out /secure/approval.json --expect-digest <digest the Owner reviewed>

# Guard (dry-run by default; --execute starts the tools; Production also needs --confirm-production):
node scripts/deploy-functions.mjs --env uat --project <id> --approval /secure/approval.json [--trust-anchor <root-owned file>] [--execute]
```

## Required Owner bootstrap (one time) — until done, `--execute` stays blocked

1. On an Owner-controlled device create an Ed25519 key pair. Keep the private key offline or hardware-backed. **Never** put it in this
   repository, a CI secret an agent can read, or any agent-accessible path; **an agent must never sign its own release**.
   `openssl genpkey -algorithm ed25519 -out owner-release-key.pem && openssl pkey -in owner-release-key.pem -pubout -out owner-release-key.pub.pem`
2. Produce the trust-anchor file from the PUBLIC key: `node scripts/release-approval-cli.mjs trust --public-key owner-release-key.pub.pem > trust.json`
3. Install it as a root-owned file the agent's user cannot rewrite (macOS shown; use `root:root` on Linux):
   `sudo mkdir -p /etc/pmdash && sudo install -o root -g wheel -m 0644 trust.json /etc/pmdash/functions-release-trust.json && sudo chown root:wheel /etc/pmdash && sudo chmod 755 /etc/pmdash`
4. Verify: `node scripts/release-approval-cli.mjs verify --approval /secure/approval.json`.

If the anchor is absent, not root-owned, group/other-writable, inside the repository, or contains no valid key, every run — dry-run
and `--execute` — is refused with the bootstrap instructions. No approval evidence is ever invented.

## Future release procedure

1. **Source prepared by the Agent** and committed locally (nothing is deployed).
2. **Independent QA completed** (not an Agent self-review) on that commit.
3. **Exact source commit frozen** (full SHA recorded; no further commits for the release).
4. **Owner reviews the scope**: the Agent runs `plan` and shows the environment, project, SHA/tree, Function list, exclusions and digest.
5. **Owner provides an independently verifiable approval**: signs the reviewed plan with the offline key (`sign --expect-digest`). Approvals expire (14 days at most).
6. **Guard validates** the approval, the anchor, the commit, the tree and the scope (dry-run shows the exact command and package size).
7. **Scoped deployment executes only under a new, separate authorisation** (`--execute`; Production adds `--confirm-production`).

## Limitations (read these)

- **Direct Firebase CLI use is not controlled by this wrapper.** Anyone with cloud credentials and a shell can still call the Firebase CLI
  (or the console) themselves. This guard covers repository-managed releases only; it is **not** organisation-wide authorisation, does not
  prevent an operator with unrestricted cloud credentials from bypassing it, and is not a sandbox.
- The signature proves the holder of the pinned key approved this exact release; it cannot prove who holds the key. Protect it.
- If an agent can obtain root (or edit the root-owned anchor some other way), it can replace the anchor. The anchor must stay under Owner control.
- The Firebase CLI binary comes from the repository's `node_modules` (toolchain trust); only the **source being deployed** is isolated.
- The guard does not enumerate live Functions; keep the manifest's "read-only enumerate first" step.
- `buildFunctionsOnlyFlag(manifest, env)` in `scripts/deployment-manifest.mjs` still **defaults to the whole allowlist** when called with
  no names (pinned by existing tests). Release tooling must use this guard and never call it without an explicit list.
- A Firebase `predeploy` hook cannot see `--only`, so it cannot enforce this; hooks are refused in the packaged `firebase.json`.
- Windows is not supported by the root-ownership check (it fails closed).

## What this does not touch

No Firebase project, IAM, Artifact Registry, Cloud Build, Function configuration or runtime is changed by the guard, and the tests use a
mock runner with synthetic in-memory keys (the real Firebase CLI is never started and no real key exists in this repository).
