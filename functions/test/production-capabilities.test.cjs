const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('./helpers/draft-store.cjs');
const { state, db } = createStore();
const path = require.resolve('firebase-admin/firestore');
const real = require(path);
require.cache[path] = { id:path, filename:path, loaded:true, exports:{...real, getFirestore:()=>db} };
const environment = require('../draft-environment');
const writes = require('../project-dashboard-writes');
const drafts = require('../project-drafts');
const prod = 'project-manager-dashboar-a067f';
const active = {schemaVersion:1, projectId:prod, drafts:true, archiveRecovery:true, enforceDraftPublish:true};
const call = (api, fn, data, email='pm@example.com') => api[fn].run({auth:{uid:email,token:{email}},data});
function setup(config=active) {
  state.docs.clear(); process.env.GCLOUD_PROJECT=prod;
  delete process.env.GOOGLE_CLOUD_PROJECT; delete process.env.FUNCTIONS_EMULATOR;
  if(config) state.docs.set('releaseCapabilities/v231',structuredClone(config));
  state.docs.set('users/pm@example.com',{role:'pm',displayName:'PM'});
  state.docs.set('users/admin@example.com',{role:'admin',displayName:'Admin'});
  state.docs.set('users/vip@example.com',{role:'vip',displayName:'VIP'});
  state.docs.set('weeks/W1',{weekLabel:'W1 2026',isReleased:true,projects:[{code:'ARCH',name:'Archived',visibility:'archived',progress:30}]});
  state.docs.set('weeks/W2',{weekLabel:'W2 2026',isReleased:false,projects:[{code:'OLD',owner:'PM',progress:20}]});
}
test('Production requires explicit same-project activation; draft and archive are separate',()=>{
  const env={GCLOUD_PROJECT:prod};
  assert.equal(environment.draftsEnabled(env),false);
  assert.equal(environment.draftsEnabled(env,active),true);
  assert.equal(environment.archiveRecoveryEnabled(env,{...active,drafts:false}),true);
  for(const config of [{...active,projectId:'other'},{...active,schemaVersion:2},{...active,drafts:'true'}]) assert.equal(environment.draftsEnabled(env,config),false);
  for(const env of [{},{GCLOUD_PROJECT:'other'},{GCLOUD_PROJECT:prod,GOOGLE_CLOUD_PROJECT:'other'},{GCLOUD_PROJECT:prod,FUNCTIONS_EMULATOR:'true'}]) assert.equal(environment.draftsEnabled(env,active),false);
});
test('Production Draft handlers read server activation and reject client activation bypass',async()=>{
  setup(null);
  await assert.rejects(call(drafts,'saveDashboardProjectDraft',{expectedRevision:0,project:{name:'Draft'}}),e=>e.details?.reason==='draft-environment');
  state.docs.set('releaseCapabilities/v231',active);
  const result=await call(drafts,'saveDashboardProjectDraft',{expectedRevision:0,project:{name:'Draft'}});
  assert.equal(result.draft.revision,1);
  state.docs.set('releaseCapabilities/v231',{...active,drafts:false});
  await assert.rejects(call(drafts,'getDashboardProjectDraft',{draftId:result.draft.draftId}),e=>e.details?.reason==='draft-environment');
});
test('staged backend permits legacy saves; activation restricts content but preserves Admin lifecycle',async()=>{
  setup({...active,enforceDraftPublish:false});
  const request=()=>({weekId:'W2',projectCode:'OLD',originalCode:'OLD',isNew:false,expectedRevision:writes.projectRevisionFingerprint(state.docs.get('weeks/W2').projects[0]),project:{code:'OLD',progress:40}});
  await call(writes,'saveDashboardProject',request());
  state.docs.set('releaseCapabilities/v231',active);
  await assert.rejects(call(writes,'saveDashboardProject',request()),e=>e.details?.reason==='draft-publish-required');
  const lifecycle={...request(),project:{code:'OLD',visibility:'archived'}};
  await call(writes,'saveDashboardProject',lifecycle,'admin@example.com');
  assert.equal(state.docs.get('weeks/W2').projects[0].visibility,'archived');
});
test('authenticated capability discovery uses effective permissions and no client configuration',async()=>{
  setup();
  const admin=await call(drafts,'getDashboardProjectDraft',{capabilities:true},'admin@example.com');
  assert.equal(admin.archiveRecoveryEnabled,true);assert.equal(admin.draftsEnabled,true);
  const pm=await call(drafts,'getDashboardProjectDraft',{capabilities:true});
  assert.equal(pm.archiveRecoveryEnabled,false);assert.equal(pm.draftsEnabled,true);
  state.docs.set('userPermissions/pm@example.com',{overrides:{'project.archive.restore':true}});
  assert.equal((await call(drafts,'getDashboardProjectDraft',{capabilities:true})).archiveRecoveryEnabled,true);
  const vip=await call(drafts,'getDashboardProjectDraft',{capabilities:true},'vip@example.com');
  assert.equal(vip.archiveRecoveryEnabled,false);assert.equal(vip.draftsEnabled,false);
});
test('Production Archive restore rejects changed same-week snapshot and records source/actor',async()=>{
  setup();const source=state.docs.get('weeks/W1').projects[0],before=structuredClone(state.docs.get('weeks/W1'));
  const revision=require('node:crypto').createHash('sha256').update(writes.projectRevisionFingerprint(source)).digest('hex');
  const request={isArchiveRestore:true,weekId:'W2',sourceWeekId:'W1',projectCode:'ARCH',expectedSourceRevision:revision};
  await assert.rejects(call(writes,'saveDashboardProject',{...request,expectedSourceRevision:'stale'},'admin@example.com'),e=>e.details?.reason==='conflict');
  const result=await call(writes,'saveDashboardProject',request,'admin@example.com');
  assert.equal(result.project.restoration.sourceWeekId,'W1');
  assert.equal(result.project.restoration.restoredBy,'admin@example.com');
  assert.deepEqual(state.docs.get('weeks/W1'),before);
  assert.equal(state.docs.get('weeks/W2').projects[0].code,'OLD');
});
test('first publication rejects historical open weeks and case-insensitive project collisions',async()=>{
  setup();state.docs.get('weeks/W1').isReleased=false;
  const {draft}=await call(drafts,'saveDashboardProjectDraft',{expectedRevision:0,project:{name:'New',code:'old',projectLevel:'system'}});
  const payload={draftId:draft.draftId,expectedRevision:1,expectedPublishedRevision:null};
  await assert.rejects(call(drafts,'publishDashboardProjectDraft',{...payload,weekId:'W1'}),e=>e.details?.reason==='historical-week');
  await assert.rejects(call(drafts,'publishDashboardProjectDraft',{...payload,weekId:'W2'}),e=>e.details?.reason==='conflict');
});

