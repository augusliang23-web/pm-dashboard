import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { HOSTING_TARGETS, loadHostingEnv } from '../scripts/hosting-env.mjs';
import { buildFirebaseArgs, runDeploy } from '../scripts/deploy-hosting.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const readJson = async path => JSON.parse(await readFile(join(repoRoot, path), 'utf8'));

function harness({ dirty = false, sha = 'abc1234', build } = {}) {
  const calls = { run: [], log: [], build: 0 };
  return {
    calls,
    options: {
      rootDir: repoRoot,
      run: async (command, args) => { calls.run.push([command, ...args]); return 0; },
      log: line => calls.log.push(line),
      getGitState: async () => ({ dirty, sha }),
      build: build || (async ({ env }) => { calls.build += 1; return { files: ['index.html'], projectId: env.firebaseProjectId, pdfReleaseReady: env.pdfServiceUrl !== null }; })
    }
  };
}

test('firebase.json adds a Hosting block without predeploy hooks or rewrites, and keeps every other target', async () => {
  const config = await readJson('firebase.json');
  assert.equal(config.hosting.public, 'dist');
  assert.equal(config.hosting.predeploy, undefined);
  assert.equal(config.hosting.rewrites, undefined);
  assert.equal(config.hosting.redirects, undefined);
  assert.equal(config.functions.source, 'functions');
  assert.equal(config.firestore.rules, 'firestore.rules');
  assert.equal(config.firestore.indexes, undefined, 'root config must not reference the UAT-only index declarations');
  assert.ok(config.emulators);
});

test('Hosting revalidates unversioned files and serves .mjs as JavaScript', async () => {
  const { headers } = (await readJson('firebase.json')).hosting;
  const find = (source, key) => headers.find(rule => rule.source === source)?.headers.find(header => header.key === key)?.value;
  assert.equal(find('**', 'Cache-Control'), 'no-cache');
  assert.match(find('**/*.mjs', 'Content-Type'), /^text\/javascript/);
});

test('.firebaserc keeps the safe demo default and adds exactly the uat and prod aliases', async () => {
  const { projects } = await readJson('.firebaserc');
  assert.equal(projects.default, 'demo-pm-dashboard-v22t');
  assert.equal(projects.uat, HOSTING_TARGETS.uat);
  assert.equal(projects.prod, HOSTING_TARGETS.prod);
  assert.deepEqual(Object.keys(projects).sort(), ['default', 'prod', 'uat']);
});

test('the only deploy targets are declared in code as exactly uat and prod', () => {
  assert.deepEqual(HOSTING_TARGETS, { uat: 'pm-dashboard-uat-20260820-a7f3', prod: 'project-manager-dashboar-a067f' });
});

test('the environment loader rejects an unknown environment and a project that differs from the code allowlist', async () => {
  await assert.rejects(loadHostingEnv(repoRoot, 'staging'), /unknown|not a hosting target/i);
  await assert.rejects(loadHostingEnv(repoRoot, '../package'), /unknown|not a hosting target/i);
});

test('the Firebase CLI arguments are fixed to Hosting and the named project', () => {
  assert.deepEqual(
    buildFirebaseArgs({ envName: 'uat', projectId: HOSTING_TARGETS.uat, sha: 'abc1234' }),
    ['deploy', '--only', 'hosting', '--project', HOSTING_TARGETS.uat, '--message', 'uat abc1234']
  );
  assert.deepEqual(
    buildFirebaseArgs({ envName: 'prod', projectId: HOSTING_TARGETS.prod, sha: 'abc1234' }),
    ['deploy', '--only', 'hosting', '--project', HOSTING_TARGETS.prod, '--message', 'prod abc1234']
  );
});

test('a UAT dry run builds and prints the command but never starts the Firebase CLI', async () => {
  const { calls, options } = harness();
  const code = await runDeploy(['--env', 'uat', '--dry-run'], options);
  assert.equal(code, 0);
  assert.equal(calls.build, 1);
  assert.deepEqual(calls.run, []);
  assert.match(calls.log.join('\n'), new RegExp(`--only hosting --project ${HOSTING_TARGETS.uat}`));
});

test('a real UAT run starts the Firebase CLI exactly once with the fixed arguments', async () => {
  const { calls, options } = harness();
  assert.equal(await runDeploy(['--env', 'uat'], options), 0);
  assert.equal(calls.run.length, 1);
  assert.deepEqual(calls.run[0].slice(1), ['deploy', '--only', 'hosting', '--project', HOSTING_TARGETS.uat, '--message', 'uat abc1234']);
});

test('a Production run is refused without --confirm-production, even with a clean tree', async () => {
  const { calls, options } = harness();
  await assert.rejects(runDeploy(['--env', 'prod'], options), /--confirm-production/);
  assert.deepEqual(calls.run, []);
});

test('a Production dry run does not require --confirm-production', async () => {
  const { calls, options } = harness();
  assert.equal(await runDeploy(['--env', 'prod', '--dry-run'], options), 0);
  assert.deepEqual(calls.run, []);
});

