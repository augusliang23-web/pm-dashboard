import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { authorizeExecutiveAudienceView } from '../pdf-service/src/report-access.js';

const pages = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const validRoles = [
  ['admin', 'admin', 'leadership'],
  ['vip', 'vip', 'leadership'],
  ['executive', 'vip', 'leadership'],
  ['pm', 'pm', 'pm-engineering'],
  ['engineering', 'engineering', 'pm-engineering'],
  ['business', 'business', 'business-product'],
  ['sales', 'business', 'business-product'],
  ['bd', 'business', 'business-product'],
  ['product', 'product', 'business-product'],
  ['PM', 'pm', 'pm-engineering'],
  [' sales ', 'business', 'business-product'],
  [' Executive ', 'vip', 'leadership'],
];

function functionSource(name) {
  const start = pages.indexOf(`function ${name}(`);
  const end = pages.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, `Pages must define ${name}`);
  return pages.slice(start, end + 2);
}

function roleContext() {
  const context = vm.createContext({ currentRawRole: undefined });
  const rawRoleState = pages.match(/^let currentRawRole = [^\n]+;$/m)?.[0] || '';
  vm.runInContext(`${rawRoleState}\n${functionSource('normalizeRole')}\n${functionSource('getDashboardRole')}
    this.resolveRole = getDashboardRole;
    Object.defineProperty(this, 'rawRole', { get: () => currentRawRole });`, context);
  return context;
}

const userDoc = (role, exists = true) => ({ exists: () => exists, data: () => ({ role }) });

test('Pages raw role starts safely at null', () => {
  assert.equal(roleContext().rawRole, null);
});

test('Pages resolves approved roles while preserving exact raw strings and never promoting non-admins', () => {
  const context = roleContext();
  for (const [raw, expected] of validRoles) {
    const perspective = context.resolveRole(userDoc(raw));
    assert.equal(perspective, expected, `raw ${JSON.stringify(raw)}`);
    assert.equal(context.rawRole, raw, 'the stored string must not be normalized for presenceSessions');
    if (raw.trim().toLowerCase() !== 'admin') assert.notEqual(perspective, 'admin');
  }
});

test('Pages rejects invalid roles and clears any previous raw role', () => {
  const context = roleContext();
  for (const raw of ['', '   ', undefined, null, 'bogus', '__proto__', 'toString', 42]) {
    context.resolveRole(userDoc('admin'));
    assert.throws(() => context.resolveRole(userDoc(raw)), /missing-dashboard-role/, `raw ${JSON.stringify(raw)}`);
    assert.equal(context.rawRole, null);
  }
  context.resolveRole(userDoc('admin'));
  assert.throws(() => context.resolveRole(userDoc(undefined, false)), /missing-dashboard-role/);
  assert.equal(context.rawRole, null);
});

function defaultPdfView(raw) {
  const context = roleContext();
  context.currentRole = context.resolveRole(userDoc(raw));
  const select = { options: [], value: '' };
  Object.assign(context, {
    document: { getElementById: () => select },
    syncExecutiveMilestoneAudienceField: () => {},
  });
  const start = pages.indexOf('const EXECUTIVE_PDF_VIEWS_BY_ROLE = {');
  const end = pages.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start, 'Pages PDF view table must exist');
  vm.runInContext(`${pages.slice(start, end + 3)}\n${functionSource('configureExecutiveMilestoneAudienceView')}
    configureExecutiveMilestoneAudienceView();`, context);
  return select.value;
}

for (const [raw, , expectedView] of validRoles) {
  test(`Pages PDF default for ${JSON.stringify(raw)} is authorized by the real backend`, () => {
    const view = defaultPdfView(raw);
    assert.equal(authorizeExecutiveAudienceView(raw, view), view);
    assert.equal(view, expectedView);
  });
}

function weekQueryFor(raw) {
  const context = roleContext();
  context.currentRole = context.resolveRole(userDoc(raw));
  let selectedQuery;
  Object.assign(context, {
    weeksUnsub: null,
    db: {},
    currentUser: { uid: 'test-uid', email: 'role@example.test' },
    authSessionGeneration: 1,
    collection: (_db, name) => ({ collection: name }),
    query: (source, constraint) => ({ source, constraint }),
    where: (field, operator, value) => ({ type: 'where', field, operator, value }),
    orderBy: field => ({ type: 'orderBy', field }),
    getEmailKey: user => user.email,
    isAuthInitializationCurrent: () => true,
    onSnapshot: value => { selectedQuery = value; return () => {}; },
  });
  vm.runInContext(`${functionSource('initData')}\ninitData(1, currentUser);`, context);
  return selectedQuery;
}

test('Pages runtime query keeps VIP/executive released-only and other approved roles on all weeks', () => {
  for (const raw of ['vip', 'executive', ' Executive ']) {
    assert.deepEqual(weekQueryFor(raw), {
      source: { collection: 'weeks' },
      constraint: { type: 'where', field: 'isReleased', operator: '==', value: true },
    }, `raw ${JSON.stringify(raw)} must not receive draft weeks`);
  }
  for (const raw of ['admin', 'sales', 'bd', 'business', 'pm', 'PM', 'engineering', 'product', ' sales ']) {
    assert.deepEqual(weekQueryFor(raw), {
      source: { collection: 'weeks' },
      constraint: { type: 'orderBy', field: 'weekLabel' },
    }, `raw ${JSON.stringify(raw)} retains the legacy all-weeks subscription`);
  }
});

test('Pages presenceSessions writes the exact raw role rather than its UI perspective', async () => {
  for (const raw of ['sales', 'PM', ' sales ']) {
    const context = roleContext();
    context.currentRole = context.resolveRole(userDoc(raw));
    let written;
    Object.assign(context, {
      currentUser: { uid: 'test-uid', email: 'role@example.test' },
      presenceSessionId: null,
      presenceSessionStartedAt: null,
      presenceSessionLastEventAt: null,
      presenceSessionState: null,
      presenceSessionClosed: false,
      presenceSessionWriteChain: null,
      PRESENCE_SESSION_RETENTION_DAYS: 90,
      PRESENCE_SESSION_COLLECTION: 'presenceSessions',
      db: {},
      makePresenceSessionId: () => 'test-session',
      getEmailKey: () => 'role@example.test',
      getUserDisplayName: () => 'Test User',
      doc: (_db, collection, id) => ({ collection, id }),
      setDoc: (ref, data) => { written = { ref, data }; return Promise.resolve(); },
      serverTimestamp: () => 'timestamp',
      console: { warn: () => assert.fail('Presence write should not fail') },
    });
    vm.runInContext(`${functionSource('startPresenceSession')}\nstartPresenceSession();`, context);
    await context.presenceSessionWriteChain;
    assert.equal(written.ref.collection, 'presenceSessions');
    assert.equal(written.data.role, raw);
    assert.equal(written.data.environment, 'v2.1');
  }
});
