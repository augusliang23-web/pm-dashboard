import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportRequestError } from '../src/report-request.js';
import { parseOnePagerPreviewRequest } from '../src/one-pager-preview-request.js';

test('parses a minimal preview request with no draft settings', () => {
  const request = parseOnePagerPreviewRequest({ weekId: 'W28', projectCode: 'PMS-001' });
  assert.deepEqual(request, { weekId: 'W28', projectCode: 'PMS-001', ganttWindowSettings: undefined });
});

test('carries through draft Gantt window settings unvalidated (sanitized later downstream)', () => {
  const request = parseOnePagerPreviewRequest({
    weekId: 'W28',
    projectCode: 'PMS-001',
    ganttWindowSettings: { defaultMonths: 999, overrides: { 'PMS-001': 12 } }
  });
  assert.deepEqual(request.ganttWindowSettings, { defaultMonths: 999, overrides: { 'PMS-001': 12 } });
});

test('requires weekId and projectCode', () => {
  assert.throws(() => parseOnePagerPreviewRequest({ projectCode: 'PMS-001' }), ReportRequestError);
  assert.throws(() => parseOnePagerPreviewRequest({ weekId: 'W28' }), ReportRequestError);
});

test('rejects a non-object body and unexpected fields', () => {
  assert.throws(() => parseOnePagerPreviewRequest(null), ReportRequestError);
  assert.throws(() => parseOnePagerPreviewRequest([]), ReportRequestError);
  assert.throws(() => parseOnePagerPreviewRequest({ weekId: 'W28', projectCode: 'PMS-001', sections: [] }), ReportRequestError);
});
