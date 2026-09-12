import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTION_PROJECT_ID = 'project-manager-dashboar-a067f';
const UAT_PROJECT_ID = 'pm-dashboard-uat-20260820-a7f3';
const REQUIRED_RUNTIME_KEYS = ['runtime', 'imports'];
const REQUIRED_DEPLOYMENT_KEYS = ['deployment'];

function violation(code, message, source = 'supplied sources') {
  return { code, message, source };
}

function sourceText(sources, key, aliases = []) {
  const candidates = [key, ...aliases];
  for (const candidate of candidates) {
    if (typeof sources?.[candidate] === 'string') return sources[candidate];
  }
  return null;
}

function collectText(sources, keys) {
  return keys.map(key => sourceText(sources, key)).filter(value => value !== null).join('\n');
}

/**
 * Check the sync boundary as behavior over source fixtures, not as a source-grep test.
 * The returned violations are intentionally structured so callers and tests can act on
 * every failed guard without having to parse human-facing output.
 */
export function verifyProductionSyncBoundary(sources) {
  const violations = [];
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    return [violation('invalid-sources', 'Repository source fixtures must be an object.')];
  }

  for (const key of REQUIRED_RUNTIME_KEYS) {
    if (sourceText(sources, key, key === 'runtime' ? ['runtimeSource', 'productionRuntime'] : ['importSource'])) {
      continue;
    }
    violations.push(violation('missing-runtime-source', `Missing required ${key} source fixture.`, key));
  }
  for (const key of REQUIRED_DEPLOYMENT_KEYS) {
    if (!sourceText(sources, key, ['deploymentSource', 'deploymentConfig'])) {
      violations.push(violation('missing-deployment-source', 'Missing required deployment source fixture.', key));
    }
  }
  if (violations.length) return violations;

  const runtime = collectText(sources, ['runtime', 'imports']);
  const deployment = sourceText(sources, 'deployment', ['deploymentSource', 'deploymentConfig']);

  if (!runtime.includes(PRODUCTION_PROJECT_ID) || !runtime.includes(UAT_PROJECT_ID)) {
    violations.push(violation('fixed-project-direction-missing', 'Runtime must bind the fixed Production and UAT project IDs.', 'runtime'));
  }

  const sourceCollectionCalls = [...runtime.matchAll(/(?:productionDb|sourceDb|sourceStore)\s*\.collection\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g)];
  if (sourceCollectionCalls.some(([, , collection]) => collection !== 'weeks')) {
    violations.push(violation('source-collection-not-allowlisted', 'The Production read boundary may access only the literal weeks collection.', 'runtime'));
  }
  const syncCollection = runtime.match(/\bSYNC_COLLECTION\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (syncCollection && syncCollection !== 'weeks') {
    violations.push(violation('source-collection-not-allowlisted', 'The shared sync collection constant must remain weeks.', 'runtime'));
  }
  if (!sourceCollectionCalls.length && syncCollection !== 'weeks') {
    violations.push(violation('source-collection-not-allowlisted', 'The Production read boundary must identify the fixed weeks collection.', 'runtime'));
  }
  if (/\b(?:productionDb|sourceDb|sourceStore)\s*\.collection\s*\(\s*(?:request|data|payload)\b/.test(runtime)) {
    violations.push(violation('caller-selected-source-collection', 'The caller cannot select the Production collection.', 'runtime'));
  }

  if (/(?:request|data|payload)\s*(?:\?|\.|\[['"]?)\s*projectId\b|projectId\s*:\s*(?:request|data|payload)\b/i.test(runtime)) {
    violations.push(violation('caller-selected-project-id', 'The caller cannot select the source or destination project ID.', 'runtime'));
  }

  if (/\b(?:productionDb|sourceDb|sourceStore)\b[^;]*(?:\.(?:set|update|delete|create|batch|runTransaction))\s*\(/i.test(runtime)) {
    violations.push(violation('production-write-capability', 'The Production boundary must expose reads only; no write operation may target its database.', 'runtime'));
  }

  if (/(?:sync-v2\.2t-local-data|local-sync|production-snapshot-import)/i.test(runtime)) {
    violations.push(violation('local-sync-runtime-import', 'The UAT callable runtime cannot import the old local snapshot-sync utility.', 'runtime'));
  }

  const hasProductionWriteRole = [...deployment.split(/\r?\n/), ...runtime.split(/\r?\n/)].some(line => {
    if (!/roles\/datastore\.(?!viewer\b)[a-z.-]+/i.test(line)) return false;
    return /production/i.test(line) || !/\buat\b|destination/i.test(line);
  });
  if (hasProductionWriteRole) {
    violations.push(violation('production-write-role', 'Production may use roles/datastore.viewer only; write roles are forbidden.', 'deployment'));
  }

  const productionDeploy = deployment.split(/\r?\n/).some(line =>
    /firebase\s+deploy/i.test(line) && line.includes(PRODUCTION_PROJECT_ID));
  if (productionDeploy) {
    violations.push(violation('production-deploy-target', 'Deployment commands must never target the Production Firebase project.', 'deployment'));
  }

  return violations;
}

async function readSources(repoRoot) {
  const read = async relativePath => readFile(resolve(repoRoot, relativePath), 'utf8');
  const [core, runtime, index, browser, firebase, aliases, deployScript, packageJson] = await Promise.all([
    read('functions/production-week-sync-core.js'),
    read('functions/production-week-sync.js'),
    read('functions/index.js'),
    read('js/uat-production-sync.mjs'),
    read('firebase.json'),
    read('.firebaserc'),
    read('scripts/deploy-after-verify.mjs'),
    read('package.json'),
  ]);
  return {
    runtime: [core, runtime, index, browser].join('\n'),
    imports: index,
    deployment: [firebase, aliases, deployScript, packageJson].join('\n'),
  };
}

async function main() {
  const repoRoot = process.argv[2] === '--root'
    ? resolve(process.argv[3] || '.')
    : resolve(fileURLToPath(new URL('..', import.meta.url)));
  const violations = verifyProductionSyncBoundary(await readSources(repoRoot));
  if (violations.length) {
    for (const item of violations) console.error(`[${item.code}] ${item.message} (${item.source})`);
    process.exitCode = 1;
    return;
  }
  console.log('Production sync boundary verified: fixed read-only Production to UAT direction.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
