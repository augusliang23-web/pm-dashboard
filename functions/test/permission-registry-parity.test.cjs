const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const server = require('../permission-registry');

const ROLES = ['admin', 'pm', 'vip', 'executive', 'engineering', 'business', 'sales', 'bd', 'product', ' Admin ', 'PM', '', 'unknown', undefined];
const VALUES = [undefined, true, false, null, 'true', 1];
const CAPABILITY_KEYS = ['week.manage', 'permissions.manage', 'week.unknown', '', '__proto__'];

async function browserRegistry() {
  return import(pathToFileURL(path.resolve(__dirname, '..', '..', 'js', 'permission-registry.mjs')).href);
}

test('Functions permission registry data matches the browser registry', async () => {
  const browser = await browserRegistry();
  assert.deepEqual(JSON.parse(JSON.stringify(server.CAPABILITIES)), JSON.parse(JSON.stringify(browser.CAPABILITIES)));
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
