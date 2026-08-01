import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  applyProjectAttentionUpdate,
  applyProjectDelete,
  applyProjectSave,
  ensureStableEditorRowId,
  mergePreservingUnknown,
  projectRevisionFingerprint,
  withProjectEditorRowIds,
} from '../team-2/js/project-mutations.mjs';

const dashboard = await readFile(
  new URL('../team-2/index.html', import.meta.url),
  'utf8',
);

test('attention update preserves nested project data and changes only the target', () => {
  const week = {
    isReleased: false,
    projects: [
      { code: 'SYS-1', owner: 'Bonnie', attention: 'watch', nested: { keep: true } },
      { code: 'SYS-2', attention: 'monitor' },
    ],
  };
  const result = applyProjectAttentionUpdate(week, {
    projectCode: 'SYS-1',
    attention: 'action',
    role: 'pm',
    canEdit: project => project.owner === 'Bonnie',
    lastModifiedBy: 'bonnie@example.com',
  });

  assert.equal(result.project.attention, 'action');
  assert.equal(result.project.attentionManual, true);
  assert.deepEqual(result.project.nested, { keep: true });
  assert.equal(result.week.projects[1], week.projects[1]);
  assert.equal(week.projects[0].attention, 'watch');
});

test('attention update rejects released weeks, invalid values, and unauthorized users', () => {
  const base = { projects: [{ code: 'SYS-1', owner: 'Bonnie', attention: 'watch' }] };
  assert.throws(
    () => applyProjectAttentionUpdate({ ...base, isReleased: true }, {
      projectCode: 'SYS-1', attention: 'action', role: 'admin',
    }),
    error => error.code === 'released-week',
  );
  assert.throws(
    () => applyProjectAttentionUpdate(base, {
      projectCode: 'SYS-1', attention: 'invalid', role: 'admin',
    }),
    error => error.code === 'invalid-attention',
  );
  assert.throws(
    () => applyProjectAttentionUpdate(base, {
      projectCode: 'SYS-1', attention: 'action', role: 'vip',
    }),
    error => error.code === 'edit-forbidden',
  );
});

test('editing merges only the live target and preserves concurrent projects and unknown fields', () => {
  const concurrentProject = { code: 'LIVE-2', name: 'Added concurrently', custom: 42 };
  const liveWeek = {
    weekLabel: '2026 Week 27',
    unknownWeekField: { keep: true },
    projects: [
      { code: 'LIVE-1', name: 'Original', owner: 'PM One', unknownProjectField: 'keep' },
      concurrentProject,
    ],
  };

  const result = applyProjectSave(liveWeek, {
    originalCode: 'LIVE-1',
    draft: { code: ' renamed-1 ', name: ' Renamed ', status: 'yellow' },
    isNew: false,
    role: 'pm',
    canEdit: project => project.owner === 'PM One',
    lastModifiedBy: 'pm.one@example.com',
  });

  assert.deepEqual(result.week.unknownWeekField, { keep: true });
  assert.equal(result.week.projects[1], concurrentProject);
  assert.deepEqual(result.project, {
    code: 'renamed-1',
    name: 'Renamed',
    owner: 'PM One',
    unknownProjectField: 'keep',
    status: 'yellow',
  });
  assert.equal(result.week.lastModifiedBy, 'pm.one@example.com');
  assert.deepEqual(liveWeek.projects[0], {
    code: 'LIVE-1',
    name: 'Original',
    owner: 'PM One',
    unknownProjectField: 'keep',
  });
});

test('project saves update metadata only for sections whose content changed', () => {
  const liveWeek = {
    projects: [{
      code: 'META-1',
      name: 'Metadata project',
      owner: 'PM One',
      status: 'green',
      highlight: 'Existing highlight',
      weeklyActions: 'Keep moving',
      sectionUpdatedAt: {
        status: { savedAt: '2026-07-30T00:00:00.000Z', editorName: 'BONNIE' },
        highlights: { savedAt: '2026-07-29T00:00:00.000Z', editorName: 'BONNIE' },
      },
    }],
  };

  const result = applyProjectSave(liveWeek, {
    originalCode: 'META-1',
    isNew: false,
    role: 'admin',
    canEdit: () => true,
    lastModifiedBy: 'admin@example.com',
    editorName: 'AUGUS.LIANG',
    savedAt: '2026-08-01T08:00:00.000Z',
    draft: {
      code: 'META-1',
      name: 'Metadata project',
      owner: 'PM One',
      status: 'green',
      highlight: 'Updated highlight',
      weeklyActions: 'Keep moving',
    },
  });

  assert.deepEqual(result.project.sectionUpdatedAt, {
    status: { savedAt: '2026-07-30T00:00:00.000Z', editorName: 'BONNIE' },
    highlights: { savedAt: '2026-08-01T08:00:00.000Z', editorName: 'AUGUS.LIANG' },
  });
});

