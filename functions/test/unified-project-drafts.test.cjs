const test=require('node:test'),assert=require('node:assert/strict');
const {createStore}=require('./helpers/draft-store.cjs');const {state,db}=createStore();
const firestorePath=require.resolve('firebase-admin/firestore'),real=require(firestorePath);
require.cache[firestorePath]={id:firestorePath,filename:firestorePath,loaded:true,exports:{...real,getFirestore:()=>db}};
const api=require('../project-drafts'),{projectRevisionFingerprint}=require('../project-dashboard-writes');
process.env.GCLOUD_PROJECT='demo-pm-dashboard-v22t';process.env.FUNCTIONS_EMULATOR='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const email='owner@example.com';const call=(name,data,who=email)=>api[name].run({auth:{uid:who,token:{email:who,firebase:{sign_in_provider:'password'}}},data});
const reason=key=>error=>error.details?.reason===key;
function setup(){state.docs.clear();state.failAudit=false;state.docs.set('users/'+email,{authUid:email,role:'pm',displayName:'Owner'});state.docs.set('users/admin@example.com',{authUid:'admin@example.com',role:'admin',displayName:'Admin'});state.docs.set('users/other@example.com',{authUid:'other@example.com',role:'pm',displayName:'Other'});state.docs.set('weeks/W1',{weekLabel:'W1 2026',isReleased:false,version:1,projects:[{name:'Existing',code:'OLD',owner:'Owner',deputy:'',visibility:'active',projectLevel:'system',progress:40,futureMetadata:{keep:true}}]});}
const source={weekId:'W1',projectCode:'OLD'};
const open=()=>call('getDashboardProjectDraft',{source});
const save=(draft,project)=>call('saveDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:draft.revision,source:draft.source,project});
test('opening and saving an owned legacy project needs no create grant and never changes official data',async()=>{
 setup();const official=structuredClone(state.docs.get('weeks/W1'));let {draft}=await open();
 assert.equal(draft.project.progress,40);assert.match(draft.source.expectedRevision,/^[a-f0-9]{64}$/);assert.equal([...state.docs.keys()].some(p=>p.startsWith('projectDrafts/')),false);
 ({draft}=await save(draft,{progress:75}));assert.equal(draft.revision,1);assert.deepEqual(state.docs.get('weeks/W1'),official);
 assert.equal((await open()).draft.project.progress,75);assert.equal((await call('getDashboardProjectDraft',{draftId:draft.draftId})).draft.project.progress,75);
 const started=await call('saveDashboardProjectDraft',{expectedRevision:0,project:{name:'Actually new'}});assert.equal(started.draft.revision,1);assert.deepEqual(state.docs.get('weeks/W1'),official);   // a PM may start a new draft; it never touches published data
});
test('source authority rejects other PM, released source, ambiguous name and forged origin',async()=>{
 setup();await assert.rejects(call('getDashboardProjectDraft',{source},'other@example.com'),reason('ownership-forbidden'));
 let {draft}=await open();await assert.rejects(save({...draft,source:{...draft.source,projectCode:'MISSING'}},{progress:75}));
 state.docs.set('users/duplicate@example.com',{authUid:'duplicate@example.com',role:'pm',displayName:'Owner'});await assert.rejects(open(),reason('ambiguous-assignment'));
 state.docs.delete('users/duplicate@example.com');state.docs.get('weeks/W1').isReleased=true;await assert.rejects(open(),reason('released-week'));
});
test('initial source save rejects stale official revision and subsequent access rechecks source ownership',async()=>{
 setup();let {draft}=await open();state.docs.get('weeks/W1').projects[0].progress=45;await assert.rejects(save(draft,{progress:75}),reason('conflict'));
 ({draft}=await open());({draft}=await save(draft,{progress:75}));state.docs.get('weeks/W1').projects[0].owner='Other';
 await assert.rejects(call('getDashboardProjectDraft',{draftId:draft.draftId}),reason('ownership-forbidden'));await assert.rejects(save(draft,{progress:90}),reason('ownership-forbidden'));
});
test('source saves preserve unknown official metadata while publishing exactly one existing project',async()=>{
 setup();let {draft}=await open();({draft}=await save(draft,{progress:75}));const before=state.docs.get('weeks/W1').projects[0];
 const result=await call('publishDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:1,weekId:'W1',expectedPublishedRevision:projectRevisionFingerprint(before)});
 assert.equal(result.project.progress,75);assert.deepEqual(result.project.futureMetadata,{keep:true});assert.equal(state.docs.get('weeks/W1').projects.length,1);assert.equal(result.project.publication.draftId,draft.draftId);
});
test('save-and-publish uses the current submitted form, with one atomic legacy conversion',async()=>{
 setup();let {draft}=await open();({draft}=await save(draft,{progress:75}));const official=state.docs.get('weeks/W1').projects[0];
 const input={draftId:draft.draftId,source:draft.source,expectedRevision:1,project:{progress:85},weekId:'W1',expectedPublishedRevision:projectRevisionFingerprint(official)};
 const result=await call('publishDashboardProjectDraft',input);assert.equal(result.project.progress,85);assert.equal(result.draft.project.progress,85);assert.equal(result.draft.revision,2);assert.equal(state.docs.get('weeks/W1').projects.length,1);
 const retry=await call('publishDashboardProjectDraft',input);assert.equal(retry.alreadyPublished,true);assert.equal(state.docs.get('weeks/W1').version,2);assert.equal([...state.docs.keys()].filter(k=>k.startsWith('projectDraftPublicationAudit/')).length,1);
 await assert.rejects(call('publishDashboardProjectDraft',{...input,project:{progress:90}}),reason('conflict'));
});
test('atomic publish audit failure saves neither current form nor official values',async()=>{
 setup();const {draft}=await open();state.failAudit=true;
 await assert.rejects(call('publishDashboardProjectDraft',{draftId:draft.draftId,source:draft.source,expectedRevision:0,project:{progress:85},weekId:'W1',expectedPublishedRevision:projectRevisionFingerprint(state.docs.get('weeks/W1').projects[0])}),/audit unavailable/);
 assert.equal(state.docs.has('projectDrafts/'+draft.draftId),false);assert.equal(state.docs.get('weeks/W1').projects[0].progress,40);
});
test('a stable new draft identifier makes first save-and-publish retry safe',async()=>{
 setup();state.docs.set('userPermissions/'+email,{overrides:{'project.manage':true}});
 const input={draftId:'client-new-id',expectedRevision:0,project:{name:'New',code:'NEW',projectLevel:'system',progress:30},weekId:'W1',expectedPublishedRevision:null};
 const result=await call('publishDashboardProjectDraft',input);assert.equal(result.project.progress,30);assert.equal(result.draft.revision,1);
 assert.equal((await call('publishDashboardProjectDraft',input)).alreadyPublished,true);assert.equal(state.docs.get('weeks/W1').projects.length,2);
 state.docs.get('weeks/W1').projects[1].progress=99;await assert.rejects(call('publishDashboardProjectDraft',input),reason('conflict'));
});
test('atomic action cannot publish a new project without create grant or leak a collided draft ID',async()=>{
 setup();const input={draftId:'client-new-id',expectedRevision:0,project:{name:'New',code:'NEW',projectLevel:'system',progress:30},weekId:'W1',expectedPublishedRevision:null};
 await call('publishDashboardProjectDraft',input);        // a PM needs no project.manage override to publish a new project
 await assert.rejects(call('saveDashboardProjectDraft',{draftId:'client-new-id',expectedRevision:0,project:{}},'other@example.com'),reason('draft-forbidden'));
});
test('non-Admin cannot import hidden or archived official data through the source endpoint',async()=>{
 setup();for(const visibility of ['hidden','archived']){state.docs.get('weeks/W1').projects[0].visibility=visibility;await assert.rejects(open(),reason('visibility-forbidden'));}
});
test('archived official projects stay in existing management rather than becoming new source drafts',async()=>{
 setup();state.docs.get('weeks/W1').projects[0].visibility='archived';const before=structuredClone([...state.docs]);
 await assert.rejects(call('getDashboardProjectDraft',{source},'admin@example.com'),reason('archive-lifecycle'));
 assert.deepEqual([...state.docs],before);
});
test('list does not return source-backed working contents after official ownership is revoked',async()=>{
 setup();let {draft}=await open();await save(draft,{highlight:'private working text'});state.docs.get('weeks/W1').projects[0].owner='Other';
 await assert.rejects(call('listDashboardProjectDrafts',{}),reason('ownership-forbidden'));
});
test('new caller-created drafts cannot preclaim the server source namespace',async()=>{
 setup();state.docs.set('userPermissions/other@example.com',{overrides:{'project.manage':true}});
 const {sourceDraftId}=require('../project-draft-origin');const draftId=sourceDraftId(source);
 await assert.rejects(call('saveDashboardProjectDraft',{draftId,expectedRevision:0,project:{name:'Wrong',code:'EVIL'}},'other@example.com'),reason('invalid-payload'));
 await assert.rejects(call('publishDashboardProjectDraft',{draftId,expectedRevision:0,project:{name:'Wrong',code:'EVIL',projectLevel:'system'},weekId:'W1',expectedPublishedRevision:null},'other@example.com'),reason('invalid-payload'));
 assert.equal(state.docs.has('projectDrafts/'+draftId),false);assert.equal((await open()).draft.project.code,'OLD');
});
test('source lookup never returns an unrelated or incorrectly bound stored draft, even for Admin',async()=>{
 setup();const {sourceDraftId}=require('../project-draft-origin');const draftId=sourceDraftId(source);
 const record={schemaVersion:1,draftId,revision:1,project:{name:'Wrong',code:'EVIL'},editorEmails:['other@example.com'],assignment:{ownerEmail:'other@example.com'}};
 state.docs.set('projectDrafts/'+draftId,record);
 await assert.rejects(call('getDashboardProjectDraft',{source},'admin@example.com'),reason('conflict'));
 await assert.rejects(open(),reason('conflict'));
 record.source={weekId:'W2',projectCode:'OLD',expectedRevision:'x'};record.project.code='OLD';
 await assert.rejects(call('getDashboardProjectDraft',{source},'admin@example.com'),reason('conflict'));
});
