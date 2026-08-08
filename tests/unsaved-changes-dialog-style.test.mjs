import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboards = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../team-2/index.html', import.meta.url), 'utf8'),
]);

test('styles the unsaved-change discard action as a dashboard danger button', () => {
  for (const dashboard of dashboards) {
    assert.match(dashboard, /class="btn btn-danger"[^>]*>Discard changes<\/button>/);
    assert.match(dashboard, /\.btn-danger\s*\{[^}]*font-size:\s*12px[^}]*border-radius:\s*6px[^}]*background:\s*var\(--red\)[^}]*color:\s*#fff[^}]*\}/s);
    assert.match(dashboard, /\.btn-danger:hover\s*\{[^}]*background:\s*#C77D7D[^}]*\}/s);
  }
});
