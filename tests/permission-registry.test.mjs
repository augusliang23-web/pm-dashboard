import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPABILITIES,
  can,
  isKnownCapability,
  normalizePermissionOverrides,
  normalizePermissionRole,
} from '../js/permission-registry.mjs';

const NON_ADMIN_ROLES = ['pm', 'engineering', 'business', 'sales', 'bd', 'product', 'executive', 'vip'];

test('week.manage is held by Admin only as a role default', () => {
  assert.equal(can('week.manage', { role: 'admin' }), true);
  for (const role of NON_ADMIN_ROLES) {
    assert.equal(can('week.manage', { role }), false, `${role} has no role default`);
    assert.equal(can('week.manage', { role, overrides: {} }), false, `${role} with empty overrides`);
  }
});

test('an explicit true override grants week.manage to every recognized non-Admin role, including VIP and Executive', () => {
  for (const role of NON_ADMIN_ROLES) {
    assert.equal(can('week.manage', { role, overrides: { 'week.manage': true } }), true, role);
    assert.equal(can('week.manage', { role, overrides: { 'week.manage': false } }), false, `${role} explicit false`);
  }
  assert.deepEqual([...CAPABILITIES['week.manage'].grantableRoles].sort(), [...NON_ADMIN_ROLES].sort());
});

test('the product resolver matrix for week.manage', () => {
  const matrix = [
    ['admin', undefined, true], ['admin', false, true],
    ['pm', undefined, false], ['pm', true, true],
    ['engineering', undefined, false], ['engineering', true, true],
    ['sales', true, true], ['bd', true, true], ['business', true, true], ['product', true, true],
    ['vip', undefined, false], ['vip', true, true],
    ['executive', undefined, false], ['executive', true, true],
    ['unknown', true, false], ['owner', undefined, false],
  ];
  for (const [role, value, expected] of matrix) {
    const overrides = value === undefined ? {} : { 'week.manage': value };
    assert.equal(can('week.manage', { role, overrides }), expected, `${role} / ${value}`);
  }
});

test('an explicit false override denies, and missing/null inherits the role default', () => {
  assert.equal(can('week.manage', { role: 'pm', overrides: { 'week.manage': false } }), false);
  assert.equal(can('week.manage', { role: 'pm', overrides: { 'week.manage': null } }), false);
  assert.equal(can('week.manage', { role: 'pm', overrides: { 'other.key': true } }), false);
});

test('Admin keeps week.manage even when stale or malformed data says false', () => {
  for (const overrides of [{ 'week.manage': false }, { 'week.manage': 'false' }, { 'week.manage': null }, null, 'junk', []]) {
    assert.equal(can('week.manage', { role: 'admin', overrides }), true, JSON.stringify(overrides));
  }
  assert.equal(can('week.manage', { role: ' ADMIN ', overrides: { 'week.manage': false } }), true);
});

test('only boolean overrides count; strings, numbers and objects inherit', () => {
  for (const value of ['true', 1, {}, [], 'yes']) {
    assert.equal(can('week.manage', { role: 'pm', overrides: { 'week.manage': value } }), false, JSON.stringify(value));
  }
});

test('unknown capabilities, unknown roles and missing input fail closed', () => {
  assert.equal(can('week.unknown', { role: 'admin' }), false);
  assert.equal(can('week.unknown', { role: 'pm', overrides: { 'week.unknown': true } }), false);
  assert.equal(can('', { role: 'admin' }), false);
  assert.equal(can(undefined, { role: 'admin' }), false);
  assert.equal(can('__proto__', { role: 'admin' }), false);
  assert.equal(can('constructor', { role: 'admin' }), false);
  assert.equal(can('week.manage', { role: 'superuser', overrides: { 'week.manage': true } }), false);
  assert.equal(can('week.manage', { role: '', overrides: { 'week.manage': true } }), false);
  assert.equal(can('week.manage'), false);
  assert.equal(can('week.manage', {}), false);
});

test('permissions.manage is reserved for raw-role Admin and is never delegable', () => {
  assert.equal(CAPABILITIES['permissions.manage'].delegable, false);
  assert.equal(can('permissions.manage', { role: 'admin' }), true);
  for (const role of NON_ADMIN_ROLES) {
    assert.equal(can('permissions.manage', { role, overrides: { 'permissions.manage': true } }), false, role);
  }
});

test('the registry is frozen and has no generic Admin or sync capability', () => {
  assert.ok(Object.isFrozen(CAPABILITIES));
  for (const definition of Object.values(CAPABILITIES)) {
    assert.ok(Object.isFrozen(definition) && Object.isFrozen(definition.roleDefaults) && Object.isFrozen(definition.grantableRoles));
    assert.equal(definition.grantableRoles.includes('admin'), false);
  }
  assert.deepEqual(Object.keys(CAPABILITIES).sort(), ['permissions.manage', 'week.manage']);
  assert.equal(isKnownCapability('week.manage'), true);
  assert.equal(isKnownCapability('admin'), false);
  assert.equal(isKnownCapability('uat.productionSync'), false);
});

test('override normalization keeps only known boolean entries', () => {
  assert.deepEqual(normalizePermissionOverrides({
    'week.manage': true, 'permissions.manage': true, stale: false, 'week.release': true,
  }), { 'week.manage': true, 'permissions.manage': true });
  assert.deepEqual(normalizePermissionOverrides({ 'week.manage': 'true' }), {});
  assert.deepEqual(normalizePermissionOverrides(null), {});
  assert.deepEqual(normalizePermissionOverrides([true]), {});
  assert.equal(normalizePermissionRole(' PM '), 'pm');
  assert.equal(normalizePermissionRole('owner'), '');
});
