import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportHandler } from '../src/app.js';

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
  await handle({ headers: { authorization: 'Bearer token' }, body: { mode: 'project', weekId: 'W28', projectCode: 'PMS-001', sections: ['project-brief'] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get('Content-Disposition'), 'attachment; filename="PMS-001-W28.pdf"');
  assert.match(rendered, /PMS/);
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
