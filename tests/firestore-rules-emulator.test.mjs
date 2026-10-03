import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const projectId = 'demo-pm-dashboard-v22t';
const firestorePort = Number(process.env.FIRESTORE_EMULATOR_PORT || 8081);
const dashboard = await dashboardSourceAsync('production');
let environment;

function rootInitialPresencePayload() {
  const start = dashboard.indexOf('function buildInitialPresencePayload({');
  const end = dashboard.indexOf('\n}\n\nasync function ensurePresenceDocument', start) + 2;
  assert.notEqual(start, -1, 'root dashboard must define the first-write presence payload');
  return new Function(`${dashboard.slice(start, end)}; return buildInitialPresencePayload;`)();
}

function auth(uid, email) {
  return environment.authenticatedContext(uid, { email }).firestore();
}

async function seed() {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users/admin@example.com'), { role: 'admin', displayName: 'Admin' }),
      setDoc(doc(db, 'users/owner@example.com'), { role: 'pm', displayName: 'Owner' }),
      setDoc(doc(db, 'users/other@example.com'), { role: 'pm', displayName: 'Other' }),
      setDoc(doc(db, 'users/vip@example.com'), { role: 'vip', displayName: 'VIP' }),
      setDoc(doc(db, 'users/engineering@example.com'), { role: 'engineering', displayName: 'Engineering' }),
      setDoc(doc(db, 'users/business@example.com'), { role: 'business', displayName: 'Business' }),
      setDoc(doc(db, 'users/product@example.com'), { role: 'product', displayName: 'Product' }),
      setDoc(doc(db, 'users/sales@example.com'), { role: 'sales', displayName: 'Sales' }),
      setDoc(doc(db, 'users/format-pm@example.com'), { role: 'PM', displayName: 'Format PM' }),
      setDoc(doc(db, 'weeks/draft-week'), {
        weekLabel: 'W33 2026', isReleased: false,
        projects: [{ code: 'ALPHA', owner: 'Owner' }],
      }),
      setDoc(doc(db, 'weeks/released-week'), {
        weekLabel: 'W32 2026', isReleased: true,
        projects: [{ code: 'ALPHA', owner: 'Owner' }],
      }),
      setDoc(doc(db, 'dashboardSettings/team-2-portfolio'), {
        ganttTemplates: { system: ['Plan'], 'hardware-module': ['EVT'] }, revision: 'seed-revision',
      }),
    ]);
  });
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: firestorePort,
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await seed();
});

after(async () => {
  await environment?.cleanup();
});

test('all existing signed-in roles retain week reads while anonymous access stays denied', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const admin = auth('admin-uid', 'admin@example.com');
  const owner = auth('owner-uid', 'owner@example.com');
  const vip = auth('vip-uid', 'vip@example.com');

  await assertFails(getDoc(doc(anonymous, 'weeks/draft-week')));
  await assertSucceeds(getDoc(doc(admin, 'weeks/draft-week')));
  await assertSucceeds(getDoc(doc(owner, 'weeks/draft-week')));
  await assertSucceeds(getDoc(doc(vip, 'weeks/draft-week')));
  await assertSucceeds(getDoc(doc(vip, 'weeks/released-week')));
  for (const [uid, email] of [
    ['engineering-uid', 'engineering@example.com'],
    ['business-uid', 'business@example.com'],
    ['product-uid', 'product@example.com'],
  ]) {
    await assertSucceeds(getDoc(doc(auth(uid, email), 'weeks/draft-week')));
  }
});

test('dashboard collection queries require membership in the internal user directory', async () => {
  const admin = auth('admin-uid', 'admin@example.com');
  const outsider = auth('outsider-uid', 'outsider@example.com');

  for (const collectionName of ['users', 'weeks', 'presence']) {
    await assertSucceeds(getDocs(collection(admin, collectionName)));
    await assertFails(getDocs(collection(outsider, collectionName)));
  }
});

