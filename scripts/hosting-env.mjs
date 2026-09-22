import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The only environments this repository may publish to Firebase Hosting, fixed in code. Adding one is a
// deliberate source change, never an env-file edit. Keys match env/<name>.json filenames and .firebaserc aliases.
export const HOSTING_TARGETS = Object.freeze({
  uat: 'pm-dashboard-uat-20260820-a7f3',
  prod: 'project-manager-dashboar-a067f'
});

const REQUIRED_TEXT_KEYS = ['environment', 'dashboardProfile', 'release', 'baseCommit', 'firebaseProjectId', 'hostingSite', 'hostingOrigin'];

function isRegisteredPdfServiceUrl(value) {
  return value === null || (typeof value === 'string' && /^https:\/\/[^/\s]+$/.test(value));
}

export async function loadHostingEnv(rootDir, name) {
  if (!Object.hasOwn(HOSTING_TARGETS, name)) {
    throw new Error(`Unknown hosting environment "${name}": it is not a hosting target of this repository.`);
  }
  const env = JSON.parse(await readFile(join(rootDir, 'env', `${name}.json`), 'utf8'));
  for (const key of REQUIRED_TEXT_KEYS) {
    if (typeof env[key] !== 'string' || !env[key].trim()) {
      throw new Error(`env/${name}.json must define a non-empty "${key}".`);
    }
  }
  if (!Object.hasOwn(env, 'pdfServiceUrl') || !isRegisteredPdfServiceUrl(env.pdfServiceUrl)) {
    throw new Error(`env/${name}.json "pdfServiceUrl" must be null or an https:// URL.`);
  }
  if (env.environment !== name) {
    throw new Error(`env/${name}.json declares environment "${env.environment}".`);
  }
  if (env.firebaseProjectId !== HOSTING_TARGETS[name]) {
    throw new Error(`env/${name}.json project "${env.firebaseProjectId}" differs from the code allowlist "${HOSTING_TARGETS[name]}".`);
  }
  if (env.hostingOrigin !== `https://${env.hostingSite}.web.app`) {
    throw new Error(`env/${name}.json hostingOrigin must be https://${env.hostingSite}.web.app.`);
  }
  // pdfReleaseReady is derived, not stored: an artifact built from this environment can serve the dashboard
  // either way, but a missing PDF endpoint must stay visible, never silently substituted for another environment's.
  return { ...env, pdfReleaseReady: env.pdfServiceUrl !== null };
}
