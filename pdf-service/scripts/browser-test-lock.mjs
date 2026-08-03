import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
    let parsedRecord = null;
    try {
      parsedRecord = JSON.parse(contents);
    } catch {
      // A newly created lock can be observed before its owner record is fully written.
    }
    const record = parsedRecord
      && typeof parsedRecord === 'object'
      && Number.isSafeInteger(parsedRecord.pid)
      && typeof parsedRecord.token === 'string'
      ? parsedRecord
      : null;
    return {
      record,
      ageMs: Math.max(0, Date.now() - fileStat.mtimeMs),
      identity: `${fileStat.dev}:${fileStat.ino}:${fileStat.size}:${fileStat.mtimeMs}`
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function observationsMatch(left, right) {
  if (!left || !right) return false;
  if (left.record?.token && right.record?.token) {
    return left.record.token === right.record.token;
  }
  return !left.record && !right.record && left.identity === right.identity;
}

function observationIsStale(observation, malformedGraceMs) {
  if (!observation) return false;
  if (observation.record) return !processIsAlive(observation.record.pid);
  return observation.ageMs >= malformedGraceMs;
}

function reclamationPath(lockPath, observation) {
  const identity = observation.record?.token || `malformed:${observation.identity}`;
  const digest = createHash('sha256').update(`${lockPath}\0${identity}`).digest('hex');
  return join(dirname(lockPath), `.pm-dashboard-pdf-reclaim-${digest}.lock`);
}

async function releaseOwnedFile(path, token) {
  const current = await inspectLock(path);
  if (current?.record?.token !== token) return;
  await removeExactLock(path);
}

async function reclaimStaleObservation(lockPath, observation, malformedGraceMs, options = {}) {
  const claimPath = reclamationPath(lockPath, observation);
  const claimToken = randomUUID();
  let claimHandle;

  try {
    claimHandle = await open(claimPath, 'wx', 0o600);
    await claimHandle.writeFile(JSON.stringify({
      pid: process.pid,
      token: claimToken,
      acquiredAt: Date.now()
    }), 'utf8');
    await claimHandle.close();
    claimHandle = null;
  } catch (error) {
    await claimHandle?.close().catch(() => {});
    if (error?.code === 'EEXIST') {
      const existingClaim = await inspectLock(claimPath);
      if (observationIsStale(existingClaim, malformedGraceMs)) {
        await reclaimStaleObservation(claimPath, existingClaim, malformedGraceMs);
      }
      return false;
    }
    if (claimHandle) await removeExactLock(claimPath);
    throw error;
  }

  try {
    await options.afterReclamationClaimAcquired?.({ lockPath, claimPath });
    const current = await inspectLock(lockPath);
    if (!observationsMatch(current, observation)) return false;
    if (!observationIsStale(current, malformedGraceMs)) return false;
    await removeExactLock(lockPath);
    return true;
  } finally {
    await releaseOwnedFile(claimPath, claimToken);
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
  malformedGraceMs = 1000,
  afterStaleLockInspection,
  afterReclamationClaimAcquired
} = {}) {
  const startedAt = Date.now();
  const token = randomUUID();
  const record = { pid: process.pid, token, acquiredAt: startedAt };
  const reportedStaleIdentities = new Set();

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
          await releaseOwnedFile(lockPath, token);
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
    if (observationIsStale(current, malformedGraceMs)) {
      const staleIdentity = current.record?.token || current.identity;
      if (!reportedStaleIdentities.has(staleIdentity)) {
        reportedStaleIdentities.add(staleIdentity);
        await afterStaleLockInspection?.({ lockPath, ownerPid, staleIdentity });
      }
      const reclaimed = await reclaimStaleObservation(lockPath, current, malformedGraceMs, {
        afterReclamationClaimAcquired
      });
      if (reclaimed) continue;
    }

    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= timeoutMs) {
      throw new Error(`Timed out waiting for browser-test lock ${lockPath}; owner pid: ${ownerPid || 'unknown'}.`);
    }
    await delay(Math.min(pollMs, Math.max(1, timeoutMs - waitedMs)));
  }
}
