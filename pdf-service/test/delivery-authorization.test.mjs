// F-1: the Delivery Performance section must never expose DRAFT-week history to a role without draft access.
// All data is SYNTHETIC. The history reader is the real bounded Firestore reader running against an in-memory fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportAccessError } from '../src/report-access.js';
import { canReadDraftDeliveryHistory, createBoundedDeliveryHistoryReader, loadAuthorizedReport } from '../src/report-data.js';
import { parseReportRequest } from '../src/report-request.js';
import { renderOverviewReportHtml } from '../src/overview-report.js';
import { canReadDraftWeeks } from '../../js/dashboard-access.mjs';

const SECTION = 'portfolio-delivery-performance';
const ROLES = ['admin', 'pm', 'sales', 'engineering', 'business', 'product', 'bd', 'vip', 'executive'];
const DAY = 86400000;
const isoMonday = (year, week) => { const jan4 = Date.UTC(year, 0, 4); return jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (week - 1) * 7 * DAY; };
const monthDay = time => new Date(time).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const project = (id, name, progress, extra = {}) => ({ projectId: id, code: id.toUpperCase(), name, owner: `PM of ${name}`, projectManager: `PM of ${name}`, progress, status: 'green', projectLevel: 'system', visibility: 'active', lifecycle: 'active', ...extra });
const SECRET = { draft: ['ZZ-DRAFT', 'Draftonly Secret', 'PM of Draftonly Secret'], future: ['ZZ-FUTURE', 'Future Secret', 'PM of Future Secret'] };

// W35..W43; W38 and W40 are drafts; the draft-only project exists only in W38; the future-only project only in W43.
function buildDocs({ released = n => n !== 38 && n !== 40 } = {}) {
  const docs = new Map();
  for (let n = 35; n <= 43; n += 1) {
    const projects = [project('p1', 'Alpha', 10 + n)];
    if (n === 38) projects.push(project('zz-draft', 'Draftonly Secret', 5));
    if (n === 43) projects.push(project('zz-future', 'Future Secret', 5));
    docs.set(`W${n}-2026`, { weekLabel: `W${n} 2026`, weekDate: `${monthDay(isoMonday(2026, n))} - ${monthDay(isoMonday(2026, n) + 4 * DAY)}`, isReleased: released(n), version: 1, summary: '', projects });
  }
  return docs;
}
function fakeDb(docs, counters) {
  return { collection: () => ({ f: null, lim: 50, after: null, where(f, o, v) { this.f = [f, v]; return this; }, orderBy() { return this; }, limit(n) { this.lim = n; return this; }, startAfter(c) { this.after = c; return this; },
    async get() { counters.queries += 1; let ids = [...docs.keys()].sort(); if (this.f) ids = ids.filter(id => docs.get(id)[this.f[0]] === this.f[1]); if (this.after) ids = ids.filter(id => id > this.after); ids = ids.slice(0, this.lim); counters.docs += ids.length; return { docs: ids.map(id => ({ id, data: () => JSON.parse(JSON.stringify(docs.get(id))) })) }; } }) };
}
function setup(role, { docs = buildDocs(), tokenExtras = {}, userRole = role } = {}) {
  const counters = { queries: 0, docs: 0, history: 0 };
  const reader = createBoundedDeliveryHistoryReader({ db: fakeDb(docs, counters) });
  const adapters = { verifyIdToken: async () => ({ email: 'qa@example.test', ...tokenExtras }), getUserByEmail: async () => ({ role: userRole }),
    getWeekById: async id => (docs.has(id) ? JSON.parse(JSON.stringify(docs.get(id))) : undefined),
    getDeliveryHistory: async options => { counters.history += 1; return reader(options); }, getDeliveryTrendsProvenance: () => ({ source: 'synthetic', asOf: '2026-10-14T00:00:00.000Z' }) };
  return { adapters, counters };
}
const run = (role, weekId, sections = [SECTION], options = {}) => {
  const { adapters, counters } = setup(role, options.setup);
  const request = parseReportRequest({ mode: 'overview', weekId, sections, overviewScope: 'all', projectCodes: ['P1', 'ZZ-DRAFT', 'ZZ-FUTURE'] }, { deliveryPerformanceSection: true });
  return loadAuthorizedReport({ request, idToken: 't', adapters }).then(report => ({ report, counters }));
};
const labels = report => report.deliveryTrends.weeklySeries.map(entry => [entry.label.replace('2026-', ''), entry.gainPp]);
const everything = report => JSON.stringify(report.deliveryTrends) + renderOverviewReportHtml({ ...report, sections: report.sections });

