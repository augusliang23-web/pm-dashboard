import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {dashboardSource} from './helpers/dashboard-source.mjs';
import * as ui from '../js/project-drafts-ui.mjs';
import {createProjectDraftsController} from '../js/project-drafts-controller.mjs';
const source=dashboardSource('uat');
function fn(name){const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);return (source.slice(start-6,start)==='async '?'async ':'')+source.slice(start,source.indexOf('\n}',start)+2);}
test('current editor form is the payload for atomic Save and Publish, including a legacy source',()=>{
 const draft={draftId:'legacy-a',revision:2,project:{progress:75},source:{weekId:'W1',projectCode:'OLD',expectedRevision:'digest'}};
 const official={code:'OLD',progress:40};Object.defineProperty(official,'__revisionFingerprint',{value:'official-40'});
 const result=ui.buildDraftSaveInput({draft,project:{code:'OLD',progress:85,owner:'untrusted'},weekId:'W1',week:{projects:[official]}});
 assert.equal(result.project.progress,85);assert.equal('owner' in result.project,false);assert.equal(result.expectedPublishedRevision,'official-40');assert.equal(result.expectedRevision,2);assert.deepEqual(result.source,draft.source);
});
test('controller loads a source project and keeps the committed form revision after atomic publish',async()=>{
 const requests=[];const controller=createProjectDraftsController({api:{get:async input=>{requests.push(input);return {draft:{draftId:'a',revision:0}};},publish:async()=>({draft:{draftId:'a',revision:1,project:{progress:85}},weekId:'W1',publishedAt:'now'})},onState:s=>requests.push(s)});
 controller.setIdentity({uid:'u'});await controller.openSource({weekId:'W1',projectCode:'OLD'});await controller.publish({});
 assert.ok(requests.some(x=>x.source?.projectCode==='OLD'));assert.equal(requests.at(-1).selected.revision,1);assert.equal(requests.at(-1).drafts[0].project.progress,85);
});
test('same editor offers atomic publishing, locks fields and closes after confirmation',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),overlay={dataset:{editorBaseline:'old'}},session={token:1,authUid:'u'};let sent;
 const context=vm.createContext({
    projectWriteCapabilities: {draftsEnabled:true,archiveRecoveryEnabled:true},
    loadProjectWriteCapabilities:async()=>{}, configureDraftEditor(){},draftEditorRecord:{draftId:'a',revision:2,assignment:{}},draftEditorSaveIntent:'publish',draftEditorTargetWeekId:'W1',allWeeks:[{__documentId:'W1',projects:[]}],currentRole:'pm',currentUser:{uid:'u'},projectEditorSession:session,projectMutationInFlight:false,projectMutationInFlightToken:null,closeModal(){context.closed=true;},
  buildDraftSaveInput:ui.buildDraftSaveInput,latestPublishWeekId:ui.latestPublishWeekId,isProjectEditorSessionCurrent:()=>true,clearProjectMutationError(){},setProjectMutationControlsDisabled(){},configureDraftEditor(){},showSaveToast(){},showProjectMutationError(){},serializeEditorState:()=>context.form,
  document:{getElementById:id=>id==='projectDraftTargetWeek'?{value:'W1'}:overlay},draftController:{publish:input=>{sent=input;return pending;},save(){throw Error('must be one atomic request');}},form:'submitted'});
 vm.runInContext(fn('saveEditorProjectDraft'),context);const operation=context.saveEditorProjectDraft({progress:85},session);context.form='typed later';resolve({draft:{draftId:'a',revision:3,project:{progress:85}}});await operation;
 assert.equal(context.closed,true);assert.equal(sent.project.progress,85);assert.equal(sent.weekId,'W1');assert.equal(overlay.dataset.editorBaseline,'submitted');assert.notEqual(context.form,overlay.dataset.editorBaseline);
});
test('first publication locks the code without falsely marking saved fields dirty',()=>{
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{id,style:{},dataset:{},classList:{add(){}},setAttribute(){},hasAttribute:()=>false,replaceChildren(){},add(){},value:'',tagName:'INPUT',type:'text',disabled:false});return nodes.get(id);};
 const code=node('pe_code');code.value='NEW';const overlay=node('projEditOverlay');overlay.hasAttribute=()=>true;overlay.querySelector=()=>node('header');overlay.querySelectorAll=()=>[code];node('pe_btn_save').parentElement=node('actions');
 const record={draftId:'new-id',revision:1,assignment:{},project:{},lastPublication:null};
 const context=vm.createContext({
    projectWriteCapabilities: {draftsEnabled:true,archiveRecoveryEnabled:true},
    loadProjectWriteCapabilities:async()=>{}, configureDraftEditor(){},document:{getElementById:node},draftEditorRecord:record,draftEditorTargetWeekId:'W30',allWeeks:[{__documentId:'W30',weekLabel:'W30 2026',projects:[]}],currentRole:'admin',eligibleDraftWeeks:ui.eligibleDraftWeeks,latestPublishWeekId:ui.latestPublishWeekId,draftPublicationState:ui.draftPublicationState,canCurrentUser:()=>true,window:{saveProjEdit:()=>{context.originalSaveCalls=(context.originalSaveCalls||0)+1;}},Option:class{constructor(label,value){this.value=value;}}});
 vm.runInContext(fn('configureDraftEditor')+'\n'+fn('serializeEditorState'),context);
 context.configureDraftEditor(true);const baseline=context.serializeEditorState(overlay);
 record.revision=2;record.lastPublication={draftRevision:2,weekOrder:202630,weekId:'W30'};context.configureDraftEditor(true);
 assert.equal(context.serializeEditorState(overlay),baseline);assert.equal(code.disabled,false);assert.equal(code.readOnly,true);
 assert.equal(node('pe_btn_publish').disabled,true,'a published project missing from the target week cannot be recreated');
 context.configureDraftEditor(false);assert.equal(node('pe_visibility').disabled,false);assert.equal(code.readOnly,false);assert.equal(node('pe_btn_publish').style.display,'none');
 node('pe_btn_save').onclick();assert.equal(context.originalSaveCalls,1);
});
test('official management keeps all original Admin visibility choices outside Draft actions',async()=>{
 for(const visibility of ['active','hidden','archived']){
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},value:'',disabled:false});return nodes.get(id);};let saved;
  const context=vm.createContext({
    projectWriteCapabilities: {draftsEnabled:true,archiveRecoveryEnabled:true},
    loadProjectWriteCapabilities:async()=>{}, configureDraftEditor(){},IS_UAT_PROFILE:true,currentUser:{uid:'admin'},currentRole:'admin',canCurrentUser:()=>true,authSessionGeneration:1,
   allWeeks:[{__documentId:'W1',weekLabel:'W1 2026',projects:[{code:'OLD',name:'Existing',visibility:'active'}]}],document:{getElementById:node},projectRevisionFingerprint:()=> 'current-official',projectDashboardApi:{saveProject:async data=>{saved=data;}},closeModal(){},openAccessibleModal(){},showSaveToast(){}});
  vm.runInContext(fn('openPublishedProjectActions'),context);context.openPublishedProjectActions('OLD','W1');node('projectVisibilitySelect').value=visibility;
  node('projectVisibilityAction').onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(saved.project.visibility,visibility);assert.equal(saved.expectedRevision,'current-official');assert.deepEqual(Object.keys(saved.project).sort(),['code','visibility']);
 }
});
