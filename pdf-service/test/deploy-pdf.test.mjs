import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  UploadManifestError,
  assertTargetIsDeployable,
  assertUploadWithinGitTrackedFiles,
  buildEnvVarsYaml,
  buildGcloudArgs,
  defaultGitState,
  defaultGitTrackedFiles,
  findUntrackedUploadCandidates,
  normalizeUploadPath,
  parseUploadManifestOutput,
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

test('runPdfDeploy --dry-run: never spawns gcloud, never inspects git state, and never resolves the upload manifest', async () => {
  const logs = [];
  const code = await runPdfDeploy(['--target', 'uat', '--dry-run'], {
    registry,
    run: neverCalled('run'),
    getGitState: neverCalled('getGitState'),
    getTrackedFiles: neverCalled('getTrackedFiles'),
    getUploadCandidates: neverCalled('getUploadCandidates'),
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
    getTrackedFiles: async () => ['package.json', 'package-lock.json', 'src/server.js'],
    getUploadCandidates: async () => ['package.json', 'src/server.js'],
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
      getTrackedFiles: async () => ['package.json', 'src/server.js'],
      getUploadCandidates: async () => ['package.json', 'src/server.js'],
      log: () => {}
    }),
    /gcloud exited with code 1/
  );
});

test('runPdfDeploy: an upload candidate outside the git-tracked set refuses to deploy before invoking gcloud', async () => {
  // Proves the guard is actually wired into runPdfDeploy's control flow (not just unit-testable in isolation):
  // a working tree that is otherwise clean (dirty: false) must still be refused if the injected upload-candidate
  // resolver reports a file git does not track.
  await assert.rejects(
    runPdfDeploy(['--target', 'uat'], {
      registry,
      run: neverCalled('run'),
      getGitState: async () => ({ dirty: false, sha: 'abc1234' }),
      getTrackedFiles: async () => ['package.json', 'src/server.js'],
      getUploadCandidates: async () => ['package.json', 'src/server.js', 'tmp/local-only.txt'],
      log: () => {}
    }),
    error => error.message.includes('tmp/local-only.txt') && error.message.includes('git does not track')
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

// -----------------------------------------------------------------------------------------------------------------
// gcloud upload boundary guard
//
// The invariant under test throughout this section: every file gcloud's upload manifest names must be a
// git-tracked file (upload set ⊆ tracked set). The upload set is expected to be a strict subset -- .gcloudignore
// deliberately excludes tracked development files -- so a smaller upload set is never itself a failure.
// -----------------------------------------------------------------------------------------------------------------

test('normalizeUploadPath: normalizes Windows separators and a leading "./"', () => {
  assert.equal(normalizeUploadPath('src\\server.js'), 'src/server.js');
  assert.equal(normalizeUploadPath('./src/server.js'), 'src/server.js');
  assert.equal(normalizeUploadPath('src/server.js'), 'src/server.js');
});

test('parseUploadManifestOutput: rejects entirely blank output as a parsing anomaly, not zero files', () => {
  assert.throws(() => parseUploadManifestOutput(''), UploadManifestError);
  assert.throws(() => parseUploadManifestOutput('\n\n   \n'), UploadManifestError);
});

test('parseUploadManifestOutput: filters blank lines and handles CRLF line endings', () => {
  assert.deepEqual(parseUploadManifestOutput('package.json\r\n\r\nsrc/server.js\r\n'), ['package.json', 'src/server.js']);
});

test('parseUploadManifestOutput: rejects non-string input', () => {
  assert.throws(() => parseUploadManifestOutput(null), UploadManifestError);
});

test('findUntrackedUploadCandidates: A -- every upload candidate tracked returns no violations', () => {
  const tracked = ['package.json', 'src/server.js', 'src/cors.js'];
  const uploaded = ['package.json', 'src/server.js'];
  assert.deepEqual(findUntrackedUploadCandidates(uploaded, tracked), []);
});

test('findUntrackedUploadCandidates: B -- one ordinary untracked upload candidate is reported', () => {
  const tracked = ['package.json', 'src/server.js'];
  const uploaded = ['package.json', 'src/server.js', 'scratch-not-in-git.js'];
  assert.deepEqual(findUntrackedUploadCandidates(uploaded, tracked), ['scratch-not-in-git.js']);
});

test('findUntrackedUploadCandidates: C -- a git-ignored file gcloud still uploads is reported (ignored status is irrelevant)', () => {
  // findUntrackedUploadCandidates never looks at .gitignore at all -- it only compares the upload list against
  // the tracked list, which is exactly why a git-ignored-but-gcloud-uploaded file cannot slip past it.
  const tracked = ['package.json', 'src/server.js'];
  const uploaded = ['package.json', 'src/server.js', 'tmp/local-only.txt'];
  assert.deepEqual(findUntrackedUploadCandidates(uploaded, tracked), ['tmp/local-only.txt']);
});

test('findUntrackedUploadCandidates: D -- a .DS_Store-style ignored local artifact selected for upload is reported', () => {
  const tracked = ['package.json', 'src/server.js'];
  const uploaded = ['package.json', 'src/server.js', '.DS_Store'];
  assert.deepEqual(findUntrackedUploadCandidates(uploaded, tracked), ['.DS_Store']);
});

test('findUntrackedUploadCandidates: E -- duplicate upload-manifest entries are handled deterministically', () => {
  const tracked = ['package.json'];
  const uploaded = ['scratch.js', 'scratch.js', 'scratch.js'];
  const first = findUntrackedUploadCandidates(uploaded, tracked);
  const second = findUntrackedUploadCandidates(uploaded, tracked);
  assert.deepEqual(first, ['scratch.js']); // reported once, not three times
  assert.deepEqual(first, second);
});

test('findUntrackedUploadCandidates: H -- Windows-style path separators normalize to match a POSIX tracked path', () => {
  const tracked = ['src/server.js'];
  const uploaded = ['src\\server.js'];
  assert.deepEqual(findUntrackedUploadCandidates(uploaded, tracked), []);
});

test('findUntrackedUploadCandidates: I -- a legitimate strict subset (e.g. .gcloudignore excluding test/, README) passes', () => {
  const tracked = ['package.json', 'package-lock.json', 'README.md', 'deploy.ps1', 'src/server.js', 'test/app.test.mjs', 'scripts/deploy-pdf.mjs'];
  const uploaded = ['package.json', 'package-lock.json', 'src/server.js'];
  assert.deepEqual(findUntrackedUploadCandidates(uploaded, tracked), []);
});

test('assertUploadWithinGitTrackedFiles: F -- an upload-list command failure fails closed', async () => {
  await assert.rejects(
    assertUploadWithinGitTrackedFiles('/irrelevant', {
      getTrackedFiles: async () => ['package.json'],
      getUploadCandidates: async () => { throw new Error('gcloud is not installed'); }
    }),
    error => error.message.includes('could not determine') && error.message.includes('upload file set')
  );
});

test('assertUploadWithinGitTrackedFiles: G -- a git tracked-list command failure fails closed', async () => {
  await assert.rejects(
    assertUploadWithinGitTrackedFiles('/irrelevant', {
      getTrackedFiles: async () => { throw new Error('not a git repository'); },
      getUploadCandidates: async () => ['package.json']
    }),
    error => error.message.includes('could not determine') && error.message.includes('git-tracked file set')
  );
});

test('assertUploadWithinGitTrackedFiles: resolves without throwing when the upload set is fully tracked', async () => {
  await assert.doesNotReject(assertUploadWithinGitTrackedFiles('/irrelevant', {
    getTrackedFiles: async () => ['package.json', 'src/server.js'],
    getUploadCandidates: async () => ['package.json']
  }));
});

test('assertUploadWithinGitTrackedFiles: rejects with the offending path named when an upload candidate is untracked', async () => {
  await assert.rejects(
    assertUploadWithinGitTrackedFiles('/irrelevant', {
      getTrackedFiles: async () => ['package.json'],
      getUploadCandidates: async () => ['package.json', 'leaked-secret.env']
    }),
    error => error.message.includes('leaked-secret.env')
  );
});

// ---------------------------------------------------------------------------------------------------------------
// THE critical regression proof (task section 7): a file that is git-ignored (so `git status --porcelain` and
// therefore the existing dirty-tree guard both report the tree as clean) but that gcloud's own upload resolution
// would still include. Uses a real, isolated temporary git repository and the real `defaultGitTrackedFiles`
// (real `git ls-files`) -- only the gcloud side is a fake resolver standing in for `gcloud meta
// list-files-for-upload`, since gcloud is not installed in this environment (see the test file's real-gcloud
// availability tests below). The fake resolver's returned list is exactly what a real .gcloudignore that never
// mentions `tmp/` would cause gcloud to report, given the fixture's `.gitignore` hides `tmp/` from git but
// pdf-service/.gcloudignore says nothing about it.
// ---------------------------------------------------------------------------------------------------------------
test('CRITICAL: a git-ignored file gcloud would still upload is rejected before any real deploy invocation', async () => {
  await withTempGitRepo(async dir => {
    // Fixture setup exactly per the task's scenario: a committed tracked baseline exists, .gitignore ignores
    // tmp/, and a file appears under tmp/ that was never added or committed.
    await writeFile(join(dir, '.gitignore'), 'tmp/\n');
    await runGit(dir, ['add', '.gitignore']);
    await runGit(dir, ['commit', '--quiet', '-m', 'add gitignore ignoring tmp/']);
    await mkdir(join(dir, 'tmp'), { recursive: true });
    await writeFile(join(dir, 'tmp', 'local-only.txt'), 'never tracked, never committed, but gcloud would upload it\n');

    // Sanity: prove the premise. The existing dirty-tree guard (real git, real defaultGitState) reports this
    // tree as clean -- exactly the false sense of safety this second guard exists to close.
    const gitState = await defaultGitState(dir);
    assert.equal(gitState.dirty, false, 'the fixture must reproduce the reported blind spot: git considers this tree clean');

    // The real git-tracked-file set for this fixture (real `git ls-files`, not injected).
    const tracked = await defaultGitTrackedFiles(dir);
    assert.ok(!tracked.includes('tmp/local-only.txt'), 'sanity: tmp/local-only.txt must not be git-tracked');

    // A fake gcloud upload resolver simulating exactly the vulnerable case: gcloud's own .gcloudignore semantics
    // did not exclude tmp/local-only.txt (pdf-service/.gcloudignore says nothing about tmp/), so it appears in
    // the upload manifest alongside the real tracked file.
    const fakeUploadCandidates = async () => ['tracked.txt', 'tmp/local-only.txt'];

    await assert.rejects(
      assertUploadWithinGitTrackedFiles(dir, { getTrackedFiles: defaultGitTrackedFiles, getUploadCandidates: fakeUploadCandidates }),
      error => error.message.includes('tmp/local-only.txt') && error.message.includes('git does not track')
    );

    // And the full deployment guard, exercised through runPdfDeploy itself (real git-state check, real
    // git-tracked-file resolution, fake upload resolver standing in for gcloud, real `run` that must never be
    // called): the deploy is refused before any deploy invocation, not merely before the specific helper.
    await assert.rejects(
      runPdfDeploy(['--target', 'uat'], {
        registry,
        run: neverCalled('run'),
        cwd: dir,
        getTrackedFiles: defaultGitTrackedFiles,
        getUploadCandidates: fakeUploadCandidates,
        log: () => {}
      }),
      error => error.message.includes('tmp/local-only.txt')
    );
  });
});

test('real gcloud availability for this environment (informational, not a correctness assertion)', async () => {
  // This test never asserts pass/fail on gcloud's presence -- it exists only to make the sandbox's actual gcloud
  // availability visible in the test report, per the requirement to report unavailable runtime evidence
  // separately rather than silently. All correctness coverage above uses dependency injection precisely because
  // this environment has no gcloud binary to invoke for real.
  const windows = process.platform === 'win32';
  try {
    await execFileAsync(windows ? 'gcloud.cmd' : 'gcloud', ['--version']);
    console.log('gcloud is available in this environment; real `gcloud meta list-files-for-upload` was NOT additionally run by this suite (no cloud mutation is ever performed by these tests).');
  } catch {
    console.log('gcloud is NOT available in this environment; `assertUploadWithinGitTrackedFiles`, `defaultUploadCandidates`, and `parseUploadManifestOutput` are covered entirely through dependency injection above, never against a real `gcloud meta list-files-for-upload` invocation.');
  }
});
