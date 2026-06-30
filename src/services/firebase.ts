// ═══════════════════════════════════════════════════════════════════
//  Firebase Service Layer — preserves exact Firestore operations from v2.0T
// ═══════════════════════════════════════════════════════════════════

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  type Unsubscribe,
  type Firestore,
} from 'firebase/firestore';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  type User,
  type Auth,
} from 'firebase/auth';
import { FIREBASE_CONFIG } from '@/types/dashboard';
import type { Week, UserDoc, PresenceDoc, PresenceSession } from '@/types/dashboard';

// ── Singleton ──
let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;
let _auth: Auth | null = null;

function getApp(): FirebaseApp {
  if (!_app) _app = initializeApp(FIREBASE_CONFIG);
  return _app;
}

export function getDb(): Firestore {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

export function getAuthInstance(): Auth {
  if (!_auth) _auth = getAuth(getApp());
  return _auth;
}

// ── Auth ──
export function onAuthChange(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(getAuthInstance(), callback);
}

export async function login(email: string, password: string) {
  return signInWithEmailAndPassword(getAuthInstance(), email, password);
}

export async function logout() {
  return signOut(getAuthInstance());
}

export async function changePassword(user: User, currentPassword: string, newPassword: string) {
  const credential = EmailAuthProvider.credential(user.email!, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

// ── Email Key (same as original) ──
export function getEmailKey(userOrEmail: string | User): string {
  const email = typeof userOrEmail === 'string' ? userOrEmail : userOrEmail?.email || '';
  return email.split('@')[0]?.toLowerCase() || email;
}

// ── User Role ──
export async function fetchUserRole(emailKey: string): Promise<string> {
  const userDoc = await getDoc(doc(getDb(), 'users', emailKey));
  if (!userDoc.exists()) throw new Error('missing-dashboard-role');
  return normalizeRole(userDoc.data().role);
}

export function normalizeRole(role: string): string {
  return (role || 'pm').toString().trim().toLowerCase();
}

// ── PM List ──
export async function fetchPMList(): Promise<string[]> {
  const snap = await getDocs(collection(getDb(), 'users'));
  const pmSet = new Set<string>();
  snap.forEach((d) => {
    if (normalizeRole(d.data().role) !== 'vip') {
      pmSet.add(getDisplayName(d.id));
    }
  });
  return Array.from(pmSet).sort();
}

export function getDisplayName(emailStr: string): string {
  if (!emailStr || emailStr === 'System') return 'System';
  const prefix = emailStr.split('@')[0]?.toLowerCase() || '';
  const aliasMap: Record<string, string> = {
    'augus.liang': 'Augus',
    'josiah.winkler': 'Josiah',
    'qianyun.zhu': 'Bonnie',
    'huichong.kong': 'Huichong',
  };
  if (aliasMap[prefix]) return aliasMap[prefix];
  const n = prefix.split('.')[0];
  return n.charAt(0).toUpperCase() + n.slice(1);
}

// ── Weeks ──
export function subscribeWeeks(
  role: string,
  callback: (weeks: Week[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const weeksRef = collection(getDb(), 'weeks');
  const q =
    role === 'vip'
      ? query(weeksRef, where('isReleased', '==', true))
      : query(weeksRef, orderBy('weekLabel'));
  return onSnapshot(
    q,
    (snap) => {
      const weeks = snap.docs.map((d) => d.data() as Week);
      callback(weeks);
    },
    (err) => onError(err as Error)
  );
}

export function getWeekDocId(weekLabel: string): string {
  return weekLabel.replace(/\s+/g, '-');
}

export async function saveWeek(week: Week): Promise<void> {
  const id = getWeekDocId(week.weekLabel);
  await setDoc(doc(getDb(), 'weeks', id), week);
}

export async function updateWeekField(weekLabel: string, fields: Record<string, unknown>): Promise<void> {
  const id = getWeekDocId(weekLabel);
  await updateDoc(doc(getDb(), 'weeks', id), fields);
}

// ── Presence ──
export function subscribePresence(
  callback: (docs: PresenceDoc[]) => void
): Unsubscribe {
  const q = query(collection(getDb(), 'presence'));
  return onSnapshot(q, (snap) => {
    const docs = snap.docs.map((d) => d.data() as PresenceDoc);
    callback(docs);
  });
}

export async function updatePresence(emailKey: string, data: Partial<PresenceDoc>): Promise<void> {
  await setDoc(doc(getDb(), 'presence', emailKey), data, { merge: true });
}

export async function createPresenceSession(sessionId: string, session: PresenceSession): Promise<void> {
  await setDoc(doc(getDb(), 'presenceSessions', sessionId), session);
}

export async function closePresenceSession(sessionId: string, closed: boolean): Promise<void> {
  await updateDoc(doc(getDb(), 'presenceSessions', sessionId), { closed, state: 'closed' });
}

// ── Sync Core (ported from sync-core.js) ──
export function cleanFirestoreData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cleanFirestoreData).filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, item]) => key && item !== undefined)
        .map(([key, item]) => [key, cleanFirestoreData(item)])
        .filter(([, item]) => item !== undefined)
    );
  }
  return value === undefined ? undefined : value;
}

export async function confirmWeekMutation<T extends Record<string, unknown>>(
  source: T,
  changes: Partial<T>,
  write: (candidate: T) => Promise<void>,
  { timeoutMs = 15000 } = {}
): Promise<T> {
  const candidate = cleanFirestoreData({ ...source, ...changes }) as T;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(Object.assign(new Error('Firestore did not confirm the write in time.'), { code: 'write-timeout' }));
    }, timeoutMs);
  });
  await Promise.race([write(candidate), timeout]);
  return candidate;
}

export function getWriteErrorMessage(error: unknown): string {
  const code = String((error as { code?: string })?.code || '');
  if (code.includes('permission-denied')) {
    return 'Save blocked by Firestore permissions. Ask the Firebase administrator to allow admin updates to released weeks.';
  }
  if (code === 'write-timeout') {
    return 'Save was not confirmed. Check the connection and try again.';
  }
  return 'Save failed. Your previous data was kept; please try again.';
}

// ── Executive Timeline Core (ported from executive-timeline-core.js) ──
export function getExecutiveTimelineCell(cells: Record<string, string[]> | string[][], index: number): string[] {
  if (Array.isArray(cells)) {
    return (cells as string[][])[index] ?? [];
  }
  return (cells as Record<string, string[]>)[`q${index + 1}`] ?? [];
}

export function serializeExecutiveMilestoneTimeline(timeline: Record<string, unknown> = {}): Record<string, unknown> {
  const rows = (timeline.rows as Array<Record<string, unknown>>) || [];
  return {
    ...timeline,
    rows: rows.map((row) => ({
      ...row,
      cells: Object.fromEntries(
        Array.from({ length: 4 }, (_, index) => {
          const value = getExecutiveTimelineCell(row.cells as Record<string, string[]> | string[][], index);
          const items = Array.isArray(value)
            ? value.map(String).filter(Boolean)
            : String(value || '')
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean);
          return [`q${index + 1}`, items];
        })
      ),
    })),
  };
}

// ── Alias map re-export ──
export { ALIAS_MAP } from '@/types/dashboard';