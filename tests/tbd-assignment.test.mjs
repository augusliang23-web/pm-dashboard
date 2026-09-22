import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await dashboardSourceAsync('production');

test('Owner and Deputy offer TBD without granting project ownership', () => {
  assert.match(html, /const PROJECT_MEMBER_TBD = ['"]TBD['"]/);
  assert.match(html, /\[\s*PROJECT_MEMBER_TBD,\s*\.\.\.PM_LIST,\s*p\.owner\s*\]/);
  assert.match(html, /\[\s*PROJECT_MEMBER_TBD,\s*\.\.\.PM_LIST,\s*p\.deputy\s*\]/);
  assert.match(html, /owner === PROJECT_MEMBER_TBD\.toLowerCase\(\) \? ['"]{2} : owner/);
  assert.match(html, /deputy === PROJECT_MEMBER_TBD\.toLowerCase\(\) \? ['"]{2} : deputy/);
});
