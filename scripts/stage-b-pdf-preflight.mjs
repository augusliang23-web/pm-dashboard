import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

// Stage B UAT PDF preflight: a source-only, standard-library-only readiness check for the future first UAT PDF
// Cloud Run deployment. It reads local JSON configuration and local git state; it never contacts GCP, Firebase,
// GitHub, or any network endpoint, and it never invokes `gcloud` or `firebase`. It is purely observational: it
// never writes, resets, or cleans anything in the repository it inspects.

export const SUPPORTED_PHASES = Object.freeze(['predeploy', 'postdeploy']);
export const SUPPORTED_FORMATS = Object.freeze(['text', 'json']);

export class PreflightUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PreflightUsageError';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// CLI argument parsing (pure, no I/O) -- unknown flags, unknown phase, and unknown format all fail closed here,
// before any file or git access is attempted.
// ---------------------------------------------------------------------------------------------------------------
export function parseCliArgs(argv) {
  const parsed = { phase: 'predeploy', format: 'text', repo: process.cwd() };
  const args = [...argv];
  while (args.length) {
    const flag = args.shift();
    if (flag === '--phase') {
      const value = args.shift();
      parsed.phase = value;
    } else if (flag === '--format') {
      const value = args.shift();
      parsed.format = value;
    } else if (flag === '--repo') {
      const value = args.shift();
      if (!value) throw new PreflightUsageError('--repo requires a path argument.');
      parsed.repo = value;
    } else {
      throw new PreflightUsageError(
        `Unsupported argument "${flag}". Usage: node scripts/stage-b-pdf-preflight.mjs ` +
        `[--phase <${SUPPORTED_PHASES.join('|')}>] [--format <${SUPPORTED_FORMATS.join('|')}>] [--repo <path>]`
      );
    }
  }
  if (!SUPPORTED_PHASES.includes(parsed.phase)) {
    throw new PreflightUsageError(`Unsupported --phase "${parsed.phase}". Supported phases: ${SUPPORTED_PHASES.join(', ')}.`);
  }
  if (!SUPPORTED_FORMATS.includes(parsed.format)) {
    throw new PreflightUsageError(`Unsupported --format "${parsed.format}". Supported formats: ${SUPPORTED_FORMATS.join(', ')}.`);
  }
  return parsed;
}

function resolveRepoPath(rawRepo) {
  const repo = resolve(rawRepo);
  if (!existsSync(repo)) throw new PreflightUsageError(`--repo path does not exist: ${repo}`);
  if (!statSync(repo).isDirectory()) throw new PreflightUsageError(`--repo path is not a directory: ${repo}`);
  return repo;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure validators -- no I/O, fully unit-testable in isolation.
// ---------------------------------------------------------------------------------------------------------------
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// A canonical bare HTTPS origin: parses as a URL, scheme is exactly https:, and the URL's own canonical
// serialization round-trips to the original string (rejecting a path, query, fragment, credentials, an explicit
// default port, or non-canonical casing). This intentionally does NOT reject a wildcard host by itself -- `*` is
// not a forbidden host code point in the WHATWG URL Standard, so `https://*.example.com` parses and canonicalizes
// without error. Wildcard rejection is a separate, explicit check below.
function isCanonicalHttpsOrigin(raw) {
  if (typeof raw !== 'string') return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.origin === raw;
}

function containsWildcard(raw) {
  return typeof raw === 'string' && raw.includes('*');
}

// A plain JSON object: excludes null, arrays, and every primitive type. Used as the explicit schema/shape
// discriminator -- deliberately separate from "JSON.parse succeeded", which only proves the bytes were valid
// JSON syntax and says nothing about the parsed value's type. Truthiness must never substitute for this check:
// `false`, `0`, and `""` are all valid, successfully-parsed JSON values that are falsy but not objects, and must
// fail here exactly like `null` and `[]` do.
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeJsonTopLevelType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value; // 'boolean', 'number', 'string', or (unreachably here) 'object'/'undefined'
}

