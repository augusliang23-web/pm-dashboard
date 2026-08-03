import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportRequestError, parseReportRequest } from '../src/report-request.js';

test('accepts an allow-listed project report request without report content', () => {
  const request = parseReportRequest({
    mode: 'project',
    weekId: 'W28-2026',
    projectCode: 'PMS-001',
    sections: ['project-brief', 'milestone']
  });

  assert.deepEqual(request, {
    mode: 'project',
    weekId: 'W28-2026',
    projectCode: 'PMS-001',
    sections: ['project-brief', 'milestone']
  });
});

test('rejects unknown report modes and sections', () => {
  assert.throws(
    () => parseReportRequest({ mode: 'portfolio', weekId: 'W28', sections: ['health-focus'] }),
    ReportRequestError
  );
  assert.throws(
    () => parseReportRequest({ mode: 'overview', weekId: 'W28', sections: ['secret-section'] }),
    /Unknown report section/
  );
});

test('rejects report content supplied by the browser', () => {
  assert.throws(
    () => parseReportRequest({
      mode: 'overview',
      weekId: 'W28',
      sections: ['health-focus'],
      reportHtml: '<h1>untrusted</h1>'
    }),
    /Unexpected report request field: reportHtml/
  );
});

test('requires a project code for project reports and a nonempty section list', () => {
  assert.throws(
    () => parseReportRequest({ mode: 'project', weekId: 'W28', sections: ['milestone'] }),
    /projectCode is required/
  );
  assert.throws(
    () => parseReportRequest({ mode: 'overview', weekId: 'W28', sections: [] }),
    /At least one report section is required/
  );
});

test('accepts an Executive milestone audience view only with that section', () => {
  assert.deepEqual(parseReportRequest({
    mode: 'overview',
    weekId: 'W28',
    sections: ['executive-milestones', 'quarterly-roadmap'],
    executiveAudienceView: 'business-product'
  }), {
    mode: 'overview',
    weekId: 'W28',
    sections: ['executive-milestones', 'quarterly-roadmap'],
    executiveAudienceView: 'business-product'
  });

  assert.throws(() => parseReportRequest({
    mode: 'overview',
    weekId: 'W28',
    sections: ['quarterly-roadmap'],
    executiveAudienceView: 'leadership'
  }), /requires the Executive milestones section/);

  assert.throws(() => parseReportRequest({
    mode: 'overview',
    weekId: 'W28',
    sections: ['executive-milestones'],
    executiveAudienceView: 'unrestricted'
  }), /Unsupported executiveAudienceView/);
});

test('accepts unique selected project codes for an Overview report', () => {
  const request = parseReportRequest({
    mode: 'overview',
    weekId: 'W28',
    sections: ['health-focus'],
    projectCodes: ['PMS-001', 'MOD-002']
  });

  assert.deepEqual(request.projectCodes, ['PMS-001', 'MOD-002']);
});

test('rejects invalid Overview project selections', () => {
  for (const projectCodes of [[], ['PMS-001', 'PMS-001'], [' '], [42]]) {
    assert.throws(
      () => parseReportRequest({ mode: 'overview', weekId: 'W28', sections: ['health-focus'], projectCodes }),
      ReportRequestError
    );
  }
});
