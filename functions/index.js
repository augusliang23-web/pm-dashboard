const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();
const projectDashboardWrites = require("./project-dashboard-writes");
const SESSION_COLLECTION = "presenceSessions";
const ROLLUP_COLLECTION = "presenceDailyRollups";
const SESSION_TIMEOUT_MS = 12 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BATCHES = 10;
const BATCH_SIZE = 250;

function utcDayStart(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function splitSessionByUtcDay(session, now) {
  const startedAt = Number(session.startedAt || 0);
  const lastSeenAt = Number(session.lastSeenAt || startedAt);
  const endedAt = Number(session.endedAt || Math.min(now, lastSeenAt + SESSION_TIMEOUT_MS));
  if (!startedAt || endedAt <= startedAt) return [];

  const onlineMs = endedAt - startedAt;
  const activeMs = Math.max(0, Number(session.activeMs || 0));
  const idleMs = Math.max(0, Number(session.idleMs || 0));
  const pieces = [];

  for (let dayStart = utcDayStart(startedAt); dayStart < endedAt; dayStart += DAY_MS) {
    const segmentStart = Math.max(startedAt, dayStart);
    const segmentEnd = Math.min(endedAt, dayStart + DAY_MS);
    const segmentOnlineMs = Math.max(0, segmentEnd - segmentStart);
    const share = onlineMs ? segmentOnlineMs / onlineMs : 0;
    pieces.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      firstSeenAt: segmentStart,
      lastSeenAt: segmentEnd,
      onlineMs: segmentOnlineMs,
      activeMs: Math.round(activeMs * share),
      idleMs: Math.round(idleMs * share)
    });
  }
  return pieces;
}

async function aggregateSession(sessionDoc, now) {
  const session = sessionDoc.data();
  if (session.aggregatedAt) return false;

  const lastSeenAt = Number(session.lastSeenAt || session.startedAt || 0);
  const isClosed = Number(session.endedAt || 0) > 0;
  const isTimedOut = lastSeenAt > 0 && now - lastSeenAt >= SESSION_TIMEOUT_MS;
  if (!isClosed && !isTimedOut) return false;

  const pieces = splitSessionByUtcDay(session, now);
  if (!pieces.length) {
    await sessionDoc.ref.update({
      aggregatedAt: FieldValue.serverTimestamp(),
      aggregationVersion: 1
    });
    return true;
  }

  await db.runTransaction(async transaction => {
    const rollups = [];
    for (const piece of pieces) {
      const safeUser = String(session.userKey || "unknown").replace(/[^a-z0-9]+/gi, "-");
      const ref = db.collection(ROLLUP_COLLECTION).doc(`${piece.date}__${safeUser}`);
      const snapshot = await transaction.get(ref);
      rollups.push({ ref, snapshot, piece });
    }

    for (const { ref, snapshot, piece } of rollups) {
      const existing = snapshot.exists ? snapshot.data() : {};
      transaction.set(ref, {
        date: piece.date,
        userKey: session.userKey || "unknown",
        displayName: session.displayName || session.userKey || "Unknown",
        role: session.role || "pm",
        environment: session.environment || "v2.1",
        sessionCount: FieldValue.increment(1),
        onlineMs: FieldValue.increment(piece.onlineMs),
        activeMs: FieldValue.increment(piece.activeMs),
        idleMs: FieldValue.increment(piece.idleMs),
        timedOutCount: FieldValue.increment(isTimedOut && !isClosed ? 1 : 0),
        firstSeenAt: Math.min(Number(existing.firstSeenAt || piece.firstSeenAt), piece.firstSeenAt),
        lastSeenAt: Math.max(Number(existing.lastSeenAt || piece.lastSeenAt), piece.lastSeenAt),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    transaction.update(sessionDoc.ref, {
      aggregatedAt: FieldValue.serverTimestamp(),
      aggregationVersion: 1,
      aggregatedEndAt: Number(session.endedAt || Math.min(now, lastSeenAt + SESSION_TIMEOUT_MS))
    });
  });
  return true;
}

exports.aggregatePresenceSessions = onSchedule({
  schedule: "15 2 * * *",
  timeZone: "UTC",
  region: "us-central1",
  timeoutSeconds: 540,
  memory: "256MiB"
}, async () => {
  let aggregated = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const snapshot = await db.collection(SESSION_COLLECTION)
      .where("aggregatedAt", "==", null)
      .limit(BATCH_SIZE)
      .get();
    if (snapshot.empty) break;

    let batchAggregated = 0;
    for (const sessionDoc of snapshot.docs) {
      if (await aggregateSession(sessionDoc, Date.now())) {
        aggregated += 1;
        batchAggregated += 1;
      }
    }
    if (snapshot.size < BATCH_SIZE || batchAggregated === 0) break;
  }
  console.log(`Presence aggregation complete: ${aggregated} session(s).`);
});

exports.saveDashboardProject = projectDashboardWrites.saveDashboardProject;
exports.deleteDashboardProject = projectDashboardWrites.deleteDashboardProject;
exports.setDashboardProjectAttention = projectDashboardWrites.setDashboardProjectAttention;
exports.setDashboardWeekRelease = projectDashboardWrites.setDashboardWeekRelease;
exports.saveDashboardWeekFields = projectDashboardWrites.saveDashboardWeekFields;
exports.createDashboardWeek = projectDashboardWrites.createDashboardWeek;
exports.saveDashboardGanttTemplateSettings = projectDashboardWrites.saveDashboardGanttTemplateSettings;
