import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
