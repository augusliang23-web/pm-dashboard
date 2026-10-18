const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('./helpers/draft-store.cjs');

const { state, db } = createStore();
const firestorePath = require.resolve('firebase-admin/firestore');
const real = require(firestorePath);
require.cache[firestorePath] = {
  id: firestorePath,
  filename: firestorePath,
  loaded: true,
  exports: { ...real, getFirestore: () => db },
};

const api = require('../project-dashboard-writes');

function setupEnvironment({ isUat = true } = {}) {
  state.docs.clear();
  state.failAudit = false;

  // Users
  state.docs.set('users/admin@example.com', { role: 'admin', displayName: 'Admin User' });
  state.docs.set('userPermissions/admin@example.com', { overrides: {} });

  state.docs.set('users/admin-no-pm@example.com', { role: 'admin', displayName: 'Admin Restricted' });
  state.docs.set('userPermissions/admin-no-pm@example.com', { overrides: { 'project.manage': false } });

  state.docs.set('users/pm@example.com', { role: 'pm', displayName: 'PM User' });
  state.docs.set('userPermissions/pm@example.com', { overrides: { 'project.manage': true } });

  state.docs.set('users/pm-no-override@example.com', { role: 'pm', displayName: 'PM No Override' });
  state.docs.set('userPermissions/pm-no-override@example.com', { overrides: {} });

  state.docs.set('users/pm-restore-granted@example.com', { role: 'pm', displayName: 'PM Restore Granted' });
  state.docs.set('userPermissions/pm-restore-granted@example.com', { overrides: { 'project.archive.restore': true } });

  state.docs.set('users/pm-restore-revoked@example.com', { role: 'pm', displayName: 'PM Restore Revoked' });
  state.docs.set('userPermissions/pm-restore-revoked@example.com', { overrides: { 'project.archive.restore': false } });

  state.docs.set('users/pm-manage-only@example.com', { role: 'pm', displayName: 'PM Manage Only' });
  state.docs.set('userPermissions/pm-manage-only@example.com', { overrides: { 'project.manage': true, 'project.archive.restore': false } });

  state.docs.set('users/pm-restore-only@example.com', { role: 'pm', displayName: 'PM Restore Only' });
  state.docs.set('userPermissions/pm-restore-only@example.com', { overrides: { 'project.manage': false, 'project.archive.restore': true } });

  state.docs.set('users/vip@example.com', { role: 'vip', displayName: 'VIP User' });
  state.docs.set('userPermissions/vip@example.com', { overrides: {} });

  state.docs.set('users/exec@example.com', { role: 'executive', displayName: 'Executive User' });
  state.docs.set('userPermissions/exec@example.com', { overrides: {} });

  // Weeks
  // W1 (released) with an archived project and active project
  state.docs.set('weeks/W1', {
    weekLabel: 'W1 2026',
    isReleased: true,
    version: 1,
    projects: [
      { code: 'ARCH-01', name: 'Archived Project One', visibility: 'archived', owner: 'PM User', progress: 50 },
      { code: 'ACTIVE-01', name: 'Active Project One', visibility: 'active', owner: 'PM User', progress: 60 },
    ],
  });

  // W2 (unreleased draft) - latest valid chronological reporting week & eligible target
  state.docs.set('weeks/W2', {
    weekLabel: 'W2 2026',
    isReleased: false,
    version: 1,
    projects: [
      { code: 'EXISTING-02', name: 'Existing Project', visibility: 'active', owner: 'PM User', progress: 30 },
    ],
  });

  if (isUat) {
    process.env.GCLOUD_PROJECT = 'pm-dashboard-uat-20260820-a7f3';
    process.env.FUNCTIONS_EMULATOR = 'true';
    delete process.env.GOOGLE_CLOUD_PROJECT;
  } else {
    process.env.GCLOUD_PROJECT = 'project-manager-dashboar-a067f';
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.GOOGLE_CLOUD_PROJECT;
  }
}

const callAs = (email, fn, data) => api[fn].run({ auth: { uid: email, token: { email } }, data });

test('Admin successful restoration into latest valid unreleased target week', async () => {
  setupEnvironment({ isUat: true });
  const result = await callAs('admin@example.com', 'saveDashboardProject', {
    isArchiveRestore: true,
    weekId: 'W2',
    sourceWeekId: 'W1',
    projectCode: 'ARCH-01',
  });

  assert.equal(result.project.code, 'ARCH-01');
  assert.equal(result.project.visibility, 'active');
  assert.equal(result.project.name, 'Archived Project One');
  assert.equal(result.project.progress, 50);

  // Target week in store now has 2 projects
  const targetWeek = state.docs.get('weeks/W2');
  assert.equal(targetWeek.projects.length, 2);
  assert.equal(targetWeek.projects[1].code, 'ARCH-01');
  assert.equal(targetWeek.projects[1].visibility, 'active');
});

