// Production Pages least-privilege hotfix (port of canonical main PR #31): the week "Release to VIP" /
// "Revert to Draft" mutation controls and the toggleReleaseWeek() global behind them must be available to the
// Admin and PM perspectives only. The DRAFT / Released status stays visible to every non-VIP perspective. The
// server already restricts setDashboardWeekRelease to admin and pm; this aligns the UI and fails closed on a
// direct call. These tests execute the real Pages getDashboardRole, canReadDraftWeeks, isVipPerspective,
// isWeekReleased, render (banner portion) and toggleReleaseWeek source in a VM, with the real confirmWeekMutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { confirmWeekMutation, getWriteErrorMessage } from '../sync-core.js';

const pages = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function sliceBody(startMarker, endMarker) {
  const start = pages.indexOf(startMarker);
  assert.ok(start >= 0, `Pages must define ${startMarker}`);
  const end = pages.indexOf(endMarker, start);
  assert.ok(end > start, `Pages must close ${startMarker}`);
  return pages.slice(start, end + endMarker.length);
}

const normalizeRoleSource = sliceBody('function normalizeRole(', '\n}\n');
const getDashboardRoleSource = sliceBody('function getDashboardRole(', '\n}\n');
const canReadDraftWeeksSource = sliceBody('function canReadDraftWeeks(', '\n}\n');
const isVipPerspectiveSource = sliceBody('const isVipPerspective = ', ';\n');
const isWeekReleasedSource = sliceBody('function isWeekReleased(', '\n}\n');
const toggleReleaseWeekSource = sliceBody('window.toggleReleaseWeek = async () => {', '\n};\n');
// render() is large and pulls in the whole dashboard. Everything up to this marker is the week banner, which only
// needs the handful of collaborators stubbed below; closing the function there executes the real banner source.
const RENDER_BANNER_END = '  const allCurrentProjects = enrichProjectsPrototype(week.projects || []);\n';
const renderStart = pages.indexOf('window.render = () => {');
const renderBannerEnd = pages.indexOf(RENDER_BANNER_END, renderStart);
assert.ok(renderStart >= 0 && renderBannerEnd > renderStart, 'Pages render() banner section must be locatable');
const renderBannerSource = `${pages.slice(renderStart, renderBannerEnd)}};\n`;

function stubElement() {
  return { style: {}, textContent: '', innerHTML: '', value: '', classList: { add() {}, remove() {}, toggle() {} } };
}

function resolvePerspective(rawRole) {
  const context = vm.createContext({ currentRawRole: undefined });
  vm.runInContext(`${normalizeRoleSource}\n${getDashboardRoleSource}\nthis.resolveRole = getDashboardRole;`, context);
  return context.resolveRole({ exists: () => true, data: () => ({ role: rawRole }) });
}

function weekFixture(isReleased) {
  return { weekLabel: 'W1 2026', weekDate: 'Jan 1 - Jan 5', lastModifiedBy: 'pm@example.com', isReleased, projects: [] };
}

function renderBanner({ perspective, isReleased, isAdminVipPreview = false }) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, stubElement());
    return elements.get(id);
  };
  const context = vm.createContext({
    window: {},
    document: { getElementById: element },
    currentRole: perspective,
    isAdminVipPreview,
    allWeeks: [weekFixture(isReleased)],
    currentIdx: 0,
    getUserDisplayName: () => 'Editor',
  });
  vm.runInContext(`${canReadDraftWeeksSource}\n${isVipPerspectiveSource}\n${isWeekReleasedSource}\n${renderBannerSource}`, context);
  context.window.render();
  return element('bannerPills').innerHTML;
}

