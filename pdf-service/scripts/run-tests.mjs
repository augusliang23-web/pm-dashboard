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

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const supportsProcessGroups = process.platform !== 'win32';

function childExitResult(child) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

function signalProcessTree(child, signal) {
  if (!child?.pid) return false;
  try {
    if (supportsProcessGroups) {
      process.kill(-child.pid, signal);
      return true;
    }
    return child.kill(signal);
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function processTreeIsAlive(child) {
  if (!child?.pid || !supportsProcessGroups) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function waitForProcessTreeExit(child, timeoutMs) {
  const startedAt = Date.now();
  while (processTreeIsAlive(child)) {
    if (Date.now() - startedAt >= timeoutMs) return false;
    await delay(Math.min(20, Math.max(1, timeoutMs - (Date.now() - startedAt))));
  }
  return true;
}

async function ensureProcessTreeExited(child, {
  requestedSignal,
  terminationGraceMs,
  processTreeExitTimeoutMs
}) {
  if (!supportsProcessGroups || !processTreeIsAlive(child)) return true;

  signalProcessTree(child, requestedSignal || 'SIGTERM');
  if (await waitForProcessTreeExit(child, terminationGraceMs)) return true;

  signalProcessTree(child, 'SIGKILL');
  return waitForProcessTreeExit(child, processTreeExitTimeoutMs);
}

function signalExitCode(signal) {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGTERM') return 143;
  return 1;
}

export async function runNodeTests({
  testFiles,
  lockPath = DEFAULT_BROWSER_TEST_LOCK_PATH,
  stdio = 'inherit',
  terminationGraceMs = 2000,
  processTreeExitTimeoutMs = 2000
}) {
  if (!Array.isArray(testFiles) || testFiles.length === 0) {
    throw new Error('At least one Node test file is required.');
  }

  const lock = await acquireBrowserTestLock({ lockPath });
  let child;
  let requestedSignal = null;
  let escalationTimer;
  const forwardSignal = signal => {
    requestedSignal ||= signal;
    if (!child) return;
    signalProcessTree(child, signal);
    clearTimeout(escalationTimer);
    escalationTimer = setTimeout(() => signalProcessTree(child, 'SIGKILL'), terminationGraceMs);
    escalationTimer.unref();
  };
  const onSigint = () => forwardSignal('SIGINT');
  const onSigterm = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  try {
    const childEnvironment = { ...process.env };
    delete childEnvironment.NODE_TEST_CONTEXT;
    child = spawn(process.execPath, buildNodeTestArgs(testFiles), {
      stdio,
      env: childEnvironment,
      detached: supportsProcessGroups
    });
    if (requestedSignal) forwardSignal(requestedSignal);
    child.stdout?.resume();
    child.stderr?.resume();
    const result = await childExitResult(child);
    if (requestedSignal) return signalExitCode(requestedSignal);
    if (Number.isInteger(result.code)) return result.code;
    return signalExitCode(result.signal || requestedSignal);
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    clearTimeout(escalationTimer);
    const treeExited = !child || await ensureProcessTreeExited(child, {
      requestedSignal,
      terminationGraceMs,
      processTreeExitTimeoutMs
    });
    if (!treeExited) {
      throw new Error(`Node test process group ${child.pid} did not exit after SIGKILL; browser-test lock was retained.`);
    }
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
