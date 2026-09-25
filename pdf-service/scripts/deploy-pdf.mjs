import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CLOUD_ENVIRONMENTS, PdfEnvironmentError, loadTargetRegistry } from '../src/environment.js';
import { parseAllowedOrigins } from '../src/cors.js';

const execFileAsync = promisify(execFile);
const PDF_SERVICE_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Every Cloud Run deploy of the PDF service is built here from the versioned target registry. Environment variables
// travel in a temporary --env-vars-file (a complete replacement of the service's variables), never in an inline
// --set-env-vars string, so no shell-specific escaping is involved.
export function assertTargetIsDeployable(name, registry) {
  if (!CLOUD_ENVIRONMENTS.includes(name)) throw new PdfEnvironmentError(`Unknown PDF deploy target "${name}".`);
  const target = registry.targets?.[name];
  if (!target || target.environment !== name) throw new PdfEnvironmentError(`Target "${name}" is not in the registry.`);
  for (const key of ['firebaseProjectId', 'region', 'serviceName', 'runtimeServiceAccount']) {
    if (typeof target[key] !== 'string' || !target[key].trim()) throw new PdfEnvironmentError(`Target "${name}" has no ${key}.`);
  }
  if (!target.runtimeServiceAccount.endsWith(`@${target.firebaseProjectId}.iam.gserviceaccount.com`)) {
    throw new PdfEnvironmentError(`Target "${name}" runtime service account must belong to ${target.firebaseProjectId}.`);
  }
  const origins = parseAllowedOrigins(target.allowedOrigins);
  if (!origins.length || origins.length !== target.allowedOrigins.length) {
    throw new PdfEnvironmentError(`Target "${name}" allowed origins must be exact bare origins.`);
  }
  return target;
}

export function buildEnvVarsYaml(target) {
  return [
    `PDF_ENVIRONMENT: ${JSON.stringify(target.environment)}`,
    `FIREBASE_PROJECT_ID: ${JSON.stringify(target.firebaseProjectId)}`,
    `ALLOWED_ORIGIN: ${JSON.stringify(target.allowedOrigins.join(','))}`,
    ''
  ].join('\n');
}

export function buildGcloudArgs(target, envFile) {
  return [
    'run', 'deploy', target.serviceName,
    '--source', '.',
    '--project', target.firebaseProjectId,
    '--region', target.region,
    '--allow-unauthenticated',
    '--ingress', 'all',
    '--min-instances', '0',
    '--max-instances', '1',
    '--concurrency', '1',
    '--cpu', '1',
    '--memory', '1Gi',
    '--timeout', '120',
    '--service-account', target.runtimeServiceAccount,
    '--env-vars-file', envFile,
    '--quiet'
  ];
}

function parseArguments(argv) {
  const args = [...argv];
  const parsed = { target: '', dryRun: false, confirmProduction: false };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--target') parsed.target = args.shift() || '';
    else if (flag === '--dry-run') parsed.dryRun = true;
    else if (flag === '--confirm-production') parsed.confirmProduction = true;
    else throw new Error(`Unsupported argument "${flag}". Usage: node scripts/deploy-pdf.mjs --target <uat|production> [--dry-run] [--confirm-production]`);
  }
  if (!parsed.target || parsed.target.startsWith('-')) throw new Error('--target <uat|production> is required.');
  return parsed;
}

// On Windows, the gcloud CLI is installed as a `gcloud.cmd` shim, not a native executable. Windows' CreateProcess
// cannot launch a .cmd/.bat file directly -- only a true native executable can bypass a shell there -- so any
// Windows invocation of gcloud needs `shell: true` just to start the process at all.
//
// That option is not a safety guarantee, and this comment previously and incorrectly claimed it was one: Node's
// own DEP0190 deprecation notice is explicit that with `shell: true`, the argument array is NOT individually
// quoted or escaped -- it is joined with spaces before being handed to cmd.exe, exactly like a hand-built command
// string would be. Every argument this module passes to gcloud today is a fixed literal or comes from the
// versioned target registry, never unsanitized external input, so this has not been exploitable in practice --
// but "not exploitable in practice today" is a different, much weaker claim than "safely escaped," and this code
// makes no attempt at ad-hoc quoting to bridge that gap. Real Windows execution of gcloud has therefore also never
// actually been exercised against a real `gcloud.cmd` shim in this project.
//
// Given that, real PDF deployment on Windows is not supported by this release at all (see
// assertPlatformSupportsRealDeploy below, which fails every real deploy closed before any of this is reached).
// This helper and the `shell: true` branch remain defined only so `resolveGcloudExecutable` and
// `defaultUploadCandidates` stay directly unit-testable, and so a future, dedicated Windows-support PR that
// implements and proves safe real Windows execution (e.g. by invoking a native launcher instead of a shell, or by
// quoting arguments correctly) has something to build on. No supported code path in this module reaches the
// Windows branch of this helper today.
export function resolveGcloudExecutable(platform = process.platform) {
  const windows = platform === 'win32';
  return { command: windows ? 'gcloud.cmd' : 'gcloud', shell: windows };
}