function toggleContext(perspective, { isReleased = false } = {}) {
  const calls = { loader: [], hideLoader: 0, toast: [], render: 0, setWeekRelease: [] };
  const context = vm.createContext({
    window: {},
    currentRole: perspective,
    currentUser: { email: 'tester@example.com' },
    currentIdx: 0,
    allWeeks: [weekFixture(isReleased)],
    releaseWriteInProgress: false,
    confirmWeekMutation,
    getWriteErrorMessage,
    showLoader: message => calls.loader.push(message),
    hideLoader: () => { calls.hideLoader += 1; },
    showSaveToast: message => calls.toast.push(message),
    render: () => { calls.render += 1; },
    console: { error() {} },
    projectDashboardApi: {
      setWeekRelease: async request => {
        calls.setWeekRelease.push(request);
        return { week: { ...weekFixture(request.isReleased), version: 2 } };
      },
    },
  });
  vm.runInContext(`${canReadDraftWeeksSource}\n${isWeekReleasedSource}\n${toggleReleaseWeekSource}`, context);
  return { context, calls };
}

// Raw Firestore role -> expected Pages perspective -> whether the release controls may be shown/used.
const MATRIX = [
  ['admin', 'admin', true],
  ['pm', 'pm', true],
  ['sales', 'business', false],
  ['bd', 'business', false],
  ['business', 'business', false],
  ['engineering', 'engineering', false],
  ['product', 'product', false],
  ['executive', 'vip', false],
  ['vip', 'vip', false],
];

test('Pages raw roles keep mapping to the intended perspective (sales/bd -> business, executive -> vip)', () => {
  for (const [raw, perspective] of MATRIX) {
    assert.equal(resolvePerspective(raw), perspective, `raw role ${raw}`);
  }
});

test('a DRAFT week shows Release to VIP to Admin and PM only, but DRAFT status to every non-VIP perspective', () => {
  for (const [raw, , allowed] of MATRIX) {
    const perspective = resolvePerspective(raw);
    const html = renderBanner({ perspective, isReleased: false });
    if (perspective === 'vip') {
      assert.equal(html, '', `${raw} (vip) banner is unchanged: empty`);
      continue;
    }
    assert.match(html, /DRAFT/, `${raw} (${perspective}) still sees the DRAFT status`);
    if (allowed) assert.match(html, /Release to VIP/, `${raw} (${perspective}) must see Release to VIP`);
    else assert.doesNotMatch(html, /Release to VIP|toggleReleaseWeek/, `${raw} (${perspective}) must not see a release control`);
  }
});

test('a Released week shows Revert to Draft to Admin and PM only, but Released status to every non-VIP perspective', () => {
  for (const [raw, , allowed] of MATRIX) {
    const perspective = resolvePerspective(raw);
    const html = renderBanner({ perspective, isReleased: true });
    if (perspective === 'vip') {
      assert.equal(html, '', `${raw} (vip) banner is unchanged: empty`);
      continue;
    }
    assert.match(html, /Released/, `${raw} (${perspective}) still sees the Released status`);
    if (allowed) assert.match(html, /Revert to Draft/, `${raw} (${perspective}) must see Revert to Draft`);
    else assert.doesNotMatch(html, /Revert to Draft|toggleReleaseWeek/, `${raw} (${perspective}) must not see a revert control`);
  }
});

test('VIP and Admin-in-VIP-preview banners are unchanged (no status pill, no controls)', () => {
  assert.equal(renderBanner({ perspective: 'vip', isReleased: false }), '');
  assert.equal(renderBanner({ perspective: 'vip', isReleased: true }), '');
  assert.equal(renderBanner({ perspective: 'admin', isReleased: false, isAdminVipPreview: true }), '');
  assert.equal(renderBanner({ perspective: 'admin', isReleased: true, isAdminVipPreview: true }), '');
});

test('an unknown or pending perspective renders status only, never a release control', () => {
  for (const perspective of ['pending', '', undefined, 'executive', 'sales']) {
    for (const isReleased of [false, true]) {
      const html = renderBanner({ perspective, isReleased });
      assert.doesNotMatch(html, /toggleReleaseWeek/, `${JSON.stringify(perspective)} must not get a control`);
    }
  }
});

