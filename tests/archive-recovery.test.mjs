import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProjectCode,
  isWeekReleased,
  findTargetDraftWeek,
  collectArchivedProjects,
  filterArchivedProjects,
  canRestoreProject,
  buildRestoredProjectPayload,
} from '../js/archive-recovery.mjs';
import { copyPreviousWeekCarryover } from '../week-carryover.mjs';

test('normalizeProjectCode folds case and trims whitespace', () => {
  assert.equal(normalizeProjectCode('  PRJ-001  '), 'prj-001');
  assert.equal(normalizeProjectCode('ALPHA'), 'alpha');
  assert.equal(normalizeProjectCode(''), '');
  assert.equal(normalizeProjectCode(null), '');
});

test('isWeekReleased checks week.isReleased boolean', () => {
  assert.equal(isWeekReleased({ isReleased: true }), true);
  assert.equal(isWeekReleased({ isReleased: false }), false);
  assert.equal(isWeekReleased({}), false);
  assert.equal(isWeekReleased(null), false);
});

test('findTargetDraftWeek resolves strictly to latest eligible draft week and never falls back to older draft week', () => {
  const weeks = [
    { weekLabel: 'W1 2026', isReleased: true },
    { weekLabel: 'W2 2026', isReleased: false },
    { weekLabel: 'W3 2026', isReleased: false },
  ];
  // Latest valid chronological week (W3 2026) is unreleased -> target is W3 2026
  const target = findTargetDraftWeek(weeks);
  assert.equal(target.weekLabel, 'W3 2026');

  // If latest valid week (W3 2026) is released, disable restore (null) - do NOT fall back to W2
  const latestReleased = [
    { weekLabel: 'W1 2026', isReleased: true },
    { weekLabel: 'W2 2026', isReleased: false },
    { weekLabel: 'W3 2026', isReleased: true },
  ];
  assert.equal(findTargetDraftWeek(latestReleased), null);

  // all released -> null
  const allReleased = [
    { weekLabel: 'W1 2026', isReleased: true },
    { weekLabel: 'W2 2026', isReleased: true },
  ];
  assert.equal(findTargetDraftWeek(allReleased), null);

  // invalid/ambiguous labels are never latest
  const invalidLabels = [
    { weekLabel: 'W1 2026', isReleased: false },
    { weekLabel: 'W26 2026 Prototype', isReleased: true },
  ];
  assert.equal(findTargetDraftWeek(invalidLabels).weekLabel, 'W1 2026');
});

test('collectArchivedProjects distinguishes Archived from Hidden and Active', () => {
  const weeks = [
    {
      weekLabel: 'W1 2026',
      projects: [
        { code: 'PRJ-ACT', name: 'Active Project', visibility: 'active', status: 'green' },
        { code: 'PRJ-HID', name: 'Hidden Project', visibility: 'hidden', status: 'yellow' },
        { code: 'PRJ-ARC', name: 'Archived Project', visibility: 'archived', status: 'red', customer: 'Acme' },
      ],
    },
  ];

  const result = collectArchivedProjects(weeks, null);
  assert.equal(result.isHistoricalIncomplete, false);
  assert.equal(result.archived.length, 1);
  assert.equal(result.archived[0].code, 'PRJ-ARC');
  assert.equal(result.archived[0].name, 'Archived Project');
  assert.equal(result.archived[0].customer, 'Acme');
  assert.equal(result.archived[0].lastStatus, 'red');
  assert.equal(result.archived[0].archivedWeekLabel, 'W1 2026');
});

test('collectArchivedProjects tracks latest project appearance across multiple weeks', () => {
  const weeks = [
    {
      weekLabel: 'W1 2026',
      projects: [
        { code: 'PRJ-1', name: 'Project 1', visibility: 'active' },
        { code: 'PRJ-2', name: 'Project 2', visibility: 'active' },
      ],
    },
    {
      weekLabel: 'W2 2026',
      projects: [
        { code: 'PRJ-1', name: 'Project 1 Updated', visibility: 'archived', owner: 'Alice' },
      ],
    },
    {
      weekLabel: 'W3 2026',
      projects: [
        { code: 'PRJ-2', name: 'Project 2', visibility: 'active' },
      ],
    },
  ];

  const result = collectArchivedProjects(weeks, weeks[2]);
  assert.equal(result.archived.length, 1);
  assert.equal(result.archived[0].code, 'PRJ-1');
  assert.equal(result.archived[0].name, 'Project 1 Updated');
  assert.equal(result.archived[0].owner, 'Alice');
  assert.equal(result.archived[0].archivedWeekLabel, 'W2 2026');
});

test('collectArchivedProjects handles missing or legacy metadata faithfully without inventing info', () => {
  const weeks = [
    {
      weekLabel: 'W1 2026',
      projects: [
        { code: 'LEGACY-01', visibility: 'archived' }, // missing name, owner, status
      ],
    },
  ];

  const result = collectArchivedProjects(weeks, null);
  assert.equal(result.archived.length, 1);
  assert.equal(result.archived[0].code, 'LEGACY-01');
  assert.equal(result.archived[0].name, '');
  assert.equal(result.archived[0].owner, '');
  assert.equal(result.archived[0].customer, '');
  assert.equal(result.archived[0].lastStatus, 'gray');
});

