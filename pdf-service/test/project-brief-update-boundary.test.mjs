// Regression coverage for the UAT project-brief / project-update PDF section-picker capability restored after
// Codex's independent review flagged its removal as a blocking regression (Control Plane decision: this UAT-only
// capability must be preserved, and Production behavior must stay unchanged). This file asserts the environment
// boundary end to end -- registry -> resolveRuntimeTarget -> the request parser -- rather than re-asserting the
// section-picker's own rendering, which the six restored tests in report-request.test.mjs, project-report.test.mjs,
// app.test.mjs, and pdf-layout.test.mjs (their .uat.test.mjs originals) already cover.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveRuntimeTarget } from '../src/environment.js';
import { ReportRequestError, parseReportRequest } from '../src/report-request.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const registry = JSON.parse(readFileSync(new URL('../src/targets/registry.json', import.meta.url), 'utf8'));

function prodEnv(extra = {}) {
  return {
    PDF_ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: registry.targets.production.firebaseProjectId,
    ALLOWED_ORIGIN: registry.targets.production.allowedOrigins.join(','),
    K_SERVICE: registry.targets.production.serviceName,
    ...extra
  };
}
function uatEnv(extra = {}) {
  return {
    PDF_ENVIRONMENT: 'uat',
    FIREBASE_PROJECT_ID: registry.targets.uat.firebaseProjectId,
    ALLOWED_ORIGIN: registry.targets.uat.allowedOrigins.join(','),
    K_SERVICE: registry.targets.uat.serviceName,
    ...extra
  };
}

test('the target registry declares the capability explicitly, opposite for each environment (not inferred)', () => {
  assert.equal(registry.targets.uat.features.projectBriefUpdateSections, true);
  assert.equal(registry.targets.production.features.projectBriefUpdateSections, false);
});

test('resolveRuntimeTarget carries the capability flag from the registry into the resolved Production/UAT target', () => {
  const production = resolveRuntimeTarget(prodEnv(), registry);
  const uat = resolveRuntimeTarget(uatEnv(), registry);
  assert.equal(production.features.projectBriefUpdateSections, false);
  assert.equal(uat.features.projectBriefUpdateSections, true);
});

test('a Production-resolved target rejects project-brief and project-update at the request-validation layer', () => {
  const production = resolveRuntimeTarget(prodEnv(), registry);
  for (const section of ['project-brief', 'project-update']) {
    assert.throws(
      () => parseReportRequest({ mode: 'project', weekId: 'W28', projectCode: 'PMS-001', sections: [section] }, production.features),
      error => error instanceof ReportRequestError && /Unknown report section/.test(error.message)
    );
  }
  // Production's own sections keep working unchanged.
  assert.doesNotThrow(() => parseReportRequest(
    { mode: 'project', weekId: 'W28', projectCode: 'PMS-001', sections: ['milestone', 'gantt', 'team-allocation', 'resources', 'budget'] },
    production.features
  ));
});

test('a UAT-resolved target accepts project-brief and project-update at the request-validation layer', () => {
  const uat = resolveRuntimeTarget(uatEnv(), registry);
  const request = parseReportRequest(
    { mode: 'project', weekId: 'W28', projectCode: 'PMS-001', sections: ['project-brief', 'project-update'] },
    uat.features
  );
  assert.deepEqual(request.sections, ['project-brief', 'project-update']);
});

test('the capability switch is a registry-driven feature flag, never a hostname/repository-name/fallback inference', async () => {
  const environmentSource = await readFile(new URL('../src/environment.js', import.meta.url), 'utf8');
  const requestSource = await readFile(new URL('../src/report-request.js', import.meta.url), 'utf8');
  for (const source of [environmentSource, requestSource]) {
    assert.doesNotMatch(source, /location\.hostname|window\.location|process\.argv\[1\]|__dirname.*includes|repositoryName|repoName/i);
  }
  // The flag must be read from the registry's per-target features object, not hardcoded true/false in environment.js.
  assert.match(environmentSource, /target\.features\?\.projectBriefUpdateSections === true/);
});

test('server.js always threads the resolved target.features into createReportHandler (never a bare {} or omitted)', async () => {
  const serverSource = await readFile(`${repoRoot}/src/server.js`, 'utf8');
  assert.match(serverSource, /createReportHandler\(\{[^}]*features:\s*target\.features[^}]*\}\)/s);
});

test('createReportHandler defaults to permissive only for direct unit-test calls; it never masks Production behavior when features are explicit', async () => {
  const appSource = await readFile(`${repoRoot}/src/app.js`, 'utf8');
  assert.match(appSource, /createReportHandler\(\{\s*adapters,\s*renderPdf,\s*features\s*=\s*\{\}\s*\}\)/);
  assert.match(appSource, /parseReportRequest\(body,\s*features\)/);
});
