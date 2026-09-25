import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTargetIsDeployable,
  buildEnvVarsYaml,
  buildGcloudArgs,
  runPdfDeploy
} from '../scripts/deploy-pdf.mjs';
import { PdfEnvironmentError, loadTargetRegistry } from '../src/environment.js';

// The real, committed target registry -- these tests never invent a fake project/service pair to validate the
// pure-function output against; they validate the actual UAT and Production targets this repository will deploy.
const registry = loadTargetRegistry();
const uatTarget = assertTargetIsDeployable('uat', registry);
const productionTarget = assertTargetIsDeployable('production', registry);

function neverCalled(name) {
  return (...args) => {
    throw new Error(`${name} must not be called in this scenario, but was called with ${JSON.stringify(args)}.`);
  };
}

test('buildGcloudArgs: UAT deploy command carries every required Cloud Run setting', () => {
  const args = buildGcloudArgs(uatTarget, '/tmp/fake-env.yaml');

  assert.deepEqual(args.slice(0, 3), ['run', 'deploy', uatTarget.serviceName]);
  assert.deepEqual(args, [
    'run', 'deploy', uatTarget.serviceName,
    '--source', '.',
    '--project', uatTarget.firebaseProjectId,
    '--region', uatTarget.region,
    '--allow-unauthenticated',
    '--ingress', 'all',
    '--min-instances', '0',
    '--max-instances', '1',
    '--concurrency', '1',
    '--cpu', '1',
    '--memory', '1Gi',
    '--timeout', '120',
    '--service-account', uatTarget.runtimeServiceAccount,
    '--env-vars-file', '/tmp/fake-env.yaml',
    '--quiet'
  ]);
});

test('buildGcloudArgs: Production deploy command uses Production identity, not UAT\'s', () => {
  const args = buildGcloudArgs(productionTarget, '/tmp/fake-env.yaml');

  assert.ok(args.includes(productionTarget.firebaseProjectId));
  assert.ok(args.includes(productionTarget.serviceName));
  assert.ok(args.includes(productionTarget.runtimeServiceAccount));
  assert.ok(!args.includes(uatTarget.firebaseProjectId));
  assert.ok(!args.includes(uatTarget.serviceName));
  assert.ok(!args.includes(uatTarget.runtimeServiceAccount));
});

test('buildGcloudArgs: UAT deploy command never names Production\'s project, service, or service account', () => {
  const args = buildGcloudArgs(uatTarget, '/tmp/fake-env.yaml');

  assert.ok(!args.includes(productionTarget.firebaseProjectId));
  assert.ok(!args.includes(productionTarget.serviceName));
  assert.ok(!args.includes(productionTarget.runtimeServiceAccount));
});

test('buildEnvVarsYaml: contains all three required startup variables for the given target', () => {
  const yaml = buildEnvVarsYaml(uatTarget);

  assert.match(yaml, /^PDF_ENVIRONMENT: "uat"$/m);
  assert.ok(yaml.includes(`FIREBASE_PROJECT_ID: ${JSON.stringify(uatTarget.firebaseProjectId)}`));
  assert.ok(yaml.includes(`ALLOWED_ORIGIN: ${JSON.stringify(uatTarget.allowedOrigins.join(','))}`));
});

test('buildEnvVarsYaml: UAT and Production env files never share a project id or origin set', () => {
  const uatYaml = buildEnvVarsYaml(uatTarget);
  const productionYaml = buildEnvVarsYaml(productionTarget);

  assert.notEqual(uatYaml, productionYaml);
  assert.ok(!uatYaml.includes(productionTarget.firebaseProjectId));
  assert.ok(!productionYaml.includes(uatTarget.firebaseProjectId));
  for (const origin of uatTarget.allowedOrigins) {
    if (!productionTarget.allowedOrigins.includes(origin)) {
      assert.ok(!productionYaml.includes(origin));
    }
  }
});

test('assertTargetIsDeployable: rejects a target name the registry does not define', () => {
  assert.throws(
    () => assertTargetIsDeployable('staging', registry),
    PdfEnvironmentError
  );
});

