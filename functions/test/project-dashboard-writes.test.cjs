const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertAllowedKeys,
  assertBoundedJson,
  assertDraftWeek,
  buildAuthenticatedActor,
  buildCreatedWeek,
  buildProjectPatch,
  buildWeekFieldsPatch,
  canMutateProject,
  canSetWeekRelease,
  canDeleteProject,
  canManageWeekFields,
  canCreateProject,
  identityTokens,
  ownerOrDeputyMatches,
  ownershipTokens,
  projectRevisionFingerprint,
  updateProjectSectionMetadata,
} = require('../project-dashboard-writes');

const actor = {
  uid: 'pm-1',
  email: 'augus@example.com',
  role: 'pm',
  displayName: 'Augus Liang',
};
const project = { code: 'ALPHA', owner: 'Augus Liang', deputy: 'Deputy' };

test('slash project codes preserve saves and authorization boundaries', () => {
  const live = { ...project, code: 'H/W-001', highlight: 'before' };
  const week = { projects: [live], isReleased: false, version: 1 };
  const request = { weekId: 'W1', originalCode: live.code, projectCode: live.code,
    project: { ...live, highlight: 'after' }, expectedRevision: projectRevisionFingerprint(live) };
  for (const permitted of [actor, { ...actor, role: 'admin' }, { ...actor, displayName: 'Deputy' }]) {
    const result = buildProjectPatch(week, request, permitted, '2026-09-10T00:00:00Z');
    assert.equal(result.committedProject.code, 'H/W-001');
    assert.equal(result.committedProject.highlight, 'after');
  }
  assert.equal(reasonFrom(() => buildProjectPatch(week, request, { ...actor, displayName: 'Other', email: 'other@example.com' })), 'ownership-forbidden');
  assert.equal(reasonFrom(() => buildProjectPatch({ ...week, isReleased: true }, request, actor)), 'released-week');
  assert.equal(reasonFrom(() => buildProjectPatch(week, { ...request, expectedRevision: 'stale' }, actor)), 'conflict');
  for (const code of [' ', 'x'.repeat(129)]) {
    assert.equal(reasonFrom(() => buildProjectPatch(week, { ...request, projectCode: code }, actor)), 'invalid-payload');
  }
  assert.equal(reasonFrom(() => buildCreatedWeek({ weekId: 'invalid/week', weekLabel: 'Test' }, { ...actor, role: 'admin' })), 'invalid-payload');
});

function reasonFrom(callback) {
  try {
    callback();
  } catch (error) {
    return error?.details?.reason;
  }
  assert.fail('Expected the operation to throw.');
}

test('project authority permits Admin globally and PM ownership only', () => {
  assert.equal(canMutateProject({ actor: { ...actor, role: 'admin' }, project }), true);
  assert.equal(canMutateProject({ actor, project }), true);
  assert.equal(canMutateProject({ actor: { ...actor, email: 'other@example.com', displayName: 'Other' }, project }), false);
  assert.equal(canMutateProject({ actor: { ...actor, role: 'bd' }, project }), false);
});

test('protected draft saves permit Admin, owner, and deputy identities', () => {
  const liveProject = { code: 'ALPHA', name: 'Alpha', owner: 'Owner', deputy: 'Deputy' };
  const week = { projects: [liveProject], version: 1, isReleased: false };
  const request = {
    weekId: 'W1', originalCode: 'ALPHA', projectCode: 'ALPHA',
    project: { ...liveProject, highlight: 'Updated' },
    expectedRevision: projectRevisionFingerprint(liveProject),
  };

  for (const allowedActor of [
    { ...actor, role: 'admin', email: 'admin@example.com', displayName: 'Admin' },
    { ...actor, email: 'owner@example.com', displayName: 'Owner' },
    { ...actor, email: 'deputy@example.com', displayName: 'Deputy' },
  ]) {
    assert.doesNotThrow(() => buildProjectPatch(week, request, allowedActor, '2026-08-18T00:00:00.000Z'));
  }
});

