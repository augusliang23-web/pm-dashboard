// Reviewer Findings Remediation (Control Plane, on top of fcca7b6): HIGH #2 -- loadHostingEnv() previously only
// checked that env/<name>.json's pdfServiceUrl had the *shape* of an https:// URL (or was null). It never compared
// it against the authoritative PDF target registry (pdf-service/src/targets/registry.json), so a Production PDF
// URL pasted into env/uat.json (or vice versa) would pass validation and be built into a "ready" Hosting artifact
// that silently pointed one environment's dashboard at another environment's PDF service -- a direct violation of
// the approved PDF Environment Boundary Contract.
//
// These tests build synthetic env/<name>.json + registry.json pairs so every cell of the required boundary matrix
// is exercised against the real loadHostingEnv() validator, not a hand-rolled comparison of two files in the test
// itself (tests/hosting-build.test.mjs's existing "matching the pdf-service target registry" test reads both real
// files and asserts they currently agree -- useful, but it does not prove the *build* fails closed when they
// don't; that is what this file adds).
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { loadHostingEnv } from '../scripts/hosting-env.mjs';

const PROD_URL = 'https://pm-dashboard-pdf-a4naj265kq-as.a.run.app';
const UAT_URL = 'https://pm-dashboard-uat-pdf-fake.a.run.app';
const UNKNOWN_URL = 'https://some-other-service.a.run.app';

function envFile(name, overrides = {}) {
  const isUat = name === 'uat';
  return {
    environment: name,
    dashboardProfile: isUat ? 'uat' : 'production',
    release: 'test',
    baseCommit: 'test',
    firebaseProjectId: isUat ? 'pm-dashboard-uat-20260820-a7f3' : 'project-manager-dashboar-a067f',
    hostingSite: isUat ? 'pm-dashboard-uat-20260820-a7f3' : 'project-manager-dashboar-a067f',
    hostingOrigin: isUat ? 'https://pm-dashboard-uat-20260820-a7f3.web.app' : 'https://project-manager-dashboar-a067f.web.app',
    pdfServiceUrl: isUat ? null : PROD_URL,
    ...overrides,
  };
}

function registryFile({ uatServiceUrl = null, prodServiceUrl = PROD_URL } = {}) {
  return {
    version: 1,
    targets: {
      uat: {
        environment: 'uat',
        firebaseProjectId: 'pm-dashboard-uat-20260820-a7f3',
        serviceUrl: uatServiceUrl,
      },
      production: {
        environment: 'production',
        firebaseProjectId: 'project-manager-dashboar-a067f',
        serviceUrl: prodServiceUrl,
      },
    },
  };
}

async function makeRoot({ prodOverrides = {}, uatOverrides = {}, registry = registryFile() } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hosting-pdf-boundary-'));
  const write = async (path, content) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), JSON.stringify(content, null, 2));
  };
  await write('env/prod.json', envFile('prod', prodOverrides));
  await write('env/uat.json', envFile('uat', uatOverrides));
  await write('pdf-service/src/targets/registry.json', registry);
  return root;
}

test('correct environment URL: env/prod.json matching the registry\'s production serviceUrl passes and is release-ready', async () => {
  const root = await makeRoot();
  try {
    const env = await loadHostingEnv(root, 'prod');
    assert.equal(env.pdfServiceUrl, PROD_URL);
    assert.equal(env.pdfReleaseReady, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('correct environment URL: env/uat.json matching a registered UAT serviceUrl passes and is release-ready', async () => {
  const root = await makeRoot({
    uatOverrides: { pdfServiceUrl: UAT_URL },
    registry: registryFile({ uatServiceUrl: UAT_URL }),
  });
  try {
    const env = await loadHostingEnv(root, 'uat');
    assert.equal(env.pdfServiceUrl, UAT_URL);
    assert.equal(env.pdfReleaseReady, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UAT config + Production PDF URL: BUILD FAIL', async () => {
  const root = await makeRoot({ uatOverrides: { pdfServiceUrl: PROD_URL } });
  try {
    await assert.rejects(loadHostingEnv(root, 'uat'), /does not match the PDF target registry/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Production config + UAT PDF URL: BUILD FAIL', async () => {
  const root = await makeRoot({
    prodOverrides: { pdfServiceUrl: UAT_URL },
    registry: registryFile({ uatServiceUrl: UAT_URL }),
  });
  try {
    await assert.rejects(loadHostingEnv(root, 'prod'), /does not match the PDF target registry/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UAT pdfServiceUrl = null: allowed only as NOT READY FOR RELEASE, when the registry also has no UAT service yet', async () => {
  const root = await makeRoot(); // default registry has uatServiceUrl: null
  try {
    const env = await loadHostingEnv(root, 'uat');
    assert.equal(env.pdfServiceUrl, null);
    assert.equal(env.pdfReleaseReady, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Production required PDF URL missing: BUILD FAIL when the registry has a registered production service but env/prod.json is null', async () => {
  const root = await makeRoot({ prodOverrides: { pdfServiceUrl: null } });
  try {
    await assert.rejects(loadHostingEnv(root, 'prod'), /does not match the PDF target registry/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Unknown PDF URL: BUILD FAIL when the configured URL matches no registry entry for this environment', async () => {
  const root = await makeRoot({ prodOverrides: { pdfServiceUrl: UNKNOWN_URL } });
  try {
    await assert.rejects(loadHostingEnv(root, 'prod'), /does not match the PDF target registry/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a registry with no entry for the requested environment fails closed instead of skipping the check', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hosting-pdf-boundary-'));
  try {
    await mkdir(join(root, 'env'), { recursive: true });
    await writeFile(join(root, 'env', 'prod.json'), JSON.stringify(envFile('prod'), null, 2));
    await mkdir(join(root, 'pdf-service', 'src', 'targets'), { recursive: true });
    await writeFile(join(root, 'pdf-service', 'src', 'targets', 'registry.json'), JSON.stringify({ version: 1, targets: {} }));
    await assert.rejects(loadHostingEnv(root, 'prod'), /no "production" target/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a missing registry file fails the build instead of silently accepting any PDF URL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hosting-pdf-boundary-'));
  try {
    await mkdir(join(root, 'env'), { recursive: true });
    await writeFile(join(root, 'env', 'prod.json'), JSON.stringify(envFile('prod'), null, 2));
    await assert.rejects(loadHostingEnv(root, 'prod'), /Could not read the authoritative PDF target registry/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the real repository env files still agree with the real registry (build-time check, not just a same-value assertion)', async () => {
  const { fileURLToPath } = await import('node:url');
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const prod = await loadHostingEnv(repoRoot, 'prod');
  const uat = await loadHostingEnv(repoRoot, 'uat');
  assert.equal(prod.pdfReleaseReady, true);
  assert.equal(uat.pdfReleaseReady, false);
});
