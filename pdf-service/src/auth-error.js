// A narrow, allowlisted boundary around adapters.verifyIdToken. Firebase Admin's verifyIdToken rejects with a
// FirebaseAuthError carrying a `.code` for a genuinely bad caller-supplied credential (expired, malformed, or
// otherwise invalid ID token) -- those cases must surface as 401, not fall through to the generic 500 handling.
// Every other rejection (a network failure, an internal Firebase Admin error, or any error whose `.code` is not in
// this allowlist) is rethrown completely unchanged: it is not obviously a bad-credential condition, so it must
// keep failing safe as an unexpected/internal error (HTTP 500), exactly as before this boundary existed.
//
// `auth/id-token-revoked` is included defensively, not because the current server actively checks revocation:
// server.js calls `auth.verifyIdToken(token)` without `checkRevoked: true`, so Firebase Admin's default path does
// not query for revocation and this code will not be surfaced by today's live verification path. It is allowlisted
// here so that IF the verification layer ever does surface this documented Firebase Auth error code (for example,
// following a future, separately reviewed and authorized decision to pass `checkRevoked: true`), it is correctly
// classified as a client credential/authentication failure (401) rather than an unexpected internal error (500),
// with no separate code change required at that point. Enabling active revocation checking itself is out of scope
// here and is not performed by this change.
const INVALID_TOKEN_ERROR_CODES = new Set([
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token'
]);

export class AuthenticationError extends Error {
  constructor(message = 'The Firebase authentication token is missing, invalid, or expired.') {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
  }
}

// Wraps adapters.verifyIdToken so callers get one of: the decoded token (success), an AuthenticationError (401,
// safe generic message, no Firebase internal error text), or the original error rethrown unchanged (falls through
// to the caller's existing 500 handling). Never returns a partially-decoded token.
export async function verifyBearerToken(adapters, idToken) {
  try {
    return await adapters.verifyIdToken(idToken);
  } catch (error) {
    if (INVALID_TOKEN_ERROR_CODES.has(error?.code)) {
      throw new AuthenticationError();
    }
    throw error;
  }
}