test('legacy Admin without displayName keeps protected management authority', () => {
  const legacyAdmin = buildAuthenticatedActor(
    { uid: 'legacy-admin', email: 'augus.liang@example.com' },
    { role: 'admin' },
  );

  assert.equal(legacyAdmin.displayName, 'Augus');
  assert.equal(canSetWeekRelease(legacyAdmin.role), true);
  assert.doesNotThrow(() => buildWeekFieldsPatch({ version: 1, isReleased: false }, {
    weekId: 'W1', fields: { summary: 'Updated by legacy Admin' },
  }, legacyAdmin));
  assert.equal(buildAuthenticatedActor(
    { uid: 'named-admin', email: 'augus.liang@example.com' },
    { role: 'admin', displayName: 'Stored Admin Name' },
  ).displayName, 'Stored Admin Name');
  assert.throws(
    () => buildAuthenticatedActor(
      { uid: 'unknown-role', email: 'augus.liang@example.com' },
      { role: 'unknown' },
    ),
    error => error?.details?.reason === 'role-forbidden',
  );
});

test('legacy PM without displayName can save a project assigned to the trusted email alias', () => {
  const legacyPm = buildAuthenticatedActor(
    { uid: 'legacy-pm', email: 'qianyun.zhu@example.com' },
    { role: 'pm' },
  );
  const liveProject = { code: 'ALPHA', name: 'Alpha', owner: 'Bonnie', deputy: '' };
  const week = { projects: [liveProject], version: 1, isReleased: false };

  assert.equal(legacyPm.displayName, 'Bonnie');
  assert.doesNotThrow(() => buildProjectPatch(week, {
    weekId: 'W1', originalCode: 'ALPHA', projectCode: 'ALPHA',
    project: { ...liveProject, highlight: 'Updated' },
    expectedRevision: projectRevisionFingerprint(liveProject),
  }, legacyPm, '2026-09-10T00:00:00.000Z'));

  for (const [email, displayName] of [
    ['augus.liang@example.com', 'Augus'],
    ['josiah.winkler@example.com', 'Josiah'],
    ['qianyun.zhu@example.com', 'Bonnie'],
    ['huichong.kong@example.com', 'Huichong'],
  ]) {
    assert.equal(buildAuthenticatedActor(
      { uid: `legacy-${displayName}`, email },
      { role: 'pm' },
    ).displayName, displayName);
  }
});

test('legacy PM fallback does not grant ownership from a similar first name', () => {
  const unrelatedPm = buildAuthenticatedActor(
    { uid: 'unrelated-pm', email: 'bonnie.other@example.com' },
    { role: 'pm' },
  );

  assert.equal(unrelatedPm.displayName, 'bonnie.other');
  assert.equal(ownerOrDeputyMatches({ owner: 'Bonnie' }, unrelatedPm), false);
});

test('ownership uses exact canonical display-name, email, or email-prefix tokens', () => {
  assert.deepEqual([...identityTokens(actor)].sort(), ['augus', 'augus liang', 'augus@example.com']);
  assert.deepEqual(ownershipTokens('Ann, owner@example.com / Deputy\nThird'), [
    'ann', 'owner@example.com', 'deputy', 'third',
  ]);
  for (const owner of ['Augus Liang', 'augus@example.com', 'augus']) {
    assert.equal(ownerOrDeputyMatches({ owner }, actor), true, owner);
  }
  assert.equal(ownerOrDeputyMatches({ owner: 'Joann' }, { ...actor, displayName: 'Ann' }), false);
  assert.equal(ownerOrDeputyMatches({ owner: 'augustus' }, actor), false);
  assert.equal(ownerOrDeputyMatches({ owner: 'augus@example.com' }, { ...actor, displayName: '' }), true);
});

