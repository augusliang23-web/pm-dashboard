import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTION_PROJECT_ID = 'project-manager-dashboar-a067f';
const UAT_PROJECT_ID = 'pm-dashboard-uat-20260820-a7f3';
const POLICY_KEYS = [
  'productionProjectId',
  'productionRoles',
  'uatProjectId',
  'uatRoles',
  'sourceCollections',
];
const REQUIRED_RUNTIME_KEYS = ['policy', 'runtime', 'imports', 'productionRead'];
const REQUIRED_DEPLOYMENT_KEYS = ['deployment'];

function violation(code, message, source = 'supplied sources') {
  return { code, message, source };
}

const LOCAL_SNAPSHOT_SYNC_PATTERN = /(?:sync-v2\.2t-local-data|local-sync|production-snapshot-import)/ig;

function isApprovedLocalSnapshotInvocation(part, matchIndex) {
  if (part.source !== 'scripts/start-v2.2t-emulator.ps1'
    || !/\[switch\]\$SyncProductionSnapshot\b/.test(part.text)) return false;
  const lineStart = part.text.lastIndexOf('\n', matchIndex) + 1;
  const lineEnd = part.text.indexOf('\n', matchIndex);
  const line = part.text.slice(lineStart, lineEnd < 0 ? part.text.length : lineEnd).trim();
  if (!/^node \(Join-Path \$repoRoot 'scripts\\sync-v2\.2t-local-data\.mjs'\) --allow-production-snapshot-read$/.test(line)) {
    return false;
  }
  const prefix = part.text.slice(0, lineStart);
  const guards = [...prefix.matchAll(/if\s*\(\$SyncProductionSnapshot\)\s*\{\s*$/gm)];
  const guard = guards.at(-1);
  return Boolean(guard) && !/[{}]/.test(prefix.slice(guard.index + guard[0].length));
}

function disallowedLocalSnapshotSource(parts, allowConfirmedLocalHelper = false) {
  for (const part of parts) {
    for (const match of part.text.matchAll(LOCAL_SNAPSHOT_SYNC_PATTERN)) {
      if (!allowConfirmedLocalHelper || !isApprovedLocalSnapshotInvocation(part, match.index)) {
        return part.source;
      }
    }
  }
  return null;
}

function sourceParts(sources, key, aliases = []) {
  const candidates = [key, ...aliases];
  for (const candidate of candidates) {
    const value = sources?.[candidate];
    if (typeof value === 'string') return [{ source: candidate, text: value }];
    if (value && typeof value === 'object' && typeof value.text === 'string') {
      return [{ source: value.source || candidate, text: value.text }];
    }
    if (Array.isArray(value) && value.every(item => item && typeof item.text === 'string')) {
      return value.map(item => ({ source: item.source || candidate, text: item.text }));
    }
  }
  return [];
}

function sourceText(sources, key, aliases = []) {
  const parts = sourceParts(sources, key, aliases);
  return parts.length ? parts.map(part => part.text).join('\n') : null;
}

function collectText(sources, keys) {
  return keys.map(key => sourceText(sources, key,
    key === 'runtime' ? ['runtimeSource', 'productionRuntime']
      : key === 'imports' ? ['importSource'] : ['productionReadSource']))
    .filter(value => value !== null).join('\n');
}

function productionHandleNames(text) {
  const names = new Set(['productionDb', 'sourceDb', 'sourceStore']);
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(\s*)*([A-Za-z_$][\w$]*)\b/g)) {
      if (names.has(match[2]) && !names.has(match[1])) {
        names.add(match[1]);
        changed = true;
      }
    }
  }
  return [...names];
}

function productionHandlePattern(names) {
  return names.map(name => name.replace(/[$]/g, '\\$&')).join('|');
}