test('assertTargetIsDeployable: rejects a target missing a required registry field', () => {
  const incompleteRegistry = {
    targets: {
      uat: { ...registry.targets.uat, region: '' }
    }
  };
  assert.throws(
    () => assertTargetIsDeployable('uat', incompleteRegistry),
    PdfEnvironmentError
  );
});

test('assertTargetIsDeployable: rejects a runtime service account belonging to a different Firebase project', () => {
  const crossedRegistry = {
    targets: {
      uat: { ...registry.targets.uat, runtimeServiceAccount: productionTarget.runtimeServiceAccount }
    }
  };
  assert.throws(
    () => assertTargetIsDeployable('uat', crossedRegistry),
    PdfEnvironmentError
  );
});

test('assertTargetIsDeployable: rejects non-canonical allowed origins', () => {
  const badOriginRegistry = {
    targets: {
      uat: { ...registry.targets.uat, allowedOrigins: ['*'] }
    }
  };
  assert.throws(() => assertTargetIsDeployable('uat', badOriginRegistry));
});

test('runPdfDeploy --dry-run: never spawns gcloud and never inspects git state', async () => {
  const logs = [];
  const code = await runPdfDeploy(['--target', 'uat', '--dry-run'], {
    registry,
    run: neverCalled('run'),
    getGitState: neverCalled('getGitState'),
    log: message => logs.push(message),
    onEnvFile: () => {}
  });

  assert.equal(code, 0);
  assert.ok(logs.some(line => line.includes('Dry run: gcloud was not started.')));
  assert.ok(logs.some(line => line.startsWith('> gcloud run deploy')));
});

test('runPdfDeploy: Production without --confirm-production fails before touching git or gcloud', async () => {
  await assert.rejects(
    runPdfDeploy(['--target', 'production'], {
      registry,
      run: neverCalled('run'),
      getGitState: neverCalled('getGitState'),
      log: () => {}
    }),
    /--confirm-production/
  );
});

test('runPdfDeploy: Production dry-run does not require --confirm-production', async () => {
  const code = await runPdfDeploy(['--target', 'production', '--dry-run'], {
    registry,
    run: neverCalled('run'),
    getGitState: neverCalled('getGitState'),
    log: () => {}
  });
  assert.equal(code, 0);
});

test('runPdfDeploy: a dirty working tree refuses to deploy before invoking gcloud', async () => {
  await assert.rejects(
    runPdfDeploy(['--target', 'uat'], {
      registry,
      run: neverCalled('run'),
      getGitState: async () => ({ dirty: true, sha: 'deadbee' }),
      log: () => {}
    }),
    /uncommitted tracked changes/
  );
});

test('runPdfDeploy: a clean UAT deploy invokes gcloud exactly once with UAT-only arguments', async () => {
  const runCalls = [];
  const code = await runPdfDeploy(['--target', 'uat'], {
    registry,
    run: async (args, options) => { runCalls.push({ args, options }); return 0; },
    getGitState: async () => ({ dirty: false, sha: 'abc1234' }),
    log: () => {},
    onEnvFile: () => {}
  });

  assert.equal(code, 0);
  assert.equal(runCalls.length, 1);
  assert.ok(runCalls[0].args.includes(uatTarget.serviceName));
  assert.ok(runCalls[0].args.includes(uatTarget.firebaseProjectId));
  assert.ok(!runCalls[0].args.includes(productionTarget.firebaseProjectId));
});

test('runPdfDeploy: a non-zero gcloud exit code fails the deploy', async () => {
  await assert.rejects(
    runPdfDeploy(['--target', 'uat'], {
      registry,
      run: async () => 1,
      getGitState: async () => ({ dirty: false, sha: 'abc1234' }),
      log: () => {}
    }),
    /gcloud exited with code 1/
  );
});

test('runPdfDeploy: the temporary env-vars file is removed after the run, dry-run or not', async () => {
  let capturedPath;
  await runPdfDeploy(['--target', 'uat', '--dry-run'], {
    registry,
    run: neverCalled('run'),
    getGitState: neverCalled('getGitState'),
    log: () => {},
    onEnvFile: path => { capturedPath = path; }
  });

  assert.ok(capturedPath);
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(capturedPath), false);
});
