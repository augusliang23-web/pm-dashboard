import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  PreflightUsageError,
  SUPPORTED_FORMATS,
  SUPPORTED_PHASES,
  exitCodeFor,
  formatReportAsText,
  parseCliArgs,
  runPreflight
} from '../scripts/stage-b-pdf-preflight.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const CLI_PATH = join(repoRoot, 'scripts', 'stage-b-pdf-preflight.mjs');

const GIT_TEST_IDENTITY_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'stage-b-preflight test',
  GIT_AUTHOR_EMAIL: 'stage-b-preflight-test@example.invalid',
  GIT_COMMITTER_NAME: 'stage-b-preflight test',
  GIT_COMMITTER_EMAIL: 'stage-b-preflight-test@example.invalid'
};

async function runGit(cwd, args) {
  return execFileAsync('git', args, { cwd, env: GIT_TEST_IDENTITY_ENV });
}

function validRegistry(overrides = {}) {
  const uat = {
    firebaseProjectId: 'demo-uat-project',
    region: 'asia-southeast1',
    serviceName: 'demo-uat-pdf',
    runtimeServiceAccount: 'demo-uat-pdf@demo-uat-project.iam.gserviceaccount.com',
    serviceUrl: null,
    allowedOrigins: ['https://example.github.io', 'https://demo-uat-project.web.app'],
    ...(overrides.uat || {})
  };
  const production = {
    firebaseProjectId: 'demo-prod-project',
    serviceName: 'demo-prod-pdf',
    ...(overrides.production || {})
  };
  return { targets: { uat, production } };
}

function validEnvUat(overrides = {}) {
  return { pdfServiceUrl: null, ...overrides };
}

async function writeFixture(dir, { registry, envUat } = {}) {
  const registryDir = join(dir, 'pdf-service', 'src', 'targets');
  await mkdir(registryDir, { recursive: true });
  await writeFile(join(registryDir, 'registry.json'), JSON.stringify(registry ?? validRegistry(), null, 2));

  const envDir = join(dir, 'env');
  await mkdir(envDir, { recursive: true });
  if (envUat !== null) {
    await writeFile(join(envDir, 'uat.json'), JSON.stringify(envUat ?? validEnvUat(), null, 2));
  }
}

async function withFixtureDir(setup, exercise) {
  const dir = await mkdtemp(join(tmpdir(), 'stage-b-preflight-'));
  try {
    await writeFixture(dir, typeof setup === 'function' ? await setup(dir) : setup);
    return await exercise(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withGitFixtureDir(setup, exercise) {
  const dir = await mkdtemp(join(tmpdir(), 'stage-b-preflight-git-'));
  try {
    await writeFixture(dir, typeof setup === 'function' ? await setup(dir) : setup);
    await runGit(dir, ['init', '--quiet']);
    await runGit(dir, ['add', '-A']);
    await runGit(dir, ['commit', '--quiet', '-m', 'initial fixture commit']);
    return await exercise(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function findCheck(report, id) {
  return report.checks.find(check => check.id === id);
}

// --------------------------------------------------------------------------------------------------------------
// 1-2: valid predeploy / postdeploy states
// --------------------------------------------------------------------------------------------------------------
test('1. a fully valid predeploy configuration passes overall', async () => {
  await withGitFixtureDir({}, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'PASS');
    assert.ok(report.checks.every(check => check.status !== 'FAIL'));
  });
});

test('2. a fully valid postdeploy configuration passes overall', async () => {
  const url = 'https://demo-uat-pdf-abc123-as.a.run.app';
  await withGitFixtureDir({
    registry: validRegistry({ uat: { serviceUrl: url } }),
    envUat: validEnvUat({ pdfServiceUrl: url })
  }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'postdeploy' });
    assert.equal(report.overall, 'PASS');
    assert.ok(report.checks.every(check => check.status !== 'FAIL'));
  });
});

// --------------------------------------------------------------------------------------------------------------
// 3-4: predeploy URL-must-be-null checks
// --------------------------------------------------------------------------------------------------------------
test('3. predeploy fails when registry UAT serviceUrl is already non-null', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { serviceUrl: 'https://already-deployed.a.run.app' } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-registry-service-url-is-null').status, 'FAIL');
  });
});

