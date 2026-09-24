import { readFileSync } from 'node:fs';
import { parseAllowedOrigins } from './cors.js';
import { createFirebaseAppOptions } from './firebase-app-options.js';

// One environment-neutral PDF source runs as separate UAT and Production services. Which environment a process is
// serving comes only from explicit configuration (PDF_ENVIRONMENT + FIREBASE_PROJECT_ID + ALLOWED_ORIGIN) that is
// validated against a versioned target registry. Every check fails closed: a misconfigured process refuses to start.
export class PdfEnvironmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PdfEnvironmentError';
  }
}

export const SUPPORTED_REGISTRY_VERSION = 1;
export const CLOUD_ENVIRONMENTS = ['uat', 'production'];
export const LOCAL_ENVIRONMENT = 'local';

export function loadTargetRegistry(source = new URL('./targets/registry.json', import.meta.url)) {
  const registry = JSON.parse(readFileSync(source, 'utf8'));
  if (registry.version !== SUPPORTED_REGISTRY_VERSION) {
    throw new PdfEnvironmentError(`Unsupported target registry version ${registry.version}.`);
  }
  return registry;
}

function requireText(environment, key) {
  const value = String(environment[key] ?? '').trim();
  if (!value) throw new PdfEnvironmentError(`${key} is required.`);
  return value;
}

function emulatorHosts(environment) {
  return Object.keys(environment).filter(key => key.endsWith('_EMULATOR_HOST') && String(environment[key]).trim());
}

function sameSet(left, right) {
  return left.length === right.length && left.every(item => right.includes(item));
}

export function resolveRuntimeTarget(environment = process.env, registry = loadTargetRegistry()) {
  const name = requireText(environment, 'PDF_ENVIRONMENT');
  if (name === LOCAL_ENVIRONMENT) return resolveLocalTarget(environment);
  if (!CLOUD_ENVIRONMENTS.includes(name)) {
    throw new PdfEnvironmentError(`PDF_ENVIRONMENT must be one of ${[...CLOUD_ENVIRONMENTS, LOCAL_ENVIRONMENT].join(', ')}.`);
  }
  const target = registry.targets?.[name];
  if (!target || target.environment !== name) throw new PdfEnvironmentError(`Target "${name}" is not in the registry.`);

  const projectId = requireText(environment, 'FIREBASE_PROJECT_ID');
  if (projectId !== target.firebaseProjectId) {
    throw new PdfEnvironmentError(`FIREBASE_PROJECT_ID "${projectId}" does not belong to the ${name} target.`);
  }
  const origins = parseAllowedOrigins(requireText(environment, 'ALLOWED_ORIGIN'));
  if (!sameSet(origins, target.allowedOrigins)) {
    throw new PdfEnvironmentError(`ALLOWED_ORIGIN must be exactly the registered origins of the ${name} target.`);
  }
  const forbidden = emulatorHosts(environment);
  if (forbidden.length) {
    throw new PdfEnvironmentError(`Emulator variables are forbidden outside local mode: ${forbidden.join(', ')}.`);
  }
  const service = String(environment.K_SERVICE ?? '').trim();
  if (service !== target.serviceName) {
    throw new PdfEnvironmentError(`Cloud Run service "${service || '(none)'}" is not the ${name} service "${target.serviceName}".`);
  }
  return Object.freeze({
    mode: 'cloud',
    environment: name,
    firebaseProjectId: target.firebaseProjectId,
    allowedOrigins: Object.freeze([...target.allowedOrigins]),
    features: Object.freeze({
      liveExecutiveTimeline: target.features?.liveExecutiveTimeline === true,
      projectBriefUpdateSections: target.features?.projectBriefUpdateSections === true
    })
  });
}

// Explicit emulator mode: never on Cloud Run, only with an emulator configured, and never with application credentials.
function resolveLocalTarget(environment) {
  if (String(environment.K_SERVICE ?? '').trim()) throw new PdfEnvironmentError('Local mode must not run on Cloud Run.');
  if (!emulatorHosts(environment).length) throw new PdfEnvironmentError('Local mode requires a Firebase emulator host variable.');
  const projectId = requireText(environment, 'FIREBASE_PROJECT_ID');
  return Object.freeze({
    mode: 'local',
    environment: LOCAL_ENVIRONMENT,
    firebaseProjectId: projectId,
    allowedOrigins: Object.freeze(parseAllowedOrigins(environment.ALLOWED_ORIGIN)),
    features: Object.freeze({ liveExecutiveTimeline: true, projectBriefUpdateSections: true })
  });
}

export function initializeFirebaseAdmin({ target, initializeApp, applicationDefault, environment = process.env }) {
  const options = target.mode === 'local'
    ? createFirebaseAppOptions({ ...environment, GCLOUD_PROJECT: target.firebaseProjectId }, { applicationDefault })
    : { credential: applicationDefault(), projectId: target.firebaseProjectId };
  const app = initializeApp(options);
  if (app?.options?.projectId !== target.firebaseProjectId) {
    throw new PdfEnvironmentError(`Effective Firebase project is not ${target.firebaseProjectId}; refusing to start.`);
  }
  return app;
}
