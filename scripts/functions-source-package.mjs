// Immutable deployment package for a Functions release.
//
// The deployment source is NEVER the developer working tree. It is rebuilt from the exact approved Git commit:
// every entry of the commit's tree under PACKAGE_PATHS is written into a fresh private directory straight from its
// blob object, so untracked files, untracked or ignored symlinks, node_modules and local edits cannot enter the
// package. The export is then re-read and compared with the commit tree (paths, modes, object ids). Symlinks and
// submodules in the commit are refused. The user's working tree is never modified or cleaned.
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class PackageIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PackageIntegrityError';
  }
}

// The only tracked paths a Functions release needs: the Firebase config and the Functions source directory.
export const PACKAGE_PATHS = Object.freeze(['firebase.json', 'functions']);
export const PACKAGE_PREFIX = 'pmdash-functions-package-';
const REQUIRED_FILES = Object.freeze(['firebase.json', 'functions/index.js', 'functions/package.json', 'functions/package-lock.json']);
const SAFE_PATH = /^[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/;
const ALLOWED_MODES = new Set(['100644', '100755']);

// git runner bound to one repository; returns stdout as a Buffer. Replace refs are disabled so a local `git replace`
// cannot make an approved object id resolve to different content.
export function makeGit(repositoryRoot) {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' };
  return async args => (await execFileAsync('git', args, { cwd: repositoryRoot, env, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })).stdout;
}

const text = buffer => buffer.toString('utf8').trim();

// Confirms the approved commit exists locally and returns its tree id. Never falls back to HEAD or the working tree.
export async function resolveSourceCommit(git, sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new PackageIntegrityError('The source commit must be a full 40-character SHA.');
  let commit; let tree;
  try {
    commit = text(await git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]));
    tree = text(await git(['rev-parse', '--verify', '--quiet', `${sha}^{tree}`]));
  } catch { throw new PackageIntegrityError(`The approved source commit ${sha} does not exist in this repository.`); }
  if (commit !== sha || !tree) throw new PackageIntegrityError(`The approved source commit ${sha} does not resolve to itself.`);
  return { sha: commit, tree };
}

export async function readFromCommit(git, sha, path) {
  try { return (await git(['show', `${sha}:${path}`])).toString('utf8'); } catch { throw new PackageIntegrityError(`${path} does not exist in commit ${sha}.`); }
}

export function assertPackageFirebaseConfig(firebaseJson) {
  let config;
  try { config = JSON.parse(firebaseJson); } catch { throw new PackageIntegrityError('firebase.json in the approved commit is not valid JSON.'); }
  const functions = config?.functions;
  if (!functions || typeof functions !== 'object' || Array.isArray(functions)) throw new PackageIntegrityError('firebase.json must declare a single "functions" object.');
  if (functions.source !== 'functions') throw new PackageIntegrityError('firebase.json functions.source must be exactly "functions".');
  for (const hook of ['predeploy', 'postdeploy']) {
    if (Object.hasOwn(functions, hook)) throw new PackageIntegrityError(`firebase.json functions.${hook} hooks would run arbitrary commands during a release and are refused.`);
  }
  return config;
}

// The exact, validated entries of the approved tree under PACKAGE_PATHS.
export async function listSourceEntries(git, sha) {
  const raw = (await git(['ls-tree', '-r', '-z', '--full-tree', sha, '--', ...PACKAGE_PATHS])).toString('utf8');
  const entries = raw.split('\0').filter(Boolean).map(line => {
    const match = /^(\d{6}) (\w+) ([0-9a-f]{40,64})\t(.+)$/s.exec(line);
    if (!match) throw new PackageIntegrityError('Unrecognised git tree entry.');
    return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
  });
  for (const entry of entries) {
    if (entry.type !== 'blob' || !ALLOWED_MODES.has(entry.mode)) throw new PackageIntegrityError(`"${entry.path}" is a ${entry.mode === '120000' ? 'symbolic link' : entry.mode === '160000' ? 'submodule' : `non-regular entry (${entry.mode} ${entry.type})`}; refusing to package it.`);
    if (!SAFE_PATH.test(entry.path) || entry.path.split('/').some(part => part === '.' || part === '..' || part === '.git')) throw new PackageIntegrityError(`Unexpected path in the approved tree: ${JSON.stringify(entry.path)}.`);
  }
  const paths = new Set(entries.map(entry => entry.path));
  for (const required of REQUIRED_FILES) if (!paths.has(required)) throw new PackageIntegrityError(`The approved commit has no ${required}.`);
  if (paths.size !== entries.length) throw new PackageIntegrityError('Duplicate paths in the approved tree.');
  return entries.sort((left, right) => (left.path < right.path ? -1 : 1));
}

async function trustedTempParent() {
  return realpath(tmpdir());
}

// Writes the approved entries into a new private directory and returns it. Nothing is read from the working tree.
export async function exportSourcePackage({ git, entries, makeTempDir = async () => mkdtemp(join(await trustedTempParent(), PACKAGE_PREFIX)) }) {
  const root = await makeTempDir();
  if (!basename(root).startsWith(PACKAGE_PREFIX)) throw new PackageIntegrityError('Refusing an unexpected package directory.');
  for (const entry of entries) {
    const target = resolve(root, entry.path);
    if (target !== root && !target.startsWith(root + sep)) throw new PackageIntegrityError(`Path escape refused: ${entry.path}.`);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, await git(['cat-file', 'blob', entry.oid]), { flag: 'wx', mode: entry.mode === '100755' ? 0o755 : 0o644 });
  }
  return root;
}

async function walk(root, directory = root) {
  const found = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) throw new PackageIntegrityError(`A symbolic link is present in the package: ${relative(root, full)}.`);
    if (stat.isDirectory()) found.push(...await walk(root, full));
    else if (stat.isFile()) found.push(relative(root, full).split(sep).join('/'));
    else throw new PackageIntegrityError(`An unexpected filesystem object is present in the package: ${relative(root, full)}.`);
  }
  return found;
}

// Re-reads the export and proves it IS the approved tree: same file set, same object ids, no links or extras.
export async function verifyExportedPackage({ git, root, entries, extraForbiddenFiles = [] }) {
  const present = (await walk(root)).sort();
  const expected = entries.map(entry => entry.path).sort();
  const extra = present.filter(path => !expected.includes(path));
  const missing = expected.filter(path => !present.includes(path));
  if (extra.length || missing.length) throw new PackageIntegrityError(`The package differs from the approved commit tree (extra: ${extra.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}).`);
  for (const entry of entries) {
    const oid = text(await git(['hash-object', '--no-filters', '--', join(root, entry.path)]));
    if (oid !== entry.oid) throw new PackageIntegrityError(`${entry.path} differs from the approved commit (expected object ${entry.oid}, found ${oid}).`);
  }
  for (const forbidden of extraForbiddenFiles) {
    if (present.includes(forbidden)) throw new PackageIntegrityError(`${forbidden} must never be part of the deployment package.`);
  }
  return present;
}

// Removes ONLY a package directory this module created.
export async function disposePackage(root) {
  if (!root || !basename(root).startsWith(PACKAGE_PREFIX) || dirname(resolve(root)) !== await trustedTempParent()) {
    throw new PackageIntegrityError('Refusing to remove a directory that is not one of our packages.');
  }
  await rm(root, { recursive: true, force: true });
}
