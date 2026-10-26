// Immutable deployment package for a Functions release.
//
// The deployment source is NEVER the developer working tree. It is rebuilt from the exact approved Git commit:
// every entry of the commit's tree under PACKAGE_PATHS is written into a fresh private directory straight from its
// blob object, so untracked files, untracked or ignored symlinks, node_modules and local edits cannot enter the
// package. Git objects (commit, trees, blobs) are re-hashed, the export is re-read and compared with the commit tree,
// and AFTER dependency installation the whole tree is scanned again: only regular files and directories are allowed,
// no link may leave the package, every approved file must be byte-identical, and the only thing installation may add is
// functions/node_modules/. The user's working tree is never modified or cleaned.
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { makeGit, openRepository } from './git-sandbox.mjs';

export { makeGit, openRepository };

export class PackageIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PackageIntegrityError';
  }
}

// The only tracked paths a Functions release needs: the Firebase config and the Functions source directory.
export const PACKAGE_PATHS = Object.freeze(['firebase.json', 'functions']);
export const PACKAGE_PREFIX = 'pmdash-functions-package-';
export const GENERATED_DIRECTORY = 'functions/node_modules';
const REQUIRED_FILES = Object.freeze(['firebase.json', 'functions/index.js', 'functions/package.json', 'functions/package-lock.json']);
const SAFE_PATH = /^[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/;
const ALLOWED_MODES = new Set(['100644', '100755']);

const text = buffer => buffer.toString('utf8').trim();

// Git object id of `content` as `type`, for the repository's object format.
export function objectId(type, content, objectFormat = 'sha1') {
  const header = Buffer.from(`${type} ${content.length}\0`);
  return createHash(objectFormat === 'sha256' ? 'sha256' : 'sha1').update(header).update(content).digest('hex');
}

// Confirms the approved commit exists locally, that the commit object really hashes to its id, and returns its tree id.
// Never falls back to HEAD or the working tree.
export async function resolveSourceCommit(git, sha, objectFormat = 'sha1') {
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new PackageIntegrityError('The source commit must be a full 40-character SHA.');
  let commit; let tree;
  try {
    commit = text(await git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]));
    tree = text(await git(['rev-parse', '--verify', '--quiet', `${sha}^{tree}`]));
  } catch { throw new PackageIntegrityError(`The approved source commit ${sha} does not exist in this repository.`); }
  if (commit !== sha || !tree) throw new PackageIntegrityError(`The approved source commit ${sha} does not resolve to itself.`);
  const commitBytes = await git(['cat-file', 'commit', sha]);
  if (objectId('commit', commitBytes, objectFormat) !== sha) throw new PackageIntegrityError(`The commit object for ${sha} does not match its id (corrupt or substituted object).`);
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

