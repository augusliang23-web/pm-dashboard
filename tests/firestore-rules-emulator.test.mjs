import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const projectId = 'demo-pm-dashboard-v22t';
const firestorePort = Number(process.env.FIRESTORE_EMULATOR_PORT || 8081);
const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');
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
