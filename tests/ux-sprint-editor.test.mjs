import '../js/project-assignment-eligibility.js';
const {projectAssignmentOptions}=globalThis.PMProjectAssignment;
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { dashboardSource } from './helpers/dashboard-source.mjs';
import { buildDraftSaveInput, latestPublishWeekId } from '../js/project-drafts-ui.mjs';
const source=dashboardSource('production');
const extract=name=>{const start=source.indexOf(`function ${name}(`);assert.ok(start>=0,name);return(source.slice(start-6,start)==='async '?'async ':'')+source.slice(start,source.indexOf('\n}',start)+2);};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function saveHarness(publishing=true){
 const pending=deferred(),events=[],session={token:'one',authUid:'u'},button={textContent:'Save & Publish'},overlay={dataset:{editorBaseline:'old'},querySelectorAll:()=>[]};
 const context=vm.createContext({performance,draftSaveProgress:null,buildDraftSaveInput,latestPublishWeekId,draftEditorSaveIntent:publishing?'publish':'draft',draftEditorTargetWeekId:'W43',allWeeks:[{__documentId:'W43',weekLabel:'W43 2026',projects:[]}],draftEditorRecord:{draftId:'a',revision:1,project:{}},currentRole:'pm',currentUser:{uid:'u'},projectEditorSession:session,projectMutationInFlight:false,projectMutationInFlightToken:null,
 isProjectEditorSessionCurrent:s=>context.projectEditorSession===s,clearProjectMutationError(){},setProjectMutationControlsDisabled:value=>events.push(['disabled',value]),configureDraftEditor(){},showSaveToast:text=>events.push(['toast',text]),showProjectMutationError:error=>events.push(['error',error?.message]),
 closeModal:id=>{assert.equal(context.projectMutationInFlight,false);events.push(['close',id]);context.projectEditorSession=null;},
 document:{getElementById:id=>id==='pe_btn_publish'?button:overlay},serializeEditorState:()=> 'submitted',
 draftController:{publish:()=>pending.promise,save:()=>pending.promise}});
 vm.runInContext(extract('saveEditorProjectDraft'),context);return{context,pending,events,session,button,overlay};
}
test('Publish immediately labels busy, waits for confirmation, then closes and notifies',async()=>{
 const h=saveHarness(),p=h.context.saveEditorProjectDraft({name:'submitted'},h.session);
 assert.equal(h.button.textContent,'Publishing…');assert.equal(h.context.projectMutationInFlight,true);assert.equal(h.events.some(e=>e[0]==='close'),false);
 h.pending.resolve({draft:{draftId:'a',revision:2,project:{name:'submitted'}}});await p;
 assert.ok(h.events.find(e=>e[0]==='close'));assert.match(h.events.find(e=>e[0]==='toast')[1],/published/);assert.equal(h.context.projectMutationInFlight,false);
});
for(const message of ['Revision conflict','Permission denied','Network unavailable','Publish validation failed'])test(`${message}: preserve values, no close/success, restore retry`,async()=>{
 const h=saveHarness(),p=h.context.saveEditorProjectDraft({name:'submitted'},h.session);h.pending.reject(Error(message));await p;
 assert.equal(h.events.some(e=>e[0]==='close'||e[0]==='toast'),false);assert.equal(h.events.find(e=>e[0]==='error')[1],message);assert.equal(h.overlay.dataset.editorBaseline,'old');assert.equal(h.context.projectMutationInFlight,false);assert.equal(h.button.textContent,'Save & Publish');
});
test('late publish success cannot close or notify another editor session',async()=>{
 const h=saveHarness(),p=h.context.saveEditorProjectDraft({name:'submitted'},h.session);h.context.projectEditorSession={token:'two',authUid:'u'};h.context.projectMutationInFlightToken='two';h.pending.resolve({draft:{project:{}}});await p;assert.equal(h.events.some(e=>e[0]==='close'||e[0]==='toast'),false);
});
test('Save Draft retains the editor and submitted baseline',async()=>{const h=saveHarness(false),p=h.context.saveEditorProjectDraft({name:'submitted'},h.session);h.pending.resolve({draft:{project:{name:'submitted'}}});await p;assert.equal(h.events.some(e=>e[0]==='close'),false);assert.equal(h.overlay.dataset.editorBaseline,'submitted');});
test('every managed opening shows a shell before awaiting private draft data',()=>{
 for(const name of ['openManagedProjectDraft','openExistingProjectDraft']){
 const start=source.indexOf(`window.${name} =`),body=source.slice(start,source.indexOf('\n};',start));
 assert.ok(body.indexOf('startDraftEditorOpening(')>=0);assert.ok(body.indexOf('startDraftEditorOpening(')<body.indexOf('await draftController.'));
 }
 assert.doesNotMatch(extract('beginDraftEditor'),/getDocs/,'reuse the authenticated directory, never repeat a users query per editor opening');
});
test('a week round trip permanently cancels a pending opening',()=>{
 for(const name of ['jumpToWeek','navWeek']){
 const start=source.indexOf(`window.${name} =`),body=source.slice(start,source.indexOf('\n};',start));
 assert.match(body,/invalidateProjectEditorSession\(\)/,`${name} must cancel before a delayed response can match the week again`);
 }
});
function adminOpeningHarness(assigned='') {
 class Option { constructor(text,value){this.text=text;this.value=value;this.disabled=false;} }
 const select=()=>({options:[],replaceChildren(...items){this.options=items;},add(item){this.options.push(item);},value:''});
 const owner=select(),deputy=select(),overlay={classList:{remove(){}},setAttribute(){}};
 const opening={email:'admin@example.test'};
 const context=vm.createContext({Option,projectDraftDirectory:{authGeneration:1,options:projectAssignmentOptions([{id:'pm@example.test',role:'pm',displayName:'PM'},{id:'admin@example.test',role:'admin',displayName:'Current Admin'}],{role:'admin',email:'admin@example.test'})},authSessionGeneration:1,currentRole:'admin',currentIdx:0,allWeeks:[{__documentId:'W43'}],draftEditorRecord:undefined,draftEditorSaveIntent:'draft',draftEditorTargetWeekId:'',draftOpening:false,
  startDraftEditorOpening:()=>opening,isDraftEditorOpeningCurrent:()=>true,performance:{mark(){},measure(){}},window:{openProjEdit(){}},captureEditorBaseline(){},getUserDisplayName:email=>email==='admin@example.test'?'Current Admin':'',
  document:{getElementById:id=>id==='pe_owner'?owner:id==='pe_deputy'?deputy:overlay}});
 vm.runInContext(extract('beginDraftEditor'),context);
 return {owner,deputy,open:()=>context.beginDraftEditor({draftId:'a',revision:1,project:{code:'A',owner:'Existing Admin'},assignment:{ownerEmail:assigned,deputyEmail:''}})};
}
test('cached directory opening preserves active Admin-self eligibility in both selectors',async()=>{
 const h=adminOpeningHarness();await h.open();
 assert.equal(h.owner.options.filter(o=>o.value==='admin@example.test').length,1);
 assert.equal(h.deputy.options.filter(o=>o.value==='admin@example.test').length,1);
 assert.equal(h.owner.options.some(o=>o.value==='other.admin@example.test'),false);
});
test('second Admin progress editing preserves an existing Admin owner as a disabled option',async()=>{
 const h=adminOpeningHarness('other.admin@example.test');await h.open();
 assert.equal(h.owner.value,'other.admin@example.test');
 assert.equal(h.owner.options.find(o=>o.value==='other.admin@example.test').disabled,true);
});