test('toggleReleaseWeek direct call by a non-Admin/PM fails closed: no loader, no callable, no mutation', async () => {
  for (const [raw, , allowed] of MATRIX) {
    if (allowed) continue;
    for (const isReleased of [false, true]) {
      const perspective = resolvePerspective(raw);
      const { context, calls } = toggleContext(perspective, { isReleased });
      const before = JSON.stringify(context.allWeeks);
      await context.window.toggleReleaseWeek();
      assert.deepEqual(calls.loader, [], `${raw} must not show a loader`);
      assert.equal(calls.hideLoader, 0, `${raw} must not touch the loader`);
      assert.deepEqual(calls.setWeekRelease, [], `${raw} must not invoke the release callable`);
      assert.deepEqual(calls.toast, [], `${raw} gets no toast (silent fail-closed)`);
      assert.equal(calls.render, 0, `${raw} must not re-render`);
      assert.equal(JSON.stringify(context.allWeeks), before, `${raw} must not mutate week data`);
      assert.equal(context.releaseWriteInProgress, false, `${raw} must not take the write lock`);
    }
  }
});

test('toggleReleaseWeek stays reachable for Admin and PM (release and revert)', async () => {
  for (const raw of ['admin', 'pm']) {
    for (const isReleased of [false, true]) {
      const { context, calls } = toggleContext(resolvePerspective(raw), { isReleased });
      await context.window.toggleReleaseWeek();
      // The request object is created inside the VM realm, so compare plain JSON rather than prototypes.
      assert.equal(JSON.stringify(calls.setWeekRelease), JSON.stringify([{ weekId: 'W1-2026', isReleased: !isReleased }]), `${raw} callable payload`);
      assert.equal(calls.loader.length, 1, `${raw} shows the loader once`);
      assert.equal(calls.hideLoader, 1, `${raw} hides the loader`);
      assert.equal(calls.render, 1, `${raw} re-renders`);
      assert.equal(context.allWeeks[0].isReleased, !isReleased, `${raw} adopts the server week`);
      assert.equal(context.releaseWriteInProgress, false, `${raw} releases the write lock`);
    }
  }
});

test('the guard is the first statement of toggleReleaseWeek, precedes all state/loader/network, and adds no error flow', () => {
  const guard = 'if (!canReadDraftWeeks(currentRole)) return;';
  const guardIndex = toggleReleaseWeekSource.indexOf(guard);
  assert.ok(guardIndex >= 0, 'Pages toggleReleaseWeek must check canReadDraftWeeks(currentRole)');
  assert.equal(toggleReleaseWeekSource.slice(0, guardIndex).replace(/window\.toggleReleaseWeek = async \(\) => \{\s*/, ''), '', 'guard must be the first statement');
  for (const later of ['allWeeks[currentIdx]', 'releaseWriteInProgress = true', 'showLoader(', 'projectDashboardApi.setWeekRelease', 'confirmWeekMutation(']) {
    assert.ok(guardIndex < toggleReleaseWeekSource.indexOf(later), `guard must precede ${later}`);
  }
  assert.doesNotMatch(toggleReleaseWeekSource.slice(0, guardIndex + guard.length), /alert|showSaveToast|showAuthError/);
});

test('every release control in the Pages banner is gated by canReadDraftWeeks and the helper is the admin/pm contract', () => {
  const buttons = renderBannerSource.match(/onclick="toggleReleaseWeek\(\)"/g) || [];
  const gated = renderBannerSource.match(/\$\{canReadDraftWeeks\(currentRole\) \?/g) || [];
  assert.equal(buttons.length, 2, 'Pages banner has exactly the Release and Revert buttons');
  assert.equal(gated.length, 2, 'both are behind canReadDraftWeeks(currentRole)');
  const { context } = toggleContext('pm');
  for (const [, perspective, allowed] of MATRIX) {
    assert.equal(context.canReadDraftWeeks(perspective), allowed, `canReadDraftWeeks(${perspective})`);
  }
});