// The exact, validated entries of the approved tree under PACKAGE_PATHS. Every tree object that names them (root and
// intermediate) is re-hashed, so a substituted tree object cannot present different entries under the approved id.
export async function listSourceEntries(git, sha, { objectFormat = 'sha1', tree } = {}) {
  const raw = (await git(['ls-tree', '-r', '-t', '-z', '--full-tree', sha, '--', ...PACKAGE_PATHS])).toString('utf8');
  const all = raw.split('\0').filter(Boolean).map(line => {
    const match = /^(\d{6}) (\w+) ([0-9a-f]{40,64})\t(.+)$/s.exec(line);
    if (!match) throw new PackageIntegrityError('Unrecognised git tree entry.');
    return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
  });
  if (tree) {
    const rootBytes = await git(['cat-file', 'tree', tree]);
    if (objectId('tree', rootBytes, objectFormat) !== tree) throw new PackageIntegrityError(`The root tree object ${tree} does not match its id (corrupt or substituted object).`);
  }
  for (const subtree of all.filter(entry => entry.type === 'tree')) {
    const bytes = await git(['cat-file', 'tree', subtree.oid]);
    if (objectId('tree', bytes, objectFormat) !== subtree.oid) throw new PackageIntegrityError(`The tree object for ${subtree.path} does not match its id (corrupt or substituted object).`);
  }
  const entries = all.filter(entry => entry.type !== 'tree');
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
export async function exportSourcePackage({ git, entries, objectFormat = 'sha1', makeTempDir = async () => mkdtemp(join(await trustedTempParent(), PACKAGE_PREFIX)) }) {
  const root = await makeTempDir();
  if (!basename(root).startsWith(PACKAGE_PREFIX)) throw new PackageIntegrityError('Refusing an unexpected package directory.');
  for (const entry of entries) {
    const target = resolve(root, entry.path);
    if (target !== root && !target.startsWith(root + sep)) throw new PackageIntegrityError(`Path escape refused: ${entry.path}.`);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const content = await git(['cat-file', 'blob', entry.oid]);
    if (objectId('blob', content, objectFormat) !== entry.oid) throw new PackageIntegrityError(`The blob for ${entry.path} does not match its id (corrupt or substituted object).`);
    await writeFile(target, content, { flag: 'wx', mode: entry.mode === '100755' ? 0o755 : 0o644 });
  }
  return root;
}

// Identity of the staging directory, captured right after creation and re-checked before the CLI starts.
export async function capturePackageIdentity(root) {
  const stat = await lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new PackageIntegrityError('The staging directory is not a real directory.');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new PackageIntegrityError('The staging directory is not owned by the executing user.');
  if ((stat.mode & 0o077) !== 0) throw new PackageIntegrityError('The staging directory is accessible to other users.');
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid };
}

export async function assertPackageIdentity(root, identity) {
  const current = await capturePackageIdentity(root);
  if (current.dev !== identity.dev || current.ino !== identity.ino || current.uid !== identity.uid) {
    throw new PackageIntegrityError('The staging directory was replaced after it was verified.');
  }
}

// Full, non-following walk. Returns { files, directories, symlinks } with package-relative POSIX paths.
async function walk(root, directory = root, found = { files: [], directories: [], symlinks: [] }) {
  for (const item of await readdir(directory)) {
    const full = join(directory, item);
    const rel = relative(root, full).split(sep).join('/');
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) found.symlinks.push(rel);
    else if (stat.isDirectory()) { found.directories.push(rel); await walk(root, full, found); }
    else if (stat.isFile()) {
      if (stat.nlink > 1) throw new PackageIntegrityError(`${rel} is a hard link (it could alias a file outside the package).`);
      found.files.push(rel);
    } else throw new PackageIntegrityError(`${rel} is a special file or unexpected filesystem object.`);
  }
  return found;
}

// npm-created executable links: functions/node_modules[/<pkg>/node_modules]*/.bin/<name>
const BIN_LINK = /^functions\/node_modules\/(?:(?:@[^/]+\/)?[^/]+\/node_modules\/)*\.bin\/[^/]+$/;

// A dependency `.bin` link is permitted only when it is a SINGLE-hop, relative link whose target is a regular file that
// lives inside the same node_modules directory the `.bin` belongs to (so inside the package, never a chain, never a
// directory, never another link, never outside). The link text is not trusted: the resolved path is checked.
async function assertDependencyBinLink(root, realRoot, link) {
  const full = join(root, link);
  let text;
  try { text = await readlink(full); } catch { throw new PackageIntegrityError(`The symbolic link ${link} cannot be read.`); }
  if (!text || text.includes('\0') || isAbsolute(text)) throw new PackageIntegrityError(`The dependency link ${link} must be a relative link.`);
  const hop = resolve(dirname(full), text);
  let hopStat;
  try { hopStat = await lstat(hop); } catch { throw new PackageIntegrityError(`The dependency link ${link} is broken (its target does not exist).`); }
  if (hopStat.isSymbolicLink()) throw new PackageIntegrityError(`The dependency link ${link} points at another link (chains are refused).`);
  if (!hopStat.isFile()) throw new PackageIntegrityError(`The dependency link ${link} does not point at a regular file.`);
  let realTarget; let realModules;
  try { realTarget = await realpath(hop); realModules = await realpath(dirname(dirname(full))); } catch { throw new PackageIntegrityError(`The dependency link ${link} is broken or circular.`); }
  const generated = join(realRoot, GENERATED_DIRECTORY);
  if (!realTarget.startsWith(`${generated}${sep}`)) throw new PackageIntegrityError(`The dependency link ${link} resolves outside ${GENERATED_DIRECTORY}/ (${realTarget}).`);
  if (!realTarget.startsWith(`${realModules}${sep}`) || realTarget.split(sep).includes('.bin')) throw new PackageIntegrityError(`The dependency link ${link} does not resolve to a package inside its own node_modules.`);
}

