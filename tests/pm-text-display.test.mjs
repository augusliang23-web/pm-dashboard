import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const escapeHelper = html.match(/function escHtml\(v\) \{[\s\S]*?\n\}/)?.[0];
const renderer = html.match(/function formatBullets\(text\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(escapeHelper, 'index.html must define escHtml');
assert.ok(renderer, 'index.html must define formatBullets');
const formatBullets = new Function(`${escapeHelper}\n${renderer}\nreturn formatBullets;`)();

test('v2.1 production source displays PM text exactly as entered', () => {
  const source = '3. jfidsao\n  3.1 jdkaojfied\n  3.2 fjdosapuveda\n- test\n  - nested test';
  assert.equal(
    formatBullets(source),
    '<div class="structured-text">3. jfidsao\n  3.1 jdkaojfied\n  3.2 fjdosapuveda\n- test\n  - nested test</div>',
  );
});

test('v2.1 production source saves PM text without trimming it', () => {
  assert.doesNotMatch(html, /highlight: document\.getElementById\('pe_highlight'\)\.value\.trim\(\)/);
  assert.doesNotMatch(html, /weeklyActions: document\.getElementById\('pe_weekly_actions'\)\.value\.trim\(\)/);
  assert.doesNotMatch(html, /row\.querySelector\('\.rap-risk'\)\?\.value\.trim\(\)/);
  assert.doesNotMatch(html, /row\.querySelector\('\.rap-action'\)\?\.value\.trim\(\)/);
});
