import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { dashboardSource } from './helpers/dashboard-source.mjs';

const source = dashboardSource('uat');
const start = source.indexOf('window.saveDraftProject = async () => {');
assert.ok(start >= 0);
const code = source.slice(start, source.indexOf('\n};', start) + 3);

test('Save Draft gives feedback and blocks a second action before form preparation', async () => {
  const session = {token: 7, authUid: 'synthetic'};
  const button = {textContent: 'Save Draft', setAttribute() {}};
  const status = {textContent: ''};
  let preparations = 0;
  const context = vm.createContext({window: {}, projectMutationInFlight: false, projectMutationInFlightToken: null,
    projectEditorSession: session, currentUser: {uid: 'synthetic'}, draftEditorSaveIntent: '',
    isProjectEditorSessionCurrent: candidate => candidate === session,
    document: {getElementById: id => id === 'pe_btn_save' ? button : status},
    clearProjectMutationError() {}, setProjectMutationControlsDisabled() {}, configureDraftEditor() {},
    performance: {mark(){}, measure(){}}, draftSaveProgress:null,
    draftSavePermit: Symbol('draft'),
  });
  let release;const pending=new Promise(resolve=>release=resolve);
  context.beginDraftSaveProgress=()=>context.draftSaveProgress={completed:false,stop(){}};
  context.window.saveProjEdit = async () => { preparations++; await pending; };
  vm.runInContext(code, context);
  const first = context.window.saveDraftProject();
  await context.window.saveDraftProject();
  assert.equal(button.textContent, 'Saving…');
  assert.equal(context.projectMutationInFlight, true);
  assert.equal(preparations, 1);
  release(); await first;
  assert.equal(preparations, 1);
  assert.equal(context.projectMutationInFlight, false);
});

function extractFunction(name) {
  const i = source.indexOf(`async function ${name}(`);
  assert.ok(i >= 0);
  return source.slice(i, source.indexOf('\n}', i) + 2);
}

test('a lost response shows no success, preserves input, and does not retry', async () => {
  const session = {token: 1, authUid: 'synthetic'};
  const fields = {}, button = {}, overlay = {dataset: {editorBaseline: 'original'}};
  let requests = 0, toast = 0, shown = '';
  const context = vm.createContext({performance, Error,
    draftSaveProgress:null, draftEditorRecord: {draftId: 'synthetic', revision: 1}, draftEditorSaveIntent: 'draft', draftEditorTargetWeekId: '',
    projectEditorSession: session, projectMutationInFlight: false, currentRole: 'pm', currentUser: {uid:'synthetic'}, allWeeks: [],
    latestPublishWeekId: () => '', buildDraftSaveInput: () => ({}), serializeEditorState: () => 'changed',
    isProjectEditorSessionCurrent: candidate => candidate === session,
    clearProjectMutationError() {}, setProjectMutationControlsDisabled() {}, configureDraftEditor() {},
    showSaveToast() { toast++; }, showProjectMutationError(error) { shown = error.message; },
    document: {getElementById(id) {return id === 'projectEditorFields' ? fields : id === 'pe_btn_publish' ? button : overlay;}},
    draftController: {async save() { requests++; throw new Error('Connection lost'); }}
  });
  vm.runInContext(extractFunction('saveEditorProjectDraft'), context);
  await context.saveEditorProjectDraft({}, session);
  assert.equal(requests, 1);
  assert.equal(toast, 0);
  assert.equal(overlay.dataset.editorBaseline, 'original');
  assert.match(shown, /Connection lost.*uncertain.*before retrying/);
  assert.equal(context.projectMutationInFlight, false);
});
