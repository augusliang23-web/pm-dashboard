import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportDataError, loadAuthorizedReport } from '../src/report-data.js';
import { ReportAccessError } from '../src/report-access.js';

const adapters = {
  verifyIdToken: async token => ({ email: token }),
  getUserByEmail: async email => ({ role: email.startsWith('vip') ? 'vip' : 'pm' }),
  getWeekById: async () => ({
    weekLabel: 'W28 2026',
    isReleased: true,
    projects: [{ code: 'PMS-001', name: 'PMS', teamMembers: [] }]
  })
};

test('loads report content from Firestore adapters rather than request input', async () => {
  const report = await loadAuthorizedReport({
    request: { mode: 'project', weekId: 'W28', projectCode: 'PMS-001', sections: ['project-brief', 'team-allocation'] },
    idToken: 'pm@example.com',
    adapters
  });

  assert.equal(report.project.name, 'PMS');
  assert.deepEqual(report.sections, ['project-brief']);
  assert.equal(report.access.email, 'pm@example.com');
});

test('rejects a missing project before rendering', async () => {
  await assert.rejects(
    () => loadAuthorizedReport({
      request: { mode: 'project', weekId: 'W28', projectCode: 'MISSING', sections: ['project-brief'] },
      idToken: 'pm@example.com',
      adapters
    }),
    ReportDataError
  );
});

test('loads no more than six trend weeks only for selected Overview trends', async () => {
  let calls = 0;
  const report = await loadAuthorizedReport({
    request: { mode: 'overview', weekId: 'W28', sections: ['weekly-trend'] },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getTrendWeeks: async () => {
        calls += 1;
        return Array.from({ length: 9 }, (_, index) => ({ weekLabel: `W${index + 20}`, isReleased: true }));
      }
    }
  });

  assert.equal(calls, 1);
  assert.equal(report.trendWeeks.length, 6);
  assert.equal(report.trendWeeks[0].weekLabel, 'W23');
});

test('limits trend history to released weeks for both Executive role vocabularies', async () => {
  for (const role of ['vip', 'executive']) {
    const report = await loadAuthorizedReport({
      request: { mode: 'overview', weekId: 'W28', sections: ['weekly-trend'], projectCodes: ['PMS-001'] },
      idToken: `${role}@example.com`,
      adapters: {
        ...adapters,
        getUserByEmail: async () => ({ role }),
        getTrendWeeks: async () => [
          { weekLabel: 'W26', isReleased: false, projects: [{ code: 'PMS-001' }] },
          { weekLabel: 'W27', isReleased: true, projects: [{ code: 'PMS-001' }] }
        ]
      }
    });
    assert.deepEqual(report.trendWeeks.map(week => week.weekLabel), ['W27'], role);
  }
});

test('does not read trend history when Weekly trends is not selected', async () => {
  let calls = 0;
  const report = await loadAuthorizedReport({
    request: { mode: 'overview', weekId: 'W28', sections: ['health-focus'] },
    idToken: 'pm@example.com',
    adapters: { ...adapters, getTrendWeeks: async () => { calls += 1; return []; } }
  });

  assert.equal(calls, 0);
  assert.deepEqual(report.trendWeeks, []);
});

test('uses ganttWorkstreams when deciding whether a Gantt section is reportable', async () => {
  const report = await loadAuthorizedReport({
    request: { mode: 'project', weekId: 'W28', projectCode: 'PMS-001', sections: ['gantt'] },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({
        weekLabel: 'W28 2026', isReleased: true,
        projects: [{ code: 'PMS-001', ganttWorkstreams: [{ name: 'Build' }] }]
      })
    }
  });

  assert.deepEqual(report.sections, ['gantt']);
});

test('propagates the authorized Executive milestone audience view', async () => {
  const report = await loadAuthorizedReport({
    request: {
      mode: 'overview',
      weekId: 'W28',
      sections: ['executive-milestones'],
      executiveAudienceView: 'business-product'
    },
    idToken: 'business@example.com',
    adapters: {
      ...adapters,
      getUserByEmail: async () => ({ role: 'business' })
    }
  });

  assert.equal(report.executiveAudienceView, 'business-product');
});

test('rejects an unknown stored role instead of widening Executive milestone access', async () => {
  await assert.rejects(() => loadAuthorizedReport({
    request: { mode: 'overview', weekId: 'W28', sections: ['executive-milestones'] },
    idToken: 'unknown@example.com',
    adapters: { ...adapters, getUserByEmail: async () => ({ role: 'unknown-role' }) }
  }), ReportAccessError);
});

test('filters current and trend weeks to selected Overview project codes', async () => {
  const report = await loadAuthorizedReport({
    request: { mode: 'overview', weekId: 'W28', sections: ['weekly-trend'], projectCodes: ['PMS-001'] },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({ projects: [{ code: 'PMS-001' }, { code: 'MOD-002' }] }),
      getTrendWeeks: async () => [{ projects: [{ code: 'PMS-001' }, { code: 'MOD-002' }] }]
    }
  });

  assert.deepEqual(report.week.projects.map(project => project.code), ['PMS-001']);
  assert.deepEqual(report.trendWeeks[0].projects.map(project => project.code), ['PMS-001']);
  assert.equal(report.availableProjectCount, 2);
});

test('derives partial selection from trusted matching projects instead of requested code count', async () => {
  const report = await loadAuthorizedReport({
    request: {
      mode: 'overview', weekId: 'W28', sections: ['executive-milestones'],
      overviewScope: 'all', projectCodes: ['PMS-001', 'STALE-999']
    },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({
        isReleased: true,
        projects: [
          { code: 'PMS-001', projectLevel: 'system', visibility: 'active' },
          { code: 'MOD-002', projectLevel: 'hardware-module', visibility: 'active' }
        ]
      })
    }
  });

  assert.equal(report.selectedProjectCount, 1);
  assert.equal(report.availableProjectCount, 2);
  assert.equal(report.projectSelectionIsPartial, true);
});

test('treats all reportable projects in the requested scope as a complete selection', async () => {
  const report = await loadAuthorizedReport({
    request: {
      mode: 'overview', weekId: 'W28', sections: ['executive-milestones'],
      overviewScope: 'hardware-module', projectCodes: ['MOD-002']
    },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({
        isReleased: true,
        projects: [
          { code: 'PMS-001', projectLevel: 'system', visibility: 'active' },
          { code: 'MOD-002', projectLevel: 'hardware-module', visibility: 'active' },
          { code: 'MOD-ARCHIVED', projectLevel: 'hardware-module', visibility: 'archived' }
        ]
      })
    }
  });

  assert.equal(report.selectedProjectCount, 1);
  assert.equal(report.availableProjectCount, 1);
  assert.equal(report.projectSelectionIsPartial, false);
});
