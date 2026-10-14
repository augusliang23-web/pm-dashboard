import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dashboardSource } from './helpers/dashboard-source.mjs';
import { parseWeekLabel, sortWeeksChronologically } from '../js/week-order.mjs';
import { buildDeliveryTrendsState } from '../js/delivery-trends-page.mjs';

const labels = list => list.map(item => item.weekLabel);
const make = names => names.map(weekLabel => ({ weekLabel }));
const SHUFFLED = ['W2 2026', 'W52 2025', 'W7 2025', 'W1 2026', 'W17 2025', 'W53 2026', 'W10 2026', 'W9 2026', 'W53 2020', 'W1 2021'];

// Extract the real functions from the page source a profile actually runs.
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf('\n}\n', start) + 3;
  return source.slice(start, end);
}

test('REPRODUCTION: the legacy numeric label sort misorders weeks across ISO years', () => {
  const legacy = new Function(`${extract(dashboardSource('production'), 'sortWeeksByLabel')}; return sortWeeksByLabel;`)();
  assert.deepEqual(labels(legacy(make(['W52 2025', 'W7 2025', 'W1 2026', 'W2 2026']))), ['W1 2026', 'W2 2026', 'W7 2025', 'W52 2025']);
  // The consequence: the "latest" week (allWeeks.length - 1) is W52 2025 although W2 2026 exists.
  const sorted = legacy(make(['W2 2026', 'W52 2025', 'W7 2025', 'W1 2026']));
  assert.equal(sorted.at(-1).weekLabel, 'W52 2025');
});

test('REPRODUCTION: inside a single year the legacy sort is already correct (no false alarm)', () => {
  const legacy = new Function(`${extract(dashboardSource('production'), 'sortWeeksByLabel')}; return sortWeeksByLabel;`)();
  assert.deepEqual(labels(legacy(make(['W10 2026', 'W9 2026', 'W2 2026', 'W41 2026', 'W17 2026']))), ['W2 2026', 'W9 2026', 'W10 2026', 'W17 2026', 'W41 2026']);
});

test('chronological sort handles non-padded weeks, year rollover and valid ISO week 53', () => {
  assert.deepEqual(labels(sortWeeksChronologically(make(SHUFFLED))), ['W53 2020', 'W1 2021', 'W7 2025', 'W17 2025', 'W52 2025', 'W1 2026', 'W2 2026', 'W9 2026', 'W10 2026', 'W53 2026']);
});

test('ISO week validity: W53 only exists in 53-week years; W0, W54 and junk are never dated', () => {
  assert.deepEqual(parseWeekLabel('W53 2026'), { year: 2026, week: 53 });
  assert.deepEqual(parseWeekLabel('W53 2020'), { year: 2020, week: 53 });
  for (const bad of ['W53 2025', 'W0 2026', 'W54 2026', 'W1 26', 'Week 1 2026', 'W26 2026 Prototype', '', null, undefined, 'w1 2026', 'W01 20266']) {
    assert.equal(parseWeekLabel(bad), null, String(bad));
  }
});

test('invalid or ambiguous labels never become valid chronological dates: they stay after every valid week', () => {
  const sorted = labels(sortWeeksChronologically(make(['W53 2025', 'W2 2026', 'W26 2026 Prototype', 'W1 2026', 'W52 2025'])));
  assert.deepEqual(sorted, ['W52 2025', 'W1 2026', 'W2 2026', 'W26 2026 Prototype', 'W53 2025']);
});

test('sorting is stable, does not mutate its input and never drops or duplicates records', () => {
  const input = [{ weekLabel: 'W3 2026', id: 'a' }, { weekLabel: 'W3 2026', id: 'b' }, { weekLabel: 'W1 2026', id: 'c' }];
  const copy = JSON.stringify(input);
  const sorted = sortWeeksChronologically(input);
  assert.equal(JSON.stringify(input), copy);
  assert.deepEqual(sorted.map(item => item.id), ['c', 'a', 'b']);
  assert.deepEqual(sortWeeksChronologically(null), []);
  assert.deepEqual(sortWeeksChronologically([]), []);
});

test('week objects, ids and non-enumerable document ids are preserved by reference', () => {
  const week = { weekLabel: 'W5 2026' };
  Object.defineProperty(week, '__documentId', { value: 'W5-2026', enumerable: false });
  const [same] = sortWeeksChronologically([week]);
  assert.equal(same, week);
  assert.equal(same.__documentId, 'W5-2026');
});

