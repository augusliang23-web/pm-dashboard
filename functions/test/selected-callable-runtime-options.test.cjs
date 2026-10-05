const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const functions = require('../index');
const { stackToWire } = require('../node_modules/firebase-functions/lib/runtime/manifest');
const { buildFromV1Alpha1 } = require('../node_modules/firebase-tools/lib/deploy/functions/runtimes/discovery/v1alpha1');
const { toBackend } = require('../node_modules/firebase-tools/lib/deploy/functions/build');
const { allEndpoints } = require('../node_modules/firebase-tools/lib/deploy/functions/backend');
const { resolveCpuAndConcurrency, resolveDefaultTimeout } = require('../node_modules/firebase-tools/lib/deploy/functions/prepare');
const { functionFromEndpoint } = require('../node_modules/firebase-tools/lib/gcp/cloudfunctionsv2');

const project = 'project-manager-dashboar-a067f';
const selectedAccounts = {
  setUserPermissionOverrides: 'pmdash-user-perms@',
  createDashboardWeek: 'pmdash-create-week@',
  saveDashboardWeekFields: 'pmdash-week-fields@',
  saveDashboardProject: 'pmdash-save-project@',
  deleteDashboardProject: 'pmdash-delete-project@',
  saveDashboardGanttTemplateSettings: 'pmdash-gantt-template@',
  saveDashboardGanttWindowSettings: 'pmdash-gantt-window@',
  setDashboardWeekRelease: 'pmdash-week-release@',
};

// Exact wire options recorded from baseline 885a4889, before the fix. null is
// the SDK's reset/default instruction, not evidence of a live instance limit.
const baselineCallableOptions = {
  availableMemoryMb: null, timeoutSeconds: null, minInstances: null,
  maxInstances: null, ingressSettings: null, concurrency: null,
  serviceAccountEmail: null, vpc: null, platform: 'gcfv2', labels: {},
  callableTrigger: {},
};
const executiveNames = [
  'addExecutiveMilestoneUpdate', 'createExecutiveMilestoneChangeRequest',
  'withdrawExecutiveMilestoneChangeRequest', 'decideExecutiveMilestoneChangeRequest',
  'applyDirectExecutiveMilestoneChange', 'initializeExecutiveMilestoneLiveTimeline',
  'saveExecutiveMilestoneTimelineConfig', 'setExecutiveRagOverride',
];
const syncNames = ['syncProductionWeeksToUat', 'getProductionWeekSyncStatus', 'restoreUatWeeksSnapshot'];
const nonSelectedOptions = {
  setDashboardProjectAttention: { ...baselineCallableOptions, serviceAccountEmail: 'pmdash-project-attn@' },
  ...Object.fromEntries(executiveNames.map(name => [name, { ...baselineCallableOptions, region: ['us-central1'] }])),
  ...Object.fromEntries(syncNames.map(name => [name, {
    ...baselineCallableOptions, availableMemoryMb: 512, timeoutSeconds: 540,
    region: ['us-central1'],
    serviceAccountEmail: 'uat-production-sync@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com',
  }])),
  aggregatePresenceSessions: {
    ...baselineCallableOptions, availableMemoryMb: 256, timeoutSeconds: 540,
    region: ['us-central1'], callableTrigger: undefined,
    scheduleTrigger: { schedule: '15 2 * * *', retryConfig: {}, timeZone: 'UTC' },
  },
};
delete nonSelectedOptions.aggregatePresenceSessions.callableTrigger;

// No handlers, emulator, cloud calls or deploy preparation are invoked. This
// follows the real SDK -> CLI discovery -> backend -> Function request path,
// with an empty existing backend so the source must establish the limit itself.
const wire = JSON.parse(JSON.stringify(stackToWire({
  specVersion: 'v1alpha1',
  endpoints: Object.fromEntries(Object.entries(functions).map(([name, fn]) => [name, {
    ...fn.__endpoint, entryPoint: name,
  }])),
})));
const build = buildFromV1Alpha1(wire, project, 'us-central1', 'nodejs22');
const backend = toBackend(build, {});
resolveCpuAndConcurrency(backend);
resolveDefaultTimeout(backend);
const parsed = Object.fromEntries(allEndpoints(backend).map(endpoint => [endpoint.id, {
  endpoint, request: functionFromEndpoint(endpoint),
}]));

test('the selected runtime-option scope agrees with the eight-Function manifest and its pinned maximum of 20', () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, '../../config/deployment-manifest.json'), 'utf8'));
  assert.deepEqual([...manifest.releases.userPermissionsV2.functions].sort(), Object.keys(selectedAccounts).sort());
  assert.equal(manifest.releases.userPermissionsV2.targetConfiguration.config.maxInstanceCount, 20);
  assert.deepEqual(Object.keys(wire.endpoints).sort(), [...Object.keys(selectedAccounts), ...Object.keys(nonSelectedOptions)].sort());
});

for (const [name, account] of Object.entries(selectedAccounts)) {
  test(`${name}: the real SDK and CLI generate an explicit 20-instance limit without changing its identity or other options`, () => {
    assert.deepEqual(wire.endpoints[name], {
      ...baselineCallableOptions, maxInstances: 20, serviceAccountEmail: account, entryPoint: name,
    });
    assert.equal(parsed[name].endpoint.maxInstances, 20);
    const request = parsed[name].request;
    assert.equal(request.serviceConfig.maxInstanceCount, 20);
    assert.equal(request.serviceConfig.serviceAccountEmail, `${account}${project}.iam.gserviceaccount.com`);
    assert.equal(request.name, `projects/${project}/locations/us-central1/functions/${name}`);
    assert.equal(request.buildConfig.runtime, 'nodejs22');
    assert.equal(request.serviceConfig.availableMemory, '256Mi');
    assert.equal(request.serviceConfig.availableCpu, '1');
    assert.equal(request.serviceConfig.maxInstanceRequestConcurrency, 80);
  });
}

for (const [name, options] of Object.entries(nonSelectedOptions)) {
  test(`${name}: all generated SDK options remain at baseline and the CLI does not apply the selected 20-instance policy`, () => {
    assert.deepEqual(wire.endpoints[name], { ...options, entryPoint: name });
    assert.equal(parsed[name].endpoint.maxInstances, null);
    assert.equal(parsed[name].request.serviceConfig.maxInstanceCount, null);
  });
}
