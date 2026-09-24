import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportHandler, createOnePagerPreviewHandler } from '../src/app.js';

function response() {
  return { headers: new Map(), statusCode: 0, body: undefined, setHeader(key, value) { this.headers.set(key, value); }, end(body) { this.body = body; } };
}

const adapters = {
  verifyIdToken: async () => ({ email: 'pm@example.com' }),
  getUserByEmail: async () => ({ role: 'pm' }),
  getWeekById: async () => ({ weekLabel: 'W28', projects: [{ code: 'PMS-001', name: 'PMS' }] })
};

test('requires a bearer token before reading or rendering a report', async () => {
  const handle = createReportHandler({ adapters, renderPdf: async () => Buffer.from('pdf') });
  const res = response();
  await handle({ body: { mode: 'overview', weekId: 'W28', sections: ['health-focus'] } }, res);
  assert.equal(res.statusCode, 401);
});

test('returns an attachment PDF without persistence when authorized', async () => {
  let rendered = '';
  const handle = createReportHandler({ adapters, renderPdf: async html => { rendered = html; return Buffer.from('%PDF'); } });
  const res = response();
  await handle({ headers: { authorization: 'Bearer token' }, body: { mode: 'project', weekId: 'W28', projectCode: 'PMS-001', sections: [] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get('Content-Disposition'), 'attachment; filename="PMS-001-W28.pdf"');
  assert.match(rendered, /PMS/);
});

test('a Production-shaped handler rejects project-brief/project-update and never renders the UAT section picker', async () => {
  let rendered = '';
  const handle = createReportHandler({
    adapters,
    renderPdf: async html => { rendered = html; return Buffer.from('%PDF'); },
    features: { projectBriefUpdateSections: false }
  });
  const res = response();
  await handle({
    headers: { authorization: 'Bearer token' },
    body: { mode: 'project', weekId: 'W28', projectCode: 'PMS-001', sections: ['project-brief'] }
  }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'Unknown report section: project-brief.' });
  assert.equal(rendered, '', 'renderPdf must never be reached for a rejected request');
});

test('returns an actionable error when generated output exceeds 8 MiB', async () => {
  const handle = createReportHandler({
    adapters,
    renderPdf: async () => new Uint8Array(8 * 1024 * 1024 + 1)
  });
  const res = response();

  await handle({
    headers: { authorization: 'Bearer token' },
    body: { mode: 'overview', weekId: 'W28', sections: ['health-focus'], projectCodes: ['PMS-001'] }
  }, res);

  assert.equal(res.statusCode, 413);
  assert.deepEqual(JSON.parse(res.body), {
    error: 'Generated PDF exceeds the 8 MiB download limit. Select fewer sections and try again.'
  });
  assert.equal(res.headers.get('Content-Type'), 'application/json; charset=utf-8');
});

test('one-pager preview requires a bearer token', async () => {
  const handle = createOnePagerPreviewHandler({ adapters });
  const res = response();
  await handle({ body: { weekId: 'W28', projectCode: 'PMS-001' } }, res);
  assert.equal(res.statusCode, 401);
});

test('one-pager preview returns standalone HTML without invoking a PDF renderer', async () => {
  const previewAdapters = {
    ...adapters,
    getWeekById: async () => ({
      weekLabel: 'W28 2026', weekDate: 'Jul 6 - Jul 12',
      projects: [{
        code: 'PMS-001', name: 'PMS',
        ganttWorkstreams: [{ id: 'a', name: 'Build', startDate: '2026-07-01', endDate: '2026-07-15', progress: 40 }]
      }]
    })
  };
  const handle = createOnePagerPreviewHandler({ adapters: previewAdapters });
  const res = response();
  await handle({ headers: { authorization: 'Bearer token' }, body: { weekId: 'W28', projectCode: 'PMS-001' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.match(res.body, /class="one-pager"/);
  assert.match(res.body, /PMS/);
});

test('one-pager preview uses the draft Gantt window instead of the persisted dashboardSettings', async () => {
  let dashboardSettingsCalls = 0;
  const previewAdapters = {
    ...adapters,
    getWeekById: async () => ({
      weekLabel: 'W28 2026', weekDate: 'Jul 6 - Jul 12',
      projects: [{
        code: 'PMS-001', name: 'PMS',
        ganttWorkstreams: [{ id: 'a', name: 'Far future', startDate: '2028-01-01', endDate: '2028-01-10', progress: 0 }]
      }]
    }),
    getDashboardSettings: async () => { dashboardSettingsCalls += 1; return { ganttWindowDefaultMonths: 3 }; }
  };
  const handle = createOnePagerPreviewHandler({ adapters: previewAdapters });
  const res = response();
  await handle({
    headers: { authorization: 'Bearer token' },
    body: { weekId: 'W28', projectCode: 'PMS-001', ganttWindowSettings: { defaultMonths: 36, overrides: {} } }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(dashboardSettingsCalls, 0, 'preview must never read persisted dashboardSettings');
  assert.match(res.body, /Far Future/);
  assert.doesNotMatch(res.body, /display window are not shown/);
});

test('one-pager preview reports a 404 for a project that no longer exists', async () => {
  const handle = createOnePagerPreviewHandler({ adapters });
  const res = response();
  await handle({ headers: { authorization: 'Bearer token' }, body: { weekId: 'W28', projectCode: 'MISSING' } }, res);
  assert.equal(res.statusCode, 404);
});
