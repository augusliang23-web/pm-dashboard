// The Delivery Performance section stays gated: Production off, missing flag off, UAT only when explicitly enabled.
// Uses a controlled synthetic target (an in-memory registry); nothing is deployed or read from the cloud.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReportHandler } from '../src/app.js';
import { loadTargetRegistry, resolveRuntimeTarget } from '../src/environment.js';
import { DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED, buildOverviewPdfRequest, isDeliveryPerformancePdfAvailable } from '../../js/overview-pdf-selection.mjs';

const SECTION = 'portfolio-delivery-performance';
const res = () => ({ headers: new Map(), statusCode: 0, body: undefined, setHeader(k, v) { this.headers.set(k, v); }, end(body) { this.body = body; } });
const adapters = { verifyIdToken: async () => ({uid:'pdf-fixture',firebase:{sign_in_provider:'password'},email: 'pm@example.test' }), getUserByEmail: async () => ({authUid:'pdf-fixture',role: 'pm' }),
  getWeekById: async () => ({ weekLabel: 'W41 2026', isReleased: true, version: 1, projects: [{ projectId: 'a', code: 'A', name: 'Alpha', progress: 10 }] }) };
const body = { mode: 'overview', weekId: 'W41-2026', sections: [SECTION], overviewScope: 'all', projectCodes: ['A'] };
const call = async features => { let rendered = false; const handler = createReportHandler({ adapters, features, renderPdf: async () => { rendered = true; return Buffer.from('%PDF'); } }); const r = res(); await handler({ headers: { authorization: 'Bearer t' }, body }, r); return { r, rendered }; };

test('backend gate: missing, false or non-boolean flag rejects the section like the old backend; only explicit true accepts it', async () => {
  for (const features of [{}, { deliveryPerformanceSection: false }, { deliveryPerformanceSection: 'true' }, { deliveryPerformanceSection: 1 }, { deliveryPerformanceSection: undefined }]) {
    const { r, rendered } = await call(features);
    assert.equal(r.statusCode, 400, JSON.stringify(features));
    assert.deepEqual(JSON.parse(r.body), { error: `Unknown report section: ${SECTION}.` });
    assert.equal(rendered, false, 'nothing is rendered for a rejected request');
  }
  const accepted = await call({ deliveryPerformanceSection: true });
  assert.equal(accepted.r.statusCode, 200);
  assert.equal(accepted.rendered, true);
});

test('target resolution: Production and UAT are enabled when registered true, absent flag is off', () => {
  const registry = JSON.parse(JSON.stringify(loadTargetRegistry()));
  const env = name => ({ PDF_ENVIRONMENT: name, FIREBASE_PROJECT_ID: registry.targets[name].firebaseProjectId, ALLOWED_ORIGIN: registry.targets[name].allowedOrigins.join(','), K_SERVICE: registry.targets[name].serviceName });
  // Production release candidate: both UAT and Production targets ship enabled.
  assert.equal(resolveRuntimeTarget(env('uat'), registry).features.deliveryPerformanceSection, true, 'uat ships enabled');
  assert.equal(resolveRuntimeTarget(env('production'), registry).features.deliveryPerformanceSection, true, 'production ships enabled');
  // Flag removed entirely: off.
  for (const name of ['uat', 'production']) { const copy = JSON.parse(JSON.stringify(registry)); delete copy.targets[name].features.deliveryPerformanceSection; assert.equal(resolveRuntimeTarget(env(name), copy).features.deliveryPerformanceSection, false); }
  // Controlled synthetic enablement:
  const disabled = JSON.parse(JSON.stringify(registry));
  disabled.targets.uat.features.deliveryPerformanceSection = false;
  disabled.targets.production.features.deliveryPerformanceSection = false;
  assert.equal(resolveRuntimeTarget(env('uat'), disabled).features.deliveryPerformanceSection, false);
  assert.equal(resolveRuntimeTarget(env('production'), disabled).features.deliveryPerformanceSection, false);
});

