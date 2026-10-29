import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardSource, normalizeProjectManagerLabelsForBaseline } from './helpers/dashboard-source.mjs';

const oldLabel = '<label class="fl">Project Manager</label>';
const accessibleLabel = '<label class="fl" for="pe_owner">Project Manager</label>';
const source = dashboardSource('production');

test('normalizes the approved accessible and historical Project Manager labels identically', () => {
  assert.equal(normalizeProjectManagerLabelsForBaseline(source),
    normalizeProjectManagerLabelsForBaseline(source.replace(accessibleLabel, oldLabel)));
});

test('rejects missing, duplicate, or altered Project Manager labels', () => {
  for (const replacement of ['', accessibleLabel + oldLabel, '<label class="fl" for="other">Project Manager</label>', '<label class="fl" for="pe_owner" hidden>Project Manager</label>']) {
    assert.throws(() => normalizeProjectManagerLabelsForBaseline(source.replace(accessibleLabel, replacement)), /Project Manager label invariant failed/);
  }
});
