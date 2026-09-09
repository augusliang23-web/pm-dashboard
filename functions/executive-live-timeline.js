'use strict';

const { getFirestore } = require('firebase-admin/firestore');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function liveTimelineRef(db = getFirestore()) {
  return db.collection('executiveMilestoneState').doc('live');
}

function liveTimelineFromWeek(week) {
  return clone(week?.strategyLayer?.executiveMilestoneTimeline || week?.executiveMilestoneTimeline || null);
}

function normalizeLiveTimelineState(value) {
  const version = Number(value?.version);
  return {
    timeline: clone(value?.timeline || null),
    version: Number.isFinite(version) && version >= 0 ? version : 0,
  };
}

function liveTimelineAsWeek(state) {
  return { strategyLayer: { executiveMilestoneTimeline: clone(normalizeLiveTimelineState(state).timeline) } };
}

function nextLiveTimelineState(state, timeline, actorEmail, now) {
  const current = normalizeLiveTimelineState(state);
  return {
    ...current,
    timeline: clone(timeline),
    version: current.version + 1,
    updatedAt: now,
    updatedBy: actorEmail,
  };
}

function snapshotFromLiveTimeline(state, actorEmail, now) {
  const current = normalizeLiveTimelineState(state);
  return {
    timeline: clone(current.timeline),
    timelineVersion: current.version,
    capturedAt: now,
    capturedBy: actorEmail,
  };
}

module.exports = {
  liveTimelineRef,
  liveTimelineFromWeek,
  normalizeLiveTimelineState,
  liveTimelineAsWeek,
  nextLiveTimelineState,
  snapshotFromLiveTimeline,
};
