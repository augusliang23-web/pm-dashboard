import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthenticationError, verifyBearerToken } from '../src/auth-error.js';

function firebaseAuthError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

test('passes through the decoded token on success', async () => {
  const decoded = await verifyBearerToken({ verifyIdToken: async () => ({ email: 'pm@example.com' }) }, 'token');
  assert.deepEqual(decoded, { email: 'pm@example.com' });
});

for (const code of ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token', 'auth/argument-error']) {
  test(`maps Firebase Auth error code "${code}" to a 401 AuthenticationError`, async () => {
    const adapters = { verifyIdToken: async () => { throw firebaseAuthError(code, `internal detail for ${code}`); } };
    await assert.rejects(() => verifyBearerToken(adapters, 'token'), AuthenticationError);
    try {
      await verifyBearerToken(adapters, 'token');
      assert.fail('expected verifyBearerToken to reject');
    } catch (error) {
      assert.equal(error.statusCode, 401);
      assert.ok(!error.message.includes(code), 'the 401 message must not leak the Firebase error code');
      assert.ok(!error.message.includes('internal detail'), 'the 401 message must not leak Firebase internal error text');
    }
  });
}

test('rethrows an unrecognized Firebase Admin error unchanged (fails safe as 500, not 401)', async () => {
  const adapters = { verifyIdToken: async () => { throw firebaseAuthError('auth/internal-error', 'boom'); } };
  await assert.rejects(() => verifyBearerToken(adapters, 'token'), error => {
    assert.equal(error instanceof AuthenticationError, false);
    assert.equal(error.statusCode, undefined);
    return true;
  });
});

test('rethrows an error with no recognizable code unchanged (fails safe as 500)', async () => {
  const adapters = { verifyIdToken: async () => { throw new Error('network timeout'); } };
  await assert.rejects(() => verifyBearerToken(adapters, 'token'), error => {
    assert.equal(error instanceof AuthenticationError, false);
    assert.equal(error.statusCode, undefined);
    return true;
  });
});
