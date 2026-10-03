// Production Pages port of canonical main's Create Next Week failure recovery: createNewWeekFromManage() must surface a rejected createDashboardWeek
// callable instead of failing silently. Executes the real profile body with the real canCurrentUser,
// js/permission-registry.mjs resolver and sync-core getCallableErrorMessage in a VM, for both profiles.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { can } from '../js/permission-registry.mjs';
import { getCallableErrorMessage } from '../sync-core.js';
import { readFileSync } from 'node:fs';
const PAGES = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function sliceBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `source must define ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `source must close ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}

const unhandled = [];
process.on('unhandledRejection', error => unhandled.push(error));

function makeContext(profile, createWeek, { rawRole = 'admin', overrides = {} } = {}) {
  const source = PAGES;
  const calls = { log: [], consoleError: [] };
  const elements = {
    wm_nw_label: { value: 'W41 2026' },
    wm_nw_date: { value: 'Oct 5 - Oct 9' },
  };
  const sourceWeek = { weekLabel: 'W40 2026', weekDate: 'Sep 28 - Oct 2', isReleased: false, projects: [] };
  Object.defineProperty(sourceWeek, '__documentId', { value: 'W40-2026', enumerable: false });
  const context = vm.createContext({
    window: {},
    Promise,
    console: { error: (...args) => calls.consoleError.push(args) },
    document: { getElementById: id => elements[id] },
    currentUser: { email: 'tester@example.com' },
    currentRawRole: rawRole,
    currentPermissionOverrides: overrides,
    canWithPermissions: can,
    getCallableErrorMessage,
    allWeeks: [sourceWeek],
    jumpToLatestOnNextRender: false,
    closeModal: id => calls.log.push(`close:${id}`),
    showLoader: text => calls.log.push(`loader:show:${text}`),
    hideLoader: () => calls.log.push('loader:hide'),
    showSaveToast: (message, options) => calls.log.push(`toast:${options?.type || 'success'}:${message}`),
    setTimeout: callback => callback(),
    projectDashboardApi: { createWeek },
  });
  vm.runInContext([
    sliceBody(source, 'function canCurrentUser(', '\n}\n'),
    sliceBody(source, 'window.createNewWeekFromManage = async () => {', '\n};\n'),
  ].join('\n'), context);
  return { context, calls };
}

const callableError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

for (const profile of ['pages']) {
  test(`${profile}: a rejected Create Week hides the loader, shows the server reason and keeps local state`, async () => {
    const before = unhandled.length;
    const reason = 'Manage Weeks permission is required to create reporting weeks.';
    const { context, calls } = makeContext(profile, async () => { throw callableError('permission-denied', reason); });

    await assert.doesNotReject(() => context.window.createNewWeekFromManage());
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(calls.log, [
      'close:weekManageOverlay',
      'loader:show:Creating New Week...',
      `toast:error:${reason}`,
      'loader:hide',
    ]);
    assert.equal(calls.log.some(entry => entry.startsWith('toast:success')), false, 'no success toast');
    assert.equal(context.jumpToLatestOnNextRender, false, 'jump flag must be disarmed');
    assert.deepEqual(context.allWeeks.map(week => week.weekLabel), ['W40 2026'], 'no fake local week');
    assert.equal(calls.consoleError.length, 1);
    assert.match(String(calls.consoleError[0][0]), /Create week failed/);
    assert.equal(unhandled.length, before, 'no unhandled rejection');
  });

  test(`${profile}: an internal or transport failure uses the generic message, never the released-week text`, async () => {
    for (const error of [callableError('internal', 'internal'), new TypeError('Failed to fetch')]) {
      const { context, calls } = makeContext(profile, async () => { throw error; });
      await context.window.createNewWeekFromManage();
      const toast = calls.log.find(entry => entry.startsWith('toast:'));
      assert.equal(toast, 'toast:error:Unable to create the new week. Please try again.');
      assert.doesNotMatch(toast, /released/i);
      assert.equal(calls.log.at(-1), 'loader:hide');
      assert.equal(context.jumpToLatestOnNextRender, false);
    }
  });

  test(`${profile}: a successful Create Week keeps the existing success flow`, async () => {
    const requests = [];
    const { context, calls } = makeContext(profile, async data => {
      requests.push(JSON.parse(JSON.stringify(data)));
      return { week: { weekLabel: data.weekLabel, weekDate: data.weekDate, isReleased: false, projects: [] } };
    }, { rawRole: 'pm', overrides: { 'week.manage': true } });

    await context.window.createNewWeekFromManage();

    assert.deepEqual(requests, [{ weekId: 'W41-2026', weekLabel: 'W41 2026', weekDate: 'Oct 5 - Oct 9', sourceWeekId: 'W40-2026' }]);
    assert.deepEqual(calls.log, [
      'close:weekManageOverlay',
      'loader:show:Creating New Week...',
      'toast:success:New week created',
      'loader:hide',
    ]);
    assert.equal(context.jumpToLatestOnNextRender, true, 'the next snapshot jumps to the new week');
    assert.deepEqual(context.allWeeks.map(week => week.weekLabel), ['W40 2026', 'W41 2026']);
    assert.equal(context.allWeeks[1].__documentId, 'W41-2026');
    assert.equal(calls.consoleError.length, 0);
  });

  test(`${profile}: release state is not a prerequisite for creating the next week`, () => {
    const body = sliceBody(PAGES, 'window.createNewWeekFromManage = async () => {', '\n};\n');
    assert.doesNotMatch(body, /isReleased|isWeekReleased/);
  });
}