// Control Plane decision: real PDF deployment (UAT or Production) is supported only on the validated macOS/Linux
// path. --dry-run remains supported on every platform, including Windows, because it never invokes gcloud at all
// -- it only logs the command that would run. This check runs before the Production confirmation gate, the
// git-clean check, the upload-manifest boundary check, and the temporary env file, so a Windows caller never
// reaches any of that, let alone gcloud.
export function assertPlatformSupportsRealDeploy(platform = process.platform) {
  if (platform === 'win32') {
    throw new Error(
      'Real PDF deployment on Windows is not supported by this release. Use the validated macOS/Linux deployment ' +
      'path (Windows may still use --dry-run, which works on every platform and never invokes gcloud).'
    );
  }
}

async function defaultRun(args, { cwd }) {
  const { command, shell } = resolveGcloudExecutable();
  const child = spawn(command, args, { cwd, stdio: 'inherit', shell });
  return new Promise((done, fail) => { child.on('error', fail); child.on('close', code => done(code ?? 1)); });
}

// `gcloud run deploy --source .` uploads the working tree as gcloud finds it on disk -- tracked or not, committed
// or not. A dirty-tree guard that only looks at tracked changes (the previous `--untracked-files=no`) lets an
// untracked file ride along into the Cloud Run source upload, and potentially into the built image, without ever
// being caught here. So this reads the *complete* working-tree state -- modified, staged, deleted, renamed, and
// untracked files all surface in default (`--untracked-files=normal`) porcelain output -- while still leaving
// .gitignore'd paths (node_modules, tmp/, ...) out of it, exactly as normal development expects.
export async function defaultGitState(cwd) {
  const status = await execFileAsync('git', ['status', '--porcelain'], { cwd });
  const head = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd });
  return { dirty: status.stdout.trim() !== '', sha: head.stdout.trim() };
}

// ---------------------------------------------------------------------------------------------------------------
// gcloud upload boundary guard.
//
// The dirty-tree guard above answers "is everything git knows about committed?" -- it does not answer "will
// gcloud upload anything git doesn't know about?", and those are different questions. `gcloud run deploy
// --source .` resolves its own upload file set using gcloud's `.gcloudignore` semantics, which are independent of
// git's ignore configuration (root .gitignore, pdf-service/.gcloudignore, .git/info/exclude, and any global
// excludesfile can all disagree with each other). A file can be git-ignored (so `git status --porcelain` reports
// the tree as clean) while gcloud still decides to upload it -- for example a stray `tmp/local-only.txt` the root
// .gitignore hides from git, that pdf-service/.gcloudignore never mentions and so gcloud still picks up. Keeping
// .gitignore and .gcloudignore manually in sync is exactly the kind of brittle, driftable invariant this repo
// has already been burned by once (the stale deploy.ps1 this PR replaced); this guard does not rely on that sync
// at all.
//
// The required invariant is a subset relationship, checked with gcloud's own upload resolution rather than a
// reimplemented .gcloudignore parser:
//
//     every file gcloud would actually upload MUST be a git-tracked file (upload set ⊆ tracked set)
//
// The upload set is expected to be a *strict* subset of the tracked set -- .gcloudignore deliberately excludes
// tracked development files (test/, scripts/, README.md, deploy.ps1, ...) from the image. That is correct and
// this guard never flags it. The only unsafe case is an upload candidate that is not tracked by git at all.
export class UploadManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadManifestError';
  }
}

// A bare `\`, forward-slash normalization, and a stripped leading "./" so a Windows-style gcloud path
// ("src\\server.js") and a git-reported POSIX path ("src/server.js") compare equal, and so "./src/server.js" and
// "src/server.js" are treated as the same entry.
export function normalizeUploadPath(rawPath) {
  return String(rawPath).replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

// Parses raw `gcloud meta list-files-for-upload` stdout into a list of non-blank, normalized paths. An entirely
// blank result is treated as a parsing anomaly, not as "gcloud intends to upload zero files": a real pdf-service
// source deploy always uploads at least package.json and src/*.js, so blank output almost certainly means the
// command was run against the wrong directory or otherwise did not do what was intended, and silently treating
// it as a vacuously-safe empty set would be exactly the kind of "silently ignore the anomaly" this guard exists
// to avoid. Fails closed by throwing rather than returning an empty array.
export function parseUploadManifestOutput(stdout) {
  if (typeof stdout !== 'string') {
    throw new UploadManifestError('gcloud upload manifest output was not text.');
  }
  const lines = stdout
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
  if (lines.length === 0) {
    throw new UploadManifestError(
      'gcloud reported an empty source upload manifest; refusing to deploy without a verifiable file list.'
    );
  }
  return lines;
}

export async function defaultGitTrackedFiles(cwd) {
  const { stdout } = await execFileAsync('git', ['ls-files'], { cwd });
  return stdout.split(/\r\n|\r|\n/).map(line => line.trim()).filter(line => line.length > 0);
}

export async function defaultUploadCandidates(cwd, {
  platform = process.platform,
  execFileImpl = execFileAsync
} = {}) {
  const { command, shell } = resolveGcloudExecutable(platform);
  const { stdout } = await execFileImpl(command, ['meta', 'list-files-for-upload'], { cwd, shell });
  return parseUploadManifestOutput(stdout);
}

// Pure comparison: every normalized upload candidate must appear in the normalized tracked set. Duplicate upload
// candidates are deduplicated deterministically (a path reported twice is checked once); the returned list of
// violations is sorted so the guard's error message and this function's own output are deterministic across runs.
export function findUntrackedUploadCandidates(uploadCandidates, trackedFiles) {
  const trackedSet = new Set(trackedFiles.map(normalizeUploadPath));
  const seen = new Set();
  const untracked = [];
  for (const raw of uploadCandidates) {
    const normalized = normalizeUploadPath(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    if (!trackedSet.has(normalized)) untracked.push(normalized);
  }
  return untracked.sort();
}

// The deployment guard itself: resolves both sets and rejects before any real deploy invocation if gcloud would
// upload anything git does not track. Enumeration failure on either side fails closed (the deploy is refused,
// never silently allowed to proceed on partial information).
export async function assertUploadWithinGitTrackedFiles(cwd, {
  getTrackedFiles = defaultGitTrackedFiles,
  getUploadCandidates = defaultUploadCandidates
} = {}) {
  let tracked;
  try {
    tracked = await getTrackedFiles(cwd);
  } catch (error) {
    throw new Error(`Refusing to deploy: could not determine the git-tracked file set (${error.message}).`);
  }

  let uploadCandidates;
  try {
    uploadCandidates = await getUploadCandidates(cwd);
  } catch (error) {
    throw new Error(`Refusing to deploy: could not determine gcloud's source upload file set (${error.message}).`);
  }

  const untracked = findUntrackedUploadCandidates(uploadCandidates, tracked);
  if (untracked.length) {
    throw new Error(
      `Refusing to deploy: gcloud would upload ${untracked.length} file(s) that git does not track: ` +
      `${untracked.join(', ')}. Every uploaded file must be a committed, tracked file -- untrack, .gcloudignore, ` +
      'or delete these before deploying.'
    );
  }
}

export async function runPdfDeploy(argv, options = {}) {
  const {
    registry = loadTargetRegistry(),
    run = defaultRun,
    log = console.log,
    getGitState = defaultGitState,
    getTrackedFiles = defaultGitTrackedFiles,
    getUploadCandidates = defaultUploadCandidates,
    platform = process.platform,
    cwd = PDF_SERVICE_DIR,
    onEnvFile = () => {}
  } = options;
  const { target: name, dryRun, confirmProduction } = parseArguments(argv);
  const target = assertTargetIsDeployable(name, registry);
  if (!dryRun) {
    // Order matters: platform support, then the Production confirmation gate, then the git-clean check, then the
    // gcloud upload-boundary check -- all before the temp env file is even created, let alone gcloud invoked.
    // None of this runs in --dry-run: a dry run must stay usable on every platform, including Windows, and
    // without gcloud installed at all (as this exact sandbox demonstrates), so it is deliberately never made to
    // depend on gcloud's own tooling being present.
    assertPlatformSupportsRealDeploy(platform);
    if (name === 'production' && !confirmProduction) throw new Error('Deploying the production PDF service requires --confirm-production.');
    const git = await getGitState(cwd);
    if (git.dirty) throw new Error('Refusing to deploy: the working tree is not completely clean (modified, staged, deleted, renamed, or untracked files present).');
    await assertUploadWithinGitTrackedFiles(cwd, { getTrackedFiles, getUploadCandidates });
  }

  const directory = await mkdtemp(join(tmpdir(), 'pdf-deploy-'));
  try {
    const envFile = join(directory, 'env.yaml');
    await writeFile(envFile, buildEnvVarsYaml(target), { mode: 0o600 });
    onEnvFile(envFile);
    const args = buildGcloudArgs(target, envFile);
    log(`> gcloud ${args.join(' ')}`);
    log(`environment variables (complete replacement):\n${buildEnvVarsYaml(target)}`);
    if (dryRun) { log('Dry run: gcloud was not started.'); return 0; }
    const code = await run(args, { cwd });
    if (code !== 0) throw new Error(`gcloud exited with code ${code}; nothing was verified as deployed.`);
    return 0;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runPdfDeploy(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
