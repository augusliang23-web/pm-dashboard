const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const server = require('../permission-registry');

const ROLES = ['admin', 'pm', 'vip', 'executive', 'engineering', 'business', 'sales', 'bd', 'product', ' Admin ', 'PM', '', 'unknown', undefined];
const VALUES = [undefined, true, false, null, 'true', 1];
const CAPABILITY_KEYS = ['week.manage', 'week.release', 'gantt.manage', 'project.manage', 'permissions.manage', 'week.unknown', '', '__proto__'];

async function browserRegistry() {
  return import(pathToFileURL(path.resolve(__dirname, '..', '..', 'js', 'permission-registry.mjs')).href);
}

test('Functions permission registry data matches the browser registry', async () => {
  const browser = await browserRegistry();
  assert.deepEqual(JSON.parse(JSON.stringify(server.CAPABILITIES)), JSON.parse(JSON.stringify(browser.CAPABILITIES)));
});

test('Functions and browser role defaults agree for every role and capability', async () => {
  const browser = await browserRegistry();
  for (const capability of CAPABILITY_KEYS) {
    for (const role of ROLES) {
      assert.equal(server.roleDefault(capability, role), browser.roleDefault(capability, role), `${capability} / ${JSON.stringify(role)}`);
    }
  }
});

test('Functions and browser resolvers agree for every role, capability and override value', async () => {
  const browser = await browserRegistry();
  for (const capability of CAPABILITY_KEYS) {
    for (const role of ROLES) {
      for (const value of VALUES) {
        const overrides = value === undefined ? {} : { [capability]: value };
        assert.equal(
          server.can(capability, { role, overrides }),
          browser.can(capability, { role, overrides }),
          `${capability} / ${JSON.stringify(role)} / ${JSON.stringify(value)}`,
        );
      }
    }
  }
  for (const overrides of [null, undefined, 'junk', [], { stale: true }]) {
    assert.deepEqual(server.normalizePermissionOverrides(overrides), browser.normalizePermissionOverrides(overrides));
  }
});


test('dashboard, browser and Functions recognize the same role contract and reject malformed roles', async () => {
  const browser = await browserRegistry();
  const { normalizeDashboardRole } = await import('../../js/dashboard-access.mjs');
  const { ROLE_CASES } = await import('../../tests/helpers/dashboard-role-cases.mjs');
  const { buildAuthenticatedActor } = require('../project-dashboard-writes');
  const expectedRoles = [...new Set(ROLE_CASES.map(({ expected }) => expected).filter(Boolean))].sort();
  assert.deepEqual([...browser.CAPABILITIES['week.manage'].roleDefaults, ...browser.CAPABILITIES['week.manage'].grantableRoles].sort(), expectedRoles);
  for (const { raw, expected } of ROLE_CASES) {
    const label = JSON.stringify(raw);
    assert.equal(normalizeDashboardRole(raw), expected, `dashboard ${label}`);
    assert.equal(browser.normalizePermissionRole(raw), expected, `browser ${label}`);
    assert.equal(server.normalizePermissionRole(raw), expected, `Functions ${label}`);
    if (expected) {
      assert.equal(buildAuthenticatedActor({ uid: 'parity', email: 'parity@example.test' }, { role: raw }).role, expected);
    } else {
      assert.throws(() => buildAuthenticatedActor({ uid: 'parity', email: 'parity@example.test' }, { role: raw }), { code: 'permission-denied' });
    }
    for (const registry of [browser, server]) {
      assert.equal(registry.can('week.manage', { role: raw }), expected === 'admin', label);
      assert.equal(registry.can('week.manage', { role: raw, overrides: { 'week.manage': true } }), !!expected, label);
      assert.equal(registry.can('permissions.manage', { role: raw, overrides: { 'permissions.manage': true } }), expected === 'admin', label);
    }
  }
});
