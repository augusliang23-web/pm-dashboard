import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extract(name){const start=source.indexOf(`function ${name}(`);assert.ok(start>=0,`${name} is required`);return source.slice(start,source.indexOf('\n}',start)+2);}
function harness({role='admin',manage=false,draft={draftId:'d',source:{weekId:'W1',projectCode:'P'}},released=false,open=true}={}){
 const week={__documentId:'W1',weekLabel:'W1',isReleased:released,projects:[{code:'P',publication:{draftId:'d'}}]},session={token:'s',code:'P'};
 const context=vm.createContext({currentRole:role,currentUser:{uid:'u'},projectWriteCapabilities:{draftsEnabled:true},canCurrentUser:()=>manage,projectEditorSession:session,draftEditorRecord:draft,allWeeks:[week],currentIdx:0,isWeekReleased:w=>w?.isReleased===true,isProjectEditorSessionCurrent:s=>open&&s===session,projectMutationInFlight:false});
 vm.runInContext(extract('getEditorPublishedProjectTarget'),context);return {context,week};
}
test('Admin can access only the current linked published project in an open week',()=>{const {context}=harness();assert.deepEqual(JSON.parse(JSON.stringify(context.getEditorPublishedProjectTarget())),{projectCode:'P',weekId:'W1'});});
test('ordinary PM and private new drafts cannot open published actions',()=>{assert.equal(harness({role:'pm'}).context.getEditorPublishedProjectTarget(),null);assert.equal(harness({draft:{draftId:'new'}}).context.getEditorPublishedProjectTarget(),null);});
test('existing delegated project.manage capability is preserved',()=>{assert.equal(harness({role:'pm',manage:true}).context.getEditorPublishedProjectTarget()?.projectCode,'P');});
test('released week, stale editor or in-flight save cannot open published actions',()=>{assert.equal(harness({released:true}).context.getEditorPublishedProjectTarget(),null);assert.equal(harness({open:false}).context.getEditorPublishedProjectTarget(),null);const {context}=harness();context.projectMutationInFlight=true;assert.equal(context.getEditorPublishedProjectTarget(),null);});
test('manage-only published editor targets the original current project',()=>{const {context}=harness({role:'pm',manage:true,draft:null});assert.equal(context.getEditorPublishedProjectTarget()?.projectCode,'P');});
test('rapid repeated published visibility actions submit only one request',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);let calls=0;
 const nodes=Object.fromEntries(['publishedProjectActionsMessage','projectVisibilityAction','projectDeleteAction','projectVisibilitySelect','projectVisibilityLabel','publishedProjectActionsOverlay','projectDraftManage'].map(id=>[id,{style:{},value:'active',disabled:false}]));
 let restoredFocus=0;nodes.projectDraftManage.focus=()=>{restoredFocus++;};
 const session={token:'s',authUid:'u'},week={__documentId:'W1',weekLabel:'W1',projects:[{code:'P',name:'Synthetic',visibility:'active'}]};
 const c=vm.createContext({projectWriteCapabilities:{draftsEnabled:true},currentUser:{uid:'u'},currentRole:'admin',canCurrentUser:()=>true,allWeeks:[week],authSessionGeneration:1,projectEditorSession:session,projectMutationInFlight:false,projectMutationInFlightToken:null,publishedProjectActionInFlight:false,isProjectEditorSessionCurrent:s=>s===session,projectRevisionFingerprint:()=> 'rev',document:{getElementById:id=>nodes[id]},openAccessibleModal(){},setProjectMutationControlsDisabled(){},closeModal(){},showSaveToast(){},projectDashboardApi:{saveProject:()=>{calls++;return pending;}},confirm:()=>true});
 vm.runInContext(extract('openPublishedProjectActions'),c);c.openPublishedProjectActions('P','W1');nodes.projectVisibilityAction.onclick();nodes.projectVisibilityAction.onclick();assert.equal(calls,1);assert.equal(c.projectMutationInFlight,true);resolve();await new Promise(r=>setImmediate(r));assert.equal(c.projectMutationInFlight,false);assert.equal(restoredFocus,1);
});
test('a stale lifecycle response cannot unlock or close a newer session',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);let closes=0;const nodes=Object.fromEntries(['publishedProjectActionsMessage','projectVisibilityAction','projectDeleteAction','projectVisibilitySelect','projectVisibilityLabel','publishedProjectActionsOverlay','projectDraftManage'].map(id=>[id,{style:{},value:'active',disabled:false,focus(){}}]));
 const old={token:'old',authUid:'a'},fresh={token:'fresh',authUid:'b'},week={__documentId:'W1',weekLabel:'W1',projects:[{code:'P',name:'Synthetic',visibility:'active'}]};
 const c=vm.createContext({projectWriteCapabilities:{draftsEnabled:true},currentUser:{uid:'a'},currentRole:'admin',canCurrentUser:()=>true,allWeeks:[week],authSessionGeneration:1,projectEditorSession:old,projectMutationInFlight:false,projectMutationInFlightToken:null,publishedProjectActionInFlight:false,isProjectEditorSessionCurrent:s=>s===c.projectEditorSession,projectRevisionFingerprint:()=> 'rev',document:{getElementById:id=>nodes[id]},openAccessibleModal(){},setProjectMutationControlsDisabled(){},closeModal(){closes++;},showSaveToast(){},projectDashboardApi:{saveProject:()=>pending}});
 vm.runInContext(extract('openPublishedProjectActions'),c);c.openPublishedProjectActions('P','W1');nodes.projectVisibilityAction.onclick();c.projectEditorSession=fresh;c.currentUser={uid:'b'};c.authSessionGeneration=2;c.projectMutationInFlight=true;c.projectMutationInFlightToken='fresh';resolve();await new Promise(r=>setImmediate(r));assert.equal(c.projectMutationInFlight,true);assert.equal(c.projectMutationInFlightToken,'fresh');assert.equal(closes,0);
});
