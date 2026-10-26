// Controlled Git execution for the Functions release guard.
//
// Every Git child process is started with an environment BUILT FROM AN ALLOW-LIST (nothing is inherited), global and
// system configuration disabled, hooks and fsmonitor forced off on the command line, `git` located by absolute path in
// OS directories (not through the user's PATH), and arguments checked against an allow-list so no option or revision
// can be injected. Nothing depends on shell startup files and no shell is ever involved.
//
// Limits: repository-local `.git/config` is still read by Git (dangerous keys are overridden per command); a same-user
// actor can replace files the user owns, including this module. See docs/functions-release-threat-model.md.
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitSandboxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitSandboxError';
  }
}

export const TRUSTED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
// Preferred first: the OS-provided git. The others are only used when it is absent.
export const GIT_CANDIDATES = Object.freeze(['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git']);

// The ONLY environment a Git child sees. Every inherited variable (including all GIT_*) is dropped.
export function gitEnvironment() {
  return Object.freeze({
    PATH: TRUSTED_PATH, HOME: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent', LC_ALL: 'C', LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_ATTR_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0'
  });
}

// Global options placed before every subcommand: no hooks, no fsmonitor, no pager/ssh/askpass/credential helpers.
export const GIT_GLOBAL_OPTIONS = Object.freeze([
  '--no-pager', '--no-optional-locks',
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.pager=cat',
  '-c', 'core.attributesFile=/dev/null', '-c', 'core.sshCommand=false', '-c', 'core.askPass=', '-c', 'credential.helper=',
  '-c', 'diff.external=', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'protocol.allow=never'
]);

const SUBCOMMANDS = new Set(['rev-parse', 'ls-tree', 'cat-file', 'hash-object', 'show', 'status']);
const STATIC_ARGUMENTS = new Set([
  '--verify', '--quiet', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', '--is-bare-repository', '--show-object-format',
  '-r', '-t', '-z', '--full-tree', '--porcelain', '--untracked-files=no', '--no-filters', '--stdin', '--', 'blob', 'tree', 'commit', 'HEAD'
]);
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REVISION = /^(?:(?:[0-9a-f]{40}|[0-9a-f]{64})|HEAD)\^\{(?:commit|tree)\}$/;
const SAFE_PATH = /^[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/;
const OBJECT_PATH = /^(?:(?:[0-9a-f]{40}|[0-9a-f]{64})):[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/;

// Rejects anything that is not a known subcommand, a known literal argument, a full object id, a `<oid>^{commit|tree}`
// revision, an `<oid>:<safe path>` object path, or (only after `--`) a safe relative path.
export function assertSafeGitArguments(args) {
  if (!Array.isArray(args) || !args.length || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new GitSandboxError('Git arguments must be a non-empty array of NUL-free strings.');
  if (!SUBCOMMANDS.has(args[0])) throw new GitSandboxError(`Git subcommand "${args[0]}" is not allowed.`);
  let afterSeparator = false;
  for (const arg of args.slice(1)) {
    if (afterSeparator) {
      if (!SAFE_PATH.test(arg) || arg.split('/').some(part => part === '..' || part === '.git')) throw new GitSandboxError(`Unsafe path argument ${JSON.stringify(arg)}.`);
    } else if (arg === '--') {
      afterSeparator = true;
    } else if (STATIC_ARGUMENTS.has(arg) || arg === 'HEAD' || OID.test(arg) || REVISION.test(arg)) {
      // accepted
    } else if (OBJECT_PATH.test(arg) && !arg.split(':')[1].split('/').some(part => part === '.' || part === '..' || part === '.git')) {
      // accepted: <oid>:<safe relative path>
    } else {
      throw new GitSandboxError(`Git argument ${JSON.stringify(arg)} is not allowed.`);
    }
  }
  return args;
}

export async function resolveGitBinary({ candidates = GIT_CANDIDATES, probe = defaultProbe } = {}) {
  for (const candidate of candidates) {
    if (await probe(candidate)) return candidate;
  }
  throw new GitSandboxError('No trusted git executable was found in the OS directories.');
}

async function defaultProbe(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() && !stat.isSymbolicLink()) return false;
    await access(path, constants.X_OK);
    return (stat.mode & 0o022) === 0 || stat.isSymbolicLink();
  } catch { return false; }
}

// A Git runner for ONE repository root. Returns stdout as a Buffer. `input` (optional) is written to stdin.
export function makeGit(repositoryRoot, { binary, run = execFileAsync } = {}) {
  let resolved = binary;
  return async (args, { input } = {}) => {
    assertSafeGitArguments(args);
    resolved ??= await resolveGitBinary();
    const options = { cwd: repositoryRoot, env: gitEnvironment(), encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 };
    const child = run(resolved, [...GIT_GLOBAL_OPTIONS, ...args], options);
    if (input !== undefined) child.child?.stdin?.end(input);
    return (await child).stdout;
  };
}

const text = buffer => buffer.toString('utf8').trim();

// Resolves and verifies the INTENDED repository: the git top level must be exactly `rootDir`, it must not be bare, `.git`
// must not be a symlink, and no alternate object database may be configured.
export async function openRepository(rootDir, { realpathFn = realpath, lstatFn = lstat, git: injected } = {}) {
  const root = await realpathFn(rootDir);
  const git = injected ?? makeGit(root);
  const topLevel = await realpathFn(text(await git(['rev-parse', '--show-toplevel'])));
  if (topLevel !== root) throw new GitSandboxError(`The git top level ${topLevel} is not the intended repository ${root}.`);
  if (text(await git(['rev-parse', '--is-bare-repository'])) !== 'false') throw new GitSandboxError('A bare repository was found where a work tree was expected.');
  let dotGit;
  try { dotGit = await lstatFn(join(root, '.git')); } catch { throw new GitSandboxError(`${root} has no .git entry.`); }
  if (dotGit.isSymbolicLink()) throw new GitSandboxError('.git is a symbolic link.');
  const gitDir = await realpathFn(text(await git(['rev-parse', '--absolute-git-dir'])));
  const commonRaw = text(await git(['rev-parse', '--git-common-dir']));
  const commonDir = await realpathFn(commonRaw.startsWith('/') ? commonRaw : join(root, commonRaw));
  for (const name of ['alternates', 'http-alternates']) {
    let present = true;
    try { await lstatFn(join(commonDir, 'objects', 'info', name)); } catch { present = false; }
    if (present) throw new GitSandboxError(`objects/info/${name} configures an alternate object database; refusing.`);
  }
  const objectFormat = text(await git(['rev-parse', '--show-object-format']));
  if (!['sha1', 'sha256'].includes(objectFormat)) throw new GitSandboxError(`Unsupported object format "${objectFormat}".`);
  return { git, root, gitDir, commonDir, objectFormat };
}
