import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const seed = await readFile(new URL('../scripts/seed-v2.2t-emulator.mjs', import.meta.url), 'utf8');
const starter = await readFile(new URL('../scripts/start-v2.2t-emulator.cmd', import.meta.url), 'utf8');
const starterScript = await readFile(new URL('../scripts/start-v2.2t-emulator.ps1', import.meta.url), 'utf8');
const localSync = await readFile(new URL('../scripts/sync-v2.2t-local-data.mjs', import.meta.url), 'utf8').catch(() => '');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8').catch(() => '{"scripts":{}}'));
const localRunner = await readFile(new URL('../scripts/local-stack.mjs', import.meta.url), 'utf8').catch(() => '');
const localStop = await readFile(new URL('../scripts/local-stop.mjs', import.meta.url), 'utf8').catch(() => '');
const localHealth = await readFile(new URL('../scripts/local-health.mjs', import.meta.url), 'utf8').catch(() => '');

test('v2.2T local preview can only opt into the isolated Firebase Emulator project', async () => {
  const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
  const aliases = JSON.parse(await readFile(new URL('../.firebaserc', import.meta.url), 'utf8'));

  assert.equal(aliases.projects.default, 'demo-pm-dashboard-v22t');
  assert.equal(config.emulators.firestore.port, 8080);
  assert.equal(config.emulators.auth.port, 9099);
  assert.equal(config.emulators.functions.port, 5001);
  assert.match(dashboard, /new URLSearchParams\(window\.location\.search\)\.get\('emulator'\) === '1'/);
  assert.match(dashboard, /connectFirestoreEmulator\(db, '127\.0\.0\.1', 8080\)/);
});

test('localhost only uses all emulators in explicit emulator mode', () => {
  assert.match(dashboard, /const isLocalPreview = \['localhost', '127\.0\.0\.1'\]\.includes\(window\.location\.hostname\)/);
  assert.match(dashboard, /const useLocalEmulator = isLocalPreview[\s\S]*get\('emulator'\) === '1'/);
  assert.match(dashboard, /if \(useLocalEmulator\) \{[\s\S]*connectFirestoreEmulator\(db, '127\.0\.0\.1', 8080\)[\s\S]*connectFunctionsEmulator\(functions, '127\.0\.0\.1', 5001\)[\s\S]*connectAuthEmulator\(auth, 'http:\/\/127\.0\.0\.1:9099'/);
  assert.doesNotMatch(dashboard, /if \(isLocalPreview\) \{[\s\S]*connectFirestoreEmulator\(db, '127\.0\.0\.1', 8080\)/);
});

test('the local seed bypasses rules only through the Emulator Admin SDK', () => {
  assert.match(seed, /createRequire\(new URL\('\.\.\/functions\/package\.json', import\.meta\.url\)\)/);
  assert.match(seed, /firebase-admin\/firestore/);
  assert.doesNotMatch(seed, /firestoreBase/);
});

test('the local seed includes the live Executive timeline and its configurable access policy', () => {
  assert.match(seed, /seedDocument\('executiveMilestoneConfig', 'timeline'/);
  assert.match(seed, /seedDocument\('executiveMilestoneState', 'live'/);
  assert.match(seed, /sectionPolicies:/);
  assert.match(seed, /TEST \/ DO NOT DELETE/);
});

test('local test accounts include the display identities required by protected project writes', () => {
  assert.match(seed, /email: 'test\.admin@pm-dashboard\.local', displayName: 'Test'/);
  assert.match(seed, /email: 'test\.pm@pm-dashboard\.local', displayName: 'Test'/);
  assert.match(seed, /email: 'test\.bd@pm-dashboard\.local', displayName: 'Test BD'/);
  assert.match(seed, /displayName: account\.displayName/);
});

test('the local emulator starter bypasses the workstation PowerShell script policy', () => {
  assert.match(starter, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(starter, /start-v2\.2t-emulator\.ps1/);
});

test('the starter writes emulator errors separately and preserves an existing local preview', () => {
  assert.match(starterScript, /\$emulatorErrorLog\s*=\s*Join-Path \$repoRoot 'tmp\\v2\.2t-emulator-error\.log'/);
  assert.match(starterScript, /-RedirectStandardOutput \$emulatorLog -RedirectStandardError \$emulatorErrorLog/);
  assert.match(starterScript, /if \(-not \(Test-NetConnection -ComputerName '127\.0\.0\.1' -Port 4173 -InformationLevel Quiet\)\)/);
});

test('the starter seeds Auth and Firestore into the isolated emulator only', () => {
  assert.match(starterScript, /\$env:FIREBASE_AUTH_EMULATOR_HOST\s*=\s*'127\.0\.0\.1:9099'/);
  assert.match(starterScript, /\$env:FIRESTORE_EMULATOR_HOST\s*=\s*'127\.0\.0\.1:8080'/);
});

test('the local starter reads a Production snapshot only after an explicit opt-in', () => {
  assert.match(starterScript, /param\([\s\S]*\[switch\]\$SyncProductionSnapshot[\s\S]*\)/);
  assert.match(starterScript, /if \(\$SyncProductionSnapshot\) \{[\s\S]*sync-v2\.2t-local-data\.mjs[\s\S]*--allow-production-snapshot-read[\s\S]*\}/);
  assert.match(localSync, /if \(!process\.argv\.includes\('--allow-production-snapshot-read'\)\) \{[\s\S]*throw new Error\([\s\S]*--allow-production-snapshot-read[\s\S]*\);[\s\S]*\}/);
  assert.match(starterScript, /--project', 'demo-pm-dashboard-v22t'/);
  assert.match(localSync, /project-manager-dashboar-a067f/);
  assert.match(localSync, /const LOCAL_PROJECT_ID = SOURCE_PROJECT_ID/);
  assert.match(localSync, /v2\.2t-production-snapshot\.json/);
  assert.match(localSync, /applicationDefault\(\)/);
  assert.match(localSync, /FIRESTORE_EMULATOR_HOST/);
});

test('the Mac local workflow exposes one explicit command contract', () => {
  assert.equal(packageJson.scripts?.['local:start'], 'node scripts/local-stack.mjs');
  assert.equal(packageJson.scripts?.['local:stop'], 'node scripts/local-stop.mjs');
  assert.equal(packageJson.scripts?.['local:seed'], 'node scripts/local-stack.mjs --seed-only');
  assert.equal(packageJson.scripts?.['test:local'], 'node scripts/local-health.mjs');
  assert.match(packageJson.scripts?.['test:all'] || '', /node --test/);
  assert.match(packageJson.scripts?.['verify:local'] || '', /test:all/);
  assert.match(localRunner, /127\.0\.0\.1:9099/);
  assert.match(localRunner, /127\.0\.0\.1:8080/);
  assert.match(localRunner, /functions:\s*5001/);
  assert.match(localRunner, /emulator=1/);
  assert.match(localStop, /v22t-local-processes/);
  assert.match(localStop, /process\.kill/);
  assert.match(localHealth, /emulator-unavailable/);
});

test('every local emulator entrypoint is pinned to the demo project', () => {
  const localEntrypoints = [localRunner, localHealth, seed, starterScript];
  for (const source of localEntrypoints) {
    assert.doesNotMatch(source, /project-manager-dashboar-a067f/);
    assert.match(source, /demo-pm-dashboard-v22t/);
  }
});