test('save rejects blank trimmed names and codes', () => {
  const liveWeek = { projects: [] };
  const options = {
    isNew: true,
    role: 'admin',
    canEdit: () => true,
    lastModifiedBy: 'admin@example.com',
  };

  assert.throws(
    () => applyProjectSave(liveWeek, { ...options, draft: { name: '   ', code: 'P-1' } }),
    /project name is required/i,
  );
  assert.throws(
    () => applyProjectSave(liveWeek, { ...options, draft: { name: 'Project', code: '\t' } }),
    /project code is required/i,
  );
});

test('save enforces case-insensitive live code uniqueness but excludes the edited target', () => {
  const liveWeek = {
    projects: [
      { code: 'ALPHA', name: 'Alpha', owner: 'PM One' },
      { code: 'BETA', name: 'Beta', owner: 'PM One' },
    ],
  };
  const options = {
    originalCode: 'ALPHA',
    isNew: false,
    role: 'pm',
    canEdit: () => true,
    lastModifiedBy: 'pm.one@example.com',
  };

  const unchanged = applyProjectSave(liveWeek, {
    ...options,
    draft: { code: ' alpha ', name: 'Alpha renamed' },
  });
  assert.equal(unchanged.project.code, 'alpha');

  assert.throws(
    () => applyProjectSave(liveWeek, {
      ...options,
      draft: { code: ' beta ', name: 'Duplicate' },
    }),
    /already exists/i,
  );
});

test('edit and delete require the exact original live code', () => {
  const liveWeek = { projects: [{ code: 'CASE-1', name: 'Case', owner: 'PM One' }] };

  assert.throws(
    () => applyProjectSave(liveWeek, {
      originalCode: 'case-1',
      draft: { code: 'CASE-1', name: 'Case' },
      isNew: false,
      role: 'pm',
      canEdit: () => true,
      lastModifiedBy: 'pm.one@example.com',
    }),
    /no longer exists/i,
  );
  assert.throws(
    () => applyProjectDelete(liveWeek, {
      originalCode: 'case-1',
      role: 'admin',
      lastModifiedBy: 'admin@example.com',
    }),
    /no longer exists/i,
  );
});

test('authorization is checked against the live target and creation/deletion are admin-only', () => {
  const liveTarget = { code: 'OWNED', name: 'Owned', owner: 'New Owner' };
  const liveWeek = { projects: [liveTarget] };
  let authorizedProject = null;

  assert.throws(
    () => applyProjectSave(liveWeek, {
      originalCode: 'OWNED',
      draft: { code: 'OWNED', name: 'Changed' },
      isNew: false,
      role: 'pm',
      canEdit: project => {
        authorizedProject = project;
        return false;
      },
      lastModifiedBy: 'old.owner@example.com',
    }),
    /permission/i,
  );
  assert.equal(authorizedProject, liveTarget);

  assert.throws(
    () => applyProjectSave({ projects: [] }, {
      draft: { code: 'NEW', name: 'New' },
      isNew: true,
      role: 'pm',
      canEdit: () => true,
      lastModifiedBy: 'pm@example.com',
    }),
    /administrators/i,
  );
  assert.throws(
    () => applyProjectDelete(liveWeek, {
      originalCode: 'OWNED',
      role: 'pm',
      lastModifiedBy: 'pm@example.com',
    }),
    /administrators/i,
  );
});

test('delete removes only the exact live target and preserves concurrent week data', () => {
  const retained = { code: 'KEEP', name: 'Concurrent', custom: true };
  const liveWeek = {
    customWeekField: 'keep',
    projects: [{ code: 'DELETE', name: 'Delete me' }, retained],
  };

  const result = applyProjectDelete(liveWeek, {
    originalCode: 'DELETE',
    role: 'admin',
    lastModifiedBy: 'admin@example.com',
  });

  assert.equal(result.week.customWeekField, 'keep');
  assert.deepEqual(result.week.projects, [retained]);
  assert.equal(result.deletedProject.code, 'DELETE');
  assert.equal(liveWeek.projects.length, 2);
});

