import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  assertTargetIsDeployable,
  buildEnvVarsYaml,
  buildGcloudArgs,
  defaultGitState,
  runPdfDeploy
} from '../scripts/deploy-pdf.mjs';
import { PdfEnvironmentError, loadTargetRegistry } from '../src/environment.js';

const execFileAsync = promisify(execFile);

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
    /working tree is not completely clean/
  );
});

test('runPdfDeploy: a working tree reported dirty only by an untracked file still refuses to deploy', async () => {
  // Exercises the same runPdfDeploy control-flow guarantee as the test above (an untracked-only dirty report
  // still blocks the deploy before gcloud runs), independent of *why* getGitState considers the tree dirty. The
  // real-git proof that an actual untracked file is what makes defaultGitState report dirty:true lives in the
  // "defaultGitState (real git)" tests below, against an isolated temporary repository.
  await assert.rejects(
    runPdfDeploy(['--target', 'uat'], {
      registry,
      run: neverCalled('run'),
      getGitState: async () => ({ dirty: true, sha: 'abc1234' }),
      log: () => {}
    }),
    /working tree is not completely clean/
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

// `defaultGitState` is exercised here against a real, isolated temporary git repository -- never this repository's
// own working tree -- so these tests prove the actual `git status` invocation detects each case, not just that
// runPdfDeploy's control flow reacts to an injected `{ dirty: true }` fixture (that control-flow guarantee is
// covered separately above).
const GIT_TEST_IDENTITY_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'deploy-pdf test',
  GIT_AUTHOR_EMAIL: 'deploy-pdf-test@example.invalid',
  GIT_COMMITTER_NAME: 'deploy-pdf test',
  GIT_COMMITTER_EMAIL: 'deploy-pdf-test@example.invalid'
};

async function runGit(cwd, args) {
  return execFileAsync('git', args, { cwd, env: GIT_TEST_IDENTITY_ENV });
}

async function withTempGitRepo(exercise) {
  const dir = await mkdtemp(join(tmpdir(), 'deploy-pdf-git-state-'));
  try {
    await runGit(dir, ['init', '--quiet']);
    await writeFile(join(dir, 'tracked.txt'), 'committed content\n');
    await runGit(dir, ['add', 'tracked.txt']);
    await runGit(dir, ['commit', '--quiet', '-m', 'initial commit']);
    await exercise(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('defaultGitState (real git): a freshly committed repository with nothing else is clean', async () => {
  await withTempGitRepo(async dir => {
    assert.equal((await defaultGitState(dir)).dirty, false);
  });
});

test('defaultGitState (real git): a modified tracked file is reported dirty', async () => {
  await withTempGitRepo(async dir => {
    await writeFile(join(dir, 'tracked.txt'), 'modified content\n');
    assert.equal((await defaultGitState(dir)).dirty, true);
  });
});

test('defaultGitState (real git): a staged-but-uncommitted new file is reported dirty', async () => {
  await withTempGitRepo(async dir => {
    await writeFile(join(dir, 'staged.txt'), 'staged content\n');
    await runGit(dir, ['add', 'staged.txt']);
    assert.equal((await defaultGitState(dir)).dirty, true);
  });
});

test('defaultGitState (real git): a deleted tracked file is reported dirty', async () => {
  await withTempGitRepo(async dir => {
    await rm(join(dir, 'tracked.txt'));
    assert.equal((await defaultGitState(dir)).dirty, true);
  });
});

test('defaultGitState (real git): a renamed tracked file is reported dirty', async () => {
  await withTempGitRepo(async dir => {
    await runGit(dir, ['mv', 'tracked.txt', 'renamed.txt']);
    assert.equal((await defaultGitState(dir)).dirty, true);
  });
});

test('defaultGitState (real git): an actual untracked file is reported dirty -- the regression this fix closes', async () => {
  // Before this fix, defaultGitState ran `git status --porcelain --untracked-files=no`, which cannot see this
  // file at all: an untracked file could ride along into `gcloud run deploy --source .`'s upload undetected.
  await withTempGitRepo(async dir => {
    await writeFile(join(dir, 'untracked.txt'), 'never added or committed\n');
    assert.equal((await defaultGitState(dir)).dirty, true, 'an untracked file must make the working tree report dirty');
  });
});

test('defaultGitState (real git): a git-ignored file does not trip the clean-tree guard', async () => {
  await withTempGitRepo(async dir => {
    await writeFile(join(dir, '.gitignore'), 'ignored.txt\n');
    await runGit(dir, ['add', '.gitignore']);
    await runGit(dir, ['commit', '--quiet', '-m', 'add gitignore']);
    await writeFile(join(dir, 'ignored.txt'), 'must not trigger the guard\n');
    assert.equal((await defaultGitState(dir)).dirty, false, 'a git-ignored file must not trip the clean-tree guard');
  });
});
