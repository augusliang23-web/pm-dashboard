// Production Release Week capability (week.release): the week "Release to VIP" / "Revert to Draft" mutation
// controls (and the toggleReleaseWeek() global behind them) are available only when the user's effective
// week.release capability is true. Role defaults preserve today's behavior (Admin and PM on); an Admin can switch
// it off for a PM or on for another working-team role. The current DRAFT / Released status stays visible to every
// non-VIP perspective. The server enforces the same capability in setDashboardWeekRelease.
// These tests execute the real Production getDashboardRole, isVipPerspective, isWeekReleased, render (banner
// portion) and toggleReleaseWeek source in a VM, with the real permission registry and confirmWeekMutation.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { can } from '../js/permission-registry.mjs';
import { confirmWeekMutation, getWriteErrorMessage } from '../sync-core.js';
import { dashboardSource } from './helpers/dashboard-source.mjs';

const production = dashboardSource('production');
const uat = dashboardSource('uat');

function sliceBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `source must define ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `source must close ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}

const getDashboardRoleSource = sliceBody(production, 'function getDashboardRole(', '\n}\n');
const isVipPerspectiveSource = sliceBody(production, 'const isVipPerspective = ', ';\n');
const isWeekReleasedSource = sliceBody(production, 'function isWeekReleased(', '\n}\n');
const toggleReleaseWeekSource = sliceBody(production, 'window.toggleReleaseWeek = async () => {', '\n};\n');
// render() is large and pulls in the whole dashboard. Everything up to this marker is the week banner, which only
// needs the handful of collaborators stubbed below; closing the function there executes the real banner source.
const RENDER_BANNER_END = '  const allCurrentProjects = enrichProjectsPrototype(week.projects || []);\n';
const renderStart = production.indexOf('window.render = () => {');
const renderBannerEnd = production.indexOf(RENDER_BANNER_END, renderStart);
assert.ok(renderStart >= 0 && renderBannerEnd > renderStart, 'Production render() banner section must be locatable');
const renderBannerSource = `${production.slice(renderStart, renderBannerEnd)}};\n`;

function stubElement() {
  return { style: {}, textContent: '', innerHTML: '', value: '', classList: { add() {}, remove() {}, toggle() {} } };
}

function resolvePerspective(rawRole) {
  const context = vm.createContext({ currentRawRole: undefined });
  vm.runInContext(`${getDashboardRoleSource}; this.resolveRole = getDashboardRole;`, context);
  return context.resolveRole({ exists: () => true, data: () => ({ role: rawRole }) });
}

function weekFixture(isReleased) {
  return { weekLabel: 'W1 2026', weekDate: 'Jan 1 - Jan 5', lastModifiedBy: 'pm@example.com', isReleased, projects: [] };
}

function renderBanner({ perspective, isReleased, isAdminVipPreview = false, rawRole = perspective, overrides = {} }) {
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
    canCurrentUser: capability => can(capability, { role: rawRole, overrides }),
    // The banner returns before touching anything else only for week-less renders; the sliced source stops
    // right after the banner, so nothing below this point is needed.
  });
  vm.runInContext(`${isVipPerspectiveSource}\n${isWeekReleasedSource}\n${renderBannerSource}`, context);
  context.window.render();
  return element('bannerPills').innerHTML;
}

function toggleContext(perspective, { isReleased = false, rawRole = perspective, overrides = {} } = {}) {
  const calls = { loader: [], hideLoader: 0, toast: [], render: 0, setWeekRelease: [] };
  const context = vm.createContext({
    window: {},
    currentRole: perspective,
    currentUser: { email: 'tester@example.com' },
    currentIdx: 0,
    allWeeks: [weekFixture(isReleased)],
    releaseWriteInProgress: false,
    canCurrentUser: capability => can(capability, { role: rawRole, overrides }),
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
    isWeekReleased: week => week?.isReleased === true,
  });
  vm.runInContext(toggleReleaseWeekSource, context);
  return { context, calls };
}

// Raw Firestore role -> expected Production perspective -> whether the release controls may be shown/used.
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

test('raw roles keep mapping to the intended perspective (sales/bd -> business, executive -> vip)', () => {
  for (const [raw, perspective] of MATRIX) {
    assert.equal(resolvePerspective(raw), perspective, `raw role ${raw}`);
  }
});

test('by role default a DRAFT week shows Release to VIP to Admin and PM only, but DRAFT status to every non-VIP perspective', () => {
  for (const [raw, , allowed] of MATRIX) {
    const perspective = resolvePerspective(raw);
    const html = renderBanner({ perspective, isReleased: false, rawRole: raw });
    if (perspective === 'vip') {
      assert.equal(html, '', `${raw} (vip) banner is unchanged: empty`);
      continue;
    }
    assert.match(html, /DRAFT/, `${raw} (${perspective}) still sees the DRAFT status`);
    if (allowed) assert.match(html, /Release to VIP/, `${raw} (${perspective}) must see Release to VIP`);
    else assert.doesNotMatch(html, /Release to VIP|toggleReleaseWeek/, `${raw} (${perspective}) must not see a release control`);
  }
});