test('Target week validation: restoring into older draft week when newer week exists is denied', async () => {
  setupEnvironment({ isUat: true });
  // Add W3 2026 as the newer unreleased week
  state.docs.set('weeks/W3', {
    weekLabel: 'W3 2026',
    isReleased: false,
    version: 1,
    projects: [],
  });

  // Attempt to restore into older week W2 instead of latest week W3
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'invalid-payload' && e.message.includes('latest valid reporting week')
  );
});

test('Target week validation: when latest valid week is released, restore is disabled on server', async () => {
  setupEnvironment({ isUat: true });
  // Add W3 2026 as the latest week, marked released
  state.docs.set('weeks/W3', {
    weekLabel: 'W3 2026',
    isReleased: true,
    version: 1,
    projects: [],
  });

  // Attempting to restore into W3 fails because it is released
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W3',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'week-already-released'
  );

  // Attempting to restore into older draft W2 fails because it is not the latest valid week
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'invalid-payload' && e.message.includes('latest valid reporting week')
  );
});

test('Latest archive state: rejects request when project subsequently became Active or Hidden in a later week', async () => {
  setupEnvironment({ isUat: true });
  // ARCH-01 was archived in W1. In W2, it was active.
  state.docs.set('weeks/W2', {
    weekLabel: 'W2 2026',
    isReleased: true,
    version: 1,
    projects: [
      { code: 'ARCH-01', visibility: 'active' },
    ],
  });
  // W3 is latest unreleased week
  state.docs.set('weeks/W3', {
    weekLabel: 'W3 2026',
    isReleased: false,
    version: 1,
    projects: [],
  });

  // Client attempts to restore by referencing old archived snapshot in W1
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W3',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'invalid-payload' && e.message.includes('no longer in an archived state')
  );

  // Same rejection if project became 'hidden'
  state.docs.set('weeks/W2', {
    weekLabel: 'W2 2026',
    isReleased: true,
    version: 1,
    projects: [
      { code: 'ARCH-01', visibility: 'hidden' },
    ],
  });

  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W3',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'invalid-payload' && e.message.includes('no longer in an archived state')
  );
});

test('Latest archive state: rejects request referencing an older archived snapshot when a newer archived snapshot exists', async () => {
  setupEnvironment({ isUat: true });
  // ARCH-01 archived in W1
  // ARCH-01 modified and archived in W2
  state.docs.set('weeks/W2', {
    weekLabel: 'W2 2026',
    isReleased: true,
    version: 1,
    projects: [
      { code: 'ARCH-01', name: 'Archived Project Revised', visibility: 'archived', progress: 80 },
    ],
  });
  // W3 is latest unreleased week
  state.docs.set('weeks/W3', {
    weekLabel: 'W3 2026',
    isReleased: false,
    version: 1,
    projects: [],
  });

  // Referencing old snapshot W1 is rejected
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W3',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'invalid-payload' && e.message.includes('not the latest archived snapshot')
  );

  // Referencing latest snapshot W2 succeeds
  const res = await callAs('admin@example.com', 'saveDashboardProject', {
    isArchiveRestore: true,
    weekId: 'W3',
    sourceWeekId: 'W2',
    projectCode: 'ARCH-01',
  });
  assert.equal(res.project.progress, 80);
});

test('Admin with project.manage=false can still restore (project.archive.restore locked ON)', async () => {
  setupEnvironment({ isUat: true });
  const result = await callAs('admin-no-pm@example.com', 'saveDashboardProject', {
    isArchiveRestore: true,
    weekId: 'W2',
    sourceWeekId: 'W1',
    projectCode: 'ARCH-01',
  });
  assert.equal(result.project.code, 'ARCH-01');
  assert.equal(result.project.visibility, 'active');
});

test('PM without override cannot restore archived project', async () => {
  setupEnvironment({ isUat: true });
  await assert.rejects(
    callAs('pm-no-override@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'role-forbidden'
  );
});

test('PM with project.archive.restore=true can restore archived project', async () => {
  setupEnvironment({ isUat: true });
  const result = await callAs('pm-restore-granted@example.com', 'saveDashboardProject', {
    isArchiveRestore: true,
    weekId: 'W2',
    sourceWeekId: 'W1',
    projectCode: 'ARCH-01',
  });
  assert.equal(result.project.code, 'ARCH-01');
  assert.equal(result.project.visibility, 'active');
});

test('PM with project.archive.restore=false cannot restore archived project', async () => {
  setupEnvironment({ isUat: true });
  await assert.rejects(
    callAs('pm-restore-revoked@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'role-forbidden'
  );
});

test('PM with project.manage=false and project.archive.restore=true can restore archived project', async () => {
  setupEnvironment({ isUat: true });
  const result = await callAs('pm-restore-only@example.com', 'saveDashboardProject', {
    isArchiveRestore: true,
    weekId: 'W2',
    sourceWeekId: 'W1',
    projectCode: 'ARCH-01',
  });
  assert.equal(result.project.code, 'ARCH-01');
  assert.equal(result.project.visibility, 'active');
});

test('PM with project.manage=true and project.archive.restore=false cannot restore archived project', async () => {
  setupEnvironment({ isUat: true });
  await assert.rejects(
    callAs('pm-manage-only@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'role-forbidden'
  );
});

test('Executive and VIP users remain denied from restoring archived projects', async () => {
  setupEnvironment({ isUat: true });
  await assert.rejects(
    callAs('exec@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'role-forbidden'
  );
  await assert.rejects(
    callAs('vip@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'role-forbidden'
  );
});

test('Duplicate code denied (exact and case-different)', async () => {
  setupEnvironment({ isUat: true });
  // Target week W2 has 'EXISTING-02'
  state.docs.get('weeks/W1').projects.push({ code: 'EXISTING-02', visibility: 'archived' });
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'EXISTING-02',
    }),
    e => e.details?.reason === 'conflict'
  );

  // Case-different duplicate: existing is 'EXISTING-02', restoring 'existing-02'
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'existing-02',
    }),
    e => e.details?.reason === 'conflict'
  );
});

