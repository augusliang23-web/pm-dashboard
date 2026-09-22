import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('project cards display member count, average allocation, and FTE', async () => {
  const html = await dashboardSourceAsync('production');

  assert.match(html, /summarizeTeamEffort/);
  assert.match(
    html,
    /Avg \$\{teamEffort\.averagePct\}% · \$\{teamEffort\.fte\.toFixed\(1\)\} FTE/,
  );
  assert.doesNotMatch(html, /\$\{teamTotal\}%/);
});
