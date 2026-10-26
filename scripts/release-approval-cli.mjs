// Release approval workflow helper.
//   plan    (Agent or anyone, read-only): derive an UNSIGNED approval payload from a frozen source commit and print the
//           canonical payload plus its digest for the Owner to review. Nothing is signed or deployed.
//   sign    (Owner only, on an Owner-controlled device): sign a reviewed plan with the Owner's PRIVATE key. The key must
//           live outside this repository. The Agent must never be given the key or run this command.
//   verify  (anyone, read-only): check an approval artifact against the pinned trust anchor.
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTRACT_VERSION, ReleaseGuardError, assertReleaseContract, parseDeploymentManifestText, readFunctionSourceText
} from './functions-release-guard.mjs';
import { functionsAllowlistFor } from './deployment-manifest.mjs';
import { readFromCommit, makeGit, resolveSourceCommit } from './functions-source-package.mjs';
import {
  DEFAULT_TRUST_ANCHOR_PATH, TRUST_SCHEMA, assertOutside, canonicalPayload, loadTrustAnchor, payloadDigest, publicKeyFingerprint, signApproval, verifyApproval
} from './release-approval.mjs';

const ISO = date => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

function options(argv, allowed) {
  const found = {};
  const args = [...argv];
  while (args.length) {
    const flag = args.shift();
    if (!allowed.includes(flag)) throw new ReleaseGuardError(`Unsupported argument "${flag}".`);
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new ReleaseGuardError(`${flag} requires a value.`);
    found[flag.slice(2)] = value;
  }
  return found;
}

// Builds the unsigned payload for a frozen source commit. The Function list is explicit; exclusions are derived so
// every manifest-eligible Function is accounted for. Scheduled Functions are never added implicitly.
export async function buildPlan({ rootDir, environment, project, sourceSha, functions, releaseId, hours = 24, approveScheduled = [], now = new Date() }) {
  const git = makeGit(rootDir);
  const source = await resolveSourceCommit(git, sourceSha);
  const manifest = parseDeploymentManifestText(await readFromCommit(git, source.sha, 'config/deployment-manifest.json'));
  const functionSource = readFunctionSourceText(await readFromCommit(git, source.sha, 'functions/index.js'));
  if (!manifest.environments?.[environment]) throw new ReleaseGuardError(`Unknown environment "${environment}".`);
  const managed = functionsAllowlistFor(manifest, environment);
  const names = [...new Set(functions)].sort();
  const payload = {
    contractVersion: CONTRACT_VERSION, releaseId, environment, firebaseProjectId: project,
    sourceSha: source.sha, sourceTree: source.tree, functions: names, expectedFunctionCount: names.length,
    exclusions: managed.filter(name => !names.includes(name)).sort(), scheduledFunctionsApproved: [...new Set(approveScheduled)].sort(),
    notBefore: ISO(now), expiresAt: ISO(new Date(now.getTime() + hours * 3600 * 1000))
  };
  // Same semantic rules the deploy wrapper applies later (HEAD/dirty state is checked at deploy time, not at plan time).
  assertReleaseContract({ manifest, contract: payload, environment, project, git: { sha: source.sha, tree: source.tree, dirty: false }, source: functionSource, now });
  return payload;
}

export async function main(argv, { rootDir = resolve(fileURLToPath(new URL('..', import.meta.url))), log = console.log } = {}) {
  const [command, ...rest] = argv;
  const realRoot = await realpath(rootDir);
  if (command === 'plan') {
    const o = options(rest, ['--env', '--project', '--source-sha', '--functions', '--release-id', '--hours', '--approve-scheduled', '--out']);
    for (const required of ['env', 'project', 'source-sha', 'functions', 'release-id']) if (!o[required]) throw new ReleaseGuardError(`--${required} is required.`);
    const payload = await buildPlan({
      rootDir: realRoot, environment: o.env, project: o.project, sourceSha: o['source-sha'], functions: o.functions.split(','),
      releaseId: o['release-id'], hours: o.hours ? Number(o.hours) : 24, approveScheduled: o['approve-scheduled'] ? o['approve-scheduled'].split(',') : []
    });
    if (o.out) await writeFile(resolve(o.out), `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
    log(`UNSIGNED PLAN - review before signing. Nothing is approved until the Owner signs it.`);
    log(`environment=${payload.environment} project=${payload.firebaseProjectId}`);
    log(`source=${payload.sourceSha} tree=${payload.sourceTree}`);
    log(`functions (${payload.functions.length}): ${payload.functions.join(', ')}`);
    log(`explicitly excluded (${payload.exclusions.length}): ${payload.exclusions.join(', ') || 'none'}`);
    log(`scheduled Functions approved: ${payload.scheduledFunctionsApproved.join(', ') || 'none'}`);
    log(`valid ${payload.notBefore} .. ${payload.expiresAt}`);
    log(`payload-sha256=${payloadDigest(payload)}`);
    log(`canonical=${canonicalPayload(payload)}`);
    return 0;
  }
  if (command === 'sign') {
    const o = options(rest, ['--plan', '--key', '--out', '--expect-digest']);
    for (const required of ['plan', 'key', 'out', 'expect-digest']) if (!o[required]) throw new ReleaseGuardError(`--${required} is required (the Owner must pass the payload digest they reviewed).`);
    assertOutside(resolve(o.key), [realRoot], 'The signing key');
    assertOutside(resolve(o.out), [realRoot], 'The approval');
    const payload = JSON.parse(await readFile(resolve(o.plan), 'utf8'));
    if (payloadDigest(payload) !== o['expect-digest']) throw new ReleaseGuardError('The plan digest differs from the digest the Owner reviewed; refusing to sign.');
    const artifact = signApproval({ payload, privateKeyPem: await readFile(resolve(o.key), 'utf8') });
    await writeFile(resolve(o.out), `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    log(`Signed approval written to ${o.out} (key ${artifact.keyId}).`);
    return 0;
  }
  if (command === 'trust') {
    // Owner bootstrap helper: turn the Owner's PUBLIC key into the trust-anchor file content (printed, never installed).
    const o = options(rest, ['--public-key']);
    if (!o['public-key']) throw new ReleaseGuardError('--public-key is required (a PEM public key; never pass a private key).');
    const publicKeyPem = await readFile(resolve(o['public-key']), 'utf8');
    if (/PRIVATE KEY/.test(publicKeyPem)) throw new ReleaseGuardError('That file contains a private key. Refusing; pass only the public key.');
    log(JSON.stringify({ schema: TRUST_SCHEMA, keys: [{ keyId: publicKeyFingerprint(publicKeyPem), publicKeyPem }] }, null, 2));
    return 0;
  }
  if (command === 'verify') {
    const o = options(rest, ['--approval', '--trust-anchor']);
    if (!o.approval) throw new ReleaseGuardError('--approval is required.');
    const trustedKeys = await loadTrustAnchor({ path: o['trust-anchor'] ? resolve(o['trust-anchor']) : DEFAULT_TRUST_ANCHOR_PATH, forbiddenRoots: [realRoot] });
    const payload = verifyApproval({ artifact: JSON.parse(await readFile(resolve(o.approval), 'utf8')), trustedKeys });
    log(`VALID approval ${payloadDigest(payload)}: ${payload.environment} ${payload.firebaseProjectId} ${payload.functions.length} Functions at ${payload.sourceSha}.`);
    return 0;
  }
  throw new ReleaseGuardError('Usage: node scripts/release-approval-cli.mjs <plan|sign|verify|trust> ...');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
