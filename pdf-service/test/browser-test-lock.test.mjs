import test from 'node:test';
import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function loadLockModule() {
  try {
    return await import('../scripts/browser-test-lock.mjs');
  } catch (error) {
    assert.fail(`browser-test-lock.mjs must export acquireBrowserTestLock: ${error.code || error.message}`);
  }
}

async function temporaryLockPath() {
  const directory = await mkdtemp(join(tmpdir(), 'pm-dashboard-browser-lock-test-'));
  return { directory, lockPath: join(directory, 'browser.lock') };
}

test('serializes independent acquisitions of the same browser-test lock', async () => {
  const { acquireBrowserTestLock } = await loadLockModule();
  const { directory, lockPath } = await temporaryLockPath();
  let first;
  let second;

  try {
    first = await acquireBrowserTestLock({ lockPath, pollMs: 10, timeoutMs: 1000 });
    const events = ['first'];
    const secondPromise = acquireBrowserTestLock({ lockPath, pollMs: 10, timeoutMs: 1000 })
      .then(lock => {
        events.push('second');
        return lock;
      });

    await delay(60);
    assert.deepEqual(events, ['first']);
    await first.release();
    first = null;
    second = await secondPromise;
    assert.deepEqual(events, ['first', 'second']);
  } finally {
    await first?.release();
    await second?.release();
    await rm(directory, { recursive: true, force: true });
  }
});

test('reclaims a lock whose recorded owner process is no longer alive', async () => {
  const { acquireBrowserTestLock } = await loadLockModule();
  const { directory, lockPath } = await temporaryLockPath();
  let lock;

  try {
    await writeFile(lockPath, JSON.stringify({
      pid: 99999999,
      token: 'dead-owner',
      acquiredAt: Date.now() - 60_000
    }));

    lock = await acquireBrowserTestLock({ lockPath, pollMs: 10, timeoutMs: 1000 });
    assert.ok(lock.waitedMs < 1000);
    await lock.release();
    lock = null;
    await assert.rejects(access(lockPath), error => error?.code === 'ENOENT');
  } finally {
    await lock?.release();
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not let an old owner release a replacement lock', async () => {
  const { acquireBrowserTestLock } = await loadLockModule();
  const { directory, lockPath } = await temporaryLockPath();
  let first;
  let replacement;

  try {
    first = await acquireBrowserTestLock({ lockPath, pollMs: 10, timeoutMs: 1000 });
    await unlink(lockPath);
    replacement = await acquireBrowserTestLock({ lockPath, pollMs: 10, timeoutMs: 1000 });
    const replacementRecord = JSON.parse(await readFile(lockPath, 'utf8'));

    await first.release();
    first = null;

    const survivingRecord = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(survivingRecord.token, replacementRecord.token);
  } finally {
    await first?.release();
    await replacement?.release();
    await rm(directory, { recursive: true, force: true });
  }
});

test('waits for a fresh malformed lock record before reclaiming it', async () => {
  const { acquireBrowserTestLock } = await loadLockModule();
  const { directory, lockPath } = await temporaryLockPath();
  let lock;

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(lockPath, '');
    const startedAt = Date.now();
    lock = await acquireBrowserTestLock({
      lockPath,
      pollMs: 10,
      timeoutMs: 1000,
      malformedGraceMs: 80
    });

    assert.ok(Date.now() - startedAt >= 70);
  } finally {
    await lock?.release();
    await rm(directory, { recursive: true, force: true });
  }
});
