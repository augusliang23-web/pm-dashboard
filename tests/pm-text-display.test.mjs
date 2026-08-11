import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert.match(source, /function formatBullets\(text\) \{\s*if \(text === null \|\| text === undefined \|\| text === ''\) return '-';\s*return `<div class="structured-text">\$\{escHtml\(text\)\}<\/div>`;/s);
assert.doesNotMatch(source, /const lines = text\.split\('\n'\)\.map\(l => l\.trim\(\)\.replace/);
assert.match(source, /highlight: document\.getElementById\('pe_highlight'\)\.value,/);
assert.match(source, /risk: document\.getElementById\('pe_risk'\)\.value,/);
assert.match(source, /next: document\.getElementById\('pe_next'\)\.value/);

console.log('PM raw-text display regression tests: 5 passed');