test('released weeks reject writes and only PM or Admin changes release state', () => {
  assert.throws(() => assertDraftWeek({ isReleased: true }), /Released reporting weeks/);
  assert.equal(canSetWeekRelease('admin'), true);
  assert.equal(canSetWeekRelease('pm'), true);
  assert.equal(canSetWeekRelease('bd'), false);
});

test('structural and week management authority is explicit', () => {
  assert.equal(canDeleteProject('admin'), true);
  assert.equal(canDeleteProject('pm'), false);
  assert.equal(canCreateProject('admin'), true);
  assert.equal(canCreateProject('pm'), false);
  assert.equal(canManageWeekFields('admin'), true);
  assert.equal(canManageWeekFields('pm'), false);
});

test('section update metadata changes only the saved project sections', () => {
  const before = {
    status: 'green', highlight: 'Old', weeklyActions: 'Keep moving',
    sectionUpdatedAt: { status: { savedAt: '2026-07-30T00:00:00.000Z', editorName: 'BONNIE' } }
  };
  const metadata = updateProjectSectionMetadata(before, {
    ...before, highlight: 'New'
  }, { editorName: 'AUGUS.LIANG', savedAt: '2026-08-01T08:00:00.000Z' });

  assert.deepEqual(metadata, {
    status: { savedAt: '2026-07-30T00:00:00.000Z', editorName: 'BONNIE' },
    highlights: { savedAt: '2026-08-01T08:00:00.000Z', editorName: 'AUGUS.LIANG' }
  });
});

test('closed request and project schemas reject forged or unknown fields', () => {
  assert.doesNotThrow(() => assertAllowedKeys({ weekId: 'W1' }, ['weekId'], 'request'));
  assert.equal(reasonFrom(() => assertAllowedKeys({ weekId: 'W1', role: 'admin' }, ['weekId'], 'request')), 'invalid-payload');

  const week = { projects: [project], version: 1, isReleased: false };
  const expectedRevision = projectRevisionFingerprint(project);
  for (const extra of ['role', 'email', 'editorName', 'savedAt', 'projects']) {
    assert.equal(reasonFrom(() => buildProjectPatch(week, {
      weekId: 'W1', originalCode: 'ALPHA', projectCode: 'ALPHA',
      project: { name: 'Alpha', code: 'ALPHA' }, expectedRevision, [extra]: 'forged',
    }, actor, '2026-08-18T00:00:00.000Z')), 'invalid-payload', extra);
  }
  assert.equal(reasonFrom(() => buildProjectPatch(week, {
    weekId: 'W1', originalCode: 'ALPHA', projectCode: 'ALPHA',
    project: { name: 'Alpha', code: 'ALPHA', sectionUpdatedAt: {} }, expectedRevision,
  }, actor, '2026-08-18T00:00:00.000Z')), 'invalid-payload');
  assert.equal(reasonFrom(() => buildProjectPatch(week, {
    weekId: 'W1', originalCode: 'ALPHA', projectCode: 'ALPHA',
    project: { name: 'Alpha', code: 'ALPHA', unexpected: true }, expectedRevision,
  }, actor, '2026-08-18T00:00:00.000Z')), 'invalid-payload');
});

