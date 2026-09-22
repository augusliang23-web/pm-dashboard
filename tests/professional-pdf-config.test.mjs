import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../professional-pdf-config.js', import.meta.url), 'utf8');

function resolveConfiguredEndpoint(url, pdfServiceUrl) {
  const window = { location: new URL(url), PM_DASHBOARD_ENV: { pdfServiceUrl } };
  vm.runInNewContext(source, { URLSearchParams, window });
  return window.PM_DASHBOARD_PDF_SERVICE_URL;
}

test('routes an explicit local emulator preview to the local PDF service regardless of the environment endpoint', () => {
  assert.equal(
    resolveConfiguredEndpoint('http://127.0.0.1:4174/?emulator=1&firestorePort=8180&authPort=9109', 'https://pm-dashboard-pdf-a4naj265kq-as.a.run.app'),
    'http://127.0.0.1:8181'
  );
});

test('uses the injected environment endpoint for a deployed dashboard origin', () => {
  assert.equal(
    resolveConfiguredEndpoint('https://augusliang23-web.github.io/pm-dashboard/?emulator=1', 'https://pm-dashboard-pdf-a4naj265kq-as.a.run.app'),
    'https://pm-dashboard-pdf-a4naj265kq-as.a.run.app'
  );
  assert.equal(
    resolveConfiguredEndpoint('https://pm-dashboard-uat-20260820-a7f3.web.app/', 'https://pm-dashboard-uat-pdf-example.a.run.app'),
    'https://pm-dashboard-uat-pdf-example.a.run.app'
  );
});

test('resolves to an empty string, never a fallback, when the environment has no PDF service configured yet', () => {
  assert.equal(resolveConfiguredEndpoint('https://pm-dashboard-uat-20260820-a7f3.web.app/', null), '');
});

test('refuses to run before the environment configuration has loaded', () => {
  assert.throws(() => {
    const window = { location: new URL('https://example.test/') };
    vm.runInNewContext(source, { URLSearchParams, window });
  }, /Dashboard environment configuration must load/);
});

test('the committed env-config.js (Production) and env/prod.json agree on the PDF endpoint used by this file', async () => {
  const envConfigSource = await readFile(new URL('../env-config.js', import.meta.url), 'utf8');
  const window = {};
  vm.runInNewContext(envConfigSource, { window });
  const prodEnv = JSON.parse(await readFile(new URL('../env/prod.json', import.meta.url), 'utf8'));
  assert.equal(window.PM_DASHBOARD_ENV.pdfServiceUrl, prodEnv.pdfServiceUrl);
  assert.equal(
    resolveConfiguredEndpoint('https://project-manager-dashboar-a067f.web.app/', window.PM_DASHBOARD_ENV.pdfServiceUrl),
    prodEnv.pdfServiceUrl
  );
});