test('4. predeploy fails when env/uat.json pdfServiceUrl is already non-null', async () => {
  await withFixtureDir({ envUat: validEnvUat({ pdfServiceUrl: 'https://already-deployed.a.run.app' }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-env-pdf-service-url-is-null').status, 'FAIL');
  });
});

// --------------------------------------------------------------------------------------------------------------
// 5-9: postdeploy URL checks
// --------------------------------------------------------------------------------------------------------------
test('5. postdeploy fails when registry UAT serviceUrl is still null', async () => {
  await withFixtureDir({ envUat: validEnvUat({ pdfServiceUrl: 'https://deployed.a.run.app' }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'postdeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-registry-service-url-non-null').status, 'FAIL');
  });
});

test('6. postdeploy fails when env/uat.json pdfServiceUrl is still null', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { serviceUrl: 'https://deployed.a.run.app' } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'postdeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-env-pdf-service-url-non-null').status, 'FAIL');
  });
});

test('7. postdeploy fails when registry and env URLs do not match exactly', async () => {
  await withFixtureDir({
    registry: validRegistry({ uat: { serviceUrl: 'https://deployed-a.a.run.app' } }),
    envUat: validEnvUat({ pdfServiceUrl: 'https://deployed-b.a.run.app' })
  }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'postdeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-service-url-matches-env').status, 'FAIL');
  });
});

test('8. postdeploy fails when the service URL is plain HTTP', async () => {
  const url = 'http://deployed.a.run.app';
  await withFixtureDir({
    registry: validRegistry({ uat: { serviceUrl: url } }),
    envUat: validEnvUat({ pdfServiceUrl: url })
  }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'postdeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-service-url-registry-is-https').status, 'FAIL');
    assert.equal(findCheck(report, 'uat-service-url-env-is-https').status, 'FAIL');
  });
});

test('9. postdeploy fails when the service URL is not a syntactically valid URL', async () => {
  const url = 'not a url at all';
  await withFixtureDir({
    registry: validRegistry({ uat: { serviceUrl: url } }),
    envUat: validEnvUat({ pdfServiceUrl: url })
  }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'postdeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-service-url-registry-syntactically-valid').status, 'FAIL');
  });
});

// --------------------------------------------------------------------------------------------------------------
// 10-12: runtime service account
// --------------------------------------------------------------------------------------------------------------
test('10. fails when the runtime service account belongs to the wrong project', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { runtimeServiceAccount: 'demo-uat-pdf@some-other-project.iam.gserviceaccount.com' } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-runtime-service-account-matches-project').status, 'FAIL');
  });
});

test('11. fails when the runtime service account is malformed', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { runtimeServiceAccount: 'not-a-service-account' } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-runtime-service-account-well-formed').status, 'FAIL');
  });
});

test('12. fails when the runtime service account is missing', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { runtimeServiceAccount: '' } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-runtime-service-account-present').status, 'FAIL');
  });
});

// --------------------------------------------------------------------------------------------------------------
// 13-17: region, service names, firebase project ids
// --------------------------------------------------------------------------------------------------------------
test('13. fails when UAT region is missing', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { region: '' } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-region-present').status, 'FAIL');
  });
});

test('14. fails when UAT serviceName is missing', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { serviceName: '' } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-service-name-present').status, 'FAIL');
  });
});

