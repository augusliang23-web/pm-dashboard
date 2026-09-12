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

const rulesFile = process.env.FIRESTORE_RULES_FILE;
if (!process.env.FIRESTORE_EMULATOR_PORT || !rulesFile) {
  test('Rules tests require an explicitly managed checkout emulator', { skip: 'run npm run test:rules' }, () => {});
} else {
const projectId = 'demo-pm-dashboard-v22t';
const firestorePort = Number(process.env.FIRESTORE_EMULATOR_PORT);
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
      setDoc(doc(db, 'weeks/draft-week'), {
        weekLabel: 'W33 2026', isReleased: false,
        projects: [{ code: 'ALPHA', owner: 'Owner' }],
      }),
      setDoc(doc(db, 'weeks/released-week'), {
        weekLabel: 'W32 2026', isReleased: true,
        projects: [{ code: 'ALPHA', owner: 'Owner' }],
      }),
    ]);
  });
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile(new URL(`../${rulesFile}`, import.meta.url), 'utf8'),
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

test('week reads expose drafts only to Admin and PM and released weeks to signed-in roles', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const admin = auth('admin-uid', 'admin@example.com');
  const owner = auth('owner-uid', 'owner@example.com');
  const vip = auth('vip-uid', 'vip@example.com');

  await assertFails(getDoc(doc(anonymous, 'weeks/draft-week')));
  await assertSucceeds(getDoc(doc(admin, 'weeks/draft-week')));
  await assertSucceeds(getDoc(doc(owner, 'weeks/draft-week')));
  await assertFails(getDoc(doc(vip, 'weeks/draft-week')));
  await assertSucceeds(getDoc(doc(vip, 'weeks/released-week')));
});

test('every client role is denied direct week create, update, and delete', async () => {
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

test('logs accept only a bounded self-attributed append-only envelope', async () => {
  const owner = auth('owner-uid', 'owner@example.com');
  const valid = {
    eventType: 'project-save',
    actorUid: 'owner-uid',
    actorEmail: 'owner@example.com',
    createdAt: serverTimestamp(),
    weekId: 'draft-week',
    projectCode: 'ALPHA',
    message: 'Saved from the dashboard',
    context: { source: 'ui' },
  };
  await assertSucceeds(setDoc(doc(owner, 'logs/valid'), valid));
  await assertSucceeds(getDoc(doc(owner, 'logs/valid')));
  await assertFails(setDoc(doc(owner, 'logs/forged-uid'), { ...valid, actorUid: 'other-uid' }));
  await assertFails(setDoc(doc(owner, 'logs/forged-email'), { ...valid, actorEmail: 'other@example.com' }));
  await assertFails(setDoc(doc(owner, 'logs/client-time'), { ...valid, createdAt: new Date('2026-08-18T00:00:00.000Z') }));
  await assertFails(setDoc(doc(owner, 'logs/missing'), {
    actorUid: 'owner-uid', actorEmail: 'owner@example.com', createdAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(owner, 'logs/extra'), { ...valid, role: 'admin' }));
  await assertFails(setDoc(doc(owner, 'logs/long-event'), { ...valid, eventType: 'x'.repeat(65) }));
  await assertFails(setDoc(doc(owner, 'logs/long-message'), { ...valid, message: 'x'.repeat(2001) }));
  await assertFails(setDoc(doc(owner, 'logs/bad-context'), { ...valid, context: 'not-a-map' }));
  await assertFails(setDoc(doc(owner, 'logs/nested-context'), {
    ...valid, context: { source: { nested: 'payload' } },
  }));
  await assertFails(setDoc(doc(owner, 'logs/oversized-context'), {
    ...valid,
    context: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`key${index}`, 'value'])),
  }));
  await assertFails(updateDoc(doc(owner, 'logs/valid'), { message: 'rewritten' }));
  await assertFails(deleteDoc(doc(owner, 'logs/valid')));
});

