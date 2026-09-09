import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('milestone reordering starts only from its dedicated handle', () => {
  const start = dashboard.indexOf('window.addMilestoneRow');
  const end = dashboard.indexOf('window.addQuarterlyMilestoneRow', start);
  const source = dashboard.slice(start, end);
  assert.doesNotMatch(source, /div\.draggable\s*=\s*true/);
  assert.match(source, /class="drag-handle milestone-drag-handle" draggable="true"/);
  assert.match(source, /handle\.ondragstart/);
  assert.match(source, /div\.classList\.add\('dragging'\)/);
  assert.match(source, /handle\.ondragend/);
});

test('other project editor rows do not make their input containers draggable', () => {
  for (const marker of ['window.addQuarterlyMilestoneRow', 'window.addTeamMemberRow', 'window.refreshDisciplineHoursEditor']) {
    const start = dashboard.indexOf(marker);
    assert.ok(start >= 0, marker);
    const source = dashboard.slice(start, start + 9000);
    assert.doesNotMatch(source, /\.draggable\s*=\s*true/);
  }
});