test('15. fails when UAT and Production serviceName are identical', async () => {
  await withFixtureDir({ registry: validRegistry({ production: { serviceName: 'demo-uat-pdf' } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-production-service-names-distinct').status, 'FAIL');
  });
});

test('16. fails when a Firebase project id is missing', async () => {
  await withFixtureDir({ registry: validRegistry({ production: { firebaseProjectId: '' } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'production-firebase-project-present').status, 'FAIL');
  });
});

test('17. fails when UAT and Production Firebase project ids are identical', async () => {
  await withFixtureDir({ registry: validRegistry({ production: { firebaseProjectId: 'demo-uat-project' } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-production-project-ids-distinct').status, 'FAIL');
  });
});

// --------------------------------------------------------------------------------------------------------------
// 18-22: allowedOrigins
// --------------------------------------------------------------------------------------------------------------
test('18. fails when allowedOrigins is empty', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { allowedOrigins: [] } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-allowed-origins-non-empty').status, 'FAIL');
  });
});

test('19. fails when allowedOrigins is the wrong type', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { allowedOrigins: 'https://example.github.io' } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-allowed-origins-is-array').status, 'FAIL');
  });
});

test('20. fails when an allowedOrigins entry contains a wildcard', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { allowedOrigins: ['https://*.example.com'] } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-allowed-origins-no-wildcard').status, 'FAIL');
  });
});

test('21. fails when an allowedOrigins entry is plain HTTP', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { allowedOrigins: ['http://example.github.io'] } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-allowed-origins-canonical-https').status, 'FAIL');
  });
});

test('22. fails when an allowedOrigins entry includes a path', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { allowedOrigins: ['https://example.github.io/pm-dashboard'] } }) }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'uat-allowed-origins-canonical-https').status, 'FAIL');
  });
});

test('23. duplicate-origin handling is deterministic across repeated runs', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { allowedOrigins: ['https://example.github.io', 'https://example.github.io'] } }) }, async dir => {
    const first = await runPreflight({ repo: dir, phase: 'predeploy' });
    const second = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(first.overall, 'FAIL');
    assert.equal(second.overall, 'FAIL');
    assert.equal(findCheck(first, 'uat-allowed-origins-no-duplicates').status, 'FAIL');
    assert.deepEqual(first.checks, second.checks);
  });
});

// --------------------------------------------------------------------------------------------------------------
// 24-26: missing/malformed files
// --------------------------------------------------------------------------------------------------------------
test('24. fails when the registry file is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stage-b-preflight-'));
  try {
    await mkdir(join(dir, 'env'), { recursive: true });
    await writeFile(join(dir, 'env', 'uat.json'), JSON.stringify(validEnvUat()));
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'registry-file-loads').status, 'FAIL');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('25. fails when env/uat.json is missing', async () => {
  await withFixtureDir({ envUat: null }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'env-uat-file-loads').status, 'FAIL');
  });
});

test('26. fails when a config file is malformed JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stage-b-preflight-'));
  try {
    await writeFixture(dir);
    await writeFile(join(dir, 'pdf-service', 'src', 'targets', 'registry.json'), '{ this is not valid JSON');
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'FAIL');
    assert.equal(findCheck(report, 'registry-file-loads').status, 'FAIL');
    // Downstream registry-dependent checks must not be present -- no false PASS/FAIL noise for data that
    // could not be loaded.
    assert.equal(findCheck(report, 'uat-target-exists'), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------------------------------------------
// 27-28: CLI argument validation (fail closed)
// --------------------------------------------------------------------------------------------------------------
test('27. an unknown phase is rejected before any file or git access', () => {
  assert.throws(() => parseCliArgs(['--phase', 'staging']), PreflightUsageError);
});

test('28. an unknown output format is rejected before any file or git access', () => {
  assert.throws(() => parseCliArgs(['--format', 'yaml']), PreflightUsageError);
});

test('an unknown CLI flag is rejected', () => {
  assert.throws(() => parseCliArgs(['--bogus']), PreflightUsageError);
});

test('a missing/invalid --repo path is rejected via runPreflight', async () => {
  await assert.rejects(runPreflight({ repo: '/this/path/does/not/exist/at/all' }), PreflightUsageError);
});

// --------------------------------------------------------------------------------------------------------------
// 29-30: output format and check-id stability
// --------------------------------------------------------------------------------------------------------------
test('29. the real CLI in --format json mode produces parseable JSON on stdout', async () => {
  await withGitFixtureDir({}, async dir => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, '--phase', 'predeploy', '--format', 'json', '--repo', dir]);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.overall, 'PASS');
    assert.equal(parsed.phase, 'predeploy');
  });
});