test('a real Production run with --confirm-production starts the Firebase CLI with the Production project', async () => {
  const { calls, options } = harness();
  assert.equal(await runDeploy(['--env', 'prod', '--confirm-production'], options), 0);
  assert.equal(calls.run.length, 1);
  assert.deepEqual(calls.run[0].slice(1), ['deploy', '--only', 'hosting', '--project', HOSTING_TARGETS.prod, '--message', 'prod abc1234']);
});

test('the deploy wrapper refuses anything outside a fixed Hosting-only deploy of a named target', async () => {
  for (const argv of [
    [],
    ['--env'],
    ['--env', 'staging'],
    ['--env', 'uat', '--only', 'functions'],
    ['--env', 'uat', '--project', 'someone-else'],
    ['--env', 'uat', '--force'],
    ['--env', 'uat', 'extra'],
    ['--env=uat']
  ]) {
    const { calls, options } = harness();
    await assert.rejects(runDeploy(argv, options), Error, JSON.stringify(argv));
    assert.deepEqual(calls.run, [], JSON.stringify(argv));
  }
});

test('the deploy wrapper refuses a dirty working tree and a failed build', async () => {
  const dirty = harness({ dirty: true });
  await assert.rejects(runDeploy(['--env', 'uat'], dirty.options), /uncommitted|dirty|clean/i);
  assert.deepEqual(dirty.calls.run, []);

  const failing = harness({ build: async () => { throw new Error('build guard failed'); } });
  await assert.rejects(runDeploy(['--env', 'uat'], failing.options), /build guard failed/);
  assert.deepEqual(failing.calls.run, []);
});

test('a dirty tree does not block a dry run (so it can be used to preview an in-progress change)', async () => {
  const { calls, options } = harness({ dirty: true });
  assert.equal(await runDeploy(['--env', 'uat', '--dry-run'], options), 0);
  assert.deepEqual(calls.run, []);
});

test('the deploy wrapper reports a non-zero Firebase CLI exit instead of hiding it', async () => {
  const { options } = harness();
  options.run = async () => 1;
  await assert.rejects(runDeploy(['--env', 'uat'], options), /exit|failed/i);
});

test('a UAT deploy logs NOT READY FOR RELEASE from the build step it drives', async () => {
  const { calls, options } = harness({
    build: async ({ env, log }) => { log(`NOT READY FOR RELEASE: ${env.environment} has no PDF Cloud Run service configured`); return { files: ['index.html'], projectId: env.firebaseProjectId, pdfReleaseReady: false }; }
  });
  await runDeploy(['--env', 'uat'], options);
  assert.match(calls.log.join('\n'), /NOT READY FOR RELEASE/);
});

test('every Firebase deploy invocation in package scripts and scripts/ is Hosting-only or routed through the deploy wrappers', async () => {
  const targets = [];
  const pkg = await readJson('package.json');
  for (const [name, value] of Object.entries(pkg.scripts)) targets.push([`package.json#${name}`, value]);
  // Every file directly inside scripts/ is scanned regardless of extension: a guard that only recognized a few
  // extensions would miss a stray .sh, .bat, or extensionless script carrying an unscoped deploy.
  for (const entry of await readdir(join(repoRoot, 'scripts'), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const text = await readFile(join(repoRoot, 'scripts', entry.name), 'utf8').catch(() => null);
    if (text !== null) targets.push([`scripts/${entry.name}`, text]);
  }
  assert.ok(targets.length >= Object.keys(pkg.scripts).length + 5, 'sanity: scripts/ must have been scanned');
  for (const [source, text] of targets) {
    for (const match of text.matchAll(/firebase\s+deploy\b[^\n]*/gi)) {
      assert.match(match[0], /--only\s+hosting\b/, `${source} has a Firebase deploy that is not Hosting-only: ${match[0]}`);
    }
  }
});

test('the wrapper source never launches a deploy that could reach Functions, Rules, or Storage', async () => {
  const source = await readFile(join(repoRoot, 'scripts/deploy-hosting.mjs'), 'utf8');
  assert.doesNotMatch(source, /['"]--only['"]\s*,\s*['"](?!hosting['"])/);
  assert.doesNotMatch(source, /shell\s*:\s*true/);
  assert.doesNotMatch(source, /['"]functions['"]|firestore:rules|--force/);
});

test('package scripts expose build/deploy pairs for both environments without touching the GitHub Pages deploy', async () => {
  const { scripts } = await readJson('package.json');
  assert.equal(scripts['build:hosting:uat'], 'node scripts/build-hosting.mjs --env uat');
  assert.equal(scripts['build:hosting:prod'], 'node scripts/build-hosting.mjs --env prod');
  assert.equal(scripts['deploy:hosting:uat'], 'node scripts/deploy-hosting.mjs --env uat');
  assert.equal(scripts['deploy:hosting:uat:dry'], 'node scripts/deploy-hosting.mjs --env uat --dry-run');
  assert.equal(scripts['deploy:hosting:prod'], 'node scripts/deploy-hosting.mjs --env prod --confirm-production');
  assert.equal(scripts['deploy:hosting:prod:dry'], 'node scripts/deploy-hosting.mjs --env prod --dry-run');
  assert.match(scripts.deploy, /deploy-after-verify\.mjs/);
});
