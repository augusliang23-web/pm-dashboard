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

async function defaultRun(args, { cwd }) {
  const windows = process.platform === 'win32';
  const child = spawn(windows ? 'gcloud.cmd' : 'gcloud', args, { cwd, stdio: 'inherit', shell: windows });
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

export async function runPdfDeploy(argv, options = {}) {
  const {
    registry = loadTargetRegistry(),
    run = defaultRun,
    log = console.log,
    getGitState = defaultGitState,
    cwd = PDF_SERVICE_DIR,
    onEnvFile = () => {}
  } = options;
  const { target: name, dryRun, confirmProduction } = parseArguments(argv);
  const target = assertTargetIsDeployable(name, registry);
  if (!dryRun) {
    if (name === 'production' && !confirmProduction) throw new Error('Deploying the production PDF service requires --confirm-production.');
    const git = await getGitState(cwd);
    if (git.dirty) throw new Error('Refusing to deploy: the working tree is not completely clean (modified, staged, deleted, renamed, or untracked files present).');
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
