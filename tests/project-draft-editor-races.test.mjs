import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildDraftSaveInput } from '../js/project-drafts-ui.mjs';
import { dashboardSource } from './helpers/dashboard-source.mjs';
const source=dashboardSource('uat');
function extract(name){const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);return (source.slice(start-6,start)==='async '?'async ':'')+source.slice(start,source.indexOf('\n}',start)+2);}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('typing while Save Draft is pending remains dirty after the submitted revision is saved',async()=>{
 const pending=deferred(),overlay={dataset:{editorBaseline:'old'}},session={token:1,authUid:'u'};
 const context=vm.createContext({buildDraftSaveInput,draftEditorSaveIntent:'draft',draftEditorTargetWeekId:'',allWeeks:[],draftEditorRecord:{draftId:'a',revision:1},currentRole:'pm',currentUser:{uid:'u'},projectEditorSession:session,projectMutationInFlight:false,
  isProjectEditorSessionCurrent:()=>true,clearProjectMutationError(){},setProjectMutationControlsDisabled(){},configureDraftEditor(){},showSaveToast(){},showProjectMutationError(){},
  document:{getElementById:()=>overlay},serializeEditorState:()=>context.form,captureEditorBaseline:()=>{overlay.dataset.editorBaseline=context.form;},
  draftController:{save:()=>pending.promise},form:'submitted'});
 vm.runInContext(extract('saveEditorProjectDraft'),context);
 const saving=context.saveEditorProjectDraft({name:'submitted'},session);context.form='typed while saving';
 pending.resolve({draft:{draftId:'a',revision:2,project:{name:'submitted'}}});await saving;
 assert.equal(overlay.dataset.editorBaseline,'submitted');assert.notEqual(context.form,overlay.dataset.editorBaseline);
});
test('delayed Admin directory request cannot reopen a draft after auth generation or role changes',async()=>{
 const pending=deferred();let opened=0;
 const context=vm.createContext({currentUser:{uid:'same',email:'same@ex.com'},currentRole:'admin',authSessionGeneration:1,draftEditorOpenGeneration:0,allWeeks:[],currentIdx:-1,
  getEmailKey:u=>u?.email,getDocs:()=>pending.promise,collection:()=>null,db:{},normalizeDashboardRole:x=>x,
  closeModal(){},window:{openProjEdit(){opened++;}},captureEditorBaseline(){},document:{getElementById:()=>({replaceChildren(){},add(){},value:''})},Option:class{},draftOpening:false});
 vm.runInContext(extract('beginDraftEditor'),context);
 const opening=context.beginDraftEditor({project:{code:'SECRET'},assignment:{}});
 context.authSessionGeneration=2;context.currentRole='engineering';pending.resolve({docs:[]});await opening;
 assert.equal(opened,0);
});
test('a newer editor opening supersedes an older pending opening in the same auth session',async()=>{
 const pending=[];const opened=[];
 const context=vm.createContext({currentUser:{uid:'same',email:'same@ex.com'},currentRole:'admin',authSessionGeneration:1,draftEditorOpenGeneration:0,allWeeks:[],currentIdx:-1,
  getEmailKey:u=>u?.email,getDocs:()=>{const d=deferred();pending.push(d);return d.promise;},collection:()=>null,db:{},normalizeDashboardRole:x=>x,
  closeModal(){},window:{openProjEdit(code){opened.push(code);}},captureEditorBaseline(){},document:{getElementById:()=>({replaceChildren(){},add(){},value:''})},Option:class{},draftOpening:false});
 vm.runInContext(extract('beginDraftEditor'),context);
 const first=context.beginDraftEditor({project:{code:'OLD'},assignment:{}}),second=context.beginDraftEditor({project:{code:'NEW'},assignment:{}});
 pending[1].resolve({docs:[]});await second;pending[0].resolve({docs:[]});await first;assert.deepEqual(opened,['NEW']);
});
test('zero persisted week documents stay an empty official portfolio without demo fallback',()=>{
 let callback;const select={};
 const context=vm.createContext({weeksUnsub:null,executiveTimelineConfigUnsub:null,executiveLiveTimelineUnsub:null,executivePendingMilestoneUnsub:null,
  collection:()=>null,doc:()=>null,query:()=>null,orderBy:()=>null,where:()=>null,db:{},currentRole:'pm',canReadDraftWeeks:()=>true,canCurrentUser:()=>false,
  getEmailKey:u=>u.email,authSessionGeneration:1,currentUser:{uid:'u',email:'u@ex.com'},isAuthInitializationCurrent:()=>true,
  onSnapshot:(ref,fn)=>{callback=fn;return ()=>{};},allWeeks:null,currentIdx:-1,jumpToLatestOnNextRender:false,sortWeeksByLabel:x=>x,
  escHtml:x=>String(x),buildPrototypeWeeks:()=>[{projects:[{progress:62}]}],render(){},hideLoader(){},document:{getElementById:()=>select}});
 vm.runInContext(extract('initData'),context);context.initData(1,context.currentUser);callback({docs:[]});
 assert.equal(context.allWeeks.length,0);assert.equal(context.currentIdx,-1);assert.match(select.innerHTML,/No Weeks/);
});
