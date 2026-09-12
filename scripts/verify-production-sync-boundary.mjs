import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTION_PROJECT_ID = 'project-manager-dashboar-a067f';
const UAT_PROJECT_ID = 'pm-dashboard-uat-20260820-a7f3';
const REQUIRED_RUNTIME_KEYS = ['runtime', 'imports', 'productionRead'];
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
  return keys.map(key => sourceText(sources, key,
    key === 'runtime' ? ['runtimeSource', 'productionRuntime']
      : key === 'imports' ? ['importSource'] : ['productionReadSource']))
    .filter(value => value !== null).join('\n');
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
    const aliases = key === 'runtime' ? ['runtimeSource', 'productionRuntime']
      : key === 'imports' ? ['importSource'] : ['productionReadSource'];
    if (sourceText(sources, key, aliases)) {
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
  const productionRead = sourceText(sources, 'productionRead', ['productionReadSource']);
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

  const requestDataAliases = [...runtime.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*request\.data\b/g)]
    .map(match => match[1]);
  const callerSelectsBoundaryKey = requestDataAliases.some(alias =>
    new RegExp(`\\b${alias}\\s*\\.\\s*(?:projectId|collection)\\b`).test(runtime));
  if (/(?:request|data|payload)\s*(?:\?|\.|\[['"]?)\s*(?:projectId|collection)\b|\b(?:projectId|collection)\b\s*:\s*(?:request|data|payload)\b|\{[^}]*\b(?:projectId|collection)\b[^}]*\}\s*=\s*request\.data\b/i.test(runtime)
    || callerSelectsBoundaryKey) {
    violations.push(violation('caller-selected-project-id', 'The caller cannot select the source or destination project ID.', 'runtime'));
  }

  if (/\b(?:productionDb|sourceDb|sourceStore)\b[^;]*(?:\.(?:set|update|delete|create|batch|bulkWriter|runTransaction))\s*\(/i.test(runtime)) {
    violations.push(violation('production-write-capability', 'The Production boundary must expose reads only; no write operation may target its database.', 'runtime'));
  }

  if (/(?:sync-v2\.2t-local-data|local-sync|production-snapshot-import)/i.test(runtime)) {
    violations.push(violation('local-sync-runtime-import', 'The UAT callable runtime cannot import the old local snapshot-sync utility.', 'runtime'));
  }

  const productionCollectionCalls = [...productionRead.matchAll(/\b[A-Za-z_$][\w$]*\s*\.\s*collection\s*\(([^)]*)\)/g)];
  if (productionCollectionCalls.length !== 1
    || !/^productionDb\s*\.\s*collection\s*\(\s*['"]weeks['"]\s*\)$/.test(productionCollectionCalls[0]?.[0] || '')) {
    violations.push(violation('source-collection-not-allowlisted', 'The dedicated Production read module must contain exactly one literal productionDb weeks read.', 'productionRead'));
  }
  if (/\.(?:set|update|delete|create|batch|bulkWriter|runTransaction)\s*\(|\b(?:set|update|delete|create|batch|bulkWriter|runTransaction)\s*[:=]/i.test(productionRead)) {
    violations.push(violation('production-write-capability', 'The dedicated Production read module may not contain any Firestore write API.', 'productionRead'));
  }
  if (/\b(?:const|let|var)\s+\w+\s*=\s*(?:productionDb|sourceDb)\b/.test(productionRead)) {
    violations.push(violation('production-write-capability', 'Production Firestore handles may not be aliased in the read module.', 'productionRead'));
  }

  const roleFindings = [];
  for (const [source, text] of [['deployment', deployment], ['runtime', runtime]]) {
    let carriedScope = null;
    for (const line of text.split(/\r?\n/)) {
      const markers = [];
      for (const match of line.matchAll(new RegExp(`${PRODUCTION_PROJECT_ID}|\\bproduction[\\w-]*`, 'gi'))) {
        markers.push({ index: match.index, scope: 'production' });
      }
      for (const match of line.matchAll(new RegExp(`${UAT_PROJECT_ID}|\\buat[\\w-]*|\\bdestination[\\w-]*`, 'gi'))) {
        markers.push({ index: match.index, scope: 'uat' });
      }
      markers.sort((left, right) => left.index - right.index);
      for (const role of line.matchAll(/roles\/datastore\.([a-z-]+)\b/gi)) {
        const nearest = [...markers].sort((left, right) => (
          Math.abs(left.index - role.index) - Math.abs(right.index - role.index)
        ))[0];
        roleFindings.push({ source, role: role[1].toLowerCase(), scope: nearest?.scope || carriedScope });
      }
      if (markers.length) carriedScope = markers.at(-1).scope;
    }
  }
  if (roleFindings.some(item => item.scope === 'production' && item.role !== 'viewer')) {
    violations.push(violation('production-write-role', 'Production may use roles/datastore.viewer only; write roles are forbidden.', 'deployment'));
  }
  if (roleFindings.some(item => item.scope === 'uat' && item.role !== 'user')) {
    violations.push(violation('uat-datastore-role-invalid', 'UAT sync access must use roles/datastore.user.', 'deployment'));
  }
  if (roleFindings.some(item => !item.scope)) {
    violations.push(violation('datastore-role-unscoped', 'Every datastore role must be associated with an explicit Production or UAT scope.', 'deployment'));
  }

  const productionDeploy = deployment.includes(PRODUCTION_PROJECT_ID)
    || (/firebase\s+use\s+production\b/i.test(deployment) && /firebase\s+deploy\b/i.test(deployment));
  if (productionDeploy) {
    violations.push(violation('production-deploy-target', 'Deployment commands must never target the Production Firebase project.', 'deployment'));
  }

  return violations;
}

async function readSources(repoRoot) {
  const read = async relativePath => readFile(resolve(repoRoot, relativePath), 'utf8');
  async function walk(relativeDirectory) {
    const absoluteDirectory = resolve(repoRoot, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    const paths = [];
    for (const entry of entries) {
      if (entry.isDirectory() && (entry.name === 'node_modules' || entry.name === '.git')) continue;
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) paths.push(...await walk(relativePath));
      else if (entry.isFile()) paths.push(relativePath);
    }
    return paths;
  }
  const [functionFiles, browserFiles, scriptFiles] = await Promise.all([
    walk('functions'), walk('js'), walk('scripts'),
  ]);
  const runtimePaths = [
    'index.html',
    ...functionFiles.filter(path => /\.js$/.test(path) && !path.includes('/test/')),
    ...browserFiles.filter(path => /\.m?js$/.test(path)),
  ];
  const deploymentPaths = [
    '.firebaserc', 'firebase.json', 'firebase.shared-backend.json', 'package.json', 'functions/package.json',
    ...scriptFiles.filter(path => !path.endsWith('verify-production-sync-boundary.mjs')
      && !path.endsWith('sync-v2.2t-local-data.mjs')),
  ];
  const [runtimeSources, deploymentSources, productionRead] = await Promise.all([
    Promise.all(runtimePaths.map(read)),
    Promise.all(deploymentPaths.map(read)),
    read('functions/production-week-sync-production-read.js'),
  ]);
  return {
    runtime: runtimeSources.join('\n'),
    imports: runtimeSources.join('\n'),
    productionRead,
    deployment: deploymentSources.join('\n'),
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