function isLiteralWeeksCollection(argument) {
  return /^\s*(['"`])weeks\1\s*$/.test(argument);
}

function parseFirebaseAliases(firebaseRc) {
  if (!firebaseRc) return new Map();
  let value;
  try {
    value = JSON.parse(firebaseRc.text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !value.projects || typeof value.projects !== 'object' || Array.isArray(value.projects)
    || Object.values(value.projects).some(project => typeof project !== 'string' || !project)) {
    return null;
  }
  return new Map(Object.entries(value.projects));
}

function resolveFirebaseProject(token, assignments, aliases) {
  const unquoted = String(token || '').trim().replace(/^['"]|['"]$/g, '');
  const variable = /^\$\{?([A-Za-z_]\w*)\}?$/.exec(unquoted)?.[1];
  const target = variable ? assignments.get(variable) : unquoted;
  if (!target) return null;
  return aliases.get(target) || target;
}

function deploymentEvents(text) {
  const normalized = text.replace(/[\\`]\r?\n/g, ' ');
  const events = [];
  const addMatches = (pattern, type, toValue) => {
    for (const match of normalized.matchAll(pattern)) {
      events.push({ index: match.index, type, value: toValue(match) });
    }
  };
  addMatches(/(?:^|[;\n])\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(['"])([^'"\r\n]*)\2/gm,
    'assignment', match => ({ name: match[1], value: match[3] }));
  addMatches(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"\r\n]*)\2/g,
    'assignment', match => ({ name: match[1], value: match[3] }));
  addMatches(/\$([A-Za-z_]\w*)\s*=\s*(['"])([^'"\r\n]*)\2/g,
    'assignment', match => ({ name: match[1], value: match[3] }));
  addMatches(/\bfirebase\s+use\s+([^\s;]+)/ig, 'use', match => match[1]);
  addMatches(/\bfirebase\s+deploy\b([^\n;]*)/ig, 'deploy', match => match[1]);
  return events.sort((left, right) => left.index - right.index);
}

function firebaseDeployViolation(deploymentParts, firebaseRcPart) {
  const aliases = parseFirebaseAliases(firebaseRcPart);
  if (aliases === null) {
    return violation('invalid-firebase-rc', 'The .firebaserc aliases must be valid structured project mappings.', firebaseRcPart.source);
  }
  for (const part of deploymentParts) {
    const assignments = new Map();
    let activeAlias = '';
    for (const event of deploymentEvents(part.text)) {
      if (event.type === 'assignment') {
        assignments.set(event.value.name, event.value.value);
        continue;
      }
      if (event.type === 'use') {
        activeAlias = event.value;
        continue;
      }
      if (event.type !== 'deploy') continue;
      const projectToken = /--project(?:\s*=\s*|\s+)([^\s]+)/i.exec(event.value)?.[1]
        || activeAlias || aliases.get('default') || '';
      const resolvedProject = resolveFirebaseProject(projectToken, assignments, aliases);
      if (resolvedProject !== UAT_PROJECT_ID) {
        const source = aliases.has(String(projectToken).replace(/^['"]|['"]$/g, ''))
          ? firebaseRcPart?.source || part.source
          : part.source;
        return violation('production-deploy-target', 'Sync deployment commands must use a resolved fixed UAT Firebase project target.', source);
      }
    }
  }
  return null;
}

function policyError(code, message) {
  const error = new Error(message);
  error.violations = [violation(code, message, 'policy')];
  return error;
}

/**
 * Parse the single local allowlist for the Production-to-UAT sync boundary.
 * This policy verifies source control only; it does not grant cloud IAM.
 */
export function parseProductionSyncBoundaryPolicy(text) {
  if (typeof text !== 'string') {
    throw policyError('invalid-policy-source', 'The sync boundary policy must be JSON text.');
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw policyError('invalid-policy-json', 'The sync boundary policy must contain valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw policyError('invalid-policy-shape', 'The sync boundary policy root must be an object.');
  }

  const keys = Object.keys(value);
  if (keys.length !== POLICY_KEYS.length || keys.some(key => !POLICY_KEYS.includes(key))) {
    throw policyError('policy-top-level-keys', 'The sync boundary policy must contain exactly its required keys.');
  }
  for (const key of ['productionRoles', 'uatRoles', 'sourceCollections']) {
    if (!Array.isArray(value[key])) {
      throw policyError('invalid-policy-shape', `${key} must be an array.`);
    }
    if (value[key].some(item => typeof item !== 'string')) {
      throw policyError('policy-array-member', `${key} entries must be strings.`);
    }
  }
  if (value.productionProjectId !== PRODUCTION_PROJECT_ID) {
    throw policyError('policy-production-project-id', 'The policy must use the fixed Production project ID.');
  }
  if (value.uatProjectId !== UAT_PROJECT_ID) {
    throw policyError('policy-uat-project-id', 'The policy must use the fixed UAT project ID.');
  }
  if (value.productionRoles.length !== 1 || value.productionRoles[0] !== 'roles/datastore.viewer') {
    throw policyError('policy-production-roles', 'Production may allow only roles/datastore.viewer.');
  }
  if (value.uatRoles.length !== 1 || value.uatRoles[0] !== 'roles/datastore.user') {
    throw policyError('policy-uat-roles', 'UAT may allow only roles/datastore.user.');
  }
  if (value.sourceCollections.length !== 1 || value.sourceCollections[0] !== 'weeks') {
    throw policyError('policy-source-collections', 'The policy may allow only the weeks source collection.');
  }

  return Object.freeze({
    productionProjectId: value.productionProjectId,
    productionRoles: Object.freeze([...value.productionRoles]),
    uatProjectId: value.uatProjectId,
    uatRoles: Object.freeze([...value.uatRoles]),
    sourceCollections: Object.freeze([...value.sourceCollections]),
  });
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
    if (key === 'policy') {
      if (typeof sources.policy !== 'string') {
        violations.push(violation('missing-policy-source', 'Missing required policy source fixture.', key));
      }
      continue;
    }
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

  let policy;
  try {
    policy = parseProductionSyncBoundaryPolicy(sources.policy);
  } catch (error) {
    if (Array.isArray(error?.violations)) return error.violations;
    return [violation('invalid-policy', 'The sync boundary policy could not be parsed.', 'policy')];
  }

  const runtime = collectText(sources, ['runtime', 'imports']);
  const productionRead = sourceText(sources, 'productionRead', ['productionReadSource']);
  const deployment = sourceText(sources, 'deployment', ['deploymentSource', 'deploymentConfig']);
  const runtimeParts = sourceParts(sources, 'runtime', ['runtimeSource', 'productionRuntime']);
  const importParts = sourceParts(sources, 'imports', ['importSource']);
  const productionReadParts = sourceParts(sources, 'productionRead', ['productionReadSource']);
  const deploymentParts = sourceParts(sources, 'deployment', ['deploymentSource', 'deploymentConfig']);
  const firebaseRcPart = sourceParts(sources, 'firebaseRc')[0];
  const executableText = `${runtime}\n${deployment}`;
  const productionHandles = productionHandleNames(executableText);
  const productionHandle = productionHandlePattern(productionHandles);

  if (!runtime.includes(policy.productionProjectId) || !runtime.includes(policy.uatProjectId)) {
    violations.push(violation('fixed-project-direction-missing', 'Runtime must bind the fixed Production and UAT project IDs.', 'runtime'));
  }

  const sourceCollectionCalls = [...executableText.matchAll(new RegExp(`\\b(${productionHandle})\\s*\\.collection\\s*\\(([^)]*)\\)`, 'g'))];
  if (sourceCollectionCalls.some(([, , argument]) => !isLiteralWeeksCollection(argument))) {
    violations.push(violation('source-collection-not-allowlisted', 'The Production read boundary may access only the literal weeks collection.', 'runtime'));
  }
  const syncCollection = executableText.match(/\bSYNC_COLLECTION\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (syncCollection && syncCollection !== 'weeks') {
    violations.push(violation('source-collection-not-allowlisted', 'The shared sync collection constant must remain weeks.', 'runtime'));
  }
  if (!sourceCollectionCalls.length && syncCollection !== 'weeks') {
    violations.push(violation('source-collection-not-allowlisted', 'The Production read boundary must identify the fixed weeks collection.', 'runtime'));
  }
  if (new RegExp(`\\b(?:${productionHandle})\\s*\\.collection\\s*\\(\\s*(?:request|data|payload)\\b`).test(executableText)) {
    violations.push(violation('caller-selected-source-collection', 'The caller cannot select the Production collection.', 'runtime'));
  }

  const requestDataAliases = [...executableText.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*request\.data\b/g)]
    .map(match => match[1]);
  const callerSelectsBoundaryKey = requestDataAliases.some(alias =>
    new RegExp(`\\b${alias}\\s*\\.\\s*(?:projectId|collection)\\b`).test(executableText));
  if (/(?:request|data|payload)\s*(?:\?|\.|\[['"]?)\s*(?:projectId|collection)\b|\b(?:projectId|collection)\b\s*:\s*(?:request|data|payload)\b|\{[^}]*\b(?:projectId|collection)\b[^}]*\}\s*=\s*request\.data\b/i.test(executableText)
    || callerSelectsBoundaryKey) {
    violations.push(violation('caller-selected-project-id', 'The caller cannot select the source or destination project ID.', 'runtime'));
  }

  if (new RegExp(`\\b(?:${productionHandle})\\b[^;\\n]*(?:\\.(?:set|update|delete|create|batch|bulkWriter|runTransaction))\\s*\\(`, 'i').test(executableText)) {
    violations.push(violation('production-write-capability', 'The Production boundary must expose reads only; no write operation may target its database.', 'runtime'));
  }

  const unsafeLocalSnapshotSource = disallowedLocalSnapshotSource([...runtimeParts, ...importParts])
    || disallowedLocalSnapshotSource(deploymentParts, true);
  if (unsafeLocalSnapshotSource) {
    violations.push(violation(
      'local-sync-runtime-import',
      'The UAT callable or deployment runtime cannot invoke the old local snapshot-sync utility.',
      unsafeLocalSnapshotSource,
    ));
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

  for (const part of [...runtimeParts, ...importParts, ...productionReadParts, ...deploymentParts]) {
    if (/roles\s*\/\s*datastore/i.test(part.text)) {
      violations.push(violation(
        'datastore-role-outside-policy',
        'Datastore roles must be declared only in the structured sync boundary policy.',
        part.source,
      ));
    }
  }

  const deploymentViolation = firebaseDeployViolation(deploymentParts, firebaseRcPart);
  if (deploymentViolation) violations.push(deploymentViolation);

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
    'firebase.json', 'firebase.shared-backend.json', 'package.json', 'functions/package.json',
    'pdf-service/deploy.ps1',
    ...scriptFiles.filter(path => !path.endsWith('verify-production-sync-boundary.mjs')
      && !path.endsWith('sync-v2.2t-local-data.mjs')),
  ];
  const [runtimeSources, deploymentSources, productionRead, policy, firebaseRc] = await Promise.all([
    Promise.all(runtimePaths.map(async path => ({ source: path, text: await read(path) }))),
    Promise.all(deploymentPaths.map(async path => ({ source: path, text: await read(path) }))),
    read('functions/production-week-sync-production-read.js'),
    read('config/production-week-sync-boundary.json'),
    read('.firebaserc'),
  ]);
  return {
    policy,
    runtime: runtimeSources,
    imports: runtimeSources,
    productionRead,
    deployment: deploymentSources,
    firebaseRc: { source: '.firebaserc', text: firebaseRc },
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
