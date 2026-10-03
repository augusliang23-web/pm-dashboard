import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPABILITIES,
  can,
  isKnownCapability,
  normalizePermissionOverrides,
  normalizePermissionRole,
  roleDefault,
} from '../js/permission-registry.mjs';

const ROLES = ['admin', 'pm', 'engineering', 'business', 'sales', 'bd', 'product', 'vip', 'executive'];
const NON_ADMIN_ROLES = ROLES.filter(role => role !== 'admin');
const WORKING_ROLES = ['pm', 'engineering', 'business', 'sales', 'bd', 'product'];
const DELEGABLE = ['week.manage', 'week.release', 'gantt.manage', 'project.manage'];

// Reviewed role defaults and grantable roles. The registry must match this table exactly.
const EXPECTED = {
  'week.manage': { defaults: ['admin'], grantable: NON_ADMIN_ROLES },
  'week.release': { defaults: ['admin', 'pm'], grantable: WORKING_ROLES },
  'gantt.manage': { defaults: ['admin'], grantable: NON_ADMIN_ROLES },
  'project.manage': { defaults: ['admin'], grantable: WORKING_ROLES },
};

test('the registry holds exactly the reviewed delegable capabilities plus the non-delegable permissions.manage', () => {
  assert.deepEqual(Object.keys(CAPABILITIES), [...DELEGABLE, 'permissions.manage']);
  for (const key of DELEGABLE) {
    const definition = CAPABILITIES[key];
    assert.equal(definition.delegable, true, key);
    assert.equal(definition.adminLocked, true, `${key} is foundational for Admin`);
    assert.deepEqual([...definition.roleDefaults].sort(), [...EXPECTED[key].defaults].sort(), `${key} role defaults`);
    assert.deepEqual([...definition.grantableRoles].sort(), [...EXPECTED[key].grantable].sort(), `${key} grantable roles`);
    assert.ok(definition.label && definition.description, `${key} has presentation metadata`);
    assert.equal(definition.grantableRoles.includes('admin'), false, `${key} never grants to admin`);
  }
  assert.equal(CAPABILITIES['permissions.manage'].delegable, false);
  assert.deepEqual([...CAPABILITIES['permissions.manage'].grantableRoles], []);
  assert.ok(Object.isFrozen(CAPABILITIES));
  for (const definition of Object.values(CAPABILITIES)) {
    assert.ok(Object.isFrozen(definition) && Object.isFrozen(definition.roleDefaults) && Object.isFrozen(definition.grantableRoles));
  }
});

test('exhaustive resolution: every recognized role x delegable capability x override state', () => {
  for (const key of DELEGABLE) {
    for (const role of ROLES) {
      const isDefault = EXPECTED[key].defaults.includes(role);
      const isGrantable = EXPECTED[key].grantable.includes(role);
      const name = `${key} / ${role}`;
      assert.equal(roleDefault(key, role), isDefault, `${name} role default`);
      // Missing, null and non-boolean overrides inherit the role default.
      for (const overrides of [undefined, null, {}, { [key]: null }, { [key]: 'true' }, { [key]: 1 }, { 'other.key': true }]) {
        assert.equal(can(key, { role, overrides }), isDefault, `${name} inherit ${JSON.stringify(overrides)}`);
      }
      if (role === 'admin') {
        // Foundational Admin access cannot be removed, even by stale or malformed data.
        for (const value of [false, true, null, 'false']) {
          assert.equal(can(key, { role, overrides: { [key]: value } }), true, `${name} Admin lock ${JSON.stringify(value)}`);
        }
      } else {
        assert.equal(can(key, { role, overrides: { [key]: false } }), false, `${name} explicit false`);
        assert.equal(can(key, { role, overrides: { [key]: true } }), isDefault || isGrantable, `${name} explicit true`);
      }
    }
  }
});

test('Release Week keeps PM access by default, an Admin can switch it off or on for individuals', () => {
  assert.equal(can('week.release', { role: 'pm' }), true);
  assert.equal(can('week.release', { role: 'pm', overrides: { 'week.release': false } }), false);
  assert.equal(can('week.release', { role: 'pm', overrides: { 'week.release': true } }), true);
  for (const role of ['engineering', 'business', 'sales', 'bd', 'product']) {
    assert.equal(can('week.release', { role }), false, role);
    assert.equal(can('week.release', { role, overrides: { 'week.release': true } }), true, role);
  }
  for (const role of ['vip', 'executive']) {
    assert.equal(can('week.release', { role, overrides: { 'week.release': true } }), false, `${role} has no release controls`);
  }
});

test('capabilities are independent: one override never affects another capability', () => {
  for (const key of DELEGABLE) {
    for (const other of DELEGABLE.filter(candidate => candidate !== key)) {
      assert.equal(can(other, { role: 'engineering', overrides: { [key]: true } }), false, `${key} must not grant ${other}`);
    }
  }
});

test('unknown capabilities, unknown roles and missing input fail closed', () => {
  for (const capability of ['week.unknown', '', undefined, null, 42, '__proto__', 'constructor', 'toString', 'admin']) {
    for (const role of ROLES) {
      assert.equal(can(capability, { role, overrides: { [String(capability)]: true } }), false, `${capability} / ${role}`);
    }
  }
  for (const role of ['superuser', '', undefined, null, 7, ['admin'], { admin: true }]) {
    for (const key of [...DELEGABLE, 'permissions.manage']) {
      assert.equal(can(key, { role, overrides: { [key]: true } }), false, `${key} / ${JSON.stringify(role)}`);
    }
  }
  assert.equal(can('week.manage'), false);
  assert.equal(can('week.manage', {}), false);
  assert.equal(roleDefault('nope', 'admin'), false);
});

test('role normalization trims and lowercases strings only', () => {
  assert.equal(normalizePermissionRole(' PM '), 'pm');
  assert.equal(normalizePermissionRole('ADMIN'), 'admin');
  assert.equal(can('project.manage', { role: ' Admin ' }), true);
  for (const bad of ['owner', '', undefined, null, 7, ['pm'], { role: 'pm' }]) assert.equal(normalizePermissionRole(bad), '');
});

test('permissions.manage is reserved for raw-role Admin and is never delegable', () => {
  assert.equal(can('permissions.manage', { role: 'admin' }), true);
  for (const role of NON_ADMIN_ROLES) {
    assert.equal(can('permissions.manage', { role, overrides: { 'permissions.manage': true } }), false, role);
  }
  assert.equal(can('permissions.manage', { role: 'admin', overrides: { 'permissions.manage': false } }), true);
});

test('override normalization keeps only known boolean entries', () => {
  assert.deepEqual(normalizePermissionOverrides({
    'week.manage': true, 'week.release': false, 'gantt.manage': true, 'project.manage': false,
    'permissions.manage': true, stale: false, 'week.legacy': true,
  }), { 'week.manage': true, 'week.release': false, 'gantt.manage': true, 'project.manage': false, 'permissions.manage': true });
  assert.deepEqual(normalizePermissionOverrides({ 'week.manage': 'true', 'week.release': null }), {});
  for (const bad of [null, undefined, 'junk', [], [true], 3]) assert.deepEqual(normalizePermissionOverrides(bad), {});
  assert.equal(isKnownCapability('week.release'), true);
  assert.equal(isKnownCapability('admin'), false);
  assert.equal(isKnownCapability('uat.productionSync'), false);
});
