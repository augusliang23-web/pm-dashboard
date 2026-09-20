const assert = require('node:assert/strict');
const test = require('node:test');

const functions = require('../index');

const expectedServiceAccounts = {
  saveDashboardProject: 'pmdash-save-project@',
  deleteDashboardProject: 'pmdash-delete-project@',
  setDashboardProjectAttention: 'pmdash-project-attn@',
  setDashboardWeekRelease: 'pmdash-week-release@',
  saveDashboardWeekFields: 'pmdash-week-fields@',
  createDashboardWeek: 'pmdash-create-week@',
  saveDashboardGanttTemplateSettings: 'pmdash-gantt-template@',
  saveDashboardGanttWindowSettings: 'pmdash-gantt-window@',
};

test('all eight dashboard handlers are exported with their exact runtime service account', () => {
  for (const [name, serviceAccountEmail] of Object.entries(expectedServiceAccounts)) {
    assert.equal(typeof functions[name], 'function', `${name} must be exported`);
    assert.equal(functions[name].__endpoint.serviceAccountEmail, serviceAccountEmail, `${name} service account`);
  }
});