test('bounded JSON rejects oversized, deep, numerous, unsafe, and non-JSON values', () => {
  assert.doesNotThrow(() => assertBoundedJson({ ok: ['value', 1, true, null] }));
  assert.equal(reasonFrom(() => assertBoundedJson({ text: '12345' }, { maxStringLength: 4 })), 'invalid-payload');
  assert.equal(reasonFrom(() => assertBoundedJson({ a: { b: { c: 1 } } }, { maxDepth: 2 })), 'invalid-payload');
  assert.equal(reasonFrom(() => assertBoundedJson([1, 2, 3], { maxArrayEntries: 2 })), 'invalid-payload');
  assert.equal(reasonFrom(() => assertBoundedJson({ a: 1, b: 2, c: 3 }, { maxObjectKeys: 2 })), 'invalid-payload');
  assert.equal(reasonFrom(() => assertBoundedJson({ amount: Number.POSITIVE_INFINITY })), 'invalid-payload');
  assert.equal(reasonFrom(() => assertBoundedJson(JSON.parse('{"__proto__":{"polluted":true}}'))), 'invalid-payload');
  assert.equal(reasonFrom(() => assertBoundedJson({ when: new Date('2026-08-18T00:00:00.000Z') })), 'invalid-payload');
  assert.equal(reasonFrom(() => assertBoundedJson({ text: 'x'.repeat(40) }, { maxBytes: 20 })), 'invalid-payload');
});

test('existing saves require a live revision and authorize against the pre-edit owner', () => {
  const liveProject = { code: 'ALPHA', name: 'Alpha', owner: 'Other' };
  const ownedProject = { ...liveProject, owner: 'Augus Liang' };
  const week = { projects: [liveProject], version: 1, isReleased: false };
  const ownedWeek = { ...week, projects: [ownedProject] };
  const draft = { code: 'ALPHA', name: 'Alpha changed', owner: 'Augus Liang' };

  assert.equal(reasonFrom(() => buildProjectPatch(ownedWeek, {
    weekId: 'W1', originalCode: 'ALPHA', projectCode: 'ALPHA', project: draft,
  }, actor, '2026-08-18T00:00:00.000Z')), 'conflict');
  assert.equal(reasonFrom(() => buildProjectPatch(ownedWeek, {
    weekId: 'W1', originalCode: 'ALPHA', projectCode: 'ALPHA', project: draft,
    expectedRevision: 'stale',
  }, actor, '2026-08-18T00:00:00.000Z')), 'conflict');
  assert.equal(reasonFrom(() => buildProjectPatch(week, {
    weekId: 'W1', originalCode: 'ALPHA', projectCode: 'ALPHA', project: draft,
    expectedRevision: projectRevisionFingerprint(liveProject),
  }, actor, '2026-08-18T00:00:00.000Z')), 'ownership-forbidden');
});

test('successful project patches use trusted server metadata and return a committed revision', () => {
  const liveProject = {
    code: 'ALPHA', name: 'Alpha', owner: 'Augus Liang', highlight: 'Old',
    sectionUpdatedAt: { status: { savedAt: '2026-08-01T00:00:00.000Z', editorName: 'Bonnie' } },
  };
  const week = { projects: [liveProject], version: 4, isReleased: false };
  const result = buildProjectPatch(week, {
    weekId: 'W1', originalCode: 'ALPHA', projectCode: 'ALPHA',
    project: { code: 'ALPHA', name: 'Alpha', owner: 'Augus Liang', highlight: 'New' },
    expectedRevision: projectRevisionFingerprint(liveProject),
  }, actor, '2026-08-18T02:03:04.000Z');

  assert.equal(result.patch.lastModifiedBy, 'augus@example.com');
  assert.equal(result.patch.version, 5);
  assert.deepEqual(result.committedProject.sectionUpdatedAt.highlights, {
    savedAt: '2026-08-18T02:03:04.000Z', editorName: 'Augus Liang',
  });
  assert.equal(result.revision, projectRevisionFingerprint(result.committedProject));
});

test('large independent text fields can save when only the revision fingerprint exceeds 20k', () => {
  const liveProject = {
    code: 'ALPHA', owner: 'Augus Liang',
    highlight: 'h'.repeat(11000), weeklyActions: 'w'.repeat(11000),
  };
  const week = { projects: [liveProject], version: 1, isReleased: false };
  const expectedRevision = projectRevisionFingerprint(liveProject);
  assert.ok(expectedRevision.length > 20000);
  const request = {
    weekId: 'W1', originalCode: 'ALPHA', projectCode: 'ALPHA',
    project: { ...liveProject }, expectedRevision,
  };
  assert.doesNotThrow(() => buildProjectPatch(week, request, actor, '2026-09-10T00:00:00Z'));
  assert.equal(reasonFrom(() => buildProjectPatch(
    week, { ...request, expectedRevision: 'stale' }, actor, '2026-09-10T00:00:00Z',
  )), 'conflict');
});