test('30. check IDs are stable across repeated runs against the same fixture', async () => {
  await withFixtureDir({}, async dir => {
    const first = await runPreflight({ repo: dir, phase: 'predeploy' });
    const second = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.deepEqual(first.checks.map(c => c.id).sort(), second.checks.map(c => c.id).sort());
  });
});

// --------------------------------------------------------------------------------------------------------------
// 31-38: real git state, isolated temporary repositories only
// --------------------------------------------------------------------------------------------------------------
test('31. a clean, freshly committed temporary git repository reports dirty=false', async () => {
  await withGitFixtureDir({}, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.git.dirty, false);
    assert.equal(findCheck(report, 'git-state-determinable').status, 'PASS');
  });
});

test('32. a modified tracked file reports dirty=true', async () => {
  await withGitFixtureDir({}, async dir => {
    await writeFile(join(dir, 'env', 'uat.json'), JSON.stringify(validEnvUat({ release: 'edited' })));
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.git.dirty, true);
  });
});

test('33. a staged-but-uncommitted change reports dirty=true', async () => {
  await withGitFixtureDir({}, async dir => {
    await writeFile(join(dir, 'staged.txt'), 'staged\n');
    await runGit(dir, ['add', 'staged.txt']);
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.git.dirty, true);
  });
});

test('34. a deleted tracked file reports dirty=true', async () => {
  await withGitFixtureDir({}, async dir => {
    await rm(join(dir, 'env', 'uat.json'));
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.git.dirty, true);
  });
});

test('35. a renamed tracked file reports dirty=true', async () => {
  await withGitFixtureDir({}, async dir => {
    await runGit(dir, ['mv', join('env', 'uat.json'), join('env', 'uat-renamed.json')]);
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.git.dirty, true);
  });
});

test('36. an actual untracked file reports dirty=true', async () => {
  await withGitFixtureDir({}, async dir => {
    await writeFile(join(dir, 'untracked-scratch.txt'), 'never added or committed\n');
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.git.dirty, true);
  });
});

test('37. a git-ignored file follows normal git semantics and does not report dirty', async () => {
  await withGitFixtureDir({}, async dir => {
    await writeFile(join(dir, '.gitignore'), 'ignored.txt\n');
    await runGit(dir, ['add', '.gitignore']);
    await runGit(dir, ['commit', '--quiet', '-m', 'add gitignore']);
    await writeFile(join(dir, 'ignored.txt'), 'must not affect dirty state\n');
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.git.dirty, false);
  });
});

test('38. running outside a git repository produces an actionable FAIL, not a crash', async () => {
  await withFixtureDir({}, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    const gitCheck = findCheck(report, 'git-state-determinable');
    assert.equal(gitCheck.status, 'FAIL');
    assert.ok(gitCheck.message.length > 0);
    assert.equal(report.git.branch, null);
    // Config-based checks must still have run normally; only the git check is affected.
    assert.equal(findCheck(report, 'uat-target-exists').status, 'PASS');
  });
});

