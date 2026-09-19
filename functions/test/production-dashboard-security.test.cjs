const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildGanttTemplateSettingsPatch,
  buildGanttWindowSettingsPatch,
  projectRevisionFingerprint,
} = require('../project-dashboard-writes');

function reasonFrom(callback) {
  try {
    callback();
  } catch (error) {
    return error?.details?.reason;
  }
  assert.fail('Expected the operation to throw.');
}

test('Gantt defaults accept only Admin and require the live revision', () => {
  const live = { revision: 4, system: ['Discovery'], 'hardware-module': ['Design'] };
  const config = { system: ['Plan', 'Build'], 'hardware-module': ['Design', 'Validate'] };
  const admin = { uid: 'admin-1', email: 'admin@example.com', role: 'admin', displayName: 'Admin' };

  assert.deepEqual(
    buildGanttTemplateSettingsPatch(live, { expectedRevision: 4, config }, admin),
    {
      system: ['Plan', 'Build'],
      'hardware-module': ['Design', 'Validate'],
      revision: 5,
      updatedBy: 'admin@example.com',
    },
  );
  assert.equal(
    reasonFrom(() => buildGanttTemplateSettingsPatch(live, { expectedRevision: 3, config }, admin)),
    'conflict',
  );
  assert.equal(
    reasonFrom(() => buildGanttTemplateSettingsPatch(live, { expectedRevision: 4, config }, { ...admin, role: 'pm' })),
    'role-forbidden',
  );
});

test('Gantt defaults reject malformed or oversized templates', () => {
  const admin = { uid: 'admin-1', email: 'admin@example.com', role: 'admin', displayName: 'Admin' };
  const valid = { expectedRevision: 0, config: { system: ['Plan'], 'hardware-module': ['Design'] } };

  assert.equal(reasonFrom(() => buildGanttTemplateSettingsPatch({}, { ...valid, forgedRole: 'admin' }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttTemplateSettingsPatch({}, { ...valid, config: { ...valid.config, system: [] } }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttTemplateSettingsPatch({}, {
    ...valid,
    config: { ...valid.config, system: Array.from({ length: 21 }, (_, index) => `Row ${index}`) },
  }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttTemplateSettingsPatch({}, {
    ...valid,
    config: { ...valid.config, system: ['Duplicate', ' duplicate '] },
  }, admin)), 'invalid-payload');
  assert.equal(projectRevisionFingerprint({ stable: true }), '{"stable":true}');
});

test('Gantt window settings accept only Admin and require the live revision', () => {
  const live = { ganttWindowRevision: 2, ganttWindowDefaultMonths: 6, ganttWindowOverrides: {} };
  const admin = { uid: 'admin-1', email: 'admin@example.com', role: 'admin', displayName: 'Admin' };
  const patch = { expectedRevision: 2, defaultMonths: 9, overrides: { 'EGP-014': 12 } };

  assert.deepEqual(
    buildGanttWindowSettingsPatch(live, patch, admin),
    {
      ganttWindowDefaultMonths: 9,
      ganttWindowOverrides: { 'EGP-014': 12 },
      ganttWindowRevision: 3,
      ganttWindowUpdatedBy: 'admin@example.com',
    },
  );
  assert.equal(
    reasonFrom(() => buildGanttWindowSettingsPatch(live, { ...patch, expectedRevision: 1 }, admin)),
    'conflict',
  );
  assert.equal(
    reasonFrom(() => buildGanttWindowSettingsPatch(live, patch, { ...admin, role: 'pm' })),
    'role-forbidden',
  );
});

test('Gantt window settings reject malformed or out-of-range values', () => {
  const admin = { uid: 'admin-1', email: 'admin@example.com', role: 'admin', displayName: 'Admin' };
  const valid = { expectedRevision: 0, defaultMonths: 6, overrides: {} };

  assert.equal(reasonFrom(() => buildGanttWindowSettingsPatch({}, { ...valid, forgedRole: 'admin' }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttWindowSettingsPatch({}, { ...valid, defaultMonths: 0 }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttWindowSettingsPatch({}, { ...valid, defaultMonths: 37 }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttWindowSettingsPatch({}, { ...valid, defaultMonths: 1.5 }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttWindowSettingsPatch({}, { ...valid, overrides: ['EGP-014'] }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttWindowSettingsPatch({}, { ...valid, overrides: { 'EGP-014': 0 } }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttWindowSettingsPatch({}, { ...valid, overrides: { '': 6 } }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttWindowSettingsPatch({}, {
    ...valid,
    overrides: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`CODE-${index}`, 6])),
  }, admin)), 'invalid-payload');

  assert.deepEqual(
    buildGanttWindowSettingsPatch({}, { ...valid, overrides: null }, admin),
    {
      ganttWindowDefaultMonths: 6,
      ganttWindowOverrides: {},
      ganttWindowRevision: 1,
      ganttWindowUpdatedBy: 'admin@example.com',
    },
  );
});
