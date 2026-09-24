import { createRequire } from 'node:module';

const projectId = 'demo-pm-dashboard-v22t';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const checks = [
  ['auth', 'http://127.0.0.1:9099/'],
  ['firestore', 'http://127.0.0.1:8080/'],
  ['functions', 'http://127.0.0.1:5001/'],
  ['preview', 'http://127.0.0.1:4173/?emulator=1'],
];

async function getJson(name, url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return { name, response, body: await response.text() };
  } catch (error) {
    throw new Error(`emulator-unavailable: ${name}: ${error.message}`);
  }
}

async function postJson(name, url, body) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return { name, response, body: await response.text() };
  } catch (error) {
    throw new Error(`emulator-unavailable: ${name}: ${error.message}`);
  }
}

const results = [];
for (const [name, url] of checks) results.push(await getJson(name, url));

const expectedEmail = 'test.admin@pm-dashboard.local';
const authLogin = await postJson(
  'auth-login',
  'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-test-key',
  { email: expectedEmail, password: 'TestOnly!12345', returnSecureToken: true },
);
if (!authLogin.response.ok) throw new Error(`auth-user-not-found: ${expectedEmail}`);

let userSnapshot;
try {
  const healthApp = initializeApp({ projectId }, `local-health-${Date.now()}`);
  userSnapshot = await getFirestore(healthApp).collection('users').doc(expectedEmail).get();
} catch (error) {
  const category = error.code === 7 || error.code === 'permission-denied'
    ? 'firestore-permission-denied'
    : 'emulator-unavailable';
  throw new Error(`${category}: ${error.message}`);
}
if (!userSnapshot.exists || !userSnapshot.data()?.role) {
  throw new Error(`dashboard-role-missing: users/${expectedEmail}`);
}

console.log('Local stack health: PASS');
console.log(results.map(({ name, response }) => `${name}: ${response.status}`).join('\n'));
console.log(`role: ${expectedEmail}`);
