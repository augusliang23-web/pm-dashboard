import { spawnSync } from 'node:child_process';

const targetRepo = 'pm-dashboard-uat';
const pushRequested = process.argv.includes('--push');

function run(command, args, options = {}) {
  return spawnSync(command, args, { stdio: 'inherit', ...options });
}

function output(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
  return result.stdout.trim();
}

const remote = output('git', ['config', '--get', 'remote.origin.url']);
if (!remote.includes(targetRepo)) {
  throw new Error(`Refusing to deploy: this checkout is not ${targetRepo}.`);
}

const verify = run('npm', ['run', 'verify:local']);
if (verify.error || verify.status !== 0) {
  throw new Error('Refusing to deploy because verify:local failed.');
}

const branch = output('git', ['branch', '--show-current']);
if (!pushRequested) {
  console.log(`Local verification passed for ${targetRepo} on ${branch}.`);
  console.log('Nothing was pushed. To publish from main after committing confirmed files, run: npm run deploy -- --push');
  process.exit(0);
}

if (branch !== 'main') throw new Error(`Refusing to push ${targetRepo}: current branch is ${branch}, expected main.`);
const status = output('git', ['status', '--porcelain']);
if (status) throw new Error('Refusing to push: working tree is not clean. Commit only confirmed files first.');

const push = run('git', ['push', 'origin', 'main']);
if (push.error || push.status !== 0) throw new Error('GitHub Pages publish push failed.');
console.log(`Published ${targetRepo}/main after fresh local verification.`);
