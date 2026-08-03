import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportDataError, loadAuthorizedReport } from '../src/report-data.js';

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

test('defaults an unknown stored role to the Everyone Executive milestone view', async () => {
  const report = await loadAuthorizedReport({
    request: { mode: 'overview', weekId: 'W28', sections: ['executive-milestones'] },
    idToken: 'unknown@example.com',
    adapters: { ...adapters, getUserByEmail: async () => ({ role: 'unknown-role' }) }
  });

  assert.equal(report.executiveAudienceView, 'everyone');
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
