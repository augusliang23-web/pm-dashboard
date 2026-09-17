import assert from 'node:assert/strict';
import test from 'node:test';

import { createDisplayNameDirectory } from '../js/display-name-directory.mjs';

test('stored display name wins for the matching email regardless of case', () => {
  const directory = createDisplayNameDirectory();
  directory.replace([{ id: 'robin.lee@example.test', displayName: ' Team Lead ' }]);

  assert.equal(directory.resolve('ROBIN.LEE@EXAMPLE.TEST'), 'Team Lead');
  assert.equal(directory.resolve('kai.lin@example.test'), 'Kai');
});

test('missing or invalid stored names use the generic first-dot email prefix', () => {
  const directory = createDisplayNameDirectory();
  directory.replace([
    { id: 'kai.lin@example.test', displayName: '' },
    { id: 'morgan.su@example.test', displayName: 'X'.repeat(129) },
    { id: 'avery.chen@example.test', displayName: 'Bad\nName' },
    { id: 'sam.wu@example.test', displayName: 42 },
  ]);

  assert.equal(directory.resolve('kai.lin@example.test'), 'Kai');
  assert.equal(directory.resolve('morgan.su@example.test'), 'Morgan');
  assert.equal(directory.resolve('avery.chen@example.test'), 'Avery');
  assert.equal(directory.resolve('sam.wu@example.test'), 'Sam');
  assert.equal(directory.resolve(null), 'System');
  assert.equal(directory.resolve('System'), 'System');
});

test('replacing or clearing a directory removes previous session names', () => {
  const directory = createDisplayNameDirectory();
  directory.set('robin.lee@example.test', { displayName: 'Session A' });
  assert.equal(directory.resolve('robin.lee@example.test'), 'Session A');

  directory.replace([{ id: 'kai.lin@example.test', displayName: 'Session B' }]);
  assert.equal(directory.resolve('robin.lee@example.test'), 'Robin');
  assert.equal(directory.resolve('kai.lin@example.test'), 'Session B');

  directory.clear();
  assert.equal(directory.resolve('kai.lin@example.test'), 'Kai');
});
