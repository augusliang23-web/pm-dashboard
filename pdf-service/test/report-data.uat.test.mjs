import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportDataError, loadAuthorizedReport } from '../src/report-data.js';
import { ReportAccessError } from '../src/report-access.js';
import { invalidSummaryCases } from '../../tests/weekly-summary-contract-fixtures.mjs';
import { normalizeWeeklySummaryForSave } from '../../js/weekly-summary-contract.mjs';
import { packedHeadingAndAskSummary, packedMissingFieldSummary, packedSummaryContext } from '../../tests/weekly-summary-packed-fixtures.mjs';

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

test('filters current and trend weeks to selected Overview project codes', async () => {
  const report = await loadAuthorizedReport({
    request: {
      mode: 'overview',
      weekId: 'W28',
      sections: ['weekly-trend'],
      projectCodes: ['PMS-001']
    },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({
        weekLabel: 'W28 2026',
        isReleased: true,
        projects: [{ code: 'PMS-001' }, { code: 'MOD-002' }]
      }),
      getTrendWeeks: async () => [{
        weekLabel: 'W27 2026',
        isReleased: true,
        projects: [{ code: 'PMS-001' }, { code: 'MOD-002' }]
      }]
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
  assert.equal(report.projectSelectionApplied, true);
});

test('treats all active cross-scope projects as the complete selectable Overview population', async () => {
  const report = await loadAuthorizedReport({
    request: {
      mode: 'overview', weekId: 'W28', sections: ['executive-milestones'],
      overviewScope: 'all', projectCodes: ['SYS-001', 'MOD-002', 'SW-003']
    },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({
        isReleased: true,
        projects: [
          { code: 'SYS-001', projectLevel: 'system', visibility: 'active' },
          { code: 'MOD-002', projectLevel: 'hardware-module', visibility: 'active' },
          { code: 'SW-003', projectLevel: 'software', visibility: 'active' },
          { code: 'HOLD-004', projectLevel: 'system', visibility: 'on-hold' },
          { code: 'DONE-005', projectLevel: 'software', visibility: 'completed' }
        ]
      })
    }
  });

  assert.deepEqual(report.week.projects.map(project => project.code), ['SYS-001', 'MOD-002', 'SW-003']);
  assert.equal(report.selectedProjectCount, 3);
  assert.equal(report.availableProjectCount, 3);
  assert.equal(report.projectSelectionIsPartial, false);
});

test('rejects non-active project codes from current and trend Overview render data', async () => {
  const report = await loadAuthorizedReport({
    request: {
      mode: 'overview',
      weekId: 'W28',
      sections: ['weekly-trend'],
      overviewScope: 'all',
      projectCodes: ['HOLD-004', 'DONE-005']
    },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({
        weekLabel: 'W28 2026',
        isReleased: true,
        projects: [
          { code: 'ACTIVE-001', visibility: 'active' },
          { code: 'HOLD-004', visibility: 'on-hold' },
          { code: 'DONE-005', visibility: 'completed' }
        ]
      }),
      getTrendWeeks: async () => [{
        weekLabel: 'W27 2026',
        isReleased: true,
        projects: [
          { code: 'ACTIVE-001', visibility: 'active' },
          { code: 'HOLD-004', visibility: 'on-hold' },
          { code: 'DONE-005', visibility: 'completed' }
        ]
      }]
    }
  });

  assert.deepEqual(report.week.projects, []);
  assert.deepEqual(report.trendWeeks[0].projects, []);
  assert.equal(report.selectedProjectCount, 0);
  assert.equal(report.availableProjectCount, 1);
  assert.equal(report.projectSelectionIsPartial, true);
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

test('loads an authorized Overview when the browser has stored repaired canonical text', async () => {
  const repaired = normalizeWeeklySummaryForSave(packedHeadingAndAskSummary, packedSummaryContext);
  assert.equal(repaired.ok, true);
  const report = await loadAuthorizedReport({
    request: { mode: 'overview', weekId: 'W28', sections: ['executive-summary'] },
    idToken: 'pm@example.com',
    adapters: {
      ...adapters,
      getWeekById: async () => ({
        weekLabel: 'W28 2026',
        summary: repaired.canonicalText,
        projects: [{ code: 'PMS-001', name: 'PMS', visibility: 'active' }]
      })
    }
  });
  assert.deepEqual(report.sections, ['executive-summary']);
});

for (const [name, summary] of [
  ['packed source', packedHeadingAndAskSummary],
  ['missing packed field', packedMissingFieldSummary]
]) {
  test(`rejects ${name} when it bypasses browser repair before PDF data loading`, async () => {
    await assert.rejects(
      () => loadAuthorizedReport({
        request: { mode: 'overview', weekId: 'W28', sections: ['executive-summary'] },
        idToken: 'pm@example.com',
        adapters: {
          ...adapters,
          getWeekById: async () => ({
            weekLabel: 'W28 2026',
            summary,
            projects: [{ code: 'PMS-001', name: 'PMS', visibility: 'active' }]
          })
        }
      }),
      error => error instanceof ReportDataError && error.statusCode === 422
    );
  });
}

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
