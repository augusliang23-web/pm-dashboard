const test=require('node:test');const assert=require('node:assert/strict');
const {createStore}=require('./helpers/draft-store.cjs');const {state,db}=createStore();const path=require.resolve('firebase-admin/firestore');const real=require(path);require.cache[path]={id:path,filename:path,loaded:true,exports:{...real,getFirestore:()=>db}};
const api=require('../project-dashboard-writes');
const actor={uid:'owner',email:'owner@example.com',role:'pm',displayName:'Owner',permissionOverrides:{'project.manage':true}};
const managed={code:'ALPHA',owner:'Owner',progress:40,publication:{draftId:'draft-a'}};
const call=(fn,data)=>api[fn].run({auth:{uid:actor.uid,token:{email:actor.email}},data});
const request=(p,isNew=false)=>({weekId:'W1',originalCode:p.code,projectCode:p.code,isNew,project:{code:p.code,progress:99},expectedRevision:api.projectRevisionFingerprint(p)});
function setup(){state.docs.clear();state.docs.set('users/'+actor.email,{role:'pm',displayName:'Owner'});state.docs.set('userPermissions/'+actor.email,{overrides:actor.permissionOverrides});state.docs.set('weeks/W1',{projects:[structuredClone(managed)],isReleased:false});process.env.GCLOUD_PROJECT='demo-pm-dashboard-v22t';process.env.FUNCTIONS_EMULATOR='true';delete process.env.GOOGLE_CLOUD_PROJECT;}
const boundary=e=>e.details?.reason==='draft-publish-required';
test('UAT old Save and attention handlers reject managed projects without partial writes',async()=>{setup();await assert.rejects(call('saveDashboardProject',request(managed)),boundary);await assert.rejects(call('setDashboardProjectAttention',{weekId:'W1',projectCode:'ALPHA',attention:'action'}),boundary);assert.equal(state.docs.get('weeks/W1').projects[0].progress,40);});
test('old new-project payload cannot bypass Draft creation in UAT',async()=>{setup();await assert.rejects(call('saveDashboardProject',request({code:'BETA'},true)),boundary);});
test('Production create and editing remain compatible',()=>{setup();const legacy={code:'OLD',owner:'Owner',progress:40};process.env.GCLOUD_PROJECT='project-manager-dashboar-a067f';assert.equal(api.buildProjectPatch({projects:[legacy]},request(legacy),actor,'now').committedProject.progress,99);assert.equal(api.buildProjectPatch({projects:[]},request({code:'NEW'},true),actor,'now').committedProject.code,'NEW');});
test('Admin lifecycle updates cannot rename a managed project through projectCode',()=>{setup();const admin={...actor,role:'admin'};const data={...request(managed),project:{code:'ALPHA',visibility:'archived'},projectCode:'RENAMED'};assert.throws(()=>api.buildProjectPatch({projects:[managed]},data,admin,'now'),boundary);const valid={...data,projectCode:'ALPHA'};assert.equal(api.buildProjectPatch({projects:[managed]},valid,admin,'now').committedProject.visibility,'archived');});
test('all UAT legacy content and attention writes must use the same draft publication boundary',async()=>{
 setup();const legacy={code:'OLD',owner:'Owner',progress:40};state.docs.get('weeks/W1').projects=[legacy];
 await assert.rejects(call('saveDashboardProject',request(legacy)),boundary);
 await assert.rejects(call('setDashboardProjectAttention',{weekId:'W1',projectCode:'OLD',attention:'action'}),boundary);
 assert.equal(state.docs.get('weeks/W1').projects[0].progress,40);
});
