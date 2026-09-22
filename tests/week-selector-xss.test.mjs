import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function rootEscHtml() {
  const start = dashboard.indexOf('function escHtml(v) {');
  const end = dashboard.indexOf('\n}', start) + 2;
  assert.notEqual(start, -1, 'root dashboard must provide escHtml');
  return new Function(`${dashboard.slice(start, end)}; return escHtml;`)();
}

function weekSelectorTemplate() {
  const start = dashboard.indexOf('sel.innerHTML = allWeeks.map((w, i) =>');
  const end = dashboard.indexOf('\n      sel.value = currentIdx;', start);
  assert.notEqual(start, -1, 'root dashboard must render the week selector');
  const assignment = dashboard.slice(start, end);
  const mapExpression = assignment.match(/allWeeks\.map\(\(w, i\) => `[\s\S]*?`\)\.join\(''\)/)?.[0];
  assert.ok(mapExpression, 'week selector must render its option template from Firestore weeks');
  return new Function('allWeeks', 'escHtml', `return ${mapExpression};`);
}

test('week selector renders a malicious Firestore label as literal option text', () => {
  const renderOptions = weekSelectorTemplate();
  const options = renderOptions([
    { weekLabel: '<img src=x onerror=alert(1)>', weekDate: '2026-08-18' },
  ], rootEscHtml());

  assert.equal(
    options,
    '<option value="0">&lt;img src=x onerror=alert(1)&gt; (2026-08-18)</option>',
  );
  assert.doesNotMatch(options, /<img\b/i);
});

test('week selector renders a malicious Firestore date as literal option text', () => {
  const renderOptions = weekSelectorTemplate();
  const options = renderOptions([
    { weekLabel: 'W34', weekDate: '<img src=x onerror=alert(2)>' },
  ], rootEscHtml());

  assert.equal(
    options,
    '<option value="0">W34 (&lt;img src=x onerror=alert(2)&gt;)</option>',
  );
  assert.doesNotMatch(options, /<img\b/i);
});

test('root innerHTML templates do not interpolate week metadata without escHtml', () => {
  const rawWeekMetadata = [
    ...dashboard.matchAll(/\.innerHTML\s*=\s*[^;]*?\$\{\s*[A-Za-z_$][\w$]*\.(?:weekLabel|weekDate)\s*\}[^;]*?;/gs),
  ].map(match => match[0]);

  assert.deepEqual(rawWeekMetadata, []);
});
