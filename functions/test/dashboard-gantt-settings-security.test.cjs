const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildGanttTemplateSettingsPatch,
  buildGanttWindowSettingsPatch,
} = require('../project-dashboard-writes');

function reasonFrom(callback) {
  try {
    callback();
  } catch (error) {
    return error?.details?.reason;
  }
  assert.fail('Expected the operation to throw.');
}

const admin = { uid: 'admin-1', email: 'admin@example.test', role: 'admin', displayName: 'Admin' };

test('UAT Gantt template settings require Admin, a live revision, and valid templates', () => {
  assert.equal(typeof buildGanttTemplateSettingsPatch, 'function');
  assert.deepEqual(
    buildGanttTemplateSettingsPatch({ revision: 4 }, {
      expectedRevision: 4,
      config: { system: ['Plan'], 'hardware-module': ['Design'] },
    }, admin),
    { system: ['Plan'], 'hardware-module': ['Design'], revision: 5, updatedBy: 'admin@example.test' },
  );
  assert.equal(reasonFrom(() => buildGanttTemplateSettingsPatch({}, {
    expectedRevision: 0, config: { system: [], 'hardware-module': ['Design'] },
  }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttTemplateSettingsPatch({ revision: 1 }, {
    expectedRevision: 0, config: { system: ['Plan'], 'hardware-module': ['Design'] },
  }, admin)), 'conflict');
  assert.equal(reasonFrom(() => buildGanttTemplateSettingsPatch({}, {
    expectedRevision: 0, config: { system: ['Plan'], 'hardware-module': ['Design'] },
  }, { ...admin, role: 'pm' })), 'role-forbidden');
});

test('Gantt window settings require Admin, a live revision, and bounded values', () => {
  assert.equal(typeof buildGanttWindowSettingsPatch, 'function');
  assert.deepEqual(
    buildGanttWindowSettingsPatch({ ganttWindowRevision: 2 }, {
      expectedRevision: 2, defaultMonths: 9, overrides: { 'EGP-014': 12 },
    }, admin),
    {
      ganttWindowDefaultMonths: 9,
      ganttWindowOverrides: { 'EGP-014': 12 },
      ganttWindowRevision: 3,
      ganttWindowUpdatedBy: 'admin@example.test',
    },
  );
  assert.equal(reasonFrom(() => buildGanttWindowSettingsPatch({}, {
    expectedRevision: 0, defaultMonths: 37, overrides: {},
  }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttWindowSettingsPatch({}, {
    expectedRevision: 0, defaultMonths: 6, overrides: { '': 6 },
  }, admin)), 'invalid-payload');
  assert.equal(reasonFrom(() => buildGanttWindowSettingsPatch({}, {
    expectedRevision: 0, defaultMonths: 6, overrides: {},
  }, { ...admin, role: 'pm' })), 'role-forbidden');
});
