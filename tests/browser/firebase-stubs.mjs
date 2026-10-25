// Browser-test support: replaces the three Firebase CDN modules the dashboard imports with in-page stubs backed by
// window.__FAKE (documents, collections, signed-in user). This lets the REAL index.html and the REAL dashboard code
// run in a REAL browser without credentials, a network backend or Production data.
//
// IMPORTANT: this is a browser test with MOCKED Firebase dependencies. It is NOT an authenticated end-to-end test.

export const FIREBASE_MODULE_PATTERN = /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-app|firebase-firestore|firebase-auth|firebase-functions)\.js$/;

const appModule = `export const initializeApp = config => ({ config });`;

const firestoreModule = `
const fake = () => window.__FAKE;
const key = ref => ref.path;
export const getFirestore = () => ({ __db: true });
export const connectFirestoreEmulator = () => {};
export const collection = (db, ...segments) => ({ type: 'collection', path: segments.join('/') });
export const doc = (base, ...segments) => (base && base.type === 'collection'
  ? { type: 'doc', path: [base.path, ...segments].join('/'), id: segments.at(-1) }
  : { type: 'doc', path: segments.join('/'), id: segments.at(-1) });
export const query = (ref, ...constraints) => ({ type: 'query', ref, constraints });
export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = field => ({ kind: 'orderBy', field });
export const limit = count => ({ kind: 'limit', count });
export const increment = n => ({ __increment: n });
export const serverTimestamp = () => ({ __serverTimestamp: true });
const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const docSnap = (path, data) => ({ id: path.split('/').at(-1), ref: { path }, exists: () => data !== undefined, data: () => clone(data),metadata:{fromCache:false,hasPendingWrites:false} });
const collectionDocs = (path, constraints = []) => {
  const all = fake().collections[path] || {};
  let entries = Object.entries(all).map(([id, data]) => ({ id, data }));
  for (const c of constraints) if (c.kind === 'where' && c.op === '==') entries = entries.filter(e => e.data[c.field] === c.value);
  const order = constraints.find(c => c.kind === 'orderBy');
  if (order) entries.sort((a, b) => String(a.data[order.field] ?? '').localeCompare(String(b.data[order.field] ?? '')));
  return entries.map(e => ({ id: e.id, ref: { path: path + '/' + e.id }, data: () => clone(e.data), exists: () => true }));
};
const snapshotOf = target => {
  if (target.type === 'doc') return docSnap(target.path, fake().documents[target.path]);
  const ref = target.type === 'query' ? target.ref : target;
  const docs = collectionDocs(ref.path, target.constraints);
  return { docs, size: docs.length, empty: docs.length === 0, forEach: fn => docs.forEach(fn), docChanges: () => [], metadata: { fromCache: fake().fromCache === true, hasPendingWrites: false } };
};
export const getDoc = async ref => { fake().reads.push(ref.path); return snapshotOf(ref); };
export const getDocFromServer = getDoc;
export const getDocs = async target => { fake().reads.push((target.ref || target).path); return snapshotOf(target); };
export const onSnapshot = (target, ...rest) => {
  // onSnapshot(target, [options], next, [error]) -- the dashboard asks for metadata changes on the weeks query.
  if (rest[0] && typeof rest[0] === 'object') rest.shift();
  const [next, error] = rest;
  fake().listeners.push((target.ref || target).path);
  setTimeout(() => { try { next(snapshotOf(target)); } catch (e) { if (error) error(e); else console.error('stub onSnapshot', e); } }, 0);
  return () => {};
};
const record = (kind, ref) => { fake().writes.push({ kind, path: ref && ref.path }); };
export const setDoc = async (ref) => { record('setDoc', ref); };
export const updateDoc = async (ref) => { record('updateDoc', ref); };
export const runTransaction = async (db, fn) => fn({ get: async ref => snapshotOf(ref), set: (ref) => record('tx.set', ref), update: (ref) => record('tx.update', ref) });
`;

const authModule = `
const fake = () => window.__FAKE;
const listeners = [];
const decorate=user=>{if(user&&!user.getIdTokenResult)user.getIdTokenResult=async()=>({claims:{email:user.email,firebase:{sign_in_provider:'password'}}});return user;};
const auth = { get currentUser() { return fake().user; } };
export const getAuth = () => auth;
export const beforeAuthStateChanged = () => () => {};
export const onIdTokenChanged = (a,cb) => {setTimeout(()=>cb(decorate(fake().user)),0);return()=>{};};
export class GoogleAuthProvider {setCustomParameters() {}}
export const signInWithPopup = async()=>{throw Error('OAuth is not implemented by presentation stubs; use the Auth emulator suite.');};
export const linkWithPopup = signInWithPopup;
export const unlink = async()=>{};
export const connectAuthEmulator = () => {};
export const onAuthStateChanged = (a, cb) => { listeners.push(cb); setTimeout(() => cb(decorate(fake().user)), 0); return () => {}; };
window.__fakeAuthChange = user => { fake().user = decorate(user); listeners.forEach(cb => cb(fake().user)); };
export const signOut = async () => { window.__fakeAuthChange(null); };
export const signInWithEmailAndPassword = async () => ({ user: fake().user });
export const sendPasswordResetEmail = async () => {};
export const updatePassword = async () => {};
export const reauthenticateWithCredential = async () => {};
export const EmailAuthProvider = { credential: () => ({}) };
`;

const functionsModule = `
export const getFunctions = () => ({});
export const connectFunctionsEmulator = () => {};
export const httpsCallable = (functions, name) => async data => {
  window.__FAKE.callables.push(name);
  const handler = window.__FAKE.callableResults[name];
  return { data: typeof handler === 'function' ? handler(data) : (handler ?? {}) };
};
`;

const MODULES = { 'firebase-app': appModule, 'firebase-firestore': firestoreModule, 'firebase-auth': authModule, 'firebase-functions': functionsModule };

export function stubModuleFor(url) {
  const match = FIREBASE_MODULE_PATTERN.exec(url);
  return match ? MODULES[match[1]] : null;
}

// Builds the window.__FAKE state injected before the page loads. Documents are SYNTHETIC.
export function buildFake({ email = 'qa-user@example.test', role = 'admin', weeks = [], extraDocuments = {}, extraCollections = {} } = {}) {
  const weekDocs = Object.fromEntries(weeks.map(week => [week.__id, (({ __id, ...rest }) => rest)(week)]));
  return {
    user: { uid: 'synthetic-uid', email, displayName: 'QA User' },
    documents: { [`users/${email}`]: { authUid:'synthetic-uid',role, displayName: 'QA User', email }, ...extraDocuments },
    collections: { weeks: weekDocs, users: { [email]: { role, displayName: 'QA User' } }, ...extraCollections },
    callables: [], callableResults: {}, writes: [], reads: [], listeners: []
  };
}
