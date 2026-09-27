import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeUsageCostGuardConfig, renderEnvConfig } from '../scripts/env-config.mjs';

const PROD_ENV = JSON.parse(await readFile(new URL('../env/prod.json', import.meta.url), 'utf8'));
const UAT_ENV = JSON.parse(await readFile(new URL('../env/uat.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------------------------
// Runtime config: Production cap exposed correctly
// ---------------------------------------------------------------------------------------------

test('normalizeUsageCostGuardConfig: Production Cloud Run + Functions caps expose S$2, manualConfig, dashboard-config, 2026-09-26', () => {
  const normalized = normalizeUsageCostGuardConfig(PROD_ENV.usageCostGuard);
  for (const service of ['cloudRun', 'cloudRunFunctions']) {
    assert.equal(normalized[service].configuredCapSgd, 2);
    assert.equal(normalized[service].source, 'dashboard-config');
    assert.equal(normalized[service].trustLevel, 'manualConfig');
    assert.equal(normalized[service].verifiedAt, '2026-09-26');
  }
});

test('normalizeUsageCostGuardConfig: UAT Cloud Run + Functions caps expose the same verified S$2 configuration', () => {
  const normalized = normalizeUsageCostGuardConfig(UAT_ENV.usageCostGuard);
  for (const service of ['cloudRun', 'cloudRunFunctions']) {
    assert.equal(normalized[service].configuredCapSgd, 2);
    assert.equal(normalized[service].trustLevel, 'manualConfig');
    assert.equal(normalized[service].verifiedAt, '2026-09-26');
  }
});

test('normalizeUsageCostGuardConfig: Cloud Run and Cloud Run Functions remain separate objects', () => {
  const normalized = normalizeUsageCostGuardConfig(PROD_ENV.usageCostGuard);
  assert.notStrictEqual(normalized.cloudRun, normalized.cloudRunFunctions);
});

test('normalizeUsageCostGuardConfig: missing/null usageCostGuard renders both services as null, never a fabricated cap', () => {
  const normalized = normalizeUsageCostGuardConfig(null);
  assert.equal(normalized.cloudRun, null);
  assert.equal(normalized.cloudRunFunctions, null);
});

test('normalizeUsageCostGuardConfig: exposes ONLY configuredCapSgd/source/trustLevel/verifiedAt -- no other keys pass through', () => {
  const withExtraFields = {
    cloudRun: {
      configuredCapSgd: 2, source: 'dashboard-config', trustLevel: 'manualConfig', verifiedAt: '2026-09-26',
      billingAccountId: 'billingAccounts/012345-ABCDEF-6789',
      serviceAccount: 'ci-deployer@project.iam.gserviceaccount.com',
      apiKey: 'super-secret-key',
    },
  };
  const normalized = normalizeUsageCostGuardConfig(withExtraFields);
  assert.deepEqual(Object.keys(normalized.cloudRun).sort(), ['configuredCapSgd', 'source', 'trustLevel', 'verifiedAt']);
  assert.ok(!('billingAccountId' in normalized.cloudRun));
  assert.ok(!('serviceAccount' in normalized.cloudRun));
  assert.ok(!('apiKey' in normalized.cloudRun));
});

// ---------------------------------------------------------------------------------------------
// renderEnvConfig: the actual browser-emitted text
// ---------------------------------------------------------------------------------------------

test('renderEnvConfig(prod): browser text exposes the Production usageCostGuard block with manualConfig caps', () => {
  const text = renderEnvConfig(PROD_ENV);
  assert.match(text, /usageCostGuard: Object\.freeze\(/);
  assert.match(text, /configuredCapSgd: 2/);
  assert.match(text, /trustLevel: "manualConfig"/);
  assert.match(text, /verifiedAt: "2026-09-26"/);
});

test('renderEnvConfig(uat): browser text exposes the UAT usageCostGuard block independently of Production text', () => {
  const prodText = renderEnvConfig(PROD_ENV);
  const uatText = renderEnvConfig(UAT_ENV);
  assert.match(uatText, /usageCostGuard: Object\.freeze\(/);
  // Both currently configure S$2, but the rendered text must come from each env's own JSON, not
  // a shared reference -- prove that by mutating one input and re-rendering.
  const mutatedUat = { ...UAT_ENV, usageCostGuard: { ...UAT_ENV.usageCostGuard, cloudRun: { ...UAT_ENV.usageCostGuard.cloudRun, configuredCapSgd: 9 } } };
  const mutatedText = renderEnvConfig(mutatedUat);
  assert.match(mutatedText, /configuredCapSgd: 9/);
  assert.doesNotMatch(prodText, /configuredCapSgd: 9/);
});

test('renderEnvConfig: never emits a Billing account id, service account, or secret-looking field', () => {
  const prodText = renderEnvConfig(PROD_ENV);
  const uatText = renderEnvConfig(UAT_ENV);
  for (const text of [prodText, uatText]) {
    assert.doesNotMatch(text, /billingAccount/i);
    assert.doesNotMatch(text, /serviceAccount/i);
    assert.doesNotMatch(text, /privateKey/i);
    assert.doesNotMatch(text, /clientSecret/i);
    assert.doesNotMatch(text, /"currentSpend"/i, 'must never ship a current-spend value from config');
  }
});

test('renderEnvConfig: missing usageCostGuard in the input env still renders a safe null block (no throw)', () => {
  const envWithoutUsageCostGuard = { ...PROD_ENV, usageCostGuard: undefined };
  const text = renderEnvConfig(envWithoutUsageCostGuard);
  assert.match(text, /cloudRun: null/);
  assert.match(text, /cloudRunFunctions: null/);
});

test('the committed env-config.js is exactly renderEnvConfig(prod), including the usageCostGuard block', async () => {
  const committed = await readFile(new URL('../env-config.js', import.meta.url), 'utf8');
  assert.equal(committed, renderEnvConfig(PROD_ENV));
});
