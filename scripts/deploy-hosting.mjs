import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildHosting } from './build-hosting.mjs';
import { HOSTING_TARGETS, loadHostingEnv } from './hosting-env.mjs';

const execFileAsync = promisify(execFile);

// Every deploy from this repository is Hosting-only and pinned to one project. The Firebase CLI arguments are
// built here and nowhere else.
export function buildFirebaseArgs({ envName, projectId, sha }) {
  return ['deploy', '--only', 'hosting', '--project', projectId, '--message', `${envName} ${sha}`];
}

function parseArguments(argv) {
  const args = [...argv];
  const parsed = { envName: '', dryRun: false, confirmProduction: false };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--env') {
      parsed.envName = args.shift() || '';
      if (!parsed.envName || parsed.envName.startsWith('-')) throw new Error('--env requires an environment name.');
    } else if (flag === '--dry-run') {
      parsed.dryRun = true;
    } else if (flag === '--confirm-production') {
      parsed.confirmProduction = true;
    } else {
      throw new Error(`Unsupported argument "${flag}". Usage: node scripts/deploy-hosting.mjs --env <${Object.keys(HOSTING_TARGETS).join('|')}> [--dry-run] [--confirm-production]`);
    }
  }
  if (!parsed.envName) throw new Error(`Usage: node scripts/deploy-hosting.mjs --env <${Object.keys(HOSTING_TARGETS).join('|')}> [--dry-run] [--confirm-production]`);
  return parsed;
}

async function defaultGetGitState(rootDir) {
  const options = { cwd: rootDir };
  const status = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=no'], options);
  const head = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], options);
  return { dirty: status.stdout.trim() !== '', sha: head.stdout.trim() };
}

async function defaultRun(command, args, { cwd }) {
  const packageDir = join(cwd, 'node_modules', `${command}-tools`);
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8').catch(() => {
    throw new Error(`${command}-tools is not installed here. Run npm ci first.`);
  }));
  const child = spawn(process.execPath, [join(packageDir, manifest.bin[command]), ...args], { cwd, stdio: 'inherit' });
  return new Promise((resolveExit, reject) => {
    child.on('error', reject);
    child.on('close', code => resolveExit(code ?? 1));
  });
}

export async function runDeploy(argv, options = {}) {
  const {
    rootDir = resolve(fileURLToPath(new URL('..', import.meta.url))),
    run = defaultRun,
    log = console.log,
    getGitState = defaultGetGitState,
    build = buildHosting
  } = options;

  const { envName, dryRun, confirmProduction } = parseArguments(argv);
  const env = await loadHostingEnv(rootDir, envName);
  const git = await getGitState(rootDir);

  if (!dryRun) {
    if (envName === 'prod' && !confirmProduction) {
      throw new Error('Deploying the Production Hosting site requires --confirm-production.');
    }
    if (git.dirty) {
      throw new Error('Refusing to deploy: the working tree has uncommitted tracked changes. Commit them first so the deploy is traceable.');
    }
  }

  const { files, pdfReleaseReady } = await build({ rootDir, outDir: join(rootDir, 'dist'), env, log });
  const args = buildFirebaseArgs({ envName, projectId: env.firebaseProjectId, sha: git.sha });
  log(`Built dist/ for ${envName}: ${files.length} files. PDF release ready: ${pdfReleaseReady}.`);
  log(`> ${['firebase', ...args].join(' ')}`);
  if (dryRun) {
    log('Dry run: the Firebase CLI was not started.');
    return 0;
  }

  const code = await run('firebase', args, { cwd: rootDir });
  if (code !== 0) throw new Error(`The Firebase CLI exited with code ${code}; nothing was verified as deployed.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runDeploy(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