test('an authenticated account outside the dashboard user directory has no data access', async () => {
  const outsider = auth('outsider-uid', 'outsider@example.com');

  await assertFails(getDoc(doc(outsider, 'users/admin@example.com')));
  await assertFails(getDoc(doc(outsider, 'weeks/released-week')));
  await assertFails(getDoc(doc(outsider, 'dashboardSettings/team-2-portfolio')));
  await assertFails(setDoc(doc(outsider, 'logs/outsider-attempt'), {
    eventType: 'project-save',
    actorUid: 'outsider-uid',
    actorEmail: 'outsider@example.com',
    createdAt: serverTimestamp(),
    weekId: 'released-week',
    projectCode: 'ALPHA',
    message: 'Unauthorized dashboard access attempt',
    context: { source: 'ui' },
  }));
  await assertFails(setDoc(doc(outsider, 'presence/outsider@example.com'), {
    name: 'Outsider', role: 'pm', status: 'active',
    lastActive: 1776556800000, lastSeenAt: 1776556800000,
    usageBuckets: {}, ownerUid: 'outsider-uid', userKey: 'outsider@example.com',
  }));
});

test('every browser role is denied direct week create, update, and delete', async () => {
  for (const [uid, email] of [
    ['admin-uid', 'admin@example.com'],
    ['owner-uid', 'owner@example.com'],
    ['vip-uid', 'vip@example.com'],
  ]) {
    const db = auth(uid, email);
    await assertFails(setDoc(doc(db, `weeks/new-${uid}`), { weekLabel: 'Injected', isReleased: false }));
    await assertFails(updateDoc(doc(db, 'weeks/draft-week'), { weekLabel: 'Changed' }));
    await assertFails(deleteDoc(doc(db, 'weeks/draft-week')));
  }
});

test('Gantt compatibility settings are readable but never directly writable by the browser', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const admin = auth('admin-uid', 'admin@example.com');
  const owner = auth('owner-uid', 'owner@example.com');

  await assertFails(getDoc(doc(anonymous, 'dashboardSettings/team-2-portfolio')));
  await assertSucceeds(getDoc(doc(admin, 'dashboardSettings/team-2-portfolio')));
  await assertSucceeds(getDoc(doc(owner, 'dashboardSettings/team-2-portfolio')));
  await assertFails(updateDoc(doc(admin, 'dashboardSettings/team-2-portfolio'), { revision: 'forged' }));
  await assertFails(updateDoc(doc(owner, 'dashboardSettings/team-2-portfolio'), { revision: 'forged' }));
});

test('audit logs accept only a bounded, self-attributed append-only envelope', async () => {
  const owner = auth('owner-uid', 'owner@example.com');
  const valid = {
    eventType: 'project-save', actorUid: 'owner-uid', actorEmail: 'owner@example.com',
    createdAt: serverTimestamp(), weekId: 'draft-week', projectCode: 'ALPHA',
    message: 'Saved from the dashboard', context: { source: 'ui' },
  };
  await assertSucceeds(setDoc(doc(owner, 'logs/valid'), valid));
  await assertFails(setDoc(doc(owner, 'logs/forged'), { ...valid, actorUid: 'other-uid' }));
  await assertFails(updateDoc(doc(owner, 'logs/valid'), { message: 'rewritten' }));
  await assertFails(deleteDoc(doc(owner, 'logs/valid')));
});

test('presence creation and updates stay bound to the authenticated identity', async () => {
  const owner = auth('owner-uid', 'owner@example.com');
  const other = auth('other-uid', 'other@example.com');
  const initialPayload = rootInitialPresencePayload()({
    uid: 'owner-uid', name: 'Owner', role: 'pm', userKey: 'owner@example.com', now: 1776556800000,
  });

  await assertSucceeds(setDoc(doc(owner, 'presence/owner@example.com'), initialPayload));
  await assertSucceeds(updateDoc(doc(owner, 'presence/owner@example.com'), {
    status: 'idle', lastSeenAt: 1776556801000,
  }));
  await assertFails(setDoc(doc(other, 'presence/owner@example.com'), initialPayload));
  await assertFails(updateDoc(doc(owner, 'presence/owner@example.com'), { ownerUid: 'other-uid' }));
  await assertFails(updateDoc(doc(other, 'presence/owner@example.com'), { status: 'idle' }));
  await assertFails(deleteDoc(doc(owner, 'presence/owner@example.com')));
});