test('recursive merge preserves unknown nested fields while honoring deliberate array removals', () => {
  const liveProject = {
    code: 'NESTED',
    name: 'Nested',
    budget: {
      mode: 'manual',
      unknownBudgetField: 'keep',
      monthlyPlans: [
        { id: 'plan-1', amount: 10, unknownPlanField: 'keep' },
        { id: 'plan-2', amount: 15, unknownPlanField: 'follow-reorder' },
        { id: 'plan-removed', amount: 20, unknownPlanField: 'remove-with-row' },
      ],
    },
    dataStatus: {
      team: { state: 'draft', unknownTeamStatus: 'keep' },
      unknownDataStatus: 'keep',
    },
    teamMembers: [
      { id: 'team-1', name: 'Alice', role: 'Engineer', directoryId: 'keep' },
      { id: 'team-removed', name: 'Removed', role: 'Engineer', directoryId: 'remove-with-row' },
    ],
    milestones: [
      { planId: 'milestone-1', name: 'Gate', status: 'to-do', unknownMilestone: 'keep' },
      { planId: 'milestone-removed', name: 'Removed gate', unknownMilestone: 'remove-with-row' },
    ],
  };
  const draft = {
    code: 'NESTED',
    name: 'Nested edited',
    budget: {
      mode: 'auto',
      monthlyPlans: [
        { id: 'plan-2', amount: 25 },
        { id: 'plan-1', amount: 15 },
      ],
    },
    dataStatus: {
      team: { state: 'confirmed' },
    },
    teamMembers: [{ id: 'team-1', name: 'Alice', role: 'Lead' }],
    milestones: [{ planId: 'milestone-1', name: 'Gate renamed', status: 'done' }],
  };

  const merged = mergePreservingUnknown(liveProject, draft);

  assert.equal(merged.budget.unknownBudgetField, 'keep');
  assert.equal(merged.budget.monthlyPlans.length, 2);
  assert.equal(merged.budget.monthlyPlans[0].unknownPlanField, 'follow-reorder');
  assert.equal(merged.budget.monthlyPlans[1].unknownPlanField, 'keep');
  assert.equal(merged.dataStatus.unknownDataStatus, 'keep');
  assert.equal(merged.dataStatus.team.unknownTeamStatus, 'keep');
  assert.equal(merged.teamMembers.length, 1);
  assert.equal(merged.teamMembers[0].directoryId, 'keep');
  assert.equal(merged.milestones.length, 1);
  assert.equal(merged.milestones[0].unknownMilestone, 'keep');
});

test('canonical project fingerprints ignore object key order and reject concurrent nested edits', () => {
  const original = {
    code: 'CONFLICT',
    name: 'Conflict',
    budget: { currency: 'USD', totalEstimated: 10 },
  };
  assert.equal(
    projectRevisionFingerprint(original),
    projectRevisionFingerprint({
      budget: { totalEstimated: 10, currency: 'USD' },
      name: 'Conflict',
      code: 'CONFLICT',
    }),
  );

  const concurrentlyChanged = {
    ...original,
    budget: { ...original.budget, totalEstimated: 11 },
  };
  assert.throws(
    () => applyProjectSave({ projects: [concurrentlyChanged] }, {
      originalCode: 'CONFLICT',
      draft: { code: 'CONFLICT', name: 'My draft' },
      isNew: false,
      role: 'admin',
      expectedFingerprint: projectRevisionFingerprint(original),
      lastModifiedBy: 'admin@example.com',
    }),
    /changed since.*reopen/i,
  );
  assert.throws(
    () => applyProjectDelete({ projects: [concurrentlyChanged] }, {
      originalCode: 'CONFLICT',
      role: 'admin',
      expectedFingerprint: projectRevisionFingerprint(original),
      lastModifiedBy: 'admin@example.com',
    }),
    /changed since.*reopen/i,
  );
});

