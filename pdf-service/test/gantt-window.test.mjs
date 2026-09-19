import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WINDOW_MONTHS,
  filterWorkstreamsByWindow,
  resolveGanttWindowMonths,
  resolveGanttWindowSettings,
  resolveReportAnchorDate,
  sanitizeDraftGanttWindowSettings
} from '../src/gantt-window.js';

test('resolves the report anchor date from the week label and date range', () => {
  const anchor = resolveReportAnchorDate({ weekLabel: 'W28 2026', weekDate: 'Jul 6 - Jul 12' });
  assert.equal(anchor.toISOString().slice(0, 10), '2026-07-12');
});

test('falls back to today when the week carries no parseable date', () => {
  const anchor = resolveReportAnchorDate({});
  const today = new Date();
  assert.equal(anchor.getUTCFullYear(), today.getUTCFullYear());
  assert.equal(anchor.getUTCMonth(), today.getUTCMonth());
  assert.equal(anchor.getUTCDate(), today.getUTCDate());
});

test('sanitizes a raw dashboardSettings document into defaultMonths + overrides', () => {
  const settings = resolveGanttWindowSettings({
    ganttWindowDefaultMonths: 9,
    ganttWindowOverrides: { 'EGP-014': 12, 'BAD-CODE': 999, '': 3, 'ZERO-CODE': 0 }
  });
  assert.deepEqual(settings, { defaultMonths: 9, overrides: { 'EGP-014': 12 } });
});

test('falls back to the 6-month default when the settings document is missing or malformed', () => {
  assert.deepEqual(resolveGanttWindowSettings(undefined), { defaultMonths: DEFAULT_WINDOW_MONTHS, overrides: {} });
  assert.deepEqual(resolveGanttWindowSettings({ ganttWindowDefaultMonths: 999 }), { defaultMonths: DEFAULT_WINDOW_MONTHS, overrides: {} });
  assert.deepEqual(resolveGanttWindowSettings({ ganttWindowOverrides: 'not-an-object' }), { defaultMonths: DEFAULT_WINDOW_MONTHS, overrides: {} });
});

test('sanitizes an already-clean draft (defaultMonths/overrides), unlike resolveGanttWindowSettings which expects raw doc field names', () => {
  const clean = sanitizeDraftGanttWindowSettings({ defaultMonths: 12, overrides: { 'EGP-014': 9, 'BAD-CODE': 999, '': 3 } });
  assert.deepEqual(clean, { defaultMonths: 12, overrides: { 'EGP-014': 9 } });

  assert.deepEqual(sanitizeDraftGanttWindowSettings(undefined), { defaultMonths: DEFAULT_WINDOW_MONTHS, overrides: {} });
  assert.deepEqual(sanitizeDraftGanttWindowSettings({ defaultMonths: 'nope' }), { defaultMonths: DEFAULT_WINDOW_MONTHS, overrides: {} });

  // Feeding a raw-doc-shaped object (ganttWindowDefaultMonths) through the draft sanitizer
  // finds no defaultMonths field and correctly falls back, rather than silently misreading it.
  assert.deepEqual(
    sanitizeDraftGanttWindowSettings({ ganttWindowDefaultMonths: 12 }),
    { defaultMonths: DEFAULT_WINDOW_MONTHS, overrides: {} }
  );
});

test('resolves a project-specific override ahead of the portfolio default', () => {
  const settings = { defaultMonths: 6, overrides: { 'EGP-014': 12 } };
  assert.equal(resolveGanttWindowMonths('EGP-014', settings), 12);
  assert.equal(resolveGanttWindowMonths('BMR-007', settings), 6);
});

test('returns null (no window configured) when no settings object is passed at all', () => {
  assert.equal(resolveGanttWindowMonths('EGP-014', undefined), null);
});

test('keeps workstreams inside the forward window and drops ones safely past it', () => {
  const { workstreams, filteredOutCount, totalCount } = filterWorkstreamsByWindow({
    workstreams: [
      { id: 'a', startDate: '2026-07-01', endDate: '2026-07-15', status: 'on-track' },
      { id: 'b', startDate: '2027-06-01', endDate: '2027-06-15', status: 'on-track' }
    ],
    anchorDate: new Date('2026-07-12T00:00:00Z'),
    windowMonths: 6
  });
  assert.deepEqual(workstreams.map(item => item.id), ['a']);
  assert.equal(filteredOutCount, 1);
  assert.equal(totalCount, 2);
});

test('keeps a one-month backward buffer of recently active work', () => {
  const { workstreams } = filterWorkstreamsByWindow({
    workstreams: [
      { id: 'recent', startDate: '2026-06-20', endDate: '2026-06-25', status: 'completed' },
      { id: 'stale', startDate: '2026-04-01', endDate: '2026-04-05', status: 'completed' }
    ],
    anchorDate: new Date('2026-07-12T00:00:00Z'),
    windowMonths: 6
  });
  assert.deepEqual(workstreams.map(item => item.id), ['recent']);
});

test('never filters out at-risk or delayed workstreams regardless of date', () => {
  const { workstreams, filteredOutCount } = filterWorkstreamsByWindow({
    workstreams: [
      { id: 'risk', startDate: '2020-01-01', endDate: '2020-01-05', status: 'at-risk' },
      { id: 'delayed', startDate: '2030-01-01', endDate: '2030-01-05', status: 'delayed' }
    ],
    anchorDate: new Date('2026-07-12T00:00:00Z'),
    windowMonths: 6
  });
  assert.deepEqual(workstreams.map(item => item.id), ['risk', 'delayed']);
  assert.equal(filteredOutCount, 0);
});

test('never hides an unscheduled workstream that has no parseable dates', () => {
  const { workstreams, filteredOutCount } = filterWorkstreamsByWindow({
    workstreams: [{ id: 'unscheduled', startDate: '', endDate: '', status: 'not-started' }],
    anchorDate: new Date('2026-07-12T00:00:00Z'),
    windowMonths: 6
  });
  assert.deepEqual(workstreams.map(item => item.id), ['unscheduled']);
  assert.equal(filteredOutCount, 0);
});
