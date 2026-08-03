import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ReportAccessError,
  authorizeExecutiveAudienceView,
  authorizeReportAccess
} from '../src/report-access.js';

test('rejects both Executive role vocabularies on an unreleased reporting week', () => {
  for (const role of ['vip', 'executive']) {
    assert.throws(
      () => authorizeReportAccess({ email: `${role}@example.com`, role }, { isReleased: false }, { mode: 'overview' }),
      ReportAccessError
    );
  }
});

test('accepts a released week and normalizes known dashboard roles', () => {
  const access = authorizeReportAccess(
    { email: 'pm@example.com', role: 'Engineering' },
    { isReleased: false },
    { mode: 'overview' }
  );
  assert.deepEqual(access, { email: 'pm@example.com', role: 'engineering' });
});

test('accepts the combined production and UAT role vocabulary', () => {
  for (const role of ['admin', 'vip', 'executive', 'pm', 'engineering', 'business', 'sales', 'bd', 'product']) {
    const access = authorizeReportAccess({ email: `${role}@example.com`, role }, { isReleased: true });
    assert.equal(access.role, role);
  }
});

test('limits Executive milestone views to the authenticated role', () => {
  assert.equal(authorizeExecutiveAudienceView('vip', 'leadership'), 'leadership');
  assert.equal(authorizeExecutiveAudienceView('executive', 'leadership'), 'leadership');
  assert.equal(authorizeExecutiveAudienceView('pm'), 'pm-engineering');
  assert.equal(authorizeExecutiveAudienceView('business', 'everyone'), 'everyone');
  assert.equal(authorizeExecutiveAudienceView('sales', 'business-product'), 'business-product');
  assert.equal(authorizeExecutiveAudienceView('bd', 'business-product'), 'business-product');
  assert.throws(
    () => authorizeExecutiveAudienceView('engineering', 'business-product'),
    error => error instanceof ReportAccessError && error.statusCode === 403
  );
  assert.throws(() => authorizeExecutiveAudienceView('unknown-role'), ReportAccessError);
});
