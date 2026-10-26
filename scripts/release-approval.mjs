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
import { lstat, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

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

const defaultIo = { lstat, readFile: path => readFile(path, 'utf8') };

function assertProtected(stat, label) {
  if (stat.isSymbolicLink()) throw new ApprovalError(`${label} is a symbolic link.`);
  if (stat.uid !== 0) throw new ApprovalError(`${label} is not owned by root, so the executing user could rewrite it.`);
  if ((stat.mode & 0o022) !== 0) throw new ApprovalError(`${label} is writable by group or others.`);
}

// Loads the pinned verification keys. Every failure is a refusal that includes the Owner bootstrap instructions.
export async function loadTrustAnchor({ path = DEFAULT_TRUST_ANCHOR_PATH, forbiddenRoots = [], io = defaultIo } = {}) {
  const refuse = reason => new ApprovalError(`Trust anchor rejected: ${reason} ${OWNER_BOOTSTRAP_HINT}`);
  if (typeof path !== 'string' || !isAbsolute(path)) throw refuse('the trust anchor path must be absolute.');
  try { assertOutside(path, forbiddenRoots, 'The trust anchor'); } catch (error) { throw refuse(error.message); }
  let stat; let directory; let text;
  try { stat = await io.lstat(path); } catch { throw refuse(`${path} does not exist or cannot be read.`); }
  try {
    if (!stat.isFile()) throw new ApprovalError(`${path} is not a regular file.`);
    assertProtected(stat, path);
    directory = await io.lstat(dirname(path));
    if (!directory.isDirectory()) throw new ApprovalError(`${dirname(path)} is not a directory.`);
    assertProtected(directory, dirname(path));
    text = await io.readFile(path);
  } catch (error) { throw refuse(error.message); }
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