test('draft-reader roles are exactly the dashboard contract (admin, pm) and the backend helper mirrors the browser helper', () => {
  for (const role of [...ROLES, 'unknown', '', undefined, null, 'ADMIN ', 'Pm']) {
    assert.equal(canReadDraftDeliveryHistory(role), canReadDraftWeeks(role), String(role));
  }
  assert.deepEqual(ROLES.filter(canReadDraftDeliveryHistory), ['admin', 'pm']);
});

for (const role of ROLES) {
  test(`B/D/E/G/H/I/J released anchor: ${role} receives draft-week history only if it is a draft reader`, async () => {
    const { report } = await run(role, 'W41-2026');
    const draftReader = ['admin', 'pm'].includes(role);
    const w38 = report.deliveryTrends.weeklySeries.find(entry => entry.label === '2026-W38');
    const w40 = report.deliveryTrends.weeklySeries.find(entry => entry.label === '2026-W40');
    if (draftReader) { assert.notEqual(w38.gainPp, null); assert.notEqual(w40.gainPp, null); }
    else { assert.equal(w38.gainPp, null, 'draft W38 is a gap'); assert.equal(w40.gainPp, null, 'draft W40 is a gap'); }
    const output = everything(report);
    for (const secret of SECRET.future) assert.ok(!output.includes(secret), `${role}: future-week data leaked (${secret})`);
    for (const secret of SECRET.draft) {
      // The draft-only project is not in the anchor week, so it is never listed as a current project for anyone;
      // for non-draft roles it must not appear anywhere (diagnostics, changes, projects).
      if (!draftReader) assert.ok(!output.includes(secret), `${role}: draft-only data leaked (${secret})`);
    }
    for (const warning of report.deliveryTrends.warnings) assert.deepEqual(Object.keys(warning).sort(), ['code', 'count', 'message', 'weekId']);
  });
}

for (const role of ROLES) {
  test(`C/F draft anchor: ${role} requesting only Delivery Performance for a draft weekId`, async () => {
    const draftReader = ['admin', 'pm'].includes(role);
    const attempt = run(role, 'W40-2026');
    if (draftReader) {
      const { report } = await attempt;
      assert.notEqual(report.deliveryTrends.summary.currentCompletionPct, null);
      return;
    }
    // vip/executive are rejected by the existing report authorization; every other role by the new section guard.
    await assert.rejects(attempt, error => {
      assert.ok(error instanceof ReportAccessError);
      assert.equal(error.statusCode, 403);
      for (const secret of [...SECRET.draft, ...SECRET.future, 'Alpha', 'P1']) assert.ok(!error.message.includes(secret), 'error message must not expose project details');
      return true;
    });
  });
}

test('draft anchor + other sections: roles without draft access get a fail-closed section and unchanged existing behavior', async () => {
  for (const role of ['sales', 'engineering', 'business', 'product', 'bd']) {
    const { report, counters } = await run(role, 'W40-2026', ['health-focus', SECTION]);
    assert.equal(report.deliveryTrends.status, 'unavailable');
    assert.equal(report.deliveryTrends.summary.weeklyProgressGainPp, null);
    assert.equal(report.deliveryTrends.summary.currentCompletionPct, null);
    assert.deepEqual(report.deliveryTrends.projects, []);
    assert.ok(report.deliveryTrends.warnings.some(warning => warning.code === 'draft-week-not-authorized'));
    assert.equal(counters.history, 0, 'no history is read for an unauthorized draft anchor');
    assert.equal(report.week.projects.length > 0, true, 'the existing health-focus section still receives its week data (unchanged behavior)');
    assert.ok(report.sections.includes('health-focus'));
    assert.ok(!JSON.stringify(report.deliveryTrends).includes('Alpha'));
  }
});

