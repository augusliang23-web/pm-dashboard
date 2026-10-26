// Controlled npm environment for the isolated Functions package.
//
// npm loads a "user" and a "global" configuration file and refuses to load the SAME path in both roles
// (`double-loading config "/dev/null" as "global", previously loaded as "user"`), so the two roles get two DISTINCT,
// empty, private files that exist before `npm ci` runs. Nothing is read from the real ~/.npmrc, a global npmrc, npm
// credentials or inherited npm_config_* variables, HOME/XDG point at an empty private directory, and the npm cache is a
// private directory too. The project's own committed configuration (a .npmrc inside the approved tree) still applies.
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

export class NpmSandboxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NpmSandboxError';
  }
}

export const NPM_SANDBOX_PREFIX = 'pmdash-npm-config-';

// Environment for npm / Firebase CLI children: operator credentials and PATH are kept (the Firebase CLI needs them),
// every variable that can inject code or redirect Git/npm configuration is removed.
const STRIPPED_EXACT = new Set(['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'BASH_ENV', 'ENV']);
export function sanitizedToolEnv(base = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (key.startsWith('GIT_') || key.startsWith('DYLD_') || key.toLowerCase().startsWith('npm_config_') || STRIPPED_EXACT.has(key)) continue;
    env[key] = value;
  }
  return env;
}

async function trustedTempParent() {
  return realpath(tmpdir());
}

// Creates the private npm configuration sandbox: two distinct empty config files, an empty home and a private cache.
export async function createNpmSandbox({ makeTempDir } = {}) {
  const root = makeTempDir ? await makeTempDir() : await mkdtemp(join(await trustedTempParent(), NPM_SANDBOX_PREFIX));
  if (!basename(root).startsWith(NPM_SANDBOX_PREFIX)) throw new NpmSandboxError('Refusing an unexpected npm sandbox directory.');
  await chmod(root, 0o700);
  const sandbox = Object.freeze({
    root, userconfig: join(root, 'user.npmrc'), globalconfig: join(root, 'global.npmrc'), home: join(root, 'home'), cache: join(root, 'cache')
  });
  await mkdir(sandbox.home, { mode: 0o700 });
  await mkdir(sandbox.cache, { mode: 0o700 });
  await writeFile(sandbox.userconfig, '', { flag: 'wx', mode: 0o600 });
  await writeFile(sandbox.globalconfig, '', { flag: 'wx', mode: 0o600 });
  return sandbox;
}

// The two config roles must be different, existing, empty, regular files inside the private sandbox (never /dev/null,
// never a real npmrc). Throws NpmSandboxError otherwise.
export async function assertNpmSandbox(sandbox) {
  if (!sandbox || typeof sandbox !== 'object') throw new NpmSandboxError('An npm sandbox is required.');
  const { root, userconfig, globalconfig, home, cache } = sandbox;
  for (const [label, path] of [['userconfig', userconfig], ['globalconfig', globalconfig], ['home', home], ['cache', cache]]) {
    if (typeof path !== 'string' || !path.startsWith(`${root}${sep}`) || path.includes('\0')) throw new NpmSandboxError(`The npm ${label} path is not inside the private sandbox.`);
  }
  if (resolve(userconfig) === resolve(globalconfig)) throw new NpmSandboxError('npm userconfig and globalconfig must be two different files (npm refuses to load one file in both roles).');
  if (userconfig === '/dev/null' || globalconfig === '/dev/null') throw new NpmSandboxError('/dev/null may not be used as an npm configuration file.');
  for (const [label, path] of [['userconfig', userconfig], ['globalconfig', globalconfig]]) {
    const stat = await lstat(path).catch(() => null);
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new NpmSandboxError(`The npm ${label} file does not exist as a regular file before installation.`);
    if ((await readFile(path)).length !== 0) throw new NpmSandboxError(`The npm ${label} file is not empty; the sandbox must not carry configuration or credentials.`);
  }
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || (rootStat.mode & 0o077) !== 0) throw new NpmSandboxError('The npm sandbox directory is not a private real directory.');
  return sandbox;
}

// The complete environment npm runs with. Deterministic: no inherited npm configuration, tokens, HOME or XDG state.
export function npmInstallEnvironment(sandbox, base = process.env) {
  const env = sanitizedToolEnv(base);
  for (const key of Object.keys(env)) {
    if (key === 'NPM_TOKEN' || key === 'NODE_AUTH_TOKEN' || key.toUpperCase().startsWith('NPM_CONFIG_')) delete env[key];
  }
  return {
    ...env, HOME: sandbox.home, XDG_CONFIG_HOME: sandbox.home,
    npm_config_userconfig: sandbox.userconfig, npm_config_globalconfig: sandbox.globalconfig, npm_config_cache: sandbox.cache,
    npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false'
  };
}

// Removes ONLY a sandbox this module created.
export async function disposeNpmSandbox(sandbox) {
  const root = sandbox?.root;
  if (!root || !basename(root).startsWith(NPM_SANDBOX_PREFIX) || dirname(resolve(root)) !== await trustedTempParent()) {
    throw new NpmSandboxError('Refusing to remove a directory that is not one of our npm sandboxes.');
  }
  await rm(root, { recursive: true, force: true });
}