test('stable row IDs prevent deleted budget, QMS, and risk metadata from moving by index', () => {
  const live = {
    budget: {
      monthlyPlans: [
        { id: 'plan-1', amount: 10, externalRef: 'deleted-plan' },
        { id: 'plan-2', amount: 20, externalRef: 'kept-plan' },
      ],
    },
    quarterlyMilestones: [
      { id: 'qms-1', goal: 'Delete', externalRef: 'deleted-qms' },
      { id: 'qms-2', goal: 'Keep', externalRef: 'kept-qms' },
    ],
    riskActions: [
      { id: 'risk-1', risk: 'Delete', externalRef: 'deleted-risk' },
      { id: 'risk-2', risk: 'Keep', externalRef: 'kept-risk' },
    ],
  };
  const draft = {
    budget: { monthlyPlans: [{ id: 'plan-2', amount: 25 }] },
    quarterlyMilestones: [{ id: 'qms-2', goal: 'Keep edited' }],
    riskActions: [{ id: 'risk-2', risk: 'Keep edited' }],
  };

  const merged = mergePreservingUnknown(live, draft);

  assert.deepEqual(merged.budget.monthlyPlans.map(row => row.externalRef), ['kept-plan']);
  assert.deepEqual(merged.quarterlyMilestones.map(row => row.externalRef), ['kept-qms']);
  assert.deepEqual(merged.riskActions.map(row => row.externalRef), ['kept-risk']);
});

test('renaming a team member preserves metadata by ID and legacy row IDs are deterministic', () => {
  const legacy = { name: 'Legacy member', roleName: 'Engineer', directoryRef: 'keep' };
  const firstId = ensureStableEditorRowId(legacy, 'team', 0);
  const secondId = ensureStableEditorRowId(legacy, 'team', 0);
  assert.equal(firstId, secondId);
  assert.match(firstId, /^team-legacy-/);

  const identified = withProjectEditorRowIds({
    teamMembers: [legacy],
    milestones: [{ name: 'Legacy gate', status: 'to-do' }],
    ganttWorkstreams: [{ name: 'Legacy workstream' }],
    budget: { monthlyPlans: [{ month: '2026-07', amount: 10 }], actuals: [] },
  });
  assert.equal(identified.teamMembers[0].id, firstId);
  assert.ok(identified.milestones[0].planId);
  assert.equal(identified.ganttWorkstreams[0].id, 'workstream-1');
  assert.ok(identified.budget.monthlyPlans[0].id);

  const merged = mergePreservingUnknown(identified, {
    teamMembers: [{ id: firstId, name: 'Renamed member', roleName: 'Lead' }],
  });
  assert.equal(merged.teamMembers[0].name, 'Renamed member');
  assert.equal(merged.teamMembers[0].directoryRef, 'keep');
});

test('project save and delete use retryable transactions and commit UI state only after await', () => {
  const saveStart = dashboard.indexOf('window.saveProjEdit = async () =>');
  const deleteStart = dashboard.indexOf('window.deleteProject = async () =>');
  const deleteEnd = dashboard.indexOf('window.addMilestoneRow', deleteStart);
  const saveSource = dashboard.slice(saveStart, deleteStart);
  const deleteSource = dashboard.slice(deleteStart, deleteEnd);

  assert.ok(saveStart >= 0 && deleteStart > saveStart && deleteEnd > deleteStart);
  for (const source of [saveSource, deleteSource]) {
    const awaitPosition = source.indexOf('await runTransaction(db, async transaction =>');
    const closePosition = source.indexOf("closeModal('projEditOverlay')");
    assert.ok(awaitPosition >= 0);
    assert.ok(source.indexOf('await transaction.get(targetWeekRef)', awaitPosition) > awaitPosition);
    assert.ok(source.indexOf('transaction.update(targetWeekRef', awaitPosition) > awaitPosition);
    assert.ok(closePosition > awaitPosition);
    assert.doesNotMatch(source, /setDoc\s*\(/);
    assert.doesNotMatch(source, /maxAttempts/);
    assert.match(source, /finally\s*\{[\s\S]*hideLoader\(\)/);
    assert.ok(source.includes('showProjectMutationError('));
  }

  assert.match(dashboard, /id="pe_btn_save"[^>]+onclick="saveProjEdit\(\)"/);
  assert.match(dashboard, /id="pe_btn_delete"[^>]+onclick="deleteProject\(\)"/);
  assert.ok(dashboard.includes('let projectMutationInFlight = false;'));
  assert.ok(dashboard.includes('function setProjectMutationControlsDisabled(disabled)'));
  assert.ok(saveSource.includes('if (projectMutationInFlight) return;'));
  assert.ok(deleteSource.includes('if (projectMutationInFlight) return;'));
  assert.doesNotMatch(
    saveSource.slice(0, saveSource.indexOf('await runTransaction')),
    /week\.projects\.(?:push|splice)|week\.projects\[[^\]]+\]\s*=/,
  );
  assert.doesNotMatch(
    deleteSource.slice(0, deleteSource.indexOf('await runTransaction')),
    /week\.projects\.(?:push|splice)|week\.projects\[[^\]]+\]\s*=/,
  );
});

