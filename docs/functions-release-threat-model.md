# Functions release guard — threat model (hardening 3)

Scope: the local wrapper `scripts/deploy-functions.mjs` and its helpers. Written **before** the hardening changes so the
controls below can be checked against it.

## Actors and capabilities

| Actor | Can | Cannot (assumed) |
|---|---|---|
| **Agent (same OS user)** | read/write everything the user can: the repo, `.git`, `~/.gitconfig`, `~/.npmrc`, shell startup files, environment variables, `/tmp`, PATH entries owned by the user; run any command as that user | write root-owned files, install a root-owned trust anchor, obtain the Owner's private key |
| **Owner** | holds the offline private key, signs reviewed plans, installs the root-owned trust anchor (sudo) | — |
| **Operator with unrestricted cloud credentials** | call the Firebase CLI / console / APIs directly | — (cannot be stopped by this wrapper) |

## Trust boundaries

| # | Boundary | Classification | Threats | Control (this iteration) | What it cannot do |
|---|---|---|---|---|---|
| A | **Source repository** (`.git`, worktree) | **Untrusted local input / agent-controlled** | tampered refs/config, replaced objects, alternates, hooks, fsmonitor, symlinked `.git`, dirty tree | Only the **approved commit** is used; every object we rely on (commit, trees, blobs) is re-hashed; alternates and replace refs refused; repository root verified; commit's tree compared with the signed `sourceTree` | A same-user agent can rewrite the guard code itself or `git` binaries it controls |
| B | **Git child processes** | **Untrusted environment** (inherited env, HOME, XDG, system/global config, PATH) | `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_CONFIG_*`/`GIT_OBJECT_DIRECTORY`/`GIT_ALTERNATE_OBJECT_DIRECTORIES`/`GIT_SSH_COMMAND`/`GIT_TEMPLATE_DIR`, user/system config, hooks, `core.fsmonitor`, PATH hijack | Environment is **built from an allow-list** (nothing inherited except a fixed set), global/system config disabled, `core.hooksPath`/`core.fsmonitor` forced off on the command line, `git` located by absolute path in OS directories, argument allow-listing (no shell; no option injection) | Repository-local `.git/config` is still read by Git; dangerous keys are overridden per command, unknown future keys are not |
| C | **Dependency installation** (`npm ci`) | **Untrusted code & network** | lifecycle scripts, malicious packages, symlinks/hardlinks, writes outside the package, user/global npm config | `--ignore-scripts`, lockfile-only (`npm ci`), `--no-bin-links`, user/global npmrc disabled, `NODE_OPTIONS`/`NODE_PATH`/`GIT_*`/`npm_config_*` stripped, runs only inside the staging directory | npm itself and the registry are trusted to honour the lockfile integrity hashes; malicious *content* of a locked package is out of scope |
| D | **Isolated deployment package** (staging dir) | **Generated, agent-writable while it exists** | symlink/hardlink/special-file injection after export or after install, source modification, replacement of the directory | Private `0700` dir; verified **before** install and again **after** install (full lstat walk: only regular files/dirs; no links unless on an explicit in-staging allow-list; every approved file re-hashed; nothing but `functions/node_modules/` may be added); directory identity (dev/ino/owner/mode) re-checked immediately before the CLI starts | A same-user agent can still win a race between the final check and the CLI reading files (TOCTOU window narrowed, not removed) |
| E | **Owner signing public key** (trust anchor) | **OS-protected trust anchor** | replaceable file or ancestor directory, symlink swap, same-user writable path | Every component from `/` to the file is `lstat`-checked: real directories only (root-owned symlinks allowed as OS aliases like `/etc`), root-owned, not group/other-writable, not writable by the current user (`access`), not under HOME/cwd/tmp/repo; checked **before** the key is used; file re-checked after read | ACLs/extended attributes, mount options and a compromised root are not evaluated; Windows unsupported (fails closed) |
| F | **Deployment credentials** (ADC, `FIREBASE_TOKEN`, gcloud login) | **Cloud-side deployment authority** | credential theft/misuse | **Not controlled.** The Firebase CLI inherits the operator's credentials (only code-injection variables are stripped) | Anyone holding the credentials can deploy without this guard |
| G | **Firebase CLI invocation** | **Agent-controlled launcher, cloud-side authority** | wrong scope/project/source, direct invocation | Only an individually named `--only functions:<name>` list, one `--project`, run with the verified package as cwd, after all checks | Direct CLI use, the console and other API clients bypass the wrapper completely |

## Classification summary

- **Untrusted local inputs:** repository contents and config, inherited environment, npm packages/registry responses, the
  staging directory contents while it exists, the approval file's *contents* (until the signature verifies).
- **Agent-controlled files:** anything the same OS user can write, including `.git`, dotfiles, `/tmp`, user-owned PATH entries, and the guard's own source.
- **Owner-controlled approval:** the Ed25519 private key (offline) and its signature over the exact release payload.
- **OS-protected trust anchors:** the root-owned public-key file and its root-owned, non-writable ancestor chain.
- **Cloud-side deployment authority:** IAM on the Firebase project — the only control that actually stops an unauthorised deploy.

## What cannot be enforced

- If an actor has the **same operating-system privileges as the runner**, it can edit or replace the guard, the Node
  binary, PATH entries it owns, the `git`/`npm` it finds, or call the Firebase CLI directly. Local filesystem checks
  **cannot** stop an actor with unrestricted cloud credentials, and they are not organisation-wide authorisation.
- Stronger assurance needs enforcement outside the machine: least-privilege deploy identities, a CI/deploy service the
  agent cannot modify, required reviews on the guard code, and IAM that rejects deployments lacking Owner approval.
- No Owner trust anchor is configured yet; until the Owner bootstraps one, `--execute` (and dry-run) stay **blocked**.
