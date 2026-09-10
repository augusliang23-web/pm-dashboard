import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { withProjectEditorRowIds, mergePreservingUnknown } from '../js/project-mutations.mjs';
const require = createRequire(import.meta.url);
const backend = require('../functions/project-data-merge.cjs');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('server preservation matches browser legacy row identity and deletion semantics', () => {
  const live = { code: 'H/W-001', teamMembers: [{ name: 'One', extra: 'keep' }, { name: 'Two' }],
    budget: { approvedBy: 'Finance', monthlyPlans: [{ month: '2026-01', audit: 'keep' }] } };
  const baseline = withProjectEditorRowIds(live);
  assert.deepEqual(backend.withProjectEditorRowIds(live), baseline);
  const draft = { teamMembers: [{ id: baseline.teamMembers[0].id, name: 'Edited' }],
    budget: { monthlyPlans: [{ id: baseline.budget.monthlyPlans[0].id, month: '2026-02' }] } };
  assert.deepEqual(backend.mergePreservingUnknown(baseline, draft), mergePreservingUnknown(baseline, draft));
});

test('risk save sends only editable fields and uses the original revision', async () => {
  const project = { code: 'H/W-001', sectionUpdatedAt: { highlights: { savedAt: 'yesterday' } } };
  Object.defineProperty(project, '__revisionFingerprint', { value: 'original-revision' });
  const week = { __documentId: 'test-week', projects: [project] };
  let sent;
  const context = { allWeeks: [week], currentIdx: 0, currentUser: {}, assertCurrentWeekEditable() {},
    projectRevisionFingerprint() { throw new Error('must use original revision'); },
    projectDashboardApi: { async saveProject(data) { sent = data; return { week: { projects: [{ ...project, riskList: true }] } }; } } };
  vm.createContext(context);
  const source = html.slice(html.indexOf('async function saveCurrentWeekQuietly('), html.indexOf('window.setStrategicTrack ='));
  vm.runInContext(source, context);
  await context.saveCurrentWeekQuietly(project, { riskList: true, riskManual: true });
  assert.deepEqual(JSON.parse(JSON.stringify(sent.project)), { code: 'H/W-001', riskList: true, riskManual: true });
  assert.equal(sent.expectedRevision, 'original-revision');
  assert.equal(project.riskList, undefined);
  context.projectDashboardApi.saveProject = async () => { throw new Error('offline'); };
  const previousWeek = context.allWeeks[0];
  await assert.rejects(context.saveCurrentWeekQuietly(project, { riskList: false }), /offline/);
  assert.equal(context.allWeeks[0], previousWeek);
});

test('validation errors preserve their explanation without a misleading network instruction', () => {
  const elements = new Map();
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, { classList: { add() {}, remove() {} } }); return elements.get(id); } };
  const context = { document, _toastTimer: null, clearTimeout, Error };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function showProjectMutationError('), html.indexOf('function isProjectEditorSessionCurrent(')), context);
  context.showProjectMutationError(new Error('Invalid project code'), 'Check your connection, refresh the dashboard.');
  const message = elements.get('projectMutationError').textContent;
  assert.match(message, /Invalid project code/);
  assert.match(message, /Copy them before/);
  assert.doesNotMatch(message, /Check your connection/);
});
