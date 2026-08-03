import { randomUUID } from 'node:crypto';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_BROWSER_TEST_LOCK_PATH = join(tmpdir(), 'pm-dashboard-pdf-browser-tests.lock');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function inspectLock(lockPath) {
  try {
    const [contents, fileStat] = await Promise.all([
      readFile(lockPath, 'utf8'),
      stat(lockPath)
    ]);
    let record = null;
    try {
      record = JSON.parse(contents);
    } catch {
      // A newly created lock can be observed before its owner record is fully written.
    }
    return { record, ageMs: Math.max(0, Date.now() - fileStat.mtimeMs) };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function removeExactLock(lockPath) {
  try {
    await unlink(lockPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function acquireBrowserTestLock({
  lockPath = DEFAULT_BROWSER_TEST_LOCK_PATH,
  timeoutMs = 600_000,
  pollMs = 100,
  malformedGraceMs = 1000
} = {}) {
  const startedAt = Date.now();
  const token = randomUUID();
  const record = { pid: process.pid, token, acquiredAt: startedAt };

  while (true) {
    let handle;
    try {
      handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(record), 'utf8');
      await handle.close();
      handle = null;

      let released = false;
      return {
        waitedMs: Date.now() - startedAt,
        release: async () => {
          if (released) return;
          released = true;
          const current = await inspectLock(lockPath);
          if (current?.record?.token !== token) return;
          await removeExactLock(lockPath);
        }
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (handle) await removeExactLock(lockPath);
      if (error?.code !== 'EEXIST') throw error;
    }

    const current = await inspectLock(lockPath);
    if (!current) continue;

    const ownerPid = current.record?.pid;
    const ownerIsLive = processIsAlive(ownerPid);
    const malformedRecordIsStale = !current.record && current.ageMs >= malformedGraceMs;
    if (!ownerIsLive && (current.record || malformedRecordIsStale)) {
      await removeExactLock(lockPath);
      continue;
    }

    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= timeoutMs) {
      throw new Error(`Timed out waiting for browser-test lock ${lockPath}; owner pid: ${ownerPid || 'unknown'}.`);
    }
    await delay(Math.min(pollMs, Math.max(1, timeoutMs - waitedMs)));
  }
}
