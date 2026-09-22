import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The only environments this repository may publish to Firebase Hosting, fixed in code. Adding one is a
// deliberate source change, never an env-file edit. Keys match env/<name>.json filenames and .firebaserc aliases.
export const HOSTING_TARGETS = Object.freeze({
  uat: 'pm-dashboard-uat-20260820-a7f3',
  prod: 'project-manager-dashboar-a067f'
});

// env/<name>.json uses this repository's short Hosting alias ("prod"); the PDF target registry (shared with the
// pdf-service, which has no notion of a Hosting alias) uses the environment's full name ("production"). This is
// the one place that mapping is declared.
const REGISTRY_ENVIRONMENT_BY_HOSTING_NAME = Object.freeze({ uat: 'uat', prod: 'production' });

const REQUIRED_TEXT_KEYS = ['environment', 'dashboardProfile', 'release', 'baseCommit', 'firebaseProjectId', 'hostingSite', 'hostingOrigin'];

function isRegisteredPdfServiceUrl(value) {
  return value === null || (typeof value === 'string' && /^https:\/\/[^/\s]+$/.test(value));
}

// The PDF target registry (pdf-service/src/targets/registry.json) is the single authoritative mapping of
// environment -> PDF Cloud Run endpoint; it is also what pdf-service itself validates against at runtime (see
// pdf-service/src/environment.js). Reading it here, rather than duplicating its URLs into env/*.json as a second,
// independently-editable source, is what lets the Hosting build catch a wrong-environment PDF endpoint instead of
// merely comparing two user-editable files that can drift together.
async function loadRegisteredPdfServiceUrl(rootDir, hostingName) {
  const registryPath = join(rootDir, 'pdf-service', 'src', 'targets', 'registry.json');
  let registry;
  try {
    registry = JSON.parse(await readFile(registryPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read the authoritative PDF target registry at ${registryPath}: ${error.message}`);
  }
  const registryEnvironment = REGISTRY_ENVIRONMENT_BY_HOSTING_NAME[hostingName];
  const target = registry?.targets?.[registryEnvironment];
  if (!target || !Object.hasOwn(target, 'serviceUrl')) {
    throw new Error(`The PDF target registry has no "${registryEnvironment}" target with a "serviceUrl"; it must be the authoritative source for every Hosting environment.`);
  }
  return target.serviceUrl;
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
  // Fail closed against the authoritative PDF target registry: env/<name>.json's pdfServiceUrl must name exactly
  // this environment's registered endpoint -- never another environment's, and never an unregistered one. A
  // Production PDF URL configured for the UAT build (or vice versa) fails here, as does any URL the registry does
  // not recognize for this environment. Only a registry serviceUrl of null permits env.pdfServiceUrl to be null
  // (an environment with no PDF service deployed yet), and that combination still builds as NOT READY FOR RELEASE
  // rather than as a pass.
  const registeredPdfServiceUrl = await loadRegisteredPdfServiceUrl(rootDir, name);
  if (env.pdfServiceUrl !== registeredPdfServiceUrl) {
    throw new Error(
      `env/${name}.json "pdfServiceUrl" (${JSON.stringify(env.pdfServiceUrl)}) does not match the PDF target ` +
      `registry's registered endpoint for "${REGISTRY_ENVIRONMENT_BY_HOSTING_NAME[name]}" (${JSON.stringify(registeredPdfServiceUrl)}). ` +
      'The Hosting build and the PDF service must agree on which endpoint serves this environment; update ' +
      `env/${name}.json or pdf-service/src/targets/registry.json so they name the same PDF service -- never the ` +
      'other environment\'s.'
    );
  }
  // pdfReleaseReady is derived, not stored: an artifact built from this environment can serve the dashboard
  // either way, but a missing PDF endpoint must stay visible, never silently substituted for another environment's.
  return { ...env, pdfReleaseReady: env.pdfServiceUrl !== null };
}