const SERVICE_ACCOUNT_PATTERN = /^[a-zA-Z0-9-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/;

function isWellFormedServiceAccount(value) {
  return typeof value === 'string' && SERVICE_ACCOUNT_PATTERN.test(value);
}

function serviceAccountBelongsToProject(value, projectId) {
  return isNonEmptyString(value) && isNonEmptyString(projectId) && value.endsWith(`@${projectId}.iam.gserviceaccount.com`);
}

function parseUrlInfo(raw) {
  if (typeof raw !== 'string') return { parses: false, isHttps: false };
  try {
    const url = new URL(raw);
    return { parses: true, isHttps: url.protocol === 'https:' };
  } catch {
    return { parses: false, isHttps: false };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Check result helpers
// ---------------------------------------------------------------------------------------------------------------
function pass(id, message) {
  return { id, status: 'PASS', message };
}
function fail(id, message) {
  return { id, status: 'FAIL', message };
}

// ---------------------------------------------------------------------------------------------------------------
// Config loading -- never throws; every failure becomes a single, clearly-identified FAIL check, and any check
// that would structurally require the missing/malformed data is skipped rather than emitting confusing follow-on
// noise.
// ---------------------------------------------------------------------------------------------------------------
async function loadJsonFile(absolutePath, checkId, label) {
  if (!existsSync(absolutePath)) {
    return { data: null, check: fail(checkId, `${label} does not exist at ${absolutePath}.`) };
  }
  let raw;
  try {
    raw = await readFile(absolutePath, 'utf8');
  } catch (error) {
    return { data: null, check: fail(checkId, `${label} could not be read: ${error.message}`) };
  }
  try {
    return { data: JSON.parse(raw), check: pass(checkId, `${label} exists and parses as JSON.`) };
  } catch (error) {
    return { data: null, check: fail(checkId, `${label} is not valid JSON: ${error.message}`) };
  }
}

// Explicit schema/shape discriminator, deliberately distinct from "JSON.parse succeeded" above. Valid JSON whose
// top-level value is null, false, 0, "", or an array parses successfully but has the wrong shape and must FAIL
// here -- never be treated as passing by virtue of being merely truthy-agnostic. Returns the shape-checked data
// (safe to pass to the object-shaped validators below) only when the check itself is PASS; otherwise returns
// null so callers cannot accidentally read through a shape that was never confirmed.
function requireObjectShape(loadResult, checkId, label, checks) {
  if (loadResult.check.status !== 'PASS') return null; // Parse failure already reported; nothing further to check.
  if (isPlainObject(loadResult.data)) {
    checks.push(pass(checkId, `${label}'s top-level value is a JSON object, as required.`));
    return loadResult.data;
  }
  checks.push(fail(checkId, `${label}'s top-level value must be a JSON object; found ${describeJsonTopLevelType(loadResult.data)}.`));
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Identity checks shared by both phases: everything about the registry's UAT/Production target shape that must
// hold both before AND after the first UAT deploy. Only the service-URL checks differ by phase (see below).
// ---------------------------------------------------------------------------------------------------------------
function buildIdentityChecks(registry) {
  const checks = [];
  const targets = registry?.targets;
  const uat = targets?.uat;
  const production = targets?.production;

  if (uat && typeof uat === 'object') {
    checks.push(pass('uat-target-exists', 'registry.targets.uat is present.'));
  } else {
    checks.push(fail('uat-target-exists', 'registry.targets.uat is missing or not an object.'));
  }
  if (production && typeof production === 'object') {
    checks.push(pass('production-target-exists', 'registry.targets.production is present.'));
  } else {
    checks.push(fail('production-target-exists', 'registry.targets.production is missing or not an object.'));
  }
  if (!uat || !production) return checks; // Nothing further can be meaningfully checked.

  // Firebase project id
  if (isNonEmptyString(uat.firebaseProjectId)) checks.push(pass('uat-firebase-project-present', 'UAT firebaseProjectId is present.'));
  else checks.push(fail('uat-firebase-project-present', 'UAT firebaseProjectId is missing or empty.'));
  if (isNonEmptyString(production.firebaseProjectId)) checks.push(pass('production-firebase-project-present', 'Production firebaseProjectId is present.'));
  else checks.push(fail('production-firebase-project-present', 'Production firebaseProjectId is missing or empty.'));
  if (isNonEmptyString(uat.firebaseProjectId) && isNonEmptyString(production.firebaseProjectId)) {
    if (uat.firebaseProjectId !== production.firebaseProjectId) {
      checks.push(pass('uat-production-project-ids-distinct', 'UAT and Production firebaseProjectId values are distinct.'));
    } else {
      checks.push(fail('uat-production-project-ids-distinct', 'UAT and Production must not share the same firebaseProjectId.'));
    }
  }

  // Region (UAT only, per the predeploy/postdeploy contract)
  if (isNonEmptyString(uat.region)) checks.push(pass('uat-region-present', 'UAT region is present.'));
  else checks.push(fail('uat-region-present', 'UAT region is missing or empty.'));

  // Service name
  if (isNonEmptyString(uat.serviceName)) checks.push(pass('uat-service-name-present', 'UAT serviceName is present.'));
  else checks.push(fail('uat-service-name-present', 'UAT serviceName is missing or empty.'));
  if (isNonEmptyString(production.serviceName)) checks.push(pass('production-service-name-present', 'Production serviceName is present.'));
  else checks.push(fail('production-service-name-present', 'Production serviceName is missing or empty.'));
  if (isNonEmptyString(uat.serviceName) && isNonEmptyString(production.serviceName)) {
    if (uat.serviceName !== production.serviceName) {
      checks.push(pass('uat-production-service-names-distinct', 'UAT and Production serviceName values are distinct.'));
    } else {
      checks.push(fail('uat-production-service-names-distinct', 'UAT and Production must not share the same serviceName.'));
    }
  }

  // Runtime service account
  if (isNonEmptyString(uat.runtimeServiceAccount)) {
    checks.push(pass('uat-runtime-service-account-present', 'UAT runtimeServiceAccount is present.'));
    if (isWellFormedServiceAccount(uat.runtimeServiceAccount)) {
      checks.push(pass('uat-runtime-service-account-well-formed', 'UAT runtimeServiceAccount matches the expected <name>@<project>.iam.gserviceaccount.com form.'));
    } else {
      checks.push(fail('uat-runtime-service-account-well-formed', `UAT runtimeServiceAccount "${uat.runtimeServiceAccount}" is not a well-formed service account email.`));
    }
    if (isNonEmptyString(uat.firebaseProjectId)) {
      if (serviceAccountBelongsToProject(uat.runtimeServiceAccount, uat.firebaseProjectId)) {
        checks.push(pass('uat-runtime-service-account-matches-project', 'UAT runtimeServiceAccount belongs to the UAT Firebase project.'));
      } else {
        checks.push(fail('uat-runtime-service-account-matches-project', `UAT runtimeServiceAccount "${uat.runtimeServiceAccount}" does not belong to UAT project "${uat.firebaseProjectId}".`));
      }
    }
  } else {
    checks.push(fail('uat-runtime-service-account-present', 'UAT runtimeServiceAccount is missing or empty.'));
  }

  // Allowed origins
  const origins = uat.allowedOrigins;
  if (origins !== undefined) checks.push(pass('uat-allowed-origins-present', 'UAT allowedOrigins is present.'));
  else checks.push(fail('uat-allowed-origins-present', 'UAT allowedOrigins is missing.'));

  if (Array.isArray(origins)) {
    checks.push(pass('uat-allowed-origins-is-array', 'UAT allowedOrigins is an array.'));

    if (origins.length > 0) checks.push(pass('uat-allowed-origins-non-empty', 'UAT allowedOrigins is non-empty.'));
    else checks.push(fail('uat-allowed-origins-non-empty', 'UAT allowedOrigins must not be empty.'));

    const wildcardOrigins = origins.filter(containsWildcard);
    if (wildcardOrigins.length === 0) checks.push(pass('uat-allowed-origins-no-wildcard', 'No UAT allowedOrigins entry contains a wildcard.'));
    else checks.push(fail('uat-allowed-origins-no-wildcard', `UAT allowedOrigins must not contain a wildcard: ${wildcardOrigins.join(', ')}`));

    // Note: the shared GitHub Pages browser origin (https://augusliang23-web.github.io) intentionally appears in
    // BOTH UAT's and Production's allowedOrigins. That is not a failure here: the two environments are separated
    // by Firebase-project-bound ID token verification, not by browser Origin uniqueness, and this check only
    // evaluates UAT's own origin list for internal well-formedness -- it never compares UAT's origins against
    // Production's.
    if (origins.length > 0) {
      const nonCanonical = origins.filter(origin => !isCanonicalHttpsOrigin(origin));
      if (nonCanonical.length === 0) {
        checks.push(pass('uat-allowed-origins-canonical-https', 'Every UAT allowedOrigins entry is a canonical bare HTTPS origin.'));
      } else {
        checks.push(fail('uat-allowed-origins-canonical-https', `UAT allowedOrigins entries must be canonical bare HTTPS origins: ${nonCanonical.map(o => JSON.stringify(o)).join(', ')}`));
      }

      const seen = new Set();
      const duplicates = new Set();
      for (const origin of origins) {
        if (seen.has(origin)) duplicates.add(origin);
        seen.add(origin);
      }
      if (duplicates.size === 0) {
        checks.push(pass('uat-allowed-origins-no-duplicates', 'UAT allowedOrigins has no duplicate entries.'));
      } else {
        checks.push(fail('uat-allowed-origins-no-duplicates', `UAT allowedOrigins contains duplicate entries: ${[...duplicates].join(', ')}`));
      }
    }
  } else {
    checks.push(fail('uat-allowed-origins-is-array', 'UAT allowedOrigins must be an array.'));
  }

  return checks;
}

// ---------------------------------------------------------------------------------------------------------------
// Anchored identity -- the known, intended UAT and Production identity values. Internal-consistency checks alone
// (buildIdentityChecks above) can be satisfied by two coordinated WRONG values, e.g. an entirely different UAT
// project id paired with a service account that correctly belongs to that same wrong project -- every relative
// check ("distinct from Production", "service account belongs to its own project") would pass while the whole
// registry silently points Stage B at the wrong place. This release-safety gate anchors both environments'
// identity to their known intended values, so a coherent-but-wrong pair fails here even though it is internally
// self-consistent. Production is anchored as well as UAT, on the same reasoning: a coordinated wrong pair on the
// Production side would defeat "distinct from UAT" exactly the same way, and anchoring both sides is a small,
// static, source-only addition with no operational cost.
export const EXPECTED_UAT_IDENTITY = Object.freeze({
  firebaseProjectId: 'pm-dashboard-uat-20260820-a7f3',
  region: 'asia-southeast1',
  serviceName: 'pm-dashboard-uat-pdf',
  runtimeServiceAccount: 'pm-dashboard-uat-pdf@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com'
});

export const EXPECTED_PRODUCTION_IDENTITY = Object.freeze({
  firebaseProjectId: 'project-manager-dashboar-a067f',
  region: 'asia-southeast1',
  serviceName: 'pm-dashboard-pdf',
  runtimeServiceAccount: 'pm-dashboard-pdf@project-manager-dashboar-a067f.iam.gserviceaccount.com'
});

function checkMatchesExpected(checkId, envLabel, fieldLabel, actual, expected) {
  if (!isNonEmptyString(actual)) {
    return fail(checkId, `${envLabel} ${fieldLabel} is missing or empty; cannot match the anchored expected value "${expected}".`);
  }
  if (actual === expected) {
    return pass(checkId, `${envLabel} ${fieldLabel} matches the anchored expected value.`);
  }
  return fail(checkId, `${envLabel} ${fieldLabel} "${actual}" does not match the anchored expected value "${expected}".`);
}

function buildAnchoredIdentityChecksFor(target, envLabel, idPrefix, expected) {
  return [
    checkMatchesExpected(`${idPrefix}-firebase-project-matches-expected`, envLabel, 'firebaseProjectId', target?.firebaseProjectId, expected.firebaseProjectId),
    checkMatchesExpected(`${idPrefix}-region-matches-expected`, envLabel, 'region', target?.region, expected.region),
    checkMatchesExpected(`${idPrefix}-service-name-matches-expected`, envLabel, 'serviceName', target?.serviceName, expected.serviceName),
    checkMatchesExpected(`${idPrefix}-runtime-service-account-matches-expected`, envLabel, 'runtimeServiceAccount', target?.runtimeServiceAccount, expected.runtimeServiceAccount)
  ];
}

// Anchored identity checks, plus the browser-Origin-is-not-the-boundary guard restated explicitly (not merely as
// a code comment): a shared Origin between UAT and Production is expected and intentionally not treated as an
// identity collision anywhere in this file -- the real boundary is the anchored Firebase project id / service
// account pair above, verified independently of Origin.
function buildExpectedIdentityChecks(registry) {
  const uat = registry?.targets?.uat;
  const production = registry?.targets?.production;
  return [
    ...buildAnchoredIdentityChecksFor(uat, 'UAT', 'uat', EXPECTED_UAT_IDENTITY),
    ...buildAnchoredIdentityChecksFor(production, 'Production', 'production', EXPECTED_PRODUCTION_IDENTITY)
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Phase-specific service-URL checks
// ---------------------------------------------------------------------------------------------------------------
function buildPredeployUrlChecks(registry, envUat) {
  const checks = [];
  const registryUrl = registry?.targets?.uat?.serviceUrl;
  if (registryUrl === null) {
    checks.push(pass('uat-registry-service-url-is-null', 'registry UAT serviceUrl is null, as expected before the first UAT deploy.'));
  } else {
    checks.push(fail('uat-registry-service-url-is-null', `registry UAT serviceUrl must be null before the first UAT deploy; found ${JSON.stringify(registryUrl)}.`));
  }

  const envUrl = envUat?.pdfServiceUrl;
  if (envUrl === null) {
    checks.push(pass('uat-env-pdf-service-url-is-null', 'env/uat.json pdfServiceUrl is null, as expected before the first UAT deploy.'));
  } else {
    checks.push(fail('uat-env-pdf-service-url-is-null', `env/uat.json pdfServiceUrl must be null before the first UAT deploy; found ${JSON.stringify(envUrl)}.`));
  }
  return checks;
}

function buildPostdeployUrlChecks(registry, envUat) {
  const checks = [];
  const registryUrl = registry?.targets?.uat?.serviceUrl;
  const envUrl = envUat?.pdfServiceUrl;

  const registryNonNull = isNonEmptyString(registryUrl);
  if (registryNonNull) checks.push(pass('uat-registry-service-url-non-null', 'registry UAT serviceUrl is set.'));
  else checks.push(fail('uat-registry-service-url-non-null', `registry UAT serviceUrl must be a non-null URL after deployment; found ${JSON.stringify(registryUrl)}.`));

  const envNonNull = isNonEmptyString(envUrl);
  if (envNonNull) checks.push(pass('uat-env-pdf-service-url-non-null', 'env/uat.json pdfServiceUrl is set.'));
  else checks.push(fail('uat-env-pdf-service-url-non-null', `env/uat.json pdfServiceUrl must be a non-null URL after deployment; found ${JSON.stringify(envUrl)}.`));

  if (registryNonNull && envNonNull) {
    if (registryUrl === envUrl) {
      checks.push(pass('uat-service-url-matches-env', 'registry UAT serviceUrl and env/uat.json pdfServiceUrl are an exact match.'));
    } else {
      checks.push(fail('uat-service-url-matches-env', `registry UAT serviceUrl (${JSON.stringify(registryUrl)}) and env/uat.json pdfServiceUrl (${JSON.stringify(envUrl)}) must match exactly.`));
    }
  }

  // Both URLs must independently be syntactically valid and HTTPS; check each that is present.
  for (const [id, label, value] of [
    ['registry', 'registry UAT serviceUrl', registryUrl],
    ['env', 'env/uat.json pdfServiceUrl', envUrl]
  ]) {
    if (!isNonEmptyString(value)) continue; // Already reported as missing above.
    const info = parseUrlInfo(value);
    if (info.parses) checks.push(pass(`uat-service-url-${id}-syntactically-valid`, `${label} is a syntactically valid URL.`));
    else checks.push(fail(`uat-service-url-${id}-syntactically-valid`, `${label} (${JSON.stringify(value)}) is not a syntactically valid URL.`));
    if (info.parses) {
      if (info.isHttps) checks.push(pass(`uat-service-url-${id}-is-https`, `${label} uses HTTPS.`));
      else checks.push(fail(`uat-service-url-${id}-is-https`, `${label} (${JSON.stringify(value)}) must use HTTPS.`));
    }
  }

  return checks;
}

// ---------------------------------------------------------------------------------------------------------------
// Git state -- observational only. Never resets, cleans, stages, or commits anything. Untracked files count
// toward "dirty", matching the same fail-closed philosophy as pdf-service/scripts/deploy-pdf.mjs's dirty-tree
// deploy guard: default `git status --porcelain` (no `--untracked-files=no`) reports modified, staged, deleted,
// renamed, and untracked paths, while leaving .gitignore'd paths out, exactly as normal development expects.
// ---------------------------------------------------------------------------------------------------------------
async function getGitState(repoDir) {
  try {
    const [branch, head, status] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoDir }),
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoDir }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: repoDir })
    ]);
    return {
      ok: true,
      branch: branch.stdout.trim(),
      head: head.stdout.trim(),
      dirty: status.stdout.trim() !== ''
    };
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim().split('\n')[0];
    return { ok: false, error: detail };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Top-level orchestration
// ---------------------------------------------------------------------------------------------------------------
export async function runPreflight({ repo = process.cwd(), phase = 'predeploy', format = 'text' } = {}) {
  if (!SUPPORTED_PHASES.includes(phase)) throw new PreflightUsageError(`Unsupported phase "${phase}".`);
  if (!SUPPORTED_FORMATS.includes(format)) throw new PreflightUsageError(`Unsupported format "${format}".`);
  const repoDir = resolveRepoPath(repo);

  const checks = [];

  const registryResult = await loadJsonFile(
    join(repoDir, 'pdf-service', 'src', 'targets', 'registry.json'), 'registry-file-loads', 'pdf-service/src/targets/registry.json'
  );
  checks.push(registryResult.check);

  const envUatResult = await loadJsonFile(
    join(repoDir, 'env', 'uat.json'), 'env-uat-file-loads', 'env/uat.json'
  );
  checks.push(envUatResult.check);

  // "JSON.parse succeeded" (registryResult.check / envUatResult.check above) is deliberately never used as the
  // success discriminator for what follows. requireObjectShape is the explicit, separate schema/shape gate:
  // valid JSON whose top-level value is null, false, 0, "", or an array parses fine but has the wrong shape, and
  // must FAIL the shape check below rather than silently skip every downstream identity/URL validation by
  // accident of being falsy or by being a non-object truthy value (an array).
  const registryData = requireObjectShape(
    registryResult, 'registry-shape-valid', 'pdf-service/src/targets/registry.json', checks
  );
  const envUatData = requireObjectShape(
    envUatResult, 'env-uat-shape-valid', 'env/uat.json', checks
  );

  if (registryData) {
    checks.push(...buildIdentityChecks(registryData));
    checks.push(...buildExpectedIdentityChecks(registryData));
    if (phase === 'predeploy') {
      checks.push(...buildPredeployUrlChecks(registryData, envUatData));
    } else {
      checks.push(...buildPostdeployUrlChecks(registryData, envUatData));
    }
  }

  const git = await getGitState(repoDir);
  if (git.ok) {
    checks.push(pass('git-state-determinable', 'Git branch, HEAD, and working-tree status were all determined successfully.'));
  } else {
    checks.push(fail('git-state-determinable', `Could not determine git state at ${repoDir}: ${git.error}`));
  }

  const overall = checks.some(check => check.status === 'FAIL') ? 'FAIL' : 'PASS';

  const report = {
    phase,
    repo: repoDir,
    overall,
    checks,
    git: git.ok
      ? { branch: git.branch, head: git.head, dirty: git.dirty }
      : { branch: null, head: null, dirty: null, error: git.error }
  };
  return report;
}

export function formatReportAsText(report) {
  const lines = [];
  lines.push(`Stage B UAT PDF preflight -- phase: ${report.phase}`);
  lines.push(`repo: ${report.repo}`);
  if (report.git.error) {
    lines.push(`git: <unavailable> (${report.git.error})`);
  } else {
    lines.push(`git: branch=${report.git.branch} head=${report.git.head} dirty=${report.git.dirty}`);
  }
  lines.push('');
  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.id} -- ${check.message}`);
  }
  lines.push('');
  lines.push(`OVERALL: ${report.overall}`);
  return lines.join('\n');
}

export function exitCodeFor(report) {
  return report.overall === 'FAIL' ? 1 : 0;
}

export async function main(argv) {
  let args;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof PreflightUsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  let report;
  try {
    report = await runPreflight(args);
  } catch (error) {
    if (error instanceof PreflightUsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  if (args.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportAsText(report));
  }
  return exitCodeFor(report);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then(code => { process.exitCode = code; })
    .catch(error => { console.error(error.message); process.exitCode = 2; });
}
