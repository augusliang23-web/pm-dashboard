import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportDataError, loadAuthorizedReport } from '../src/report-data.js';
import { ReportAccessError } from '../src/report-access.js';
import { invalidSummaryCases } from '../../tests/weekly-summary-contract-fixtures.mjs';

const adapters = {
  verifyIdToken: async token => ({ email: token }),
  getUserByEmail: async email => ({ role: email.startsWith('owner') ? 'executive' : 'pm' }),
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
    idToken: 'sales@example.com',
    adapters: {
      ...adapters,
      getUserByEmail: async () => ({ role: 'sales' })
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

test('does not read update-history collections for a historical week PDF', async () => {
  let historyCalls = 0;
  await loadAuthorizedReport({
    request: { mode: 'overview', weekId: 'W28', sections: ['executive-milestones'] },
    idToken: 'pm@example.com',
    adapters: { ...adapters, getExecutiveMilestoneUpdates: async () => { historyCalls += 1; return []; } },
  });
  assert.equal(historyCalls, 0);
});

test('uses the Executive milestone snapshot captured at release for a released overview PDF', async () => {
  let liveReads = 0;
  const snapshotTimeline = { title: 'Released Executive timeline', rows: [] };
  const report = await loadAuthorizedReport({
    request: { mode: 'overview', weekId: 'W28', sections: ['executive-milestones'] },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({
        weekLabel: 'W28 2026',
        isReleased: true,
        projects: [],
        strategyLayer: {
          executiveMilestoneTimeline: { title: 'Legacy timeline', rows: [] },
          executiveMilestoneTimelineSnapshot: { timeline: snapshotTimeline }
        }
      }),
      getLiveExecutiveTimeline: async () => { liveReads += 1; return { timeline: { title: 'Live timeline', rows: [] } }; }
    }
  });

  assert.equal(report.week.strategyLayer.executiveMilestoneTimeline.title, 'Released Executive timeline');
  assert.equal(liveReads, 0);
});

test('uses the current live Executive timeline for a draft overview PDF', async () => {
  let liveReads = 0;
  const report = await loadAuthorizedReport({
    request: { mode: 'overview', weekId: 'W30', sections: ['executive-milestones'] },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({
        weekLabel: 'W30 2026',
        isReleased: false,
        projects: [],
        strategyLayer: { executiveMilestoneTimeline: { title: 'Legacy draft timeline', rows: [] } }
      }),
      getLiveExecutiveTimeline: async () => { liveReads += 1; return { timeline: { title: 'Current live timeline', rows: [] } }; }
    }
  });

  assert.equal(report.week.strategyLayer.executiveMilestoneTimeline.title, 'Current live timeline');
  assert.equal(liveReads, 1);
});

test('rejects an invalid stored Weekly Summary before Executive Summary PDF rendering', async () => {
  const [, invalidSummary] = invalidSummaryCases[0];
  await assert.rejects(
    () => loadAuthorizedReport({
      request: { mode: 'overview', weekId: 'W28', sections: ['executive-summary'] },
      idToken: 'pm@example.com',
      adapters: {
        ...adapters,
        getWeekById: async () => ({
          weekLabel: 'W28 2026',
          summary: invalidSummary,
          projects: [{ code: 'PMS-001', name: 'PMS', visibility: 'active' }]
        })
      }
    }),
    error => error instanceof ReportDataError
      && error.statusCode === 422
      && error.message.startsWith('Weekly Summary is not valid for PDF export:')
  );
});

test('allows a canonical removed-project movement in Executive Summary PDF data', async () => {
  const report = await loadAuthorizedReport({
    request: { mode: 'overview', weekId: 'W28', sections: ['executive-summary'] },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({
        weekLabel: 'W28 2026',
        summary: `WEEKLY MOVEMENT\nPortfolio Summary: One project was released.\n- Project: Released project\n  Movement: Transitioned out of active tracking.\n  Blocker: None\n  Next step: Archive project records.\nMANAGEMENT ASK\nNo immediate management decision required this week.`,
        projects: [{ code: 'PMS-001', name: 'PMS', visibility: 'active' }]
      })
    }
  });
  assert.deepEqual(report.sections, ['executive-summary']);
});

test('rejects malformed Executive Summary structure with a PDF data error', async () => {
  await assert.rejects(
    () => loadAuthorizedReport({
      request: { mode: 'overview', weekId: 'W28', sections: ['executive-summary'] },
      idToken: 'pm@example.com',
      adapters: {
        ...adapters,
        getWeekById: async () => ({
          weekLabel: 'W28 2026',
          summary: 'WEEKLY MOVEMENT\nPortfolio Summary: Broken.\n- Project: Released project\n  Movement: Transitioned.\n  Blocker: None\nMANAGEMENT ASK\nNo immediate management decision required this week.',
          projects: [{ code: 'PMS-001', name: 'PMS', visibility: 'active' }]
        })
      }
    }),
    error => error instanceof ReportDataError && error.statusCode === 422
  );
});

test('does not validate Weekly Summary when Executive Summary is not selected', async () => {
  const [, invalidSummary] = invalidSummaryCases[0];
  const report = await loadAuthorizedReport({
    request: { mode: 'overview', weekId: 'W28', sections: ['health-focus'] },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({
        weekLabel: 'W28 2026',
        summary: invalidSummary,
        projects: [{ code: 'PMS-001', name: 'PMS', visibility: 'active' }]
      })
    }
  });
  assert.deepEqual(report.sections, ['health-focus']);
});
