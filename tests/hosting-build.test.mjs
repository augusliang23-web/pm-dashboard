import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { collectHostingAssets } from '../scripts/hosting-assets.mjs';
import { buildHosting } from '../scripts/build-hosting.mjs';
import { HOSTING_TARGETS, loadHostingEnv } from '../scripts/hosting-env.mjs';
import { renderEnvConfig } from '../scripts/env-config.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const FORBIDDEN_TOP_LEVEL = [
  'functions', 'tests', 'docs', 'scripts', 'pdf-service', 'config', 'env', 'node_modules', '.git',
  'firestore.rules', 'firestore.uat.rules', 'firestore.shared-backend.rules', 'firestore.uat.indexes.json',
  'firebase.json', '.firebaserc', 'package.json', 'package-lock.json', 'README.md'
];

async function makeRoot(files) {
  const root = await mkdtemp(join(tmpdir(), 'hosting-root-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

async function listTree(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listTree(full, base));
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out.sort();
}

const fakeEnv = {
  environment: 'uat', dashboardProfile: 'uat', release: 'test', baseCommit: 'test',
  firebaseProjectId: 'fake-project', hostingSite: 'fake-project', hostingOrigin: 'https://fake-project.web.app',
  pdfServiceUrl: null, pdfReleaseReady: false,
  firebaseConfig: { apiKey: 'test', authDomain: 'fake-project.firebaseapp.com', projectId: 'fake-project' }
};

function fakeIndex(body = '') {
  return `<!doctype html><script src="./env-config.js"></script>
<script>
const IS_UAT_PROFILE = window.PM_DASHBOARD_ENV.dashboardProfile === 'uat';
</script>
<script type="module">
import { a } from "./js/a.mjs?v=1";
${body}
</script>`;
}

function fakeFiles(overrides = {}) {
  return {
    'index.html': fakeIndex(),
    'env-config.js': renderEnvConfig({ ...fakeEnv, environment: 'committed-default', firebaseProjectId: 'committed-project', firebaseConfig: { ...fakeEnv.firebaseConfig, projectId: 'committed-project' } }),
    'js/a.mjs': "import { b } from '../b.js';\nexport const a = b;\n",
    'b.js': 'export const b = 1;\n',
    'functions/index.js': 'secret\n',
    'firestore.rules': 'rules\n',
    ...overrides
  };
}

test('HOSTING_TARGETS names exactly the two deployable environments, matching env/*.json', () => {
  assert.deepEqual(HOSTING_TARGETS, { uat: 'pm-dashboard-uat-20260820-a7f3', prod: 'project-manager-dashboar-a067f' });
});

test('the hosting asset list is the import closure of the real index.html and includes env-config.js', async () => {
  const assets = await collectHostingAssets(repoRoot);

  for (const required of [
    'index.html', 'env-config.js', 'professional-pdf-config.js', 'professional-pdf-client.mjs',
    'sync-core.js', 'week-carryover.mjs', 'js/dashboard-access.mjs', 'js/project-dashboard-api.mjs',
    'js/portfolio-core.mjs', 'js/executive-outcomes.mjs'
  ]) {
    assert.ok(assets.includes(required), `${required} must be published`);
  }
  for (const asset of assets) {
    assert.doesNotMatch(asset, /^\.\.|^\//, `${asset} must stay inside the repository`);
    assert.doesNotMatch(asset, /\?/, `${asset} must not keep a query string`);
    assert.ok((await stat(join(repoRoot, asset))).isFile(), `${asset} must exist`);
  }
  for (const forbidden of FORBIDDEN_TOP_LEVEL) {
    assert.ok(
      !assets.some(asset => asset === forbidden || asset.startsWith(`${forbidden}/`)),
      `${forbidden} must never be published`
    );
  }
  assert.ok(!assets.some(asset => /\.test\.|\.rules$|\.log$/.test(asset)));
});

test('buildHosting copies the closure and then overwrites only env-config.js with the target rendering', async () => {
  const root = await makeRoot(fakeFiles());
  const outDir = join(root, 'dist');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'stale.js'), 'old');
  try {
    const result = await buildHosting({ rootDir: root, outDir, env: fakeEnv, log: () => {} });
    assert.deepEqual(await listTree(outDir), result.files);
    assert.deepEqual(result.files, ['b.js', 'env-config.js', 'index.html', 'js/a.mjs']);
    for (const file of result.files.filter(f => f !== 'env-config.js')) {
      assert.equal(await readFile(join(outDir, file), 'utf8'), await readFile(join(root, file), 'utf8'), `${file} must be byte-identical`);
    }
    assert.equal(await readFile(join(outDir, 'env-config.js'), 'utf8'), renderEnvConfig(fakeEnv));
    assert.equal(result.pdfReleaseReady, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the build refuses when index.html does not load env-config.js', async () => {
  const root = await makeRoot(fakeFiles({ 'index.html': '<!doctype html><script type="module">import { a } from "./js/a.mjs";</script>' }));
  try {
    await assert.rejects(buildHosting({ rootDir: root, outDir: join(root, 'dist'), env: fakeEnv, log: () => {} }), /env-config\.js/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a missing import target fails the build instead of publishing a broken page', async () => {
  const root = await makeRoot(fakeFiles({ 'js/a.mjs': "import './gone.mjs';\n" }));
  try {
    await assert.rejects(buildHosting({ rootDir: root, outDir: join(root, 'dist'), env: fakeEnv, log: () => {} }), /gone\.mjs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the build refuses when a copied file still names another registered environment project id', async () => {
  const root = await makeRoot(fakeFiles({ 'js/a.mjs': "// pm-dashboard-uat-20260820-a7f3 leaked in here\nexport const a = 1;\n" }));
  try {
    await assert.rejects(
      buildHosting({ rootDir: root, outDir: join(root, 'dist'), env: { ...fakeEnv, environment: 'prod' }, log: () => {} }),
      /js\/a\.mjs.*pm-dashboard-uat-20260820-a7f3/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a build with no PDF service configured logs NOT READY FOR RELEASE and never fabricates an endpoint', async () => {
  const root = await makeRoot(fakeFiles());
  const logs = [];
  try {
    const result = await buildHosting({ rootDir: root, outDir: join(root, 'dist'), env: fakeEnv, log: line => logs.push(line) });
    assert.equal(result.pdfReleaseReady, false);
    assert.ok(logs.some(line => line.startsWith('NOT READY FOR RELEASE')), 'must log the not-ready state');
    const written = await readFile(join(root, 'dist', 'env-config.js'), 'utf8');
    assert.match(written, /pdfServiceUrl: null/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a build with a configured PDF service does not log NOT READY FOR RELEASE', async () => {
  const root = await makeRoot(fakeFiles());
  const readyEnv = { ...fakeEnv, pdfServiceUrl: 'https://fake-pdf.example.test', pdfReleaseReady: true };
  const logs = [];
  try {
    const result = await buildHosting({ rootDir: root, outDir: join(root, 'dist'), env: readyEnv, log: line => logs.push(line) });
    assert.equal(result.pdfReleaseReady, true);
    assert.ok(!logs.some(line => line.includes('NOT READY FOR RELEASE')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the real UAT build publishes only browser files, injects env/uat.json, and never names the Production project', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'hosting-dist-uat-'));
  try {
    const env = await loadHostingEnv(repoRoot, 'uat');
    const logs = [];
    const { files, projectId, pdfReleaseReady } = await buildHosting({ rootDir: repoRoot, outDir, env, log: line => logs.push(line) });
    assert.equal(projectId, 'pm-dashboard-uat-20260820-a7f3');
    assert.deepEqual(files, await collectHostingAssets(repoRoot));
    assert.equal(pdfReleaseReady, false);
    assert.ok(logs.some(line => line.startsWith('NOT READY FOR RELEASE: uat')));
    const envConfig = await readFile(join(outDir, 'env-config.js'), 'utf8');
    assert.match(envConfig, /dashboardProfile: "uat"/);
    assert.match(envConfig, /pdfServiceUrl: null/);
    for (const file of files) {
      assert.ok(!(await readFile(join(outDir, file), 'utf8')).includes('project-manager-dashboar-a067f'), `${file} names the Production project`);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('the real Production build publishes only browser files, injects env/prod.json, and never names the UAT project', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'hosting-dist-prod-'));
  try {
    const env = await loadHostingEnv(repoRoot, 'prod');
    const logs = [];
    const { files, projectId, pdfReleaseReady } = await buildHosting({ rootDir: repoRoot, outDir, env, log: line => logs.push(line) });
    assert.equal(projectId, 'project-manager-dashboar-a067f');
    assert.equal(pdfReleaseReady, true);
    assert.ok(!logs.some(line => line.includes('NOT READY FOR RELEASE')));
    const envConfig = await readFile(join(outDir, 'env-config.js'), 'utf8');
    assert.match(envConfig, /dashboardProfile: "production"/);
    assert.match(envConfig, /pdfServiceUrl: "https:\/\/pm-dashboard-pdf-a4naj265kq-as\.a\.run\.app"/);
    for (const file of files) {
      assert.ok(!(await readFile(join(outDir, file), 'utf8')).includes('pm-dashboard-uat-20260820-a7f3'), `${file} names the UAT project`);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('the generated hosting directory is never committed', async () => {
  const ignore = await readFile(join(repoRoot, '.gitignore'), 'utf8');
  assert.match(ignore, /^dist\/$/m);
});

test('both environment files declare a Firebase project matching the code allowlist and a registered PDF endpoint shape', async () => {
  for (const name of Object.keys(HOSTING_TARGETS)) {
    const env = await loadHostingEnv(repoRoot, name);
    assert.equal(env.firebaseProjectId, HOSTING_TARGETS[name]);
    assert.equal(typeof env.pdfReleaseReady, 'boolean');
    if (env.pdfServiceUrl !== null) assert.match(env.pdfServiceUrl, /^https:\/\//);
  }
});

test('the environment loader rejects an unknown environment and a path traversal attempt', async () => {
  await assert.rejects(loadHostingEnv(repoRoot, 'staging'), /unknown|not a hosting target/i);
  await assert.rejects(loadHostingEnv(repoRoot, '../package'), /unknown|not a hosting target/i);
});

test('env/prod.json is release-ready and env/uat.json is not, matching the pdf-service target registry', async () => {
  const registry = JSON.parse(await readFile(join(repoRoot, 'pdf-service/src/targets/registry.json'), 'utf8'));
  const prod = await loadHostingEnv(repoRoot, 'prod');
  const uat = await loadHostingEnv(repoRoot, 'uat');
  assert.equal(prod.pdfServiceUrl, registry.targets.production.serviceUrl);
  assert.equal(uat.pdfServiceUrl, registry.targets.uat.serviceUrl);
  assert.equal(prod.pdfReleaseReady, true);
  assert.equal(uat.pdfReleaseReady, false);
});
