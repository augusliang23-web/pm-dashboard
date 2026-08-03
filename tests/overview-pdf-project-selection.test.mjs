import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOverviewPdfRequest,
  buildOverviewProjectOptions,
  reconcileOverviewProjectSelection,
} from '../js/overview-pdf-selection.mjs';

test('builds unique project options in the visible Overview order', () => {
  assert.deepEqual(
    buildOverviewProjectOptions([
      { code: 'PMS-001', name: 'Programme Alpha' },
      { code: 'MOD-002', name: '' },
      { code: 'PMS-001', name: 'Duplicate' },
      { code: ' ' },
      null,
    ]),
    [
      { code: 'PMS-001', name: 'Programme Alpha' },
      { code: 'MOD-002', name: 'MOD-002' },
    ],
  );
});

test('builds an Overview PDF request with selected project codes', () => {
  assert.deepEqual(
    buildOverviewPdfRequest({
      sections: ['health-focus', 'executive-milestones'],
      overviewScope: 'System',
      projectCodes: ['PMS-001', 'MOD-002'],
      executiveAudienceView: 'leadership',
    }),
    {
      mode: 'overview',
      sections: ['health-focus', 'executive-milestones'],
      overviewScope: 'system',
      projectCodes: ['PMS-001', 'MOD-002'],
      executiveAudienceView: 'leadership',
    },
  );
});

test('rejects an Overview PDF request without sections or projects', () => {
  assert.throws(
    () => buildOverviewPdfRequest({ sections: [], overviewScope: 'All', projectCodes: ['PMS-001'] }),
    /section/i,
  );
  assert.throws(
    () => buildOverviewPdfRequest({ sections: ['health-focus'], overviewScope: 'All', projectCodes: [] }),
    /project/i,
  );
});

test('preserves valid project choices when returning from the section step', () => {
  const options = buildOverviewProjectOptions([
    { code: 'PMS-001', name: 'Programme Alpha' },
    { code: 'MOD-002', name: 'Module Beta' },
  ]);
  assert.deepEqual(reconcileOverviewProjectSelection(options), ['PMS-001', 'MOD-002']);
  assert.deepEqual(reconcileOverviewProjectSelection(options, ['MOD-002', 'STALE-999']), ['MOD-002']);
  assert.deepEqual(reconcileOverviewProjectSelection(options, []), []);
});
