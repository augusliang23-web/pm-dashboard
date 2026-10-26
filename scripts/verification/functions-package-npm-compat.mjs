// LOCAL compatibility probe for the isolated Functions package (no cloud, no release):
//   1. export the given commit's tree into a disposable staging directory and verify it against the tree,
//   2. prove npm loads the two DISTINCT sandbox config files (and that the old /dev/null+/dev/null arrangement collides),
//   3. run a REAL `npm ci` with the guard's exact arguments and environment (needs registry access),
//   4. run the post-install and final pre-CLI integrity scans, including the Firebase Functions SDK entry check,
//   5. ask the installed Firebase CLI's own discovery logic (findFunctionsBinary, a pure file-system lookup) to locate the SDK,
//   6. print the scoped command that WOULD be used. The Firebase CLI is never started and nothing is deployed.
// Usage: node scripts/verification/functions-package-npm-compat.mjs [<full 40-hex commit>]   (default: HEAD)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALL_ARGUMENTS } from '../functions-release-guard.mjs';
import {
  assertPackageIdentity, capturePackageIdentity, disposePackage, exportSourcePackage, listSourceEntries, openRepository,
  resolveSourceCommit, verifyExportedPackage, verifyInstalledPackage
} from '../functions-source-package.mjs';
import { assertNpmSandbox, createNpmSandbox, disposeNpmSandbox, npmInstallEnvironment } from '../npm-sandbox.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(join(root, 'package.json'));

function runNpm(args, { cwd, env }) {
  return new Promise(resolveRun => {
    const child = spawn('npm', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => resolveRun({ code: -1, output: String(error) }));
    child.on('close', code => resolveRun({ code, output }));
  });
}

const result = { steps: {} };
const repository = await openRepository(root);
const { git, objectFormat } = repository;
const head = (await git(['rev-parse', 'HEAD'])).toString().trim();
const source = await resolveSourceCommit(git, process.argv[2] || head, objectFormat);
const entries = await listSourceEntries(git, source.sha, { objectFormat, tree: source.tree });
const packageRoot = await exportSourcePackage({ git, entries, objectFormat });
const sandbox = await createNpmSandbox();
try {
  const identity = await capturePackageIdentity(packageRoot);
  await verifyExportedPackage({ git, root: packageRoot, entries, objectFormat });
  result.steps.export = { commit: source.sha, tree: source.tree, files: entries.length };

  // npm config loading: the old arrangement collides, the sandbox does not.
  const collide = await runNpm(['config', 'get', 'ignore-scripts'], { cwd: join(packageRoot, 'functions'), env: { PATH: process.env.PATH, npm_config_userconfig: '/dev/null', npm_config_globalconfig: '/dev/null' } });
  await assertNpmSandbox(sandbox);
  const env = npmInstallEnvironment(sandbox);
  const loads = await runNpm(['config', 'get', 'userconfig', 'globalconfig', 'ignore-scripts'], { cwd: join(packageRoot, 'functions'), env });
  result.steps.npmConfig = {
    oldArrangement: { exitCode: collide.code, message: (collide.output.match(/double-loading config[^\n]*/) || [''])[0] },
    sandbox: { distinct: sandbox.userconfig !== sandbox.globalconfig, exitCode: loads.code, output: loads.output.trim().split('\n').map(line => line.replace(sandbox.root, '<sandbox>')) }
  };

  const started = Date.now();
  const install = await runNpm([...INSTALL_ARGUMENTS], { cwd: join(packageRoot, 'functions'), env });
  result.steps.npmCi = { args: ['npm', ...INSTALL_ARGUMENTS], exitCode: install.code, seconds: Math.round((Date.now() - started) / 1000), tail: install.output.trim().split('\n').slice(-3) };
  if (install.code !== 0) throw new Error(`npm ci failed with ${install.code}`);
  result.steps.npmCi.topLevelPackages = (await readdir(join(packageRoot, 'functions', 'node_modules'))).filter(name => !name.startsWith('.')).length;
  result.steps.npmCi.binLinksCreatedByNpm = (await readdir(join(packageRoot, 'functions', 'node_modules', '.bin'))).length;

  await assertPackageIdentity(packageRoot, identity);
  const post = await verifyInstalledPackage({ git, root: packageRoot, entries, objectFormat, requireSdkEntry: true });
  result.steps.postInstallScan = { files: post.files, generatedFiles: post.generated, sdk: post.sdk };
  await assertPackageIdentity(packageRoot, identity);
  const final = await verifyInstalledPackage({ git, root: packageRoot, entries, objectFormat, requireSdkEntry: true });
  result.steps.finalScan = { files: final.files, generatedFiles: final.generated, sdk: final.sdk };

  // The Firebase CLI's own SDK lookup (pure file-system lookup; no discovery server, no network, no cloud).
  const { Delegate } = require('firebase-tools/lib/deploy/functions/runtimes/node/index.js');
  const functionsDir = join(packageRoot, 'functions');
  const found = new Delegate('pm-dashboard-uat-20260820-a7f3', packageRoot, functionsDir, 'nodejs22').findFunctionsBinary();
  const realFound = await realpath(found);
  const realRoot = await realpath(packageRoot);
  result.steps.firebaseCliDiscovery = {
    found: found.replace(packageRoot, '<staging>'), resolvedTarget: realFound.replace(realRoot, '<staging>'),
    insideStaging: realFound.startsWith(`${realRoot}/`), insideNodeModules: realFound.startsWith(`${realRoot}/functions/node_modules/`)
  };
  result.steps.mockDeployCommand = 'NOT EXECUTED (mock): deploy --only functions:<named list> --project <id>';
  result.verdict = 'PASS';
} catch (error) {
  result.verdict = 'FAIL';
  result.error = String(error.message || error);
  process.exitCode = 1;
} finally {
  await disposeNpmSandbox(sandbox);
  await disposePackage(packageRoot);
}
console.log(JSON.stringify(result, null, 2));
