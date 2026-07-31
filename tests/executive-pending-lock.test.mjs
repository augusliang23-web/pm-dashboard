import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isExecutiveMilestoneActionLocked,
  pendingExecutiveMilestoneIds,
} from '../js/executive-pending-lock.mjs';

test('pending requests lock move rename and delete only for their milestone', () => {
  const pendingIds = pendingExecutiveMilestoneIds([
    { state: 'pending', itemId: 'ms-1' },
    { state: 'approved', itemId: 'ms-2' },
    { state: 'pending', itemId: '' },
  ]);

  assert.deepEqual([...pendingIds], ['ms-1']);
  for (const action of ['move', 'rename', 'delete']) {
    assert.equal(isExecutiveMilestoneActionLocked({ action, itemId: 'ms-1', pendingIds }), true);
  }
  assert.equal(isExecutiveMilestoneActionLocked({ action: 'add', itemId: 'ms-1', pendingIds }), false);
  assert.equal(isExecutiveMilestoneActionLocked({ action: 'move', itemId: 'ms-2', pendingIds }), false);
});