test('feature resolution never depends on a hostname, repository name or request data', () => {
  const source = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/report-request.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/report-data.js', import.meta.url), 'utf8');
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n'); // comments may mention the rule
  assert.doesNotMatch(code, /hostname|location\.host|req\.headers\.host|x-forwarded-host|\.origin\.includes/i);
  assert.match(readFileSync(new URL('../src/server.js', import.meta.url), 'utf8'), /features: target\.features/);
});

test('frontend gate: both UAT and Production profiles can offer and send the section when backend is verified', () => {
  assert.equal(DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED, true, 'frontend release candidate');
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'uat' }), true);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'production' }), true);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'production', backendVerified: true }), true);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'production', backendVerified: false }), false);
  assert.equal(isDeliveryPerformancePdfAvailable({ profile: 'uat', backendVerified: false }), false);
  const request = buildOverviewPdfRequest({ sections: ['health-focus', SECTION], projectCodes: ['A'], overviewScope: 'all', deliveryPerformanceAvailable: false });
  assert.deepEqual(request.sections, ['health-focus']);
});

test('Production release candidate: the shipped registry enables deliveryPerformanceSection for both targets and changes no other feature', () => {
  const registry = loadTargetRegistry();
  assert.deepEqual(registry.targets.uat.features, { liveExecutiveTimeline: true, projectBriefUpdateSections: true, deliveryPerformanceSection: true });
  assert.deepEqual(registry.targets.production.features, { liveExecutiveTimeline: false, projectBriefUpdateSections: false, deliveryPerformanceSection: true });
  // Environment isolation is untouched: project, service, origins and service accounts per target.
  assert.equal(registry.targets.uat.firebaseProjectId, 'pm-dashboard-uat-20260820-a7f3');
  assert.equal(registry.targets.uat.serviceName, 'pm-dashboard-uat-pdf');
  assert.equal(registry.targets.production.firebaseProjectId, 'project-manager-dashboar-a067f');
  assert.equal(registry.targets.production.serviceName, 'pm-dashboard-pdf');
  assert.ok(registry.targets.uat.allowedOrigins.every(origin => !origin.includes('project-manager-dashboar')));
  assert.ok(registry.targets.production.allowedOrigins.every(origin => !origin.includes('pm-dashboard-uat')));
});

test('end to end with the SHIPPED registry: both resolved targets accept the section', async () => {
  const registry = loadTargetRegistry();
  const env = name => ({ PDF_ENVIRONMENT: name, FIREBASE_PROJECT_ID: registry.targets[name].firebaseProjectId, ALLOWED_ORIGIN: registry.targets[name].allowedOrigins.join(','), K_SERVICE: registry.targets[name].serviceName });
  const uat = await call(resolveRuntimeTarget(env('uat'), registry).features);
  assert.equal(uat.r.statusCode, 200);
  assert.equal(uat.rendered, true);
  const production = await call(resolveRuntimeTarget(env('production'), registry).features);
  assert.equal(production.r.statusCode, 200);
  assert.equal(production.rendered, true);
});

test('existing Overview sections are accepted identically by both shipped targets', async () => {
  const registry = loadTargetRegistry();
  const env = name => ({ PDF_ENVIRONMENT: name, FIREBASE_PROJECT_ID: registry.targets[name].firebaseProjectId, ALLOWED_ORIGIN: registry.targets[name].allowedOrigins.join(','), K_SERVICE: registry.targets[name].serviceName });
  for (const name of ['uat', 'production']) {
    const features = resolveRuntimeTarget(env(name), registry).features;
    for (const section of ['health-focus', 'weekly-trend', 'executive-summary', 'attention-matrix', 'risk-actions', 'quarterly-roadmap', 'project-portfolio', 'resource-analytics', 'budget-overview']) {
      let rendered = false;
      const handler = createReportHandler({ adapters, features, renderPdf: async () => { rendered = true; return Buffer.from('%PDF'); } });
      const r = res(); await handler({ headers: { authorization: 'Bearer t' }, body: { ...body, sections: [section] } }, r);
      assert.notEqual(r.statusCode, 400, `${name}/${section} must not be rejected as an unknown section`);
    }
  }
});