test('UAT initData sorts chronologically; Production keeps the legacy sort byte-for-byte', () => {
  const uat = dashboardSource('uat');
  const production = dashboardSource('production');
  assert.equal((uat.match(/allWeeks = sortWeeksChronologically\(fetchedWeeks\);/g) || []).length, 1);
  assert.equal((uat.match(/allWeeks = sortWeeksByLabel\(fetchedWeeks\);/g) || []).length, 0);
  assert.equal((production.match(/allWeeks = sortWeeksByLabel\(fetchedWeeks\);/g) || []).length, 1);
  assert.doesNotMatch(production, /sortWeeksChronologically|week-order\.mjs/);
  assert.match(uat, /import \{ sortWeeksChronologically \} from "\.\/js\/week-order\.mjs";/);
});

test('default latest-week selection, previous/next navigation and the reporting anchor follow chronological order', () => {
  const names = ['W2 2026', 'W52 2025', 'W7 2025', 'W1 2026'];
  const legacy = new Function(`${extract(dashboardSource('production'), 'sortWeeksByLabel')}; return sortWeeksByLabel;`)();
  const wrong = legacy(make(names));
  const right = sortWeeksChronologically(make(names));
  // Latest selection is allWeeks.length - 1 (initData); navigation clamps currentIdx + dir to [0, length - 1] (navWeek).
  assert.equal(wrong.at(-1).weekLabel, 'W52 2025');
  assert.equal(right.at(-1).weekLabel, 'W2 2026');
  const nav = (weeks, idx, dir) => Math.max(0, Math.min(weeks.length - 1, idx + dir));
  assert.equal(right[nav(right, right.length - 1, -1)].weekLabel, 'W1 2026');
  assert.equal(right[nav(right, right.length - 1, 1)].weekLabel, 'W2 2026');
  assert.equal(right[nav(right, 0, -1)].weekLabel, 'W7 2025');
});

test('Delivery Trends anchors on the chronologically latest week once the list is sorted', () => {
  const periods = [[2025, 50], [2025, 51], [2025, 52], [2026, 1], [2026, 2]];
  const weeks = periods.map(([year, week], i) => ({ weekId: `W${week}-${year}`, weekLabel: `W${week} ${year}`, isReleased: true, version: 1, reportingPeriod: { year, week },
    projects: [{ projectId: 'p1', code: 'P1', name: 'Alpha', projectManager: 'PM', progress: 10 + i * 2, status: 'green', projectLevel: 'system', visibility: 'active', lifecycle: 'active' }] }));
  const sorted = sortWeeksChronologically([...weeks].reverse());
  const state = buildDeliveryTrendsState({ weeks: sorted, currentIdx: sorted.length - 1, windowWeeks: 6, overviewScope: 'system', role: 'admin', source: 'uat', asOf: '2026-01-20T00:00:00.000Z' });
  assert.equal(state.contract.provenance.anchorWeekId, 'W2-2026');
  assert.equal(state.contract.summary.weeklyProgressGainPp, 2);
});

// getIsoWeekData creates the next week's label: verify it at ISO-year boundaries in several time zones.
test('getIsoWeekData produces valid ISO labels and Monday-Friday dates across year boundaries in any time zone', () => {
  const source = extract(dashboardSource('uat'), 'getIsoWeekData');
  const script = `${source}
    const out = [];
    for (const [iso, offset] of [['2025-12-24', 1], ['2026-12-21', 1], ['2020-12-21', 1], ['2024-12-23', 1], ['2026-01-05', 0]]) {
      const [y, m, d] = iso.split('-').map(Number);
      const r = getIsoWeekData(new Date(y, m - 1, d), offset);
      out.push(r.label + ' | ' + r.dateStr);
    }
    console.log(JSON.stringify(out));`;
  const expected = ['W1 2026 | Dec 29 - Jan 2', 'W53 2026 | Dec 28 - Jan 1', 'W53 2020 | Dec 28 - Jan 1', 'W1 2025 | Dec 30 - Jan 3', 'W2 2026 | Jan 5 - Jan 9'];
  // Note: the 2026-01-05 input with offset 0 is the Monday of ISO W2 2026.
  for (const tz of ['UTC', 'Asia/Taipei', 'America/Los_Angeles']) {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));
    assert.deepEqual(result, expected, tz);
  }
});
