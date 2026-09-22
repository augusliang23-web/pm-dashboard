import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const statePath = resolve(repoRoot, 'tmp', 'v22t-local-processes.json');

try {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  for (const pid of state.pids || []) {
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
  await rm(statePath, { force: true });
  console.log('Stopped the v2.2T local stack.');
} catch (error) {
  if (error.code === 'ENOENT') {
    console.log('No v2.2T local stack state was found.');
  } else {
    console.error(`local-stop-error: ${error.message}`);
    process.exitCode = 1;
  }
}
