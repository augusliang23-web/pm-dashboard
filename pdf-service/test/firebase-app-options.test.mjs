import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirebaseAppOptions } from '../src/firebase-app-options.js';

test('uses the local Firebase project ID without application credentials for emulator requests', () => {
  let applicationDefaultCalled = false;
  const options = createFirebaseAppOptions({
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9109',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180'
  }, {
    applicationDefault: () => {
      applicationDefaultCalled = true;
      return { shouldNotBeUsed: true };
    }
  });

  assert.deepEqual(options, { projectId: 'project-manager-dashboar-a067f' });
  assert.equal(applicationDefaultCalled, false);
});

test('keeps application credentials for the deployed PDF service', () => {
  const credential = { production: true };
  assert.deepEqual(
    createFirebaseAppOptions({}, { applicationDefault: () => credential }),
    { credential }
  );
});
