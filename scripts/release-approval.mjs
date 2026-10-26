// Independently verifiable Owner approval for Cloud Functions releases.
//
// An approval is an Ed25519 signature, made by an Owner-controlled private key that never enters this repository or
// any agent-accessible location, over a canonical release payload (environment, Firebase project, exact source commit
// and tree, exact Function names, count, exclusions, scheduled-Function approvals, validity window). Changing any
// field invalidates the signature. The approval artifact is stored OUTSIDE the repository and is never packaged.
//
// Trust anchor: the matching PUBLIC key(s) are read from a file outside the repository that must be owned by root and
// not writable by group/other (an Owner-run, one-time sudo bootstrap). A key the agent's own user can rewrite is not
// a trust anchor, so a missing or user-writable anchor makes release execution FAIL CLOSED.
//
// Honest limits: this proves "the holder of the pinned Owner key approved exactly this release". It cannot stop an
// operator with unrestricted cloud credentials from calling the Firebase CLI directly, and it cannot prove who holds
// the key. Keep the private key offline/hardware-backed and never give it to an agent.
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

export class ApprovalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export const APPROVAL_SCHEMA = 'pmdash-functions-release-approval/v1';
export const TRUST_SCHEMA = 'pmdash-release-trust/v1';
export const SIGNATURE_DOMAIN = 'PMDASH-FUNCTIONS-RELEASE-APPROVAL-V1\n';
export const DEFAULT_TRUST_ANCHOR_PATH = '/etc/pmdash/functions-release-trust.json';
export const OWNER_BOOTSTRAP_HINT =
  'Owner bootstrap required (see docs/functions-release-guard.md): create an Ed25519 key pair on an Owner-controlled device, ' +
  `keep the private key offline, and install ONLY the public key list as a root-owned, not group/other-writable file at ${DEFAULT_TRUST_ANCHOR_PATH} ` +
  '(or another root-owned path passed with --trust-anchor). Until then --execute stays blocked.';

const LIST_FIELDS = ['functions', 'exclusions', 'scheduledFunctionsApproved'];

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
  }
  return value;
}

// Canonical form: name lists sorted, object keys sorted, no whitespace. The list order is therefore not a way to
// smuggle a difference, and the same payload always has the same bytes.
export function canonicalPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ApprovalError('The approval payload must be an object.');
  const copy = { ...payload };
  for (const field of LIST_FIELDS) {
    if (Array.isArray(copy[field]) && copy[field].every(item => typeof item === 'string')) copy[field] = [...copy[field]].sort();
  }
  return JSON.stringify(sortKeys(copy));
}

export function signedBytes(payload) {
  return Buffer.from(`${SIGNATURE_DOMAIN}${canonicalPayload(payload)}`, 'utf8');
}

export function payloadDigest(payload) {
  return createHash('sha256').update(signedBytes(payload)).digest('hex');
}

function ed25519PublicKey(pem) {
  let key;
  try { key = createPublicKey(pem); } catch { throw new ApprovalError('A trusted public key is not a valid PEM public key.'); }
  if (key.asymmetricKeyType !== 'ed25519') throw new ApprovalError('Only Ed25519 keys are accepted.');
  return key;
}