test('by role default a Released week shows Revert to Draft to Admin and PM only, but Released status to every non-VIP perspective', () => {
  for (const [raw, , allowed] of MATRIX) {
    const perspective = resolvePerspective(raw);
    const html = renderBanner({ perspective, isReleased: true, rawRole: raw });
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
      const html = renderBanner({ perspective, isReleased, rawRole: perspective });
      assert.doesNotMatch(html, /toggleReleaseWeek/, `${JSON.stringify(perspective)} must not get a control`);
    }
  }
});

test('toggleReleaseWeek direct call without week.release fails closed: no loader, no callable, no mutation', async () => {
  for (const [raw, , allowed] of MATRIX) {
    if (allowed) continue;
    for (const isReleased of [false, true]) {
      const perspective = resolvePerspective(raw);
      const { context, calls } = toggleContext(perspective, { isReleased, rawRole: raw });
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
      const { context, calls } = toggleContext(resolvePerspective(raw), { isReleased, rawRole: raw });
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
  const guard = "if (!canCurrentUser('week.release')) return;";
  const guardIndex = toggleReleaseWeekSource.indexOf(guard);
  assert.ok(guardIndex >= 0, 'Production toggleReleaseWeek must check canCurrentUser(week.release)');
  assert.equal(toggleReleaseWeekSource.slice(0, guardIndex).replace(/window\.toggleReleaseWeek = async \(\) => \{\s*/, ''), '', 'guard must be the first statement');
  for (const later of ['allWeeks[currentIdx]', 'releaseWriteInProgress = true', 'showLoader(', 'projectDashboardApi.setWeekRelease', 'confirmWeekMutation(']) {
    assert.ok(guardIndex < toggleReleaseWeekSource.indexOf(later), `guard must precede ${later}`);
  }
  assert.doesNotMatch(toggleReleaseWeekSource.slice(0, guardIndex + guard.length), /alert|showSaveToast|showAuthError/);
});

test('every release control in the Production banner is gated by the effective week.release capability', () => {
  const renderSource = renderBannerSource;
  const buttons = renderSource.match(/onclick="toggleReleaseWeek\(\)"/g) || [];
  const gated = renderSource.match(/\$\{canCurrentUser\('week\.release'\) \?/g) || [];
  assert.equal(buttons.length, 2, 'Production banner has exactly the Release and Revert buttons');
  assert.equal(gated.length, 2, "both are behind canCurrentUser('week.release')");
  assert.doesNotMatch(renderSource, /canReadDraftWeeks/);
});

// Delegation: [raw role, overrides, expected week.release]. V1 is PM-only: an explicit OFF removes a PM's access,
// and no other role can be granted it (a stale or forged true override is ignored); Admin stays locked ON.
const DELEGATION = [
  ['admin', { 'week.release': false }, true],
  ['pm', {}, true],
  ['pm', { 'week.release': false }, false],
  ['pm', { 'week.release': true }, true],
  ['engineering', {}, false],
  ['engineering', { 'week.release': true }, false],
  ['business', { 'week.release': true }, false],
  ['sales', { 'week.release': true }, false],
  ['bd', { 'week.release': true }, false],
  ['product', { 'week.release': true }, false],
  ['pm', { 'week.release': null }, true],
  ['engineering', { 'week.release': false }, false],
  ['engineering', { 'week.manage': true, 'gantt.manage': true, 'project.manage': true }, false],
  ['vip', { 'week.release': true }, false],
  ['executive', { 'week.release': true }, false],
];

test('delegated week.release shows and runs the release controls only for effective holders', async () => {
  for (const [raw, overrides, allowed] of DELEGATION) {
    const perspective = resolvePerspective(raw);
    const label = `${raw} ${JSON.stringify(overrides)}`;
    for (const isReleased of [false, true]) {
      if (perspective !== 'vip') {
        const html = renderBanner({ perspective, isReleased, rawRole: raw, overrides });
        assert.equal(/toggleReleaseWeek/.test(html), allowed, `${label} released=${isReleased}: banner control`);
      }
      const { context, calls } = toggleContext(perspective, { isReleased, rawRole: raw, overrides });
      await context.window.toggleReleaseWeek();
      assert.equal(calls.setWeekRelease.length, allowed ? 1 : 0, `${label} released=${isReleased}: callable`);
    }
  }
});

test('UAT keeps its own release-control contract and the Production guard does not leak into UAT', () => {
  assert.match(uat, /\$\{canManageWeekRelease\(\) \?/);
  assert.match(uat, /!canManageWeekRelease\(\)\) return;/);
  const uatToggle = sliceBody(uat, 'window.toggleReleaseWeek = async () => {', '\n};\n');
  assert.doesNotMatch(uatToggle, /canReadDraftWeeks/);
  // UAT shares the same effective capability.
  assert.match(sliceBody(uat, 'function canManageWeekRelease() {', '\n}\n'), /return canCurrentUser\('week\.release'\);/);
});