// A symlink is only ever permitted when it is (a) an npm-created `.bin` link that passes assertDependencyBinLink, or (b) on
// the explicit reviewed list AND fully resolving inside the package. Everything else is refused.
async function assertSymlinksContained(root, symlinks, allowedSymlinks) {
  const realRoot = await realpath(root);
  for (const link of symlinks) {
    if (BIN_LINK.test(link) && !allowedSymlinks.includes(link)) { await assertDependencyBinLink(root, realRoot, link); continue; }
    if (!allowedSymlinks.includes(link)) throw new PackageIntegrityError(`A symbolic link is present in the package and is not a validated dependency link or on the reviewed in-package list: ${link}.`);
    let real;
    try { real = await realpath(join(root, link)); } catch { throw new PackageIntegrityError(`The symbolic link ${link} is broken or circular.`); }
    if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new PackageIntegrityError(`The symbolic link ${link} resolves outside the package.`);
  }
}

export const SDK_PACKAGE = 'functions/node_modules/firebase-functions';
export const SDK_BIN_LINK = 'functions/node_modules/.bin/firebase-functions';

// The Firebase CLI finds the Functions SDK ONLY through functions/node_modules/.bin/firebase-functions (see
// findFunctionsBinary in firebase-tools). Confirm that entry exists at exactly that path, is an npm-created link, and
// resolves to the executable file the SDK's own package.json declares as its `firebase-functions` bin, inside the package.
export async function assertFunctionsSdkEntry(root) {
  const link = join(root, SDK_BIN_LINK);
  const stat = await lstat(link).catch(() => null);
  if (!stat) throw new PackageIntegrityError(`${SDK_BIN_LINK} is missing: the Firebase CLI cannot discover Functions without it.`);
  if (!stat.isSymbolicLink()) throw new PackageIntegrityError(`${SDK_BIN_LINK} must be the npm-created link, not a regular file or directory.`);
  let sdk;
  try { sdk = JSON.parse(await readFile(join(root, SDK_PACKAGE, 'package.json'), 'utf8')); } catch { throw new PackageIntegrityError(`${SDK_PACKAGE}/package.json is missing or unreadable.`); }
  const declared = sdk?.bin?.['firebase-functions'];
  if (typeof declared !== 'string' || !declared) throw new PackageIntegrityError('The installed firebase-functions package declares no "firebase-functions" bin.');
  const realRoot = await realpath(root);
  const sdkDirectory = join(realRoot, SDK_PACKAGE);
  let expected; let actual;
  try { expected = await realpath(resolve(root, SDK_PACKAGE, declared)); actual = await realpath(link); } catch { throw new PackageIntegrityError(`${SDK_BIN_LINK} is broken or the SDK's declared bin is missing.`); }
  if (!expected.startsWith(`${sdkDirectory}${sep}`)) throw new PackageIntegrityError('The SDK bin declared by firebase-functions resolves outside the package of firebase-functions itself.');
  if (actual !== expected) throw new PackageIntegrityError(`${SDK_BIN_LINK} resolves to ${relative(realRoot, actual)} instead of the SDK's declared bin ${relative(realRoot, expected)}.`);
  const target = await lstat(expected);
  if (!target.isFile() || (target.mode & 0o111) === 0) throw new PackageIntegrityError('The SDK bin is not an executable regular file.');
  return { link: SDK_BIN_LINK, target: relative(realRoot, expected) };
}

