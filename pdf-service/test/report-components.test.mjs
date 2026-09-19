import test from 'node:test';
import assert from 'node:assert/strict';
import { rawTextBlock } from '../src/report-components.js';

test('renders CRLF and array text as escaped raw line units without list tags', () => {
  const html = rawTextBlock(['Alpha\r\nBeta', '• <unsafe>']);

  assert.equal((html.match(/class="pdf-raw-text-line"/g) || []).length, 3);
  assert.match(html, />Alpha<\/div>/);
  assert.match(html, />Beta<\/div>/);
  assert.match(html, />• &lt;unsafe&gt;<\/div>/);
  assert.equal((html.match(/data-pdf-split-unit/g) || []).length, 3);
  assert.doesNotMatch(html, /<ul|<li/);
});