test('Production attention stays compatible before activation and rejects legacy bypass after activation',async()=>{
  setup({...active,drafts:false,archiveRecovery:false,enforceDraftPublish:false});
  const request={weekId:'W2',projectCode:'OLD',attention:'action'};
  const result=await call(writes,'setDashboardProjectAttention',request);
  assert.equal(result.project.attention,'action');
  const before=structuredClone(state.docs.get('weeks/W2'));
  state.docs.set('releaseCapabilities/v231',active);
  await assert.rejects(call(writes,'setDashboardProjectAttention',{...request,attention:'watch'}),e=>e.details?.reason==='draft-publish-required' && /Reload the dashboard/.test(e.message));
  assert.deepEqual(state.docs.get('weeks/W2'),before);
});
test('Production attention denies unauthenticated, wrong role, wrong owner and released writes',async()=>{
  setup({...active,drafts:false,enforceDraftPublish:false});
  const request={weekId:'W2',projectCode:'OLD',attention:'action'};
  await assert.rejects(writes.setDashboardProjectAttention.run({data:request}),e=>e.code==='unauthenticated');
  await assert.rejects(call(writes,'setDashboardProjectAttention',request,'vip@example.com'),e=>e.code==='permission-denied');
  state.docs.set('users/other@example.com',{role:'pm',displayName:'Other'});
  await assert.rejects(call(writes,'setDashboardProjectAttention',request,'other@example.com'),e=>e.details?.reason==='ownership-forbidden');
  state.docs.get('weeks/W2').isReleased=true;
  await assert.rejects(call(writes,'setDashboardProjectAttention',request),e=>e.details?.reason==='released-week');
  assert.equal(state.docs.get('weeks/W2').projects[0].attention,undefined);
});