test('project editor pins week and identity session and stale completions cannot close a newer modal', () => {
  const saveStart = dashboard.indexOf('window.saveProjEdit = async () =>');
  const deleteStart = dashboard.indexOf('window.deleteProject = async () =>');
  const deleteEnd = dashboard.indexOf('window.addMilestoneRow', deleteStart);
  const saveSource = dashboard.slice(saveStart, deleteStart);
  const deleteSource = dashboard.slice(deleteStart, deleteEnd);
  const authStart = dashboard.indexOf('window.handleLogout = async () =>');
  const authEnd = dashboard.indexOf('function getUserDisplayName', authStart);
  const authSource = dashboard.slice(authStart, authEnd);

  assert.ok(dashboard.includes('let projectEditorSession = null;'));
  assert.ok(dashboard.includes('projectEditorSession = Object.freeze({'));
  assert.ok(dashboard.includes('weekId: week.__documentId ||'));
  assert.ok(dashboard.includes('revisionFingerprint: projectRevisionFingerprint(existingProject)'));
  assert.ok(dashboard.includes("Object.defineProperty(normalizedWeek, '__documentId'"));
  assert.ok(dashboard.includes('session.authUid === (currentUser?.uid ||'));
  assert.ok(dashboard.includes('session.authEmail === getEmailKey(currentUser)'));
  assert.ok(dashboard.includes('session.role === currentRole'));
  assert.ok(authSource.includes('invalidateProjectEditorSession();'));

  for (const source of [saveSource, deleteSource]) {
    assert.ok(source.includes('const session = projectEditorSession;'));
    assert.ok(source.includes("doc(db, 'weeks', session.weekId)"));
    assert.ok(source.includes('assertProjectEditorSessionCurrent(session);'));
    assert.ok(source.includes('expectedFingerprint: session.revisionFingerprint'));
    assert.doesNotMatch(source, /allWeeks\[currentIdx\]/);
    assert.ok(source.includes('if (!isProjectEditorSessionCurrent(session)) return;'));
    assert.ok(
      source.indexOf('if (!isProjectEditorSessionCurrent(session)) return;')
        < source.indexOf("closeModal('projEditOverlay')"),
    );
  }
  assert.doesNotMatch(dashboard, /function applyCommittedWeek|applyCommittedWeek\(/);
});

test('editable project row renderers and collectors persist stable DOM identities', () => {
  for (const datasetName of [
    'riskActionId',
    'teamMemberId',
    'budgetRowId',
    'quarterlyMilestoneId',
    'planId',
    'workstreamId',
  ]) {
    assert.ok(dashboard.includes(`dataset.${datasetName}`), `missing dataset.${datasetName}`);
  }

  const riskCollector = dashboard.slice(
    dashboard.indexOf('function collectRiskActionPairs()'),
    dashboard.indexOf('function collectMilestonesWithHistory'),
  );
  const teamCollector = dashboard.slice(
    dashboard.indexOf('function collectTeamMembers()'),
    dashboard.indexOf('function getSelectedBudgetMode()'),
  );
  const saveSource = dashboard.slice(
    dashboard.indexOf('window.saveProjEdit = async () =>'),
    dashboard.indexOf('window.deleteProject = async () =>'),
  );
  assert.ok(riskCollector.includes('id: row.dataset.riskActionId'));
  assert.ok(teamCollector.includes('id: row.dataset.teamMemberId'));
  assert.ok(teamCollector.includes('id: row.dataset.budgetRowId'));
  assert.ok(saveSource.includes('id: div.dataset.quarterlyMilestoneId'));
  assert.ok(dashboard.includes('p = withProjectEditorRowIds(p);'));
  assert.ok(dashboard.includes('newEditorRowId('));
});
