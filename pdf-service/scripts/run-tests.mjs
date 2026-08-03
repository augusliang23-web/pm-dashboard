import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  acquireBrowserTestLock,
  DEFAULT_BROWSER_TEST_LOCK_PATH
} from './browser-test-lock.mjs';

export async function discoverTestFiles(testDirectory) {
  const entries = await readdir(testDirectory, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map(entry => resolve(testDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export function buildNodeTestArgs(testFiles) {
  return ['--test', '--test-concurrency=1', ...testFiles];
}

function childExitCode(child) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolveExit(Number.isInteger(code) ? code : 1));
  });
}

export async function runNodeTests({
  testFiles,
  lockPath = DEFAULT_BROWSER_TEST_LOCK_PATH,
  stdio = 'inherit'
}) {
  if (!Array.isArray(testFiles) || testFiles.length === 0) {
    throw new Error('At least one Node test file is required.');
  }

  const lock = await acquireBrowserTestLock({ lockPath });
  let child;
  const forwardSignal = signal => child?.kill(signal);
  const onSigint = () => forwardSignal('SIGINT');
  const onSigterm = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  try {
    const childEnvironment = { ...process.env };
    delete childEnvironment.NODE_TEST_CONTEXT;
    child = spawn(process.execPath, buildNodeTestArgs(testFiles), {
      stdio,
      env: childEnvironment
    });
    child.stdout?.resume();
    child.stderr?.resume();
    return await childExitCode(child);
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    await lock.release();
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  const testDirectory = fileURLToPath(new URL('../test/', import.meta.url));
  const testFiles = await discoverTestFiles(testDirectory);
  process.exitCode = await runNodeTests({ testFiles });
}
