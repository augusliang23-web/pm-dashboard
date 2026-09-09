import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectDashboardApi } from '../js/project-dashboard-api.mjs';

test('dashboard API maps each business mutation to its protected Callable', async () => {
  const calls = [];
  const api = createProjectDashboardApi({
    functions: { region: 'us-central1' },
    httpsCallable: (_functions, name) => async data => {
      calls.push({ name, data });
      return { data: { ok: true } };
    },
  });

  await api.saveProject({ weekId: 'W30-2026' });
  await api.deleteProject({ weekId: 'W30-2026' });
  await api.setAttention({ weekId: 'W30-2026' });
  await api.saveWeekFields({ weekId: 'W30-2026' });
  await api.createWeek({ weekId: 'W31-2026' });
  await api.setWeekRelease({ weekId: 'W30-2026' });
  await api.saveGanttTemplateSettings({ expectedRevision: 4, config: { system: ['Plan'] } });

  assert.deepEqual(calls.map(call => call.name), [
    'saveDashboardProject',
    'deleteDashboardProject',
    'setDashboardProjectAttention',
    'saveDashboardWeekFields',
    'createDashboardWeek',
    'setDashboardWeekRelease',
    'saveDashboardGanttTemplateSettings',
  ]);
});