test('presence sessions accept only the dashboard session envelope and bounded updates', async () => {
  const owner = auth('owner-uid', 'owner@example.com');
  const sessionStartedAt = Date.now();
  const session = {
    sessionId: 'owner-session-valid',
    ownerUid: 'owner-uid',
    userKey: 'owner@example.com',
    displayName: 'Owner',
    role: 'pm',
    environment: 'v2.1',
    startedAt: sessionStartedAt,
    lastSeenAt: sessionStartedAt,
    endedAt: null,
    activeMs: 0,
    idleMs: 0,
    state: 'active',
    endReason: null,
    aggregatedAt: null,
    expiresAt: new Date(sessionStartedAt + 90 * 24 * 60 * 60 * 1000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await assertSucceeds(setDoc(doc(owner, 'presenceSessions/owner-session-valid'), session));
  await assertFails(setDoc(doc(owner, 'presenceSessions/owner-session-extra'), {
    ...session, sessionId: 'owner-session-extra', extra: 'forged',
  }));
  await assertFails(setDoc(doc(owner, 'presenceSessions/owner-session-type'), {
    ...session, sessionId: 'owner-session-type', activeMs: '0',
  }));
  await assertFails(setDoc(doc(owner, 'presenceSessions/owner-session-large'), {
    ...session, sessionId: 'owner-session-large', displayName: 'x'.repeat(129),
  }));
  const futureStartedAt = sessionStartedAt + 365 * 24 * 60 * 60 * 1000;
  await assertFails(setDoc(doc(owner, 'presenceSessions/owner-session-future'), {
    ...session,
    sessionId: 'owner-session-future',
    startedAt: futureStartedAt,
    lastSeenAt: futureStartedAt,
    expiresAt: new Date(futureStartedAt + 90 * 24 * 60 * 60 * 1000),
  }));
  await assertFails(setDoc(doc(owner, 'presenceSessions/owner-session-expiry'), {
    ...session,
    sessionId: 'owner-session-expiry',
    expiresAt: new Date(sessionStartedAt + 365 * 24 * 60 * 60 * 1000),
  }));
  await assertFails(updateDoc(doc(owner, 'presenceSessions/owner-session-valid'), { activeMs: 'forged' }));
  await assertFails(updateDoc(doc(owner, 'presenceSessions/owner-session-valid'), { state: 'forged' }));
  const closedAt = Date.now();
  await assertSucceeds(updateDoc(doc(owner, 'presenceSessions/owner-session-valid'), {
    lastSeenAt: closedAt,
    endedAt: closedAt,
    state: 'closed',
    endReason: 'logout',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(owner, 'presenceSessions/owner-session-valid'), {
    lastSeenAt: closedAt + 1,
    endedAt: null,
    state: 'active',
    endReason: null,
    updatedAt: serverTimestamp(),
  }));
});

test('presenceSessions requires the exact stored sales role', async () => {
  const sales = auth('sales-uid', 'sales@example.com');
  const makeSession = (sessionId, role) => {
    const startedAt = Date.now();
    return {
      sessionId,
      ownerUid: 'sales-uid',
      userKey: 'sales@example.com',
      displayName: 'Sales',
      role,
      environment: 'v2.1',
      startedAt,
      lastSeenAt: startedAt,
      endedAt: null,
      activeMs: 0,
      idleMs: 0,
      state: 'active',
      endReason: null,
      aggregatedAt: null,
      expiresAt: new Date(startedAt + 90 * 24 * 60 * 60 * 1000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  };

  await assertSucceeds(setDoc(doc(sales, 'presenceSessions/sales-role-raw'), makeSession('sales-role-raw', 'sales')));
  await assertFails(setDoc(doc(sales, 'presenceSessions/sales-role-business'), makeSession('sales-role-business', 'business')));
  await assertFails(setDoc(doc(sales, 'presenceSessions/sales-role-pm'), makeSession('sales-role-pm', 'pm')));
});

test('presenceSessions requires the exact stored PM casing', async () => {
  const pm = auth('format-pm-uid', 'format-pm@example.com');
  const makeSession = (sessionId, role) => {
    const startedAt = Date.now();
    return {
      sessionId,
      ownerUid: 'format-pm-uid',
      userKey: 'format-pm@example.com',
      displayName: 'Format PM',
      role,
      environment: 'v2.1',
      startedAt,
      lastSeenAt: startedAt,
      endedAt: null,
      activeMs: 0,
      idleMs: 0,
      state: 'active',
      endReason: null,
      aggregatedAt: null,
      expiresAt: new Date(startedAt + 90 * 24 * 60 * 60 * 1000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  };

  await assertSucceeds(setDoc(doc(pm, 'presenceSessions/pm-role-raw'), makeSession('pm-role-raw', 'PM')));
  await assertFails(setDoc(doc(pm, 'presenceSessions/pm-role-normalized'), makeSession('pm-role-normalized', 'pm')));
});

test('userPermissions overrides are readable only by the account itself and Admin and never client-writable', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'userPermissions/owner@example.com'), {
      schemaVersion: 1, overrides: { 'week.manage': true }, revision: 1,
    });
  });
  const admin = auth('admin-uid', 'admin@example.com');
  const owner = auth('owner-uid', 'owner@example.com');
  const other = auth('other-uid', 'other@example.com');
  const outsider = auth('outsider-uid', 'outsider@example.com');

  await assertSucceeds(getDoc(doc(owner, 'userPermissions/owner@example.com')));
  await assertSucceeds(getDoc(doc(admin, 'userPermissions/owner@example.com')));
  await assertSucceeds(getDoc(doc(other, 'userPermissions/other@example.com')));
  await assertFails(getDoc(doc(other, 'userPermissions/owner@example.com')));
  await assertFails(getDoc(doc(outsider, 'userPermissions/outsider@example.com')));
  await assertFails(getDocs(collection(other, 'userPermissions')));
  for (const client of [admin, owner, other, outsider]) {
    await assertFails(setDoc(doc(client, 'userPermissions/owner@example.com'), { overrides: { 'week.manage': false } }));
    await assertFails(setDoc(doc(client, 'userPermissions/other@example.com'), { overrides: { 'week.manage': true } }));
    await assertFails(updateDoc(doc(client, 'userPermissions/owner@example.com'), { 'overrides.week.manage': false }));
    await assertFails(deleteDoc(doc(client, 'userPermissions/owner@example.com')));
  }
});

test('userPermissionAudit is readable only by Admin and never client-writable', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'userPermissionAudit/seed-audit'), {
      targetEmail: 'owner@example.com', actorEmail: 'admin@example.com', actorUid: 'admin-uid',
      revisionBefore: 0, revisionAfter: 1, roleAtChange: 'pm',
      changes: [{ capability: 'week.manage', before: null, after: true }],
    });
  });
  const admin = auth('admin-uid', 'admin@example.com');
  const owner = auth('owner-uid', 'owner@example.com');
  const other = auth('other-uid', 'other@example.com');
  const vip = auth('vip-uid', 'vip@example.com');
  const outsider = auth('outsider-uid', 'outsider@example.com');

  await assertSucceeds(getDoc(doc(admin, 'userPermissionAudit/seed-audit')));
  await assertSucceeds(getDocs(query(collection(admin, 'userPermissionAudit'), where('targetEmail', '==', 'owner@example.com'))));
  for (const client of [owner, other, vip, outsider]) {
    await assertFails(getDoc(doc(client, 'userPermissionAudit/seed-audit')));
    await assertFails(getDocs(query(collection(client, 'userPermissionAudit'), where('targetEmail', '==', 'owner@example.com'))));
  }
  for (const client of [admin, owner, other, vip, outsider]) {
    await assertFails(setDoc(doc(client, 'userPermissionAudit/forged'), {
      targetEmail: 'owner@example.com', actorEmail: 'admin@example.com', changes: [],
    }));
    await assertFails(updateDoc(doc(client, 'userPermissionAudit/seed-audit'), { roleAtChange: 'admin' }));
    await assertFails(deleteDoc(doc(client, 'userPermissionAudit/seed-audit')));
  }
});