test('collectArchivedProjects handles incomplete or unconfirmed historical loading', () => {
  assert.deepEqual(collectArchivedProjects(null, null), {
    archived: [],
    isHistoricalIncomplete: true,
  });
  // Unconfirmed server state -> isHistoricalIncomplete: true
  assert.deepEqual(collectArchivedProjects([], null, { isServerConfirmed: false }), {
    archived: [],
    isHistoricalIncomplete: true,
  });
  // Confirmed server state with 0 weeks -> isHistoricalIncomplete: false
  assert.deepEqual(collectArchivedProjects([], null, { isServerConfirmed: true }), {
    archived: [],
    isHistoricalIncomplete: false,
  });
});

test('filterArchivedProjects searches by code or name case-insensitively', () => {
  const list = [
    { code: 'ALPHA-01', name: 'Highway Inverter' },
    { code: 'BETA-02', name: 'Solar Charger' },
    { code: 'GAMMA-03', name: 'Alpha Battery Unit' },
  ];

  assert.equal(filterArchivedProjects(list, '').length, 3);
  assert.equal(filterArchivedProjects(list, 'alpha').length, 2); // ALPHA-01 code, and GAMMA-03 name
  assert.equal(filterArchivedProjects(list, 'solar').length, 1);
  assert.equal(filterArchivedProjects(list, 'beta-02').length, 1);
  assert.equal(filterArchivedProjects(list, 'nonexistent').length, 0);
});

test('canRestoreProject prevents duplicates (exact and case-different)', () => {
  const targetWeek = {
    weekLabel: 'W2 2026',
    isReleased: false,
    projects: [
      { code: 'PRJ-01', visibility: 'active' },
      { code: 'PRJ-02', visibility: 'active' },
    ],
  };

  assert.deepEqual(canRestoreProject('PRJ-03', targetWeek), { allowed: true });

  // Exact duplicate
  const exact = canRestoreProject('PRJ-01', targetWeek);
  assert.equal(exact.allowed, false);
  assert.match(exact.reason, /already exists/);

  // Case-different duplicate
  const caseDiff = canRestoreProject('prj-01', targetWeek);
  assert.equal(caseDiff.allowed, false);
  assert.match(caseDiff.reason, /already exists/);

  // Locked target week
  assert.equal(canRestoreProject('PRJ-03', { ...targetWeek, isReleased: true }).allowed, false);

  // Missing target week
  assert.equal(canRestoreProject('PRJ-03', null).allowed, false);
});

test('Full lifecycle: Archive in Week 1 -> dropped in Week 2 -> Restored in Week 2 -> carried over into Week 3', () => {
  // Step A: Week 1 has project archived
  const week1 = {
    weekId: 'w1',
    weekLabel: 'W1 2026',
    isReleased: true, // historical week is released
    projects: [
      { code: 'PRJ-RESTORE', name: 'Restore Me', owner: 'Bob', status: 'green', visibility: 'archived', progress: 50 },
    ],
  };

  // Step B: Week 2 created from Week 1 via copyPreviousWeekCarryover
  const week2Carryover = copyPreviousWeekCarryover(week1);
  const week2 = {
    weekId: 'w2',
    weekLabel: 'W2 2026',
    isReleased: false,
    ...week2Carryover,
  };
  // PRJ-RESTORE is dropped from week 2
  assert.equal(week2.projects.length, 0);

  // Step C: Global archive discovery finds PRJ-RESTORE from allWeeks history
  const allWeeks = [week1, week2];
  const discovery = collectArchivedProjects(allWeeks, week2);
  assert.equal(discovery.archived.length, 1);
  assert.equal(discovery.archived[0].code, 'PRJ-RESTORE');
  assert.equal(discovery.archived[0].archivedWeekLabel, 'W1 2026');

  // Step D: Restore into Week 2
  const check = canRestoreProject('PRJ-RESTORE', week2);
  assert.equal(check.allowed, true);

  const restoredPayload = buildRestoredProjectPayload(discovery.archived[0]);
  assert.equal(restoredPayload.code, 'PRJ-RESTORE');
  assert.equal(restoredPayload.visibility, 'active');
  assert.equal(restoredPayload.progress, 50);

  // Simulate applying to week 2
  week2.projects.push(restoredPayload);
  assert.equal(week2.projects.length, 1);

  // Step E & F: Create Week 3 from Week 2
  const week3Carryover = copyPreviousWeekCarryover(week2);
  const week3 = {
    weekId: 'w3',
    weekLabel: 'W3 2026',
    isReleased: false,
    ...week3Carryover,
  };
  // Confirm project carried over into Week 3!
  assert.equal(week3.projects.length, 1);
  assert.equal(week3.projects[0].code, 'PRJ-RESTORE');
  assert.equal(week3.projects[0].visibility, 'active');

  // Step G: Confirm Week 1 historical remains 100% unchanged
  assert.equal(week1.projects[0].visibility, 'archived');
  assert.equal(week1.isReleased, true);

  // Step H: Duplicate restore into Week 2 is now prevented
  const duplicateCheck = canRestoreProject('prj-restore', week2);
  assert.equal(duplicateCheck.allowed, false);
});
