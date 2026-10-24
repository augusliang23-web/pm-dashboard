const test=require('node:test'),assert=require('node:assert/strict');
const {createStore}=require('./helpers/draft-store.cjs');const {state,db}=createStore();
const firestorePath=require.resolve('firebase-admin/firestore'),real=require(firestorePath);
require.cache[firestorePath]={id:firestorePath,filename:firestorePath,loaded:true,exports:{...real,getFirestore:()=>db}};
const api=require('../project-drafts'),{projectRevisionFingerprint}=require('../project-dashboard-writes');
process.env.GCLOUD_PROJECT='demo-pm-dashboard-v22t';process.env.FUNCTIONS_EMULATOR='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const email='owner@example.com';const call=(name,data,who=email)=>api[name].run({auth:{uid:who,token:{email:who,firebase:{sign_in_provider:'password'}}},data});
const reason=key=>error=>error.details?.reason===key;
function setup(){state.docs.clear();state.failAudit=false;state.docs.set('users/'+email,{authUid:email,role:'pm',displayName:'Owner'});state.docs.set('users/admin@example.com',{authUid:'admin@example.com',role:'admin',displayName:'Admin'});state.docs.set('users/other@example.com',{authUid:'other@example.com',role:'pm',displayName:'Other'});state.docs.set('weeks/W1',{weekLabel:'W1 2026',isReleased:false,version:1,projects:[{name:'Existing',code:'OLD',owner:'Owner',deputy:'',visibility:'active',projectLevel:'system',progress:40,futureMetadata:{keep:true}}]});}

test('PM without project.manage: new project Save Draft -> relogin -> resume -> repeated Save Draft -> Save & Publish; draft stays private and published data only changes on Publish',async()=>{
 setup();const before=structuredClone(state.docs.get('weeks/W1'));
 // 1. Save an incomplete draft (no name, no code, no project level): allowed, creates no published data
 let {draft}=await call('saveDashboardProjectDraft',{draftId:'pm-new-1',expectedRevision:0,project:{progress:10,highlight:'work in progress'}});
 assert.equal(draft.revision,1);assert.deepEqual(state.docs.get('weeks/W1'),before);
 // 2. "Logout/login": a brand new request resumes the same draft from the stored copy
 const resumed=(await call('getDashboardProjectDraft',{draftId:'pm-new-1'})).draft;
 assert.equal(resumed.project.highlight,'work in progress');assert.equal(resumed.revision,1);
 // 3. Repeated Save Draft keeps working and still publishes nothing
 ({draft}=await call('saveDashboardProjectDraft',{draftId:'pm-new-1',expectedRevision:1,project:{progress:30,name:'Proper name',code:'PM-NEW',projectLevel:'system'}}));
 assert.equal(draft.revision,2);assert.deepEqual(state.docs.get('weeks/W1'),before);
 // 4. Publishing an incomplete draft is rejected by the normal validation
 await assert.rejects(call('saveDashboardProjectDraft',{draftId:'pm-new-2',expectedRevision:0,project:{progress:5}}).then(d=>call('publishDashboardProjectDraft',{draftId:'pm-new-2',expectedRevision:1,weekId:'W1',expectedPublishedRevision:null})),reason('invalid-payload'));
 // 5. Save & Publish of the completed draft creates the published project; another PM can neither read nor save nor publish it
 await assert.rejects(call('getDashboardProjectDraft',{draftId:'pm-new-1'},'other@example.com'),reason('draft-forbidden'));
 await assert.rejects(call('saveDashboardProjectDraft',{draftId:'pm-new-1',expectedRevision:2,project:{progress:99}},'other@example.com'),reason('draft-forbidden'));
 const result=await call('publishDashboardProjectDraft',{draftId:'pm-new-1',expectedRevision:2,weekId:'W1',expectedPublishedRevision:null});
 assert.ok(result.publishedAt);assert.ok(state.docs.get('weeks/W1').projects.some(p=>p.code==='PM-NEW'));
 // 6. After publishing, the draft is recorded as published (the Dashboard Draft label disappears) and is still reachable
 const after=(await call('getDashboardProjectDraft',{draftId:'pm-new-1'})).draft;assert.equal(after.lastPublication.draftRevision,after.revision);assert.equal(after.project.owner,'Owner');   // owner assigned by the server from the signed-in PM
});
