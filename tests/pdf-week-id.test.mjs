import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboards = ['index.html'];

for (const dashboard of dashboards) {
  test(`${dashboard} falls back to weekLabel when PDF metadata is unavailable`, async () => {
    const source = await dashboardSourceAsync('production');
    const professionalDownload = source.match(
      /async function downloadProfessionalReport\([\s\S]*?\n}/
    )?.[0] || '';

    assert.match(
      professionalDownload,
      /const selectedWeek = allWeeks\[currentIdx\];[\s\S]*const weekId = selectedWeek\?\.__documentId \|\| selectedWeek\?\.weekLabel\?\.replace\(\/\\s\+\/g, '-'\);/
    );
  });
}