test('Sequential duplicate restore attempts fail with conflict', async () => {
  // Note on Concurrency:
  // This test validates sequential deduplication in the transaction handler.
  // Truly simultaneous/concurrent transactions across multiple processes rely on Firestore's
  // native optimistic concurrency control (OCC) and retry mechanism, which is not simulated by
  // the in-memory test double. Therefore, live multi-client transaction serialization is marked UNVERIFIED.
  setupEnvironment({ isUat: true });
  // First restore succeeds
  await callAs('admin@example.com', 'saveDashboardProject', {
    isArchiveRestore: true,
    weekId: 'W2',
    sourceWeekId: 'W1',
    projectCode: 'ARCH-01',
  });
  // Second sequential attempt fails with conflict
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'arch-01',
    }),
    e => e.details?.reason === 'conflict'
  );
});

test('Invalid source archive denied (missing project or not archived)', async () => {
  setupEnvironment({ isUat: true });
  // Missing project
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'NON-EXISTENT',
    }),
    e => e.code === 'not-found'
  );

  // Project exists in W1 but visibility is 'active', not 'archived'
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'ACTIVE-01',
    }),
    e => e.details?.reason === 'invalid-payload'
  );
});

test('Executive and VIP denied from restoring archived project', async () => {
  setupEnvironment({ isUat: true });
  for (const email of ['vip@example.com', 'exec@example.com']) {
    await assert.rejects(
      callAs(email, 'saveDashboardProject', {
        isArchiveRestore: true,
        weekId: 'W2',
        sourceWeekId: 'W1',
        projectCode: 'ARCH-01',
      }),
      e => e.details?.reason === 'role-forbidden'
    );
  }
});

test('Historical week remains completely unchanged after restoration', async () => {
  setupEnvironment({ isUat: true });
  const w1Before = structuredClone(state.docs.get('weeks/W1'));
  await callAs('admin@example.com', 'saveDashboardProject', {
    isArchiveRestore: true,
    weekId: 'W2',
    sourceWeekId: 'W1',
    projectCode: 'ARCH-01',
  });
  const w1After = state.docs.get('weeks/W1');
  assert.deepEqual(w1Before, w1After);
});

test('Generic isNew creation remains strictly blocked in UAT (PR #54 Draft boundary preserved)', async () => {
  setupEnvironment({ isUat: true });
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      weekId: 'W2',
      projectCode: 'BRAND-NEW',
      originalCode: '',
      isNew: true,
      project: { code: 'BRAND-NEW', name: 'Brand New' },
    }),
    e => e.details?.reason === 'draft-publish-required'
  );
});

test('Production environment rejects archive restore operation', async () => {
  setupEnvironment({ isUat: false });
  await assert.rejects(
    callAs('admin@example.com', 'saveDashboardProject', {
      isArchiveRestore: true,
      weekId: 'W2',
      sourceWeekId: 'W1',
      projectCode: 'ARCH-01',
    }),
    e => e.details?.reason === 'environment-forbidden'
  );
});

test('Invalid synthetic week cannot override latest authoritative Archive state', async () => {
  setupEnvironment({ isUat: true });
  // W1 (released, valid): ARCH-01 is archived
  // W2 (unreleased draft, valid): target week
  // Add an invalid synthetic week containing ARCH-01 as active
  state.docs.set('weeks/W-SYNTHETIC', {
    weekLabel: 'W26 2026 Prototype',
    isReleased: false,
    version: 1,
    projects: [
      { code: 'ARCH-01', visibility: 'active' },
    ],
  });

  // Restore must succeed because priorWeeks strictly slices valid chronological weeks (0 .. latestValidIdx),
  // ignoring the invalid synthetic week at the tail of orderedWeeks.
  const result = await callAs('admin@example.com', 'saveDashboardProject', {
    isArchiveRestore: true,
    weekId: 'W2',
    sourceWeekId: 'W1',
    projectCode: 'ARCH-01',
  });

  assert.equal(result.project.code, 'ARCH-01');
  assert.equal(result.project.visibility, 'active');
});
