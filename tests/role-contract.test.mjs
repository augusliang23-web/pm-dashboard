import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

import { canReadDraftWeeks } from '../js/dashboard-access.mjs';
import { authorizeExecutiveAudienceView } from '../pdf-service/src/report-access.js';
import { dashboardSource } from './helpers/dashboard-source.mjs';

const production = dashboardSource('production');
const uat = dashboardSource('uat');
const originalUatHash = '12ce8cd958e8660d5f65db9c88b63af5031261379420d598d4f638f8802d7a21';

const validRoles = new Map([
  ['admin', 'admin'],
  ['vip', 'vip'],
  ['executive', 'vip'],
  ['pm', 'pm'],
  ['engineering', 'engineering'],
  ['business', 'business'],
  ['sales', 'business'],
  ['bd', 'business'],
  ['product', 'product'],
  ['PM', 'pm'],
  [' sales ', 'business'],
]);

function functionSource(name) {
  const start = production.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Production must define ${name}`);
  const end = production.indexOf('\n}\n', start);
  assert.ok(end > start, `Production must close ${name}`);
  return production.slice(start, end + 2);
}

function roleContext() {
  const context = vm.createContext({
    currentRawRole: undefined,
    normalizeRole: role => {
      const normalized = String(role || 'pm').trim().toLowerCase();
      return ['admin', 'pm', 'vip', 'engineering', 'business', 'product'].includes(normalized) ? normalized : 'pm';
    },
  });
  vm.runInContext(`${functionSource('getDashboardRole')}; this.resolveRole = getDashboardRole;`, context);
  return context;
}

function userDoc(role, exists = true) {
  return { exists: () => exists, data: () => ({ role }) };
}

function defaultPdfView(perspective) {
  const start = production.indexOf('const EXECUTIVE_PDF_VIEWS_BY_ROLE = {');
  const end = production.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start, 'Production PDF view table must exist');
  const context = vm.createContext({
    currentRole: perspective,
    normalizeRole: role => role,
    syncExecutiveMilestoneAudienceField: () => {},
    document: {
      getElementById: () => ({ options: [], value: '' }),
    },
  });
  vm.runInContext(`${production.slice(start, end + 3)}\n${functionSource('configureExecutiveMilestoneAudienceView')}\nthis.configure = configureExecutiveMilestoneAudienceView;`, context);
  const select = { options: [], value: '' };
  context.document.getElementById = () => select;
  context.configure();
  return select.value;
}

test('Production maps every approved raw role to the v2.1 perspective without promoting non-admin users', () => {
  const context = roleContext();
  for (const [raw, expected] of validRoles) {
    assert.equal(context.resolveRole(userDoc(raw)), expected, `role ${JSON.stringify(raw)}`);
    assert.equal(context.currentRawRole, raw, `raw role ${JSON.stringify(raw)} must be preserved exactly`);
    if (raw !== 'admin') assert.notEqual(expected, 'admin');
  }
});

test('Production rejects empty, missing, and unknown roles through the existing login failure path', () => {
  const context = roleContext();
  context.resolveRole(userDoc('admin'));
  for (const raw of ['', '   ', undefined, null, 'bogus', '__proto__', 'toString']) {
    assert.throws(() => context.resolveRole(userDoc(raw)), /missing-dashboard-role/, `role ${JSON.stringify(raw)}`);
    assert.equal(context.currentRawRole, null, 'a rejected login must not retain the prior raw role');
  }
  assert.throws(() => context.resolveRole(userDoc(undefined, false)), /missing-dashboard-role/);
  assert.equal(context.currentRawRole, null);
});

test('Production PDF default view for every valid raw role is accepted by real backend authorization', () => {
  const context = roleContext();
  for (const [raw, expected] of validRoles) {
    const perspective = context.resolveRole(userDoc(raw));
    assert.equal(perspective, expected);
    const view = defaultPdfView(perspective);
    assert.ok(view, `role ${JSON.stringify(raw)} must get a PDF default view`);
    assert.equal(authorizeExecutiveAudienceView(raw, view), view, `backend must authorize ${raw} → ${view}`);
  }
});

test('Production visibility keeps executive released-only and maps sales and bd to Business', () => {
  const context = roleContext();
  const executive = context.resolveRole(userDoc('executive'));
  assert.equal(executive, 'vip');
  assert.equal(canReadDraftWeeks(executive), false);
  for (const raw of ['sales', 'bd']) {
    const perspective = context.resolveRole(userDoc(raw));
    assert.equal(perspective, 'business');
    assert.equal(canReadDraftWeeks(perspective), false);
  }
  assert.equal(canReadDraftWeeks(context.resolveRole(userDoc('pm'))), true);
});

test('Production presenceSessions writes the exact raw role for compatibility', async () => {
  for (const raw of ['sales', 'PM']) {
    let written;
    const context = roleContext();
    context.currentRole = context.resolveRole(userDoc(raw));
    Object.assign(context, {
      currentUser: { uid: 'test-uid', email: 'role@example.test' },
      presenceSessionId: null,
      presenceSessionStartedAt: null,
      presenceSessionLastEventAt: null,
      presenceSessionState: null,
      presenceSessionClosed: false,
      presenceSessionWriteChain: null,
      PRESENCE_SESSION_RETENTION_DAYS: 1,
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
    vm.runInContext(`${functionSource('startPresenceSession')}; this.startSession = startPresenceSession;`, context);
    context.startSession();
    await context.presenceSessionWriteChain;
    assert.equal(written.ref.collection, 'presenceSessions');
    assert.equal(written.data.role, raw, `raw ${JSON.stringify(raw)} must remain unchanged`);
    assert.equal(written.data.environment, 'v2.1');
  }
});

test('UAT rendered profile remains byte-identical to the frozen main baseline', () => {
  assert.equal(createHash('sha256').update(uat).digest('hex'), originalUatHash);
});
