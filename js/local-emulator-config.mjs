const DEFAULT_FIRESTORE_PORT = 8080;
const DEFAULT_AUTH_PORT = 9099;
const DEFAULT_FUNCTIONS_PORT = 5001;

function readPort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

export function getLocalEmulatorConfig(locationLike = {}) {
  const hostname = String(locationLike.hostname || '').toLowerCase();
  const params = new URLSearchParams(String(locationLike.search || ''));
  if (!['localhost', '127.0.0.1'].includes(hostname) || params.get('emulator') !== '1') return null;
  return {
    firestorePort: readPort(params.get('firestorePort'), DEFAULT_FIRESTORE_PORT),
    authPort: readPort(params.get('authPort'), DEFAULT_AUTH_PORT),
    functionsPort: readPort(params.get('functionsPort'), DEFAULT_FUNCTIONS_PORT)
  };
}
