import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../professional-pdf-config.js', import.meta.url), 'utf8');

function resolveConfiguredEndpoint(url) {
  const window = { location: new URL(url) };
  vm.runInNewContext(source, { URLSearchParams, window });
  return window.PM_DASHBOARD_PDF_SERVICE_URL;
}

test('routes an explicit local emulator preview to the local PDF service', () => {
  assert.equal(
    resolveConfiguredEndpoint('http://127.0.0.1:4174/?emulator=1&firestorePort=8180&authPort=9109'),
    'http://127.0.0.1:8181'
  );
});

test('keeps the Cloud Run PDF service for the deployed dashboard origin', () => {
  assert.equal(
    resolveConfiguredEndpoint('https://augusliang23-web.github.io/pm-dashboard/?emulator=1'),
    'https://pm-dashboard-pdf-a4naj265kq-as.a.run.app'
  );
});
