import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helpers = await import("../js/presence-usage.mjs").catch(() => ({}));

test("uses a 2,000-write scale and only the 20% line below 2,000 writes", () => {
  assert.equal(typeof helpers.selectPresenceWriteScale, "function");
  assert.deepEqual(
    helpers.selectPresenceWriteScale([{ count: 240 }, { count: 1_999 }]),
    {
      maxWrites: 2_000,
      gridValues: [0, 500, 1_000, 1_500, 2_000],
      referenceLines: [
        { value: 2_000, label: "20% · 2k", kind: "attention" },
      ],
    },
  );
});

test("uses the full quota scale with 20% and 80% lines at 2,000 writes", () => {
  assert.equal(typeof helpers.selectPresenceWriteScale, "function");
  const scale = helpers.selectPresenceWriteScale([{ count: 2_000 }]);

  assert.equal(scale.maxWrites, 10_000);
  assert.deepEqual(scale.gridValues, [0, 2_500, 5_000, 7_500, 10_000]);
  assert.deepEqual(scale.referenceLines, [
    { value: 2_000, label: "20% · 2k", kind: "attention" },
    { value: 8_000, label: "80% · 8k", kind: "warning" },
  ]);
});

test("builds recent last-seen activities and ignores invalid or stale timestamps", () => {
  assert.equal(typeof helpers.buildLastSeenPresenceActivities, "function");
  const cutoff = Date.UTC(2026, 6, 1);
  const now = Date.UTC(2026, 6, 2);

  assert.deepEqual(
    helpers.buildLastSeenPresenceActivities(
      [
        {
          id: "nick@example.com",
          data: {
            name: "Nick",
            role: "PM",
            lastSeenAt: cutoff + 1_000,
            lastActive: 0,
          },
        },
        {
          id: "josiah@example.com",
          data: {
            name: "Josiah",
            role: "PM",
            lastActive: cutoff + 2_000,
          },
        },
        {
          id: "old@example.com",
          data: { lastSeenAt: cutoff - 1 },
        },
        {
          id: "future@example.com",
          data: { lastSeenAt: now + 1 },
        },
      ],
      cutoff,
      now,
    ),
    [
      {
        userKey: "nick@example.com",
        displayName: "Nick",
        role: "PM",
        lastSeenAt: cutoff + 1_000,
      },
      {
        userKey: "josiah@example.com",
        displayName: "Josiah",
        role: "PM",
        lastSeenAt: cutoff + 2_000,
      },
    ],
  );
});

test("uses last-seen only when a user has no session or estimated activity", () => {
  assert.equal(typeof helpers.buildPresenceTimelineLanes, "function");
  const lanes = helpers.buildPresenceTimelineLanes(
    [
      {
        userKey: "nick@example.com",
        displayName: "Nick",
        role: "PM",
        startedAt: 100,
      },
    ],
    [
      {
        userKey: "JOSIAH@example.com",
        displayName: "Josiah",
        role: "PM",
        bucketStart: 200,
      },
    ],
    [
      {
        userKey: "nick@example.com",
        displayName: "Nick",
        role: "PM",
        lastSeenAt: 300,
      },
      {
        userKey: "josiah@example.com",
        displayName: "Josiah",
        role: "PM",
        lastSeenAt: 400,
      },
      {
        userKey: "bonnie@example.com",
        displayName: "Bonnie",
        role: "PM",
        lastSeenAt: 500,
      },
    ],
  );

  assert.deepEqual(
    lanes.map((lane) => ({
      key: lane.key,
      kinds: lane.entries.map((entry) => entry.kind),
    })),
    [
      { key: "bonnie@example.com", kinds: ["last-seen"] },
      { key: "josiah@example.com", kinds: ["estimate"] },
      { key: "nick@example.com", kinds: ["session"] },
    ],
  );
});

test("dashboard wires dynamic scale, timeline lanes, and last-seen fallback", async () => {
  const source = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );

  assert.match(source, /selectPresenceWriteScale/);
  assert.match(source, /buildLastSeenPresenceActivities/);
  assert.match(source, /buildPresenceTimelineLanes/);
  assert.match(source, /lastSeenAt:\s*now/);
  assert.match(source, /ownerUid:\s*currentUser\.uid/);
  assert.match(source, /Activity detected \(time unknown\)/);
});

test("presence timeline keeps user names frozen while the chart scrolls horizontally", async () => {
  const source = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /\.usage-chart-frozen-labels\s*\{[^}]*position:\s*sticky;[^}]*left:\s*0;/s,
  );
  assert.match(source, /class="usage-chart-frozen-labels"/);
  assert.match(source, /class="usage-chart-frozen-label"/);
  assert.match(source, /aria-label="User names"/);
});
