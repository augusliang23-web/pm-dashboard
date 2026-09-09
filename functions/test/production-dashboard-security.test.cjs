const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildGanttTemplateSettingsPatch,
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