export function publicKeyFingerprint(pem) {
  const der = ed25519PublicKey(pem).export({ type: 'spki', format: 'der' });
  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

// Owner-side signing (used by scripts/release-approval-cli.mjs on the Owner's device, and with SYNTHETIC keys in tests).
export function signApproval({ payload, privateKeyPem }) {
  let privateKey;
  try { privateKey = createPrivateKey(privateKeyPem); } catch { throw new ApprovalError('The signing key is not a valid PEM private key.'); }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new ApprovalError('Only Ed25519 signing keys are accepted.');
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  return {
    schema: APPROVAL_SCHEMA, payload, keyId: publicKeyFingerprint(publicPem),
    signature: cryptoSign(null, signedBytes(payload), privateKey).toString('base64')
  };
}

function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function parseApprovalArtifact(raw) {
  if (!plainObject(raw)) throw new ApprovalError('The approval is missing or not an object.');
  const keys = Object.keys(raw).sort().join(',');
  if (keys !== 'keyId,payload,schema,signature') throw new ApprovalError(`The approval must contain exactly schema, payload, keyId and signature (found: ${Object.keys(raw).join(', ') || 'nothing'}). Free-text authorisation is not accepted.`);
  if (raw.schema !== APPROVAL_SCHEMA) throw new ApprovalError(`Unsupported approval schema "${raw.schema}".`);
  if (!plainObject(raw.payload)) throw new ApprovalError('The approval payload is missing.');
  if (typeof raw.keyId !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(raw.keyId)) throw new ApprovalError('The approval keyId is malformed.');
  if (typeof raw.signature !== 'string') throw new ApprovalError('The approval signature is missing.');
  const bytes = Buffer.from(raw.signature, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== raw.signature) throw new ApprovalError('The approval signature is malformed.');
  return raw;
}

// Returns the verified payload. Throws unless the signature is valid for a key present in the trust anchor.
export function verifyApproval({ artifact, trustedKeys }) {
  const approval = parseApprovalArtifact(artifact);
  if (!Array.isArray(trustedKeys) || !trustedKeys.length) throw new ApprovalError('No trusted Owner key is configured.');
  const key = trustedKeys.find(candidate => candidate.keyId === approval.keyId);
  if (!key) throw new ApprovalError(`The approval is signed by key ${approval.keyId}, which is not in the trust anchor.`);
  let valid = false;
  try { valid = cryptoVerify(null, signedBytes(approval.payload), ed25519PublicKey(key.publicKeyPem), Buffer.from(approval.signature, 'base64')); } catch { valid = false; }
  if (!valid) throw new ApprovalError('The approval signature does not match its payload (the payload was altered or signed with another key).');
  return approval.payload;
}

function inside(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

export function assertOutside(file, roots, what) {
  for (const root of roots.filter(Boolean)) {
    if (inside(root, file)) throw new ApprovalError(`${what} must be stored outside ${root} (it must never be part of the source or the deployment package).`);
  }
}

const defaultIo = {
  lstat, realpath, access, readFile: path => readFile(path, 'utf8'),
  getuid: () => (typeof process.getuid === 'function' ? process.getuid() : -1)
};

function isRootOwnedAndClosed(stat) {
  return stat.uid === 0 && (stat.mode & 0o022) === 0;
}

function ancestorPaths(absolutePath) {
  const parts = absolutePath.split('/').filter(Boolean);
  const out = ['/'];
  for (let index = 1; index <= parts.length; index += 1) out.push(`/${parts.slice(0, index).join('/')}`);
  return out;
}

async function writableByCurrentUser(io, path) {
  if (typeof io.access !== 'function') return false;
  try { await io.access(path, constants.W_OK); return true; } catch { return false; }
}

// Validates the COMPLETE chain from the filesystem root to the trust-anchor file, before the key is used:
//  1. Every symlink used to reach the file (e.g. macOS /etc -> /private/etc) must itself be root-owned.
//  2. After resolving all links, every directory from "/" down must be a real directory owned by root and not writable
//     by group or others, and must not be writable by the executing user (catches ACLs and ownership surprises).
//  3. The file must be a regular file owned by root, not group/other-writable and not writable by the executing user.
// An attacker who can replace any ancestor can replace the file, so the file's own ownership proves nothing alone.
async function assertTrustPath(path, io, refuse) {
  let real;
  try { real = await io.realpath(path); } catch { throw refuse(`${path} does not exist or cannot be resolved.`); }
  for (const step of ancestorPaths(path)) {
    let stat;
    try { stat = await io.lstat(step); } catch { throw refuse(`${step} cannot be inspected.`); }
    if (stat.isSymbolicLink() && stat.uid !== 0) throw refuse(`${step} is a symbolic link not owned by root (it could be re-pointed).`);
  }
  const chain = ancestorPaths(real);
  const asRoot = io.getuid?.() === 0;
  for (const step of chain.slice(0, -1)) {
    let stat;
    try { stat = await io.lstat(step); } catch { throw refuse(`${step} cannot be inspected.`); }
    if (stat.isSymbolicLink()) throw refuse(`${step} is a symbolic link in the resolved path.`);
    if (!stat.isDirectory()) throw refuse(`${step} is not a directory.`);
    if (stat.uid !== 0) throw refuse(`${step} is not owned by root, so its owner could replace the trust anchor.`);
    if ((stat.mode & 0o022) !== 0) throw refuse(`${step} is writable by group or others, so the trust anchor could be replaced.`);
    if (!asRoot && await writableByCurrentUser(io, step)) throw refuse(`${step} is writable by the executing user.`);
  }
  let file;
  try { file = await io.lstat(real); } catch { throw refuse(`${real} cannot be inspected.`); }
  if (file.isSymbolicLink()) throw refuse(`${real} is a symbolic link.`);
  if (!file.isFile()) throw refuse(`${real} is not a regular file.`);
  if (file.uid !== 0) throw refuse(`${real} is not owned by root, so the executing user could rewrite it.`);
  if ((file.mode & 0o022) !== 0) throw refuse(`${real} is writable by group or others.`);
  if (!asRoot && await writableByCurrentUser(io, real)) throw refuse(`${real} is writable by the executing user.`);
  return { real, stat: file };
}

function sameFile(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.uid === after.uid && before.mode === after.mode;
}

// Loads the pinned verification keys. Every failure is a refusal that includes the Owner bootstrap instructions.
// `ambientRoots` are locations the agent's user can normally write (home, temp, current directory); a trust anchor
// under any of them is refused even before the metadata checks.
export async function loadTrustAnchor({ path = DEFAULT_TRUST_ANCHOR_PATH, forbiddenRoots = [], ambientRoots = defaultAmbientRoots(), io = defaultIo } = {}) {
  const refuse = reason => new ApprovalError(`Trust anchor rejected: ${reason} ${OWNER_BOOTSTRAP_HINT}`);
  if (typeof path !== 'string' || !isAbsolute(path)) throw refuse('the trust anchor path must be absolute.');
  try { assertOutside(path, [...forbiddenRoots, ...ambientRoots], 'The trust anchor'); } catch (error) { throw refuse(error.message); }
  const { real, stat: before } = await assertTrustPath(path, io, refuse);
  try { assertOutside(real, [...forbiddenRoots, ...ambientRoots], 'The resolved trust anchor'); } catch (error) { throw refuse(error.message); }
  let text; let after;
  try { text = await io.readFile(real); after = await io.lstat(real); } catch (error) { throw refuse(`the file could not be read (${error.message}).`); }
  if (!sameFile(before, after)) throw refuse('the file changed while it was being read.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw refuse('the file is not valid JSON.'); }
  if (!plainObject(parsed) || Object.keys(parsed).sort().join(',') !== 'keys,schema' || parsed.schema !== TRUST_SCHEMA) throw refuse(`the file must be {"schema": "${TRUST_SCHEMA}", "keys": [...]} and nothing else.`);
  if (!Array.isArray(parsed.keys) || !parsed.keys.length) throw refuse('the file lists no trusted keys.');
  const seen = new Set();
  const trustedKeys = parsed.keys.map(entry => {
    if (!plainObject(entry) || Object.keys(entry).sort().join(',') !== 'keyId,publicKeyPem') throw refuse('each key needs exactly keyId and publicKeyPem.');
    let fingerprint;
    try { fingerprint = publicKeyFingerprint(entry.publicKeyPem); } catch (error) { throw refuse(error.message); }
    if (fingerprint !== entry.keyId) throw refuse(`keyId ${entry.keyId} is not the fingerprint of its public key.`);
    if (seen.has(entry.keyId)) throw refuse(`duplicate key ${entry.keyId}.`);
    seen.add(entry.keyId);
    return { keyId: entry.keyId, publicKeyPem: entry.publicKeyPem };
  });
  return trustedKeys;
}

export function defaultAmbientRoots() {
  const roots = [process.cwd(), tmpdir()];
  try { roots.push(homedir()); } catch { /* no home directory */ }
  return roots.filter(Boolean);
}