test('presence writes are restricted to the authenticated email and immutable identity', async () => {
  const owner = auth('owner-uid', 'owner@example.com');
  const other = auth('other-uid', 'other@example.com');
  const valid = {
    name: 'Owner', role: 'pm', status: 'active',
    lastActive: 1776556800000, lastSeenAt: 1776556800000,
    usageBuckets: {}, ownerUid: 'owner-uid', userKey: 'owner@example.com',
  };
  await assertSucceeds(setDoc(doc(owner, 'presence/owner@example.com'), valid));
  await assertSucceeds(getDoc(doc(other, 'presence/owner@example.com')));
  await assertSucceeds(updateDoc(doc(owner, 'presence/owner@example.com'), {
    status: 'idle', lastSeenAt: 1776556801000,
  }));
  await assertFails(setDoc(doc(owner, 'presence/other@example.com'), valid));
  await assertFails(setDoc(doc(owner, 'presence/owner@example.com'), { ...valid, ownerUid: 'other-uid' }));
  await assertFails(setDoc(doc(owner, 'presence/owner@example.com'), { ...valid, userKey: 'other@example.com' }));
  await assertFails(updateDoc(doc(owner, 'presence/owner@example.com'), { ownerUid: 'other-uid' }));
  await assertFails(updateDoc(doc(owner, 'presence/owner@example.com'), { userKey: 'other@example.com' }));
  await assertFails(updateDoc(doc(other, 'presence/owner@example.com'), { status: 'idle' }));
  await assertFails(setDoc(doc(owner, 'presence/extra'), { ...valid, extra: true }));
  await assertFails(setDoc(doc(owner, 'presence/owner@example.com'), { ...valid, name: 'x'.repeat(129) }));
  await assertFails(setDoc(doc(owner, 'presence/owner@example.com'), { ...valid, status: { active: true } }));
  await assertFails(setDoc(doc(owner, 'presence/owner@example.com'), { ...valid, usageBuckets: [] }));
  await assertFails(setDoc(doc(owner, 'presence/owner@example.com'), {
    ...valid,
    usageBuckets: Object.fromEntries(Array.from({ length: 257 }, (_, index) => [
      `bucket-${index}`, { bucketId: `bucket-${index}` },
    ])),
  }));
  await assertFails(deleteDoc(doc(owner, 'presence/owner@example.com')));
});

test('the actual first presence payload initializes a new document while malformed and cross-user writes fail', async () => {
  const owner = auth('owner-uid', 'owner@example.com');
  const other = auth('other-uid', 'other@example.com');
  const initialPayload = rootInitialPresencePayload()({
    uid: 'owner-uid', name: 'Owner', role: 'pm', userKey: 'owner@example.com', now: 1776556800000,
  });

  assert.deepEqual(initialPayload, {
    name: 'Owner', role: 'pm', status: 'active',
    lastActive: 1776556800000, lastSeenAt: 1776556800000,
    usageBuckets: {}, ownerUid: 'owner-uid', userKey: 'owner@example.com',
  });
  await assertSucceeds(setDoc(doc(owner, 'presence/owner@example.com'), initialPayload));
  await assertFails(setDoc(doc(other, 'presence/owner@example.com'), initialPayload));
  await assertFails(setDoc(doc(owner, 'presence/malformed@example.com'), {
    ...initialPayload, extra: 'forged',
  }));
});

test('a legacy presence record may establish identity once for its matching owner', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'presence/owner@example.com'), {
      name: 'Owner', role: 'pm', status: 'active', lastActive: 1, lastSeenAt: 1, usageBuckets: {},
    });
  });
  const owner = auth('owner-uid', 'owner@example.com');
  await assertSucceeds(setDoc(doc(owner, 'presence/owner@example.com'), {
    ownerUid: 'owner-uid', userKey: 'owner@example.com', lastSeenAt: 2,
  }, { merge: true }));
  await assertFails(updateDoc(doc(owner, 'presence/owner@example.com'), { ownerUid: 'replacement' }));
});

test('Admin and non-Admin clients cannot read or write sync control, run, or snapshot records', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'uatProductionWeekSync/control'), {
      activeRunId: 'run-1', expiresAt: '2099-01-01T00:00:00.000Z',
    });
    await setDoc(doc(db, 'uatProductionWeekSyncRuns/run-1'), {
      runId: 'run-1', phase: 'succeeded', complete: true,
    });
    await setDoc(doc(db, 'uatProductionWeekSyncRuns/run-1/weeks/W33-2026'), {
      data: { weekLabel: 'W33 2026' },
    });
  });

  for (const db of [
    auth('admin-uid', 'admin@example.com'),
    auth('owner-uid', 'owner@example.com'),
  ]) {
    for (const path of [
      'uatProductionWeekSync/control',
      'uatProductionWeekSyncRuns/run-1',
      'uatProductionWeekSyncRuns/run-1/weeks/W33-2026',
    ]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { blocked: true }));
      await assertFails(updateDoc(doc(db, path), { blocked: true }));
      await assertFails(deleteDoc(doc(db, path)));
    }
  }
});
}
