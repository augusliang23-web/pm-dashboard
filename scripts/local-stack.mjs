import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const functionsRoot = resolve(repoRoot, 'functions');
const tmpRoot = resolve(repoRoot, 'tmp');
const statePath = resolve(tmpRoot, 'v22t-local-processes.json');
const projectId = 'demo-pm-dashboard-v22t';
const ports = { auth: 9099, firestore: 8080, functions: 5001, preview: 4173 };
const localEnv = {
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

function fail(message) {
  console.error(`local-stack-error: ${message}`);
  process.exitCode = 1;
}

function checkCommand(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.error || (result.status !== 0 && !/\d+\.\d+\.\d+/.test(output))) {
    throw new Error(`${label} is unavailable`);
  }
}

function javaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(resolve(candidate, 'bin/java'), ['-version'], { stdio: 'ignore' });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error('Java Runtime 21 or newer is unavailable; install OpenJDK 21 before starting Firebase Emulator');
}

function portIsOpen(port) {
  return new Promise(resolvePort => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = result => {
      socket.destroy();
      resolvePort(result);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(800, () => finish(false));
  });
}

async function assertPortsFree() {
  for (const [name, port] of Object.entries(ports)) {
    if (await portIsOpen(port)) throw new Error(`port ${port} (${name}) is already in use`);
  }
}

function startProcess(command, args, env, logName) {
  const output = openSync(resolve(tmpRoot, logName), 'a');
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: true,
    env: { ...process.env, ...env },
    stdio: ['ignore', output, output],
  });
  child.once('error', error => console.error(`${logName}: ${error.message}`));
  return child;
}

async function waitForPort(port, label) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await portIsOpen(port)) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }
  throw new Error(`${label} did not start on port ${port}`);
}

function runSeed() {
  const result = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/seed-v2.2t-emulator.mjs')], {
    cwd: repoRoot,
    env: { ...process.env, ...localEnv },
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) throw new Error('local seed failed');
}

async function writeState(children) {
  await writeFile(statePath, `${JSON.stringify({
    version: 1,
    projectId,
    pids: children.map(child => child.pid),
  }, null, 2)}\n`, 'utf8');
}

async function stopChildren(children) {
  for (const child of children.reverse()) {
    if (!child.pid) continue;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
}

async function main() {
  const seedOnly = process.argv.includes('--seed-only');
  await mkdir(tmpRoot, { recursive: true });
  checkCommand('firebase', ['--version'], 'Firebase CLI');
  const home = javaHome();
  if (!seedOnly) await assertPortsFree();

  if (seedOnly) {
    for (const port of [ports.auth, ports.firestore, ports.functions]) {
      if (!(await portIsOpen(port))) throw new Error(`Emulator service is unavailable on port ${port}`);
    }
    runSeed();
    console.log('Seeded local v2.2T test accounts.');
    return;
  }

  const emulator = startProcess('firebase', ['emulators:start', '--project', projectId, '--only', 'auth,firestore,functions'], {
    JAVA_HOME: home,
    PATH: `${resolve(home, 'bin')}:${process.env.PATH || ''}`,
  }, 'v22t-emulator.log');
  const children = [emulator];
  try {
    for (const [name, port] of Object.entries({ auth: ports.auth, firestore: ports.firestore, functions: ports.functions })) {
      await waitForPort(port, name);
    }
    runSeed();
    const preview = startProcess(process.execPath, [resolve(repoRoot, 'scripts/serve-static.mjs'), String(ports.preview)], {}, 'v22t-preview.log');
    children.push(preview);
    await waitForPort(ports.preview, 'preview');
    await writeState(children);
    console.log('v2.2T local stack is ready.');
    console.log('Open http://127.0.0.1:4173/?emulator=1');
    console.log('Test admin: test.admin@pm-dashboard.local / TestOnly!12345');
    console.log('Stop with: npm run local:stop');
    await new Promise(resolveWait => {
      const shutdown = async () => { await stopChildren(children); resolveWait(); };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
  } catch (error) {
    await stopChildren(children);
    throw error;
  }
}

main().catch(error => fail(error.message));
