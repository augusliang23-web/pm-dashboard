import {selectedPublishWeekId,isHistoricalPublishWeek} from '../js/project-drafts-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildDraftSaveInput, latestPublishWeekId } from '../js/project-drafts-ui.mjs';
import { sortWeeksChronologically, latestValidWeekIndex } from '../js/week-order.mjs';
import { dashboardSource } from './helpers/dashboard-source.mjs';
const source=dashboardSource('uat');
function extract(name){const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);return (source.slice(start-6,start)==='async '?'async ':'')+source.slice(start,source.indexOf('\n}',start)+2);}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('typing while Save Draft is pending remains dirty after the submitted revision is saved',async()=>{
 const pending=deferred(),overlay={dataset:{editorBaseline:'old'}},session={token:1,authUid:'u'};
 const context=vm.createContext({selectedPublishWeekId,isHistoricalPublishWeek,currentIdx:0,confirm:()=>true,performance,draftSaveProgress:null,buildDraftSaveInput,latestPublishWeekId,draftEditorSaveIntent:'draft',draftEditorTargetWeekId:'',allWeeks:[],draftEditorRecord:{draftId:'a',revision:1},currentRole:'pm',currentUser:{uid:'u'},projectEditorSession:session,projectMutationInFlight:false,
  isProjectEditorSessionCurrent:()=>true,clearProjectMutationError(){},setProjectMutationControlsDisabled(){},configureDraftEditor(){},showSaveToast(){},showProjectMutationError(){},
  document:{getElementById:()=>overlay},serializeEditorState:()=>context.form,captureEditorBaseline:()=>{overlay.dataset.editorBaseline=context.form;},
  draftController:{save:()=>pending.promise},form:'submitted'});
 vm.runInContext(extract('saveEditorProjectDraft'),context);
 const saving=context.saveEditorProjectDraft({name:'submitted'},session);context.form='typed while saving';
 pending.resolve({draft:{draftId:'a',revision:2,project:{name:'submitted'}}});await saving;
 assert.equal(overlay.dataset.editorBaseline,'submitted');assert.notEqual(context.form,overlay.dataset.editorBaseline);
});
for (const change of ['auth','role','generation','week','closed']) test(`pending opening cannot hydrate after ${change} changes`,()=>{
 const opening={generation:1,authGeneration:1,uid:'u',email:'u@ex.com',role:'admin',weekId:'W43'};
 const context=vm.createContext({selectedPublishWeekId,isHistoricalPublishWeek,currentIdx:0,confirm:()=>true,draftEditorOpenGeneration:1,authSessionGeneration:1,currentUser:{uid:'u',email:'u@ex.com'},currentRole:'admin',currentIdx:0,allWeeks:[{__documentId:'W43'}],getEmailKey:u=>u?.email,document:{getElementById:()=>({classList:{contains:()=>change!=='closed'}})}});
 vm.runInContext(extract('isDraftEditorOpeningCurrent'),context);
 if(change==='auth')context.authSessionGeneration=2;if(change==='role')context.currentRole='engineering';if(change==='generation')context.draftEditorOpenGeneration=2;if(change==='week')context.allWeeks=[{__documentId:'W42'}];
 assert.equal(context.isDraftEditorOpeningCurrent(opening),false);
});
test('zero persisted week documents stay an empty official portfolio without demo fallback',()=>{
 let callback;const select={};
 const context=vm.createContext({selectedPublishWeekId,isHistoricalPublishWeek,currentIdx:0,confirm:()=>true,weeksUnsub:null,executiveTimelineConfigUnsub:null,executiveLiveTimelineUnsub:null,executivePendingMilestoneUnsub:null,
  collection:()=>null,doc:()=>null,query:()=>null,orderBy:()=>null,where:()=>null,db:{},currentRole:'pm',canReadDraftWeeks:()=>true,canCurrentUser:()=>false,
  getEmailKey:u=>u.email,authSessionGeneration:1,currentUser:{uid:'u',email:'u@ex.com'},isAuthInitializationCurrent:()=>true,
  deliveryTrendsRawWeeks:[],deliveryTrendsHistoryState:{source:null,complete:false},
  normalizeProject:p=>({...p}),projectRevisionFingerprint:()=>'',sortWeeksChronologically,latestValidWeekIndex,
  onSnapshot:(ref,...args)=>{const fn=typeof args[0]==='function'?args[0]:args[1];if(fn)callback=fn;return ()=>{};},allWeeks:null,currentIdx:-1,jumpToLatestOnNextRender:false,sortWeeksByLabel:x=>x,
  escHtml:x=>String(x),buildPrototypeWeeks:()=>[{projects:[{progress:62}]}],render(){},hideLoader(){},document:{getElementById:()=>select}});
 vm.runInContext(extract('initData'),context);context.initData(1,context.currentUser);callback({docs:[]});
 assert.equal(context.allWeeks.length,0);assert.equal(context.currentIdx,-1);assert.match(select.innerHTML,/No Weeks/);
});