async function assertApprovedFilesIntact({ git, root, entries, objectFormat }) {
  for (const entry of entries) {
    const stat = await lstat(join(root, entry.path)).catch(() => null);
    if (!stat || !stat.isFile()) throw new PackageIntegrityError(`${entry.path} is missing from the package or is no longer a regular file.`);
    const oid = objectId('blob', await readFile(join(root, entry.path)), objectFormat);
    if (oid !== entry.oid) throw new PackageIntegrityError(`${entry.path} differs from the approved commit (expected object ${entry.oid}, found ${oid}).`);
  }
}

// Pre-install check: the package IS the approved tree and nothing else.
export async function verifyExportedPackage({ git, root, entries, objectFormat = 'sha1', extraForbiddenFiles = [], allowedSymlinks = [] }) {
  const found = await walk(root);
  await assertSymlinksContained(root, found.symlinks, allowedSymlinks);
  const present = found.files.sort();
  const expected = entries.map(entry => entry.path).sort();
  const extra = present.filter(path => !expected.includes(path));
  const missing = expected.filter(path => !present.includes(path));
  if (extra.length || missing.length) throw new PackageIntegrityError(`The package differs from the approved commit tree (extra: ${extra.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}).`);
  await assertApprovedFilesIntact({ git, root, entries, objectFormat });
  for (const forbidden of extraForbiddenFiles) {
    if (present.includes(forbidden)) throw new PackageIntegrityError(`${forbidden} must never be part of the deployment package.`);
  }
  return present;
}

// Post-install check over the COMPLETE upload tree. Installation may add only functions/node_modules/ (regular files and
// directories); every approved file must be byte-identical; links, hard links and special files are refused.
export async function verifyInstalledPackage({ git, root, entries, objectFormat = 'sha1', extraForbiddenFiles = [], allowedSymlinks = [], requireSdkEntry = false }) {
  const found = await walk(root);
  await assertSymlinksContained(root, found.symlinks, allowedSymlinks);
  const approved = new Set(entries.map(entry => entry.path));
  const ancestors = new Set();
  for (const path of approved) for (let dir = dirname(path); dir && dir !== '.'; dir = dirname(dir)) ancestors.add(dir);
  const inGenerated = path => path === GENERATED_DIRECTORY || path.startsWith(`${GENERATED_DIRECTORY}/`);
  const unexpectedFiles = found.files.filter(path => !approved.has(path) && !inGenerated(path));
  const unexpectedDirectories = found.directories.filter(path => !ancestors.has(path) && !inGenerated(path));
  // Links were already validated one by one (assertSymlinksContained): only validated dependency .bin links or reviewed links remain.
  if (unexpectedFiles.length || unexpectedDirectories.length) {
    throw new PackageIntegrityError(`Unexpected content in the package after installation (files: ${unexpectedFiles.slice(0, 5).join(', ') || 'none'}; directories: ${unexpectedDirectories.slice(0, 5).join(', ') || 'none'}); only ${GENERATED_DIRECTORY}/ may be generated.`);
  }
  await assertApprovedFilesIntact({ git, root, entries, objectFormat });
  for (const forbidden of extraForbiddenFiles) {
    if (found.files.includes(forbidden)) throw new PackageIntegrityError(`${forbidden} must never be part of the deployment package.`);
  }
  const sdk = requireSdkEntry ? await assertFunctionsSdkEntry(root) : null;
  return { files: found.files.length, generated: found.files.filter(inGenerated).length, sdk };
}

// Removes ONLY a package directory this module created.
export async function disposePackage(root) {
  if (!root || !basename(root).startsWith(PACKAGE_PREFIX) || dirname(resolve(root)) !== await trustedTempParent()) {
    throw new PackageIntegrityError('Refusing to remove a directory that is not one of our packages.');
  }
  await rm(root, { recursive: true, force: true });
}
