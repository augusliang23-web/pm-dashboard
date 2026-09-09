import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocalEmulatorConfig } from '../js/local-emulator-config.mjs';

test('uses isolated emulator ports only for an explicit local emulator preview', () => {
  assert.deepEqual(
    getLocalEmulatorConfig({
      hostname: '127.0.0.1',
      search: '?emulator=1&firestorePort=8180&authPort=9109&functionsPort=5101'
    }),
    { firestorePort: 8180, authPort: 9109, functionsPort: 5101 }
  );
});

test('keeps the established local ports when no isolated port is supplied', () => {
  assert.deepEqual(
    getLocalEmulatorConfig({ hostname: 'localhost', search: '?emulator=1' }),
    { firestorePort: 8080, authPort: 9099, functionsPort: 5001 }
  );
});

test('does not enable an emulator from a non-local page or invalid port value', () => {
  assert.equal(
    getLocalEmulatorConfig({ hostname: 'augusliang23-web.github.io', search: '?emulator=1&firestorePort=8180' }),
    null
  );
  assert.deepEqual(
    getLocalEmulatorConfig({ hostname: '127.0.0.1', search: '?emulator=1&firestorePort=nope&authPort=99999' }),
    { firestorePort: 8080, authPort: 9099, functionsPort: 5001 }
  );
});
