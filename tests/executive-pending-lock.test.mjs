import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isExecutiveMilestoneActionLocked,
  pendingExecutiveMilestoneIds,
} from '../js/executive-pending-lock.mjs';

test('pending requests lock move rename and delete only for their milestone', () => {
  const pendingIds = pendingExecutiveMilestoneIds([
    { state: 'pending', itemId: 'waiting' },
    { state: 'approved', itemId: 'approved' },
    { state: 'pending', itemId: '' },
  ]);

  assert.deepEqual([...pendingIds], ['waiting']);
  for (const action of ['move', 'rename', 'delete']) {
    assert.equal(isExecutiveMilestoneActionLocked({ action, itemId: 'waiting', pendingIds }), true);
  }
  assert.equal(isExecutiveMilestoneActionLocked({ action: 'add', itemId: 'waiting', pendingIds }), false);
  assert.equal(isExecutiveMilestoneActionLocked({ action: 'move', itemId: 'approved', pendingIds }), false);
});
