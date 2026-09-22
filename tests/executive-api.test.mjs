import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createExecutiveApi } from '../js/executive-api.mjs';

test('maps each browser method to the approved callable and exact payload', async () => {
  const calls = [];
  const api = createExecutiveApi({
    functions: { region: 'us-central1' },
    httpsCallable(functions, name) {
      assert.equal(functions.region, 'us-central1');
      return async payload => {
        calls.push({ name, payload });
        return { data: { ok: true, name } };
      };
    },
  });

  const payloads = [
    ['addUpdate', 'addExecutiveMilestoneUpdate', { weekId: 'w1', itemId: 'i1' }],
    ['createRequest', 'createExecutiveMilestoneChangeRequest', { weekId: 'w1', changeType: 'rename' }],
    ['withdrawRequest', 'withdrawExecutiveMilestoneChangeRequest', { requestId: 'r1' }],
    ['decideRequest', 'decideExecutiveMilestoneChangeRequest', { requestId: 'r1', decision: 'approve' }],
    ['applyDirectChange', 'applyDirectExecutiveMilestoneChange', { weekId: 'w1', reason: 'Admin correction' }],
    ['setRagOverride', 'setExecutiveRagOverride', { weekId: 'w1', scope: 'quarter', targetId: 'q1' }],
    ['saveTimelineConfig', 'saveExecutiveMilestoneTimelineConfig', { expectedVersion: 1, reason: 'Rename Q1', config: { sections: [], quarters: [] } }],
    ['initializeLiveTimeline', 'initializeExecutiveMilestoneLiveTimeline', { sourceWeekId: 'W29-2026' }],
  ];
  for (const [method, name, payload] of payloads) {
    assert.deepEqual(await api[method](payload), { ok: true, name });
  }
  assert.deepEqual(calls, payloads.map(([, name, payload]) => ({ name, payload })));
});

test('v2.2T root client includes the live timeline initializer', async () => {
  const root = await readFile(new URL('../js/executive-api.mjs', import.meta.url), 'utf8');
  assert.match(root, /initializeLiveTimeline: invoke\(call\('initializeExecutiveMilestoneLiveTimeline'\)\)/);
});
