import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForPositiveIntegerFile(path, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = Number.parseInt(await readFile(path, 'utf8'), 10);
      if (Number.isSafeInteger(value) && value > 0) return value;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function waitForChild(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for child ${child.pid}`)), timeoutMs);
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function loadRunnerModule() {
  try {
    return await import('../scripts/run-tests.mjs');
  } catch (error) {
    assert.fail(`run-tests.mjs must export buildNodeTestArgs: ${error.code || error.message}`);
  }
}

test('discovers only test modules in deterministic order', async () => {
  const { discoverTestFiles } = await loadRunnerModule();
  const directory = await mkdtemp(join(tmpdir(), 'pm-dashboard-test-discovery-'));

  try {
    await writeFile(join(directory, 'b.test.mjs'), '');
    await writeFile(join(directory, 'a.test.mjs'), '');
    await writeFile(join(directory, 'fixture.mjs'), '');
    await mkdir(join(directory, 'nested.test.mjs'));

    assert.deepEqual(await discoverTestFiles(directory), [
      join(directory, 'a.test.mjs'),
      join(directory, 'b.test.mjs')
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('builds a single-concurrency Node test command', async () => {
  const { buildNodeTestArgs } = await loadRunnerModule();

  assert.deepEqual(buildNodeTestArgs(['/tmp/a.test.mjs', '/tmp/b.test.mjs']), [
    '--test',
    '--test-concurrency=1',
    '/tmp/a.test.mjs',
    '/tmp/b.test.mjs'
  ]);
});

test('propagates real Node test success and failure exit codes', async () => {
  const { runNodeTests } = await loadRunnerModule();
  const directory = await mkdtemp(join(tmpdir(), 'pm-dashboard-test-runner-'));
  const lockPath = join(directory, 'runner.lock');
  const passingTest = join(directory, 'passing.test.mjs');
  const failingTest = join(directory, 'failing.test.mjs');

  try {
    await writeFile(passingTest, `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('passes', () => assert.equal(1, 1));\n`);
    await writeFile(failingTest, `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('fails', () => assert.equal(1, 2));\n`);

    assert.equal(await runNodeTests({ testFiles: [passingTest], lockPath, stdio: 'pipe' }), 0);
    assert.equal(await runNodeTests({ testFiles: [failingTest], lockPath, stdio: 'pipe' }), 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const { signal, exitCode } of [
  { signal: 'SIGINT', exitCode: 130 },
  { signal: 'SIGTERM', exitCode: 143 }
]) {
  test(`${signal} removes the complete Node test process tree before releasing the lock`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pm-dashboard-test-runner-signal-'));
  const lockPath = join(directory, 'runner.lock');
  const descendantPidPath = join(directory, 'descendant.pid');
  const hangingTest = join(directory, 'hanging.test.mjs');
  const harness = join(directory, 'harness.mjs');
  const runnerUrl = pathToFileURL(join(process.cwd(), 'scripts', 'run-tests.mjs')).href;
  let harnessProcess;
  let descendantPid;

  try {
    await writeFile(hangingTest, `
      import test from 'node:test';
      import { spawn } from 'node:child_process';
      import { writeFile } from 'node:fs/promises';
      test('hangs with a descendant', async () => {
        const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        descendant.unref();
        await writeFile(${JSON.stringify(descendantPidPath)}, String(descendant.pid));
        await new Promise(resolve => setTimeout(resolve, 60_000));
      });
    `);
    await writeFile(harness, `
      import { runNodeTests } from ${JSON.stringify(runnerUrl)};
      process.exitCode = await runNodeTests({
        testFiles: [${JSON.stringify(hangingTest)}],
        lockPath: ${JSON.stringify(lockPath)},
        stdio: 'ignore',
        terminationGraceMs: 100,
        processTreeExitTimeoutMs: 1000
      });
    `);

    harnessProcess = spawn(process.execPath, [harness], { stdio: 'ignore' });
    const harnessExit = waitForChild(harnessProcess);
    descendantPid = await waitForPositiveIntegerFile(descendantPidPath);
    assert.equal(processIsAlive(descendantPid), true);

    harnessProcess.kill(signal);
    assert.deepEqual(await harnessExit, { code: exitCode, signal: null });
    await assert.rejects(access(lockPath), error => error?.code === 'ENOENT');

    for (let attempt = 0; attempt < 50 && processIsAlive(descendantPid); attempt += 1) {
      await delay(20);
    }
    assert.equal(processIsAlive(descendantPid), false);
  } finally {
    if (harnessProcess && harnessProcess.exitCode === null && harnessProcess.signalCode === null) {
      harnessProcess.kill('SIGKILL');
    }
    if (descendantPid && processIsAlive(descendantPid)) {
      process.kill(descendantPid, 'SIGKILL');
    }
    await rm(directory, { recursive: true, force: true });
  }
  });
}

test('a repeated SIGINT escalates the child tree without bypassing lock cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pm-dashboard-test-runner-repeat-signal-'));
  const lockPath = join(directory, 'runner.lock');
  const descendantPidPath = join(directory, 'descendant.pid');
  const hangingTest = join(directory, 'hanging.test.mjs');
  const harness = join(directory, 'harness.mjs');
  const runnerUrl = pathToFileURL(join(process.cwd(), 'scripts', 'run-tests.mjs')).href;
  let harnessProcess;
  let descendantPid;

  try {
    await writeFile(hangingTest, `
      import test from 'node:test';
      import { spawn } from 'node:child_process';
      import { writeFile } from 'node:fs/promises';
      test('hangs with a signal-resistant descendant', async () => {
        const code = \`
          const { writeFileSync } = require('node:fs');
          process.on('SIGINT', () => {});
          process.on('SIGTERM', () => {});
          writeFileSync(${JSON.stringify(descendantPidPath)}, String(process.pid));
          setInterval(() => {}, 1000);
        \`;
        const descendant = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
        descendant.unref();
        await new Promise(resolve => setTimeout(resolve, 60_000));
      });
    `);
    await writeFile(harness, `
      import { runNodeTests } from ${JSON.stringify(runnerUrl)};
      process.exitCode = await runNodeTests({
        testFiles: [${JSON.stringify(hangingTest)}],
        lockPath: ${JSON.stringify(lockPath)},
        stdio: 'ignore',
        terminationGraceMs: 1000,
        processTreeExitTimeoutMs: 1000
      });
    `);

    harnessProcess = spawn(process.execPath, [harness], { stdio: 'ignore' });
    const harnessExit = waitForChild(harnessProcess);
    descendantPid = await waitForPositiveIntegerFile(descendantPidPath);
    assert.equal(processIsAlive(descendantPid), true);

    harnessProcess.kill('SIGINT');
    await delay(50);
    harnessProcess.kill('SIGINT');

    assert.deepEqual(await harnessExit, { code: 130, signal: null });
    await assert.rejects(access(lockPath), error => error?.code === 'ENOENT');
    assert.equal(processIsAlive(descendantPid), false);
  } finally {
    if (harnessProcess && harnessProcess.exitCode === null && harnessProcess.signalCode === null) {
      harnessProcess.kill('SIGKILL');
    }
    if (descendantPid && processIsAlive(descendantPid)) {
      process.kill(descendantPid, 'SIGKILL');
    }
    await rm(directory, { recursive: true, force: true });
  }
});