test('existing sections are not affected: requests without Delivery Performance never read history or change behavior', async () => {
  for (const role of ROLES.filter(role => !['vip', 'executive'].includes(role))) {
    const { report, counters } = await run(role, 'W40-2026', ['health-focus']);
    assert.equal(counters.history, 0);
    assert.equal(report.deliveryTrends, undefined);
    assert.equal(report.week.projects.length, 1);
  }
});

test('client-supplied role or capability claims are never trusted', async () => {
  // A forged claim inside the verified token, with a users/{email} record that says sales.
  const { report } = await run('sales', 'W41-2026', [SECTION], { setup: { tokenExtras: { role: 'admin', admin: true, week_manage: true, claims: { role: 'admin' } }, userRole: 'sales' } });
  assert.equal(report.deliveryTrends.weeklySeries.find(entry => entry.label === '2026-W38').gainPp, null);
  // The request schema rejects any role/capability field outright.
  for (const field of ['role', 'publicationMode', 'includeDrafts', 'capabilities']) {
    assert.throws(() => parseReportRequest({ mode: 'overview', weekId: 'W41-2026', sections: [SECTION], projectCodes: ['P1'], [field]: 'admin' }, { deliveryPerformanceSection: true }), /Unexpected report request field/);
  }
});

test('a delegated week.manage override is not trusted by the PDF backend (documented fail-closed mismatch)', async () => {
  // The backend only has users/{email}; even an override-like field on that record does not grant draft history.
  const { adapters } = setup('sales');
  adapters.getUserByEmail = async () => ({ role: 'sales', permissions: { 'week.manage': true }, overrides: { 'week.manage': true } });
  const docs = buildDocs();
  const request = parseReportRequest({ mode: 'overview', weekId: 'W41-2026', sections: [SECTION], overviewScope: 'all', projectCodes: ['P1'] }, { deliveryPerformanceSection: true });
  adapters.getWeekById = async id => JSON.parse(JSON.stringify(docs.get(id)));
  const report = await loadAuthorizedReport({ request, idToken: 't', adapters });
  assert.equal(report.deliveryTrends.weeklySeries.find(entry => entry.label === '2026-W38').gainPp, null);
});

test('an unknown or missing role is rejected before any history is requested', async () => {
  for (const role of ['', 'superuser', null]) {
    const { adapters, counters } = setup('pm', { userRole: role });
    const request = parseReportRequest({ mode: 'overview', weekId: 'W41-2026', sections: [SECTION], overviewScope: 'all', projectCodes: ['P1'] }, { deliveryPerformanceSection: true });
    await assert.rejects(loadAuthorizedReport({ request, idToken: 't', adapters }));
    assert.equal(counters.history, 0);
    assert.equal(counters.queries, 0);
  }
});

test('released-only roles read ONLY released documents (the published filter is applied at the query)', async () => {
  const { adapters, counters } = setup('sales');
  const seen = [];
  const original = adapters.getDeliveryHistory;
  adapters.getDeliveryHistory = async options => { seen.push(options.publicationMode); const history = await original(options); assert.ok(history.weeks.every(week => week.isReleased === true), 'only released documents were read'); return history; };
  const request = parseReportRequest({ mode: 'overview', weekId: 'W41-2026', sections: [SECTION], overviewScope: 'all', projectCodes: ['P1'] }, { deliveryPerformanceSection: true });
  await loadAuthorizedReport({ request, idToken: 't', adapters });
  assert.deepEqual(seen, ['released']);
  assert.equal(counters.docs, 7, 'W35..W43 minus the two drafts');
});

test('draft readers use include-drafts, and a draft week never appears for released-only roles in the rendered PDF HTML', async () => {
  const sales = (await run('sales', 'W41-2026')).report;
  const admin = (await run('admin', 'W41-2026')).report;
  assert.deepEqual(labels(sales).filter(([week]) => ['W38', 'W40'].includes(week)).map(([, gain]) => gain), [null, null]);
  assert.ok(labels(admin).filter(([week]) => ['W38', 'W40'].includes(week)).every(([, gain]) => gain !== null));
  for (const secret of SECRET.draft) assert.ok(!renderOverviewReportHtml({ ...sales, sections: [SECTION] }).includes(secret));
});
