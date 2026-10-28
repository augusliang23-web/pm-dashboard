import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {dashboardSource} from './helpers/dashboard-source.mjs';
const source=dashboardSource('production');
function arrow(name){const i=source.indexOf(`window.${name} = async (`);assert.ok(i>=0);const j=source.indexOf('\n};',i);assert.ok(j>i);return source.slice(i,j+3);}
function harness(){let count=0;const a={token:1,authUid:'u'},b={token:2,authUid:'u'};
 const c=vm.createContext({window:{},draftSavePermit:Symbol('old shared'),activeDraftSavePermit:null,projectMutationInFlight:true,projectMutationInFlightToken:1,projectEditorSession:a,currentUser:{uid:'u'},isProjectEditorSessionCurrent:s=>s===c.projectEditorSession,collectEditorResources:()=>{count++;return null;}});
 vm.runInContext(arrow('saveProjEdit'),c);return{c,a,b,count:()=>count};}
test('locked save accepts only this attempt and this session; old permits never revive',async()=>{
 const {c,a,b,count}=harness(),permitA={session:a},permitB={session:b};c.activeDraftSavePermit=permitA;
 await c.window.saveProjEdit();assert.equal(count(),0,'direct calls denied');
 await c.window.saveProjEdit({session:a});assert.equal(count(),0,'distinct object denied');
 await c.window.saveProjEdit(permitA);assert.equal(count(),1,'valid same attempt admitted');
 c.projectEditorSession=b;c.projectMutationInFlightToken=2;c.activeDraftSavePermit=permitB;
 await c.window.saveProjEdit(permitA);assert.equal(count(),1,'previous session permit denied');
 await c.window.saveProjEdit(permitB);assert.equal(count(),2,'new session permit admitted');
 c.projectMutationInFlight=false;c.activeDraftSavePermit=null;
 await c.window.saveProjEdit(permitB);assert.equal(count(),2,'completed or canceled permit denied');
});
test('stale cleanup cannot revoke or unlock newer save',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const a={token:1,authUid:'u'},b={token:2,authUid:'u'};let seen;
 const c=vm.createContext({window:{},performance:{mark(){}},projectMutationInFlight:false,projectMutationInFlightToken:null,projectEditorSession:a,currentUser:{uid:'u'},draftEditorSaveIntent:'',activeDraftSavePermit:null,draftSaveProgress:null,
 isProjectEditorSessionCurrent:s=>s===c.projectEditorSession,clearProjectMutationError(){},setProjectMutationControlsDisabled(){},configureDraftEditor(){},document:{getElementById:()=>({textContent:'',setAttribute(){}})},beginDraftSaveProgress:()=>({completed:true})});
 c.window.saveProjEdit=async p=>{seen=p;await pending;};vm.runInContext(arrow('saveDraftProject'),c);
 const first=c.window.saveDraftProject();assert.equal(c.activeDraftSavePermit,seen);
 const fresh={session:b};c.projectEditorSession=b;c.projectMutationInFlight=true;c.projectMutationInFlightToken=2;c.activeDraftSavePermit=fresh;
 resolve();await first;assert.equal(c.activeDraftSavePermit,fresh);assert.equal(c.projectMutationInFlight,true);assert.equal(c.projectMutationInFlightToken,2);
});
for(const outcome of ['success','failure']) test(`actual Save Draft wrapper revokes its permit after ${outcome}`,async()=>{
 const session={token:4,authUid:'u'};let permit;
 const c=vm.createContext({window:{},performance:{mark(){}},projectMutationInFlight:false,projectMutationInFlightToken:null,projectEditorSession:session,currentUser:{uid:'u'},draftEditorSaveIntent:'',activeDraftSavePermit:null,draftSaveProgress:null,
 isProjectEditorSessionCurrent:s=>s===c.projectEditorSession,clearProjectMutationError(){},setProjectMutationControlsDisabled(){},configureDraftEditor(){},document:{getElementById:()=>({textContent:'',setAttribute(){}})},beginDraftSaveProgress:()=>({completed:true})});
 c.window.saveProjEdit=async p=>{permit=p;assert.equal(c.activeDraftSavePermit,p);if(outcome==='failure')throw Error('synthetic');};vm.runInContext(arrow('saveDraftProject'),c);
 if(outcome==='failure')await assert.rejects(c.window.saveDraftProject(),/synthetic/);else await c.window.saveDraftProject();
 assert.equal(c.activeDraftSavePermit,null);assert.equal(c.projectMutationInFlight,false);assert.equal(permit.session,session);
});
test('actual editor invalidation revokes a canceled permit and clears the lock',()=>{
 const start=source.indexOf('function invalidateProjectEditorSession() {'),end=source.indexOf('\n}',start);assert.ok(start>=0&&end>start);
 const node={classList:{remove(){}},removeAttribute(){},querySelectorAll:()=>[],replaceChildren(){}};
 const c=vm.createContext({activeDraftSavePermit:{session:{token:1}},draftSaveProgress:null,draftEditorOpenGeneration:0,draftEditorRecord:{},projectEditorSession:{token:1},projectMutationInFlight:true,projectMutationInFlightToken:1,editingProjCode:'synthetic',isCreatingNew:false,document:{getElementById:()=>node},setProjectMutationControlsDisabled(){},clearProjectMutationError(){}});
 vm.runInContext(source.slice(start,end+2),c);c.invalidateProjectEditorSession();assert.equal(c.activeDraftSavePermit,null);assert.equal(c.projectMutationInFlight,false);assert.equal(c.projectEditorSession,null);
});