test('budget audit fields are preserved while deleted rows stay deleted', () => {
  const liveProject = {
    code: 'ALPHA', owner: 'Augus Liang',
    budget: {
      mode: 'manual', currency: 'USD', approvedBy: 'finance@example.com',
      monthlyPlans: [
        { id: 'keep', month: '2026-09', categoryName: 'Hardware', amount: 10, auditNote: 'reviewed' },
        { id: 'remove', month: '2026-10', categoryName: 'Travel', amount: 20, auditNote: 'remove me' },
      ],
      actuals: [],
    },
  };
  const week = { projects: [liveProject], version: 1, isReleased: false };
  const result = buildProjectPatch(week, {
    weekId: 'W1', originalCode: 'ALPHA', projectCode: 'ALPHA',
    project: {
      ...liveProject,
      budget: {
        ...liveProject.budget,
        monthlyPlans: [liveProject.budget.monthlyPlans[0]],
      },
    },
    expectedRevision: projectRevisionFingerprint(liveProject),
  }, actor, '2026-09-10T00:00:00Z');
  assert.equal(result.committedProject.budget.approvedBy, 'finance@example.com');
  assert.deepEqual(result.committedProject.budget.monthlyPlans, [liveProject.budget.monthlyPlans[0]]);
});

test('week field saves are closed and week creation accepts only server-side carryover input', () => {
  const admin = { ...actor, role: 'admin', email: 'admin@example.com', displayName: 'Admin' };
  assert.deepEqual(buildWeekFieldsPatch({ version: 2, isReleased: false }, {
    weekId: 'W2', fields: { summary: 'Safe', strategyLayer: { projectMap: {} } },
  }, admin), {
    summary: 'Safe', strategyLayer: { projectMap: {} }, lastModifiedBy: 'admin@example.com', version: 3,
  });
  assert.equal(reasonFrom(() => buildWeekFieldsPatch({ version: 2 }, {
    weekId: 'W2', fields: { isReleased: true },
  }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildWeekFieldsPatch({ version: 2 }, {
    weekId: 'W2', fields: {},
  }, admin)), 'invalid-payload');

  const sourceWeek = {
    projects: [
      { code: 'ACTIVE', visibility: 'active' },
      { code: 'LEGACY' },
      { code: 'ARCHIVED', visibility: 'archived' },
    ],
    strategyLayer: { projectMap: { ACTIVE: { checkpoint: 'Q1' } } },
  };
  const created = buildCreatedWeek({
    weekId: 'W33-2026', weekLabel: 'W33 2026', weekDate: 'Aug 10 - Aug 14', sourceWeekId: 'W32-2026',
  }, admin, sourceWeek);
  assert.deepEqual(created.projects.map(item => item.code), ['ACTIVE', 'LEGACY']);
  assert.deepEqual(created.strategyLayer, sourceWeek.strategyLayer);
  assert.equal(created.isReleased, false);
  assert.equal(created.lastModifiedBy, 'admin@example.com');
  assert.equal(created.version, 0);
  assert.equal(reasonFrom(() => buildCreatedWeek({
    weekId: 'W33-2026', weekLabel: 'W33 2026', weekDate: 'Aug 10 - Aug 14', week: sourceWeek,
  }, admin, sourceWeek)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildCreatedWeek({
    weekId: 'W33-2026', weekLabel: 'W33 2026', weekDate: 'Aug 10 - Aug 14', projects: [],
  }, admin, sourceWeek)), 'invalid-payload');
});
