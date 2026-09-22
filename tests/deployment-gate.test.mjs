import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const deployScript = await readFile(new URL('../scripts/deploy-after-verify.mjs', import.meta.url), 'utf8').catch(() => '');
const healthScript = await readFile(new URL('../scripts/local-health.mjs', import.meta.url), 'utf8');

test('deploy command is guarded by local verification and explicit push', () => {
  assert.match(packageJson.scripts.deploy, /deploy-after-verify\.mjs/);
  assert.match(deployScript, /verify:local/);
  assert.match(deployScript, /--push/);
  assert.match(deployScript, /\['push',\s*'origin',\s*'main'\]/);
  assert.match(deployScript, /pm-dashboard-uat/);
  assert.match(deployScript, /remote\.includes\(targetRepo\)/);
});

test('local health keeps distinct initialization failure categories', () => {
  assert.match(healthScript, /emulator-unavailable/);
  assert.match(healthScript, /auth-user-not-found/);
  assert.match(healthScript, /dashboard-role-missing/);
  assert.match(healthScript, /firestore-permission-denied/);
});
