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
2. The trust anchor passes **full-ancestor validation** (see "Trust anchor path" below) and lists only Ed25519 keys whose `keyId` equals the key fingerprint.
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

## Controlled Git execution (hardening 3)

Every Git child process (`scripts/git-sandbox.mjs`) gets an environment **built from an allow-list**: nothing is inherited, so
`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_CONFIG_COUNT`/`KEY_*`/`VALUE_*`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_SSH_COMMAND`, `GIT_TEMPLATE_DIR` and every other `GIT_*` are dropped. `HOME` and `XDG_CONFIG_HOME` point
at `/nonexistent`, global/system configuration is disabled, `PATH` is the OS directories, replace refs are disabled, and each command
is run with `core.hooksPath=/dev/null` and `core.fsmonitor=false` (plus no pager/ssh/askpass/credential helper). `git` is found by absolute
path in OS directories, not through the user's PATH. Arguments are allow-listed (known subcommands, literal flags, full object ids,
`<oid>^{commit|tree}`, `<oid>:<safe path>`, and safe relative paths after `--`); no shell is involved and no startup file is read.
The intended repository is resolved and verified (git top level equals the repository root, not bare, `.git` is not a symlink, no
`objects/info/alternates`), and the commit, the root tree, every intermediate tree and every blob are **re-hashed**, so a substituted object
cannot present different content under an approved id. Repository-local `.git/config` is still read by Git; the dangerous keys are
overridden per command, unknown future keys are not.

## Immutable source package

`git ls-tree` of the approved tree under `firebase.json` and `functions/` is the **only** input. Every blob is written into a
fresh `0700` temp directory (`pmdash-functions-package-*`); symlinks, submodules, odd paths and `.git` segments in the commit
are refused; `firebase.json` must keep `functions.source = "functions"` and may not define `predeploy`/`postdeploy` hooks.
The export is re-read and must equal the tree (paths, object ids, no extra files, no links); the approval file name must not
appear in it. Dependencies are installed **inside the package** with `npm ci --ignore-scripts --bin-links --no-audit --no-fund`
(exact lockfile, no lifecycle scripts). npm runs in a private **npm sandbox** (`scripts/npm-sandbox.mjs`): `userconfig` and `globalconfig` are two
**distinct, empty, private files that exist before `npm ci`** (npm refuses to load one path in both roles, so `/dev/null` for both fails with
`double-loading config`), `HOME`/`XDG_CONFIG_HOME` point at an empty private directory, the npm cache is private, and `NPM_TOKEN`, `NODE_AUTH_TOKEN`,
`NODE_OPTIONS`, `NODE_PATH`, `GIT_*` and every inherited `npm_config_*` are removed. The real `~/.npmrc` is never read or written; a project `.npmrc`
inside the approved tree would still apply. The sandbox is removed afterwards (also when npm fails). The Firebase CLI runs with the package as its working directory. The user's working tree is never modified or cleaned, and only the
package directory this tool created is removed.

### Post-install integrity

1. **Before** installation the package must equal the approved tree exactly.
2. **After** installation the **whole upload tree** is walked without following links: only regular files and directories are allowed;
   hard links and FIFOs/sockets/devices are refused. A symlink is permitted only if it is
   (a) an **npm-created dependency link** `functions/node_modules[/<pkg>/node_modules]*/.bin/<name>` that is a **relative, single-hop** link to a
   **regular file** whose fully resolved path is inside the same `node_modules` directory (never a chain, a directory, another `.bin` entry, an
   absolute target, a target outside `functions/node_modules/`, or broken/circular); or (b) on an explicit, reviewed in-package list **and** fully
   resolving inside the package (the list is empty by default and there is no switch that allows external targets). Any other link is refused.
   The link text is never trusted; the resolved path is checked. `--bin-links` is required because the Firebase CLI discovers the Functions SDK
   **only** through `functions/node_modules/.bin/firebase-functions` (`findFunctionsBinary` in `firebase-tools`): that entry must exist at that exact
   path, be the npm-created link, resolve to the executable the installed `firebase-functions` package declares as its `firebase-functions` bin, and stay
   inside the package. A regular launcher, a re-pointed link, a missing or non-executable entry is refused.
3. Every approved file is re-hashed and must be byte-identical; the only thing installation may add is `functions/node_modules/`; any other
   new file or directory (for example `functions/generated.js`, `.npmrc`, a new top-level directory) is refused.
4. The staging directory's identity (device/inode/owner, real `0700` directory, not a symlink) is captured at creation and re-checked, and
   the scan is **repeated immediately before the Firebase CLI starts**; the CLI runs only if everything passed. A same-user actor can
   still race the final instant: the window is narrowed, not removed.

## Trust anchor path (hardening 3)

The anchor is validated **before the key is used**, along the complete path from `/` to the file:

- every symlink used to reach it (for example macOS `/etc` -> `/private/etc`) must be **root-owned**;
- after resolving all links, every directory from `/` down must be a real directory **owned by root**, **not group/other-writable** (sticky
  or not), and **not writable by the executing user** (`access(W_OK)`, which also catches ACL/group surprises);
- the file must be a regular file, owned by root, not group/other-writable, not writable by the executing user, and unchanged while read;
- the path may not be under the repository, the home directory, the temp directory or the current directory.

A file that merely looks root-owned is not trusted if any ancestor could be replaced by the agent's user. Real limits: ACLs and extended
attributes beyond `access()`, mount options and a compromised root are not evaluated; Windows is unsupported (fails closed). If no safe
anchor can be established under the current permissions (the case today), release execution stays **blocked**.

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

1. **Agent prepares the source** and commits it locally (nothing is deployed).
2. **Independent QA** (Codex or another independent reviewer; an Agent self-review does not count) on that exact commit.
3. **Exact source commit frozen**: full SHA recorded, no further commits for the release.
4. **Owner approves the exact scope**: the Agent runs `plan`; the Owner reads the environment, project, SHA/tree, Function list, exclusions, scheduled approvals, validity window and digest.
5. **Owner approval signature created outside the source repository**, with the offline key (`sign --expect-digest`); approvals expire (14 days at most).
6. **Guard verifies the trust anchor** (full ancestor chain) and the signature over the exact payload.
7. **Immutable source exported** from the approved commit into the isolated package (sanitized Git, every object re-hashed).
8. **Dependencies installed safely** inside the package (`npm ci --ignore-scripts --bin-links`, private npm sandbox with two distinct empty config files, stripped environment).
9. **Post-install verification** of the whole upload tree, repeated immediately before the CLI starts.
10. **Explicit scoped deployment** (`--execute`; Production adds `--confirm-production`) with only the individually named `functions:<name>` selectors — and only under a new, separate authorisation to deploy.

If any step is unavailable (for example no Owner trust anchor), execution stays blocked; there is no override flag.

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
- **No real Owner trust anchor is configured yet**, so this guard is not operationally ready: `--execute` (and dry-run) are blocked until the Owner bootstraps one.
- **Same-user agent privileges:** an actor with the same OS privileges as the runner can alter the guard, Node, user-owned PATH entries and the
  tools it finds, or call the Firebase CLI directly. Stronger assurance needs enforcement outside the machine (least-privilege deploy
  identities, a deploy service the agent cannot modify, required reviews on the guard code, IAM that rejects unapproved deployments).
- The repository-local `.git/config` is read by Git; dangerous keys are overridden per command, unknown keys are not. `npm`, the registry
  and the locked packages' content are trusted to honour the lockfile integrity hashes.
- Deployment credentials (ADC, `FIREBASE_TOKEN`) are inherited by the Firebase CLI and are not controlled; see `docs/functions-release-threat-model.md`.

## What this does not touch

No Firebase project, IAM, Artifact Registry, Cloud Build, Function configuration or runtime is changed by the guard, and the tests use a
mock runner with synthetic in-memory keys (the real Firebase CLI is never started and no real key exists in this repository).
