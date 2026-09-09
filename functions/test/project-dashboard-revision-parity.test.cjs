const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const server = require('../project-dashboard-writes');

test('Functions and browser project revision fingerprints are byte-identical', async () => {
  assert.equal(typeof server.projectRevisionFingerprint, 'function');
  const browser = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'js', 'project-mutations.mjs')).href);
  const timestamp = { toMillis: () => 1776556800000 };
  const fixtures = [
    { code: 'A', nested: { z: 1, a: true }, rows: [{ id: '2' }, { id: '1' }] },
    { rows: [undefined, null, Number.NaN, Number.POSITIVE_INFINITY], createdAt: new Date('2026-08-18T00:00:00.000Z') },
    { updatedAt: timestamp, bigint: 12n, omitted: undefined },
  ];
  for (const fixture of fixtures) {
    assert.equal(server.projectRevisionFingerprint(fixture), browser.projectRevisionFingerprint(fixture));
  }
  assert.equal(
    server.projectRevisionFingerprint({ b: 2, a: 1 }),
    server.projectRevisionFingerprint({ a: 1, b: 2 }),
  );
});
