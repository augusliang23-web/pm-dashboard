import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmWeekMutation,
  cleanFirestoreData,
  getCallableErrorMessage,
  getWriteErrorMessage
} from '../sync-core.js';

test('rejected write leaves source week unchanged', async () => {
  const week = { weekLabel: 'W26 2026', isReleased: false };

  await assert.rejects(
    confirmWeekMutation(week, { isReleased: true }, async () => {
      throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    }),
    /denied/
  );

  assert.deepEqual(week, { weekLabel: 'W26 2026', isReleased: false });
});

test('confirmed write returns a changed clone', async () => {
  const week = { weekLabel: 'W26 2026', isReleased: true };

  const next = await confirmWeekMutation(
    week,
    { isReleased: false },
    async candidate => assert.equal(candidate.isReleased, false)
  );

  assert.notEqual(next, week);
  assert.equal(week.isReleased, true);
  assert.equal(next.isReleased, false);
});

test('confirmed write preserves client-only document identity after the write', async () => {
  const week = { weekLabel: 'W29 2026', isReleased: false };
  Object.defineProperty(week, '__documentId', {
    value: 'W29-2026',
    enumerable: false
  });

  const next = await confirmWeekMutation(
    week,
    { isReleased: true },
    async candidate => assert.equal(candidate.__documentId, undefined)
  );

  assert.equal(next.__documentId, 'W29-2026');
  assert.equal(Object.prototype.propertyIsEnumerable.call(next, '__documentId'), false);
});

test('pending write times out without changing source', async () => {
  const week = { isReleased: true };

  await assert.rejects(
    confirmWeekMutation(
      week,
      { isReleased: false },
      () => new Promise(() => {}),
      { timeoutMs: 5 }
    ),
    error => error.code === 'write-timeout'
  );

  assert.equal(week.isReleased, true);
});

test('cleanFirestoreData removes undefined recursively', () => {
  assert.deepEqual(
    cleanFirestoreData({
      keep: 1,
      drop: undefined,
      nested: { keep: 2, drop: undefined },
      rows: [1, undefined, 2]
    }),
    { keep: 1, nested: { keep: 2 }, rows: [1, 2] }
  );
});

test('permission and timeout errors are actionable', () => {
  assert.match(getWriteErrorMessage({ code: 'permission-denied' }), /permission/i);
  assert.match(getWriteErrorMessage({ code: 'write-timeout' }), /connection/i);
});

test('callable errors surface the server reason and fall back for generic failures', () => {
  const fallback = 'Unable to create the new week. Please try again.';
  const callable = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });
  assert.equal(
    getCallableErrorMessage(callable('permission-denied', 'Manage Weeks permission is required to create reporting weeks.'), fallback),
    'Manage Weeks permission is required to create reporting weeks.',
  );
  assert.equal(getCallableErrorMessage(callable('already-exists', 'This reporting week already exists.'), fallback), 'This reporting week already exists.');
  assert.equal(getCallableErrorMessage(callable('internal', 'internal'), fallback), fallback);
  assert.equal(getCallableErrorMessage(callable('unavailable', 'Service unavailable'), fallback), fallback);
  assert.equal(getCallableErrorMessage(callable('permission-denied', 'permission-denied'), fallback), fallback);
  assert.equal(getCallableErrorMessage(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }), fallback), fallback);
  assert.equal(getCallableErrorMessage(new TypeError('Failed to fetch'), fallback), fallback);
  assert.equal(getCallableErrorMessage(undefined, fallback), fallback);
});