// --------------------------------------------------------------------------------------------------------------
// 39-40: no network, no cloud CLI (static source assertions, mirroring the same pattern used to keep
// pdf-service/scripts/deploy-pdf.mjs free of a real deploy invocation)
// --------------------------------------------------------------------------------------------------------------
test('39. the preflight tool performs no network operation', async () => {
  const source = await readFile(CLI_PATH, 'utf8');
  assert.doesNotMatch(source, /\bfetch\(/);
  assert.doesNotMatch(source, /from\s+['"]node:https?['"]/);
  assert.doesNotMatch(source, /require\(\s*['"]https?['"]\s*\)/);
});

test('40. the preflight tool never invokes a cloud CLI', async () => {
  const source = await readFile(CLI_PATH, 'utf8');
  // Comment-only lines are prose describing this exact guarantee (including this file's own module docstring
  // header, which names "gcloud" and "firebase" only to say the tool never invokes them) -- strip them before
  // matching so the assertion checks real code, not the sentence stating the rule.
  const codeOnly = source.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
  assert.doesNotMatch(codeOnly, /\bgcloud\b/);
  assert.doesNotMatch(codeOnly, /\bfirebase\s+deploy\b/);
});

// --------------------------------------------------------------------------------------------------------------
// Additional meaningful coverage
// --------------------------------------------------------------------------------------------------------------
test('the shared GitHub Pages origin appearing in both UAT and Production origin lists is not itself a failure', async () => {
  // Confirms the explicit non-requirement in the task: UAT and Production intentionally share
  // https://augusliang23-web.github.io as a browser origin. The checker only validates UAT's own list.
  await withGitFixtureDir({ registry: validRegistry() }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(findCheck(report, 'uat-allowed-origins-canonical-https').status, 'PASS');
    assert.equal(report.overall, 'PASS');
  });
});

test('predeploy checks never require Production and UAT allowedOrigins to be disjoint', async () => {
  await withGitFixtureDir({
    registry: validRegistry({ production: { allowedOrigins: ['https://example.github.io'] } })
  }, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    assert.equal(report.overall, 'PASS');
  });
});

test('formatReportAsText renders every check and the overall verdict', async () => {
  await withGitFixtureDir({}, async dir => {
    const report = await runPreflight({ repo: dir, phase: 'predeploy' });
    const text = formatReportAsText(report);
    for (const check of report.checks) {
      assert.ok(text.includes(check.id), `text output must mention check id "${check.id}"`);
    }
    assert.ok(text.includes('OVERALL: PASS'));
  });
});

test('exitCodeFor returns 0 for PASS and 1 for FAIL', async () => {
  assert.equal(exitCodeFor({ overall: 'PASS' }), 0);
  assert.equal(exitCodeFor({ overall: 'FAIL' }), 1);
});

test('the CLI exits 2 on a usage error and does not print a stack trace', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [CLI_PATH, '--phase', 'bogus']),
    error => {
      assert.equal(error.code, 2);
      assert.doesNotMatch(error.stderr, /at Object\.<anonymous>/); // no raw stack trace for an expected usage error
      return true;
    }
  );
});

test('the CLI exits 1 (not 0, not a crash) when checks fail', async () => {
  await withFixtureDir({ registry: validRegistry({ uat: { serviceUrl: 'https://already-deployed.a.run.app' } }) }, async dir => {
    await assert.rejects(
      execFileAsync(process.execPath, [CLI_PATH, '--phase', 'predeploy', '--repo', dir]),
      error => {
        assert.equal(error.code, 1);
        return true;
      }
    );
  });
});

test('SUPPORTED_PHASES and SUPPORTED_FORMATS match the documented CLI contract', () => {
  assert.deepEqual([...SUPPORTED_PHASES], ['predeploy', 'postdeploy']);
  assert.deepEqual([...SUPPORTED_FORMATS], ['text', 'json']);
});

// --------------------------------------------------------------------------------------------------------------
// Real-repository sanity: the actual committed configuration must currently be predeploy-clean. This test reads
// the real repository (never writes to it) to keep this suite honest about the state stage-b-pdf-readiness.md
// and the runbook both describe.
// --------------------------------------------------------------------------------------------------------------
test('the real repository currently passes predeploy (UAT PDF service not yet deployed)', async () => {
  const report = await runPreflight({ repo: repoRoot, phase: 'predeploy' });
  assert.equal(findCheck(report, 'uat-registry-service-url-is-null').status, 'PASS');
  assert.equal(findCheck(report, 'uat-env-pdf-service-url-is-null').status, 'PASS');
});