test('Production permission rules normalize the stored role exactly like the browser, Functions and UAT', async () => {
  // [account, stored role, normalized Admin?]
  const cases = [
    ['role-admin', 'admin', true],
    ['role-admin-upper', 'ADMIN', true],
    ['role-admin-padded', ' Admin ', true],
    ['role-admin-title', 'Admin', true],
    ['role-pm-upper', 'PM', false],
    ['role-vip-upper', 'VIP', false],
    ['role-business-upper', 'BUSINESS', false],
    ['role-executive-upper', 'EXECUTIVE', false],
    ['role-unknown', 'contractor', false],
    ['role-number', 7, false],
    ['role-array', ['admin'], false],
    ['role-map', { admin: true }, false],
  ];
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      ...cases.map(([account, role]) => setDoc(doc(db, `users/${account}@example.com`), { role, displayName: account })),
      ...cases.map(([account]) => setDoc(doc(db, `userPermissions/${account}@example.com`), { overrides: {}, revision: 0 })),
      setDoc(doc(db, 'users/role-missing@example.com'), { displayName: 'No role' }),
      setDoc(doc(db, 'userPermissions/owner@example.com'), { schemaVersion: 1, overrides: { 'week.manage': true }, revision: 1 }),
      setDoc(doc(db, 'userPermissionAudit/matrix-audit'), {
        targetEmail: 'owner@example.com', actorEmail: 'admin@example.com', actorUid: 'admin-uid',
        revisionBefore: 0, revisionAfter: 1, roleAtChange: 'pm',
        changes: [{ capability: 'week.manage', before: null, after: true }],
      }),
      setDoc(doc(db, 'presenceDailyRollups/2026-10-03'), { date: '2026-10-03' }),
    ]);
  });

  for (const [account, role, admin] of [...cases, ['role-missing', undefined, false]]) {
    const client = auth(`${account}-uid`, `${account}@example.com`);
    const label = `${account} (${JSON.stringify(role)})`;
    const expect = admin ? assertSucceeds : assertFails;
    await expect(getDoc(doc(client, 'userPermissions/owner@example.com')), `${label}: other user's permissions`);
    await expect(getDocs(collection(client, 'userPermissions')), `${label}: list permissions`);
    await expect(getDoc(doc(client, 'userPermissionAudit/matrix-audit')), `${label}: audit`);
    await expect(getDocs(query(collection(client, 'userPermissionAudit'), where('targetEmail', '==', 'owner@example.com'))), `${label}: audit query`);
    await expect(getDoc(doc(client, 'presenceDailyRollups/2026-10-03')), `${label}: Admin presence rollups follow isAdmin()`);
    // Ordinary dashboard users always read their own permission document.
    await assertSucceeds(getDoc(doc(client, `userPermissions/${account}@example.com`)), `${label}: own permissions`);
    for (const write of [
      setDoc(doc(client, 'userPermissions/owner@example.com'), { overrides: { 'week.manage': false } }),
      setDoc(doc(client, `userPermissions/${account}@example.com`), { overrides: { 'week.manage': true } }),
      deleteDoc(doc(client, 'userPermissions/owner@example.com')),
      setDoc(doc(client, 'userPermissionAudit/forged-matrix'), { targetEmail: 'owner@example.com', changes: [] }),
      deleteDoc(doc(client, 'userPermissionAudit/matrix-audit')),
    ]) {
      await assertFails(write, `${label}: client write`);
    }
  }
});

test('Production presenceSessions still bind the exact stored role, not the normalized one', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users/upper-admin@example.com'), { role: 'ADMIN', displayName: 'Upper Admin' });
  });
  const client = auth('upper-admin-uid', 'upper-admin@example.com');
  const now = Date.now();
  const session = (sessionId, role) => ({
    sessionId, ownerUid: 'upper-admin-uid', userKey: 'upper-admin@example.com', displayName: 'Upper Admin', role,
    environment: 'v2.1', startedAt: now, lastSeenAt: now, endedAt: null, activeMs: 0, idleMs: 0, state: 'active',
    endReason: null, aggregatedAt: null, expiresAt: new Date(now + 90 * 24 * 60 * 60 * 1000),
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await assertSucceeds(setDoc(doc(client, 'presenceSessions/upper-admin-raw'), session('upper-admin-raw', 'ADMIN')));
  await assertFails(setDoc(doc(client, 'presenceSessions/upper-admin-normalized'), session('upper-admin-normalized', 'admin')));
});
