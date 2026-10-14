const test=require('node:test'); const assert=require('node:assert/strict');
const {createStore}=require('./helpers/draft-store.cjs');const {state,db}=createStore();
const path=require.resolve('firebase-admin/firestore');const real=require(path);require.cache[path]={id:path,filename:path,loaded:true,exports:{...real,getFirestore:()=>db}};
const api=require('../project-drafts');const {projectRevisionFingerprint}=require('../project-dashboard-writes');
process.env.GCLOUD_PROJECT='demo-pm-dashboard-v22t';process.env.FUNCTIONS_EMULATOR='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const call=(fn,data,email='owner@example.com')=>api[fn].run({data,auth:{uid:email,token:{email}}});
async function setup(){state.docs.clear();state.failAudit=false;state.docs.set('users/owner@example.com',{role:'pm',displayName:'Owner'});state.docs.set('userPermissions/owner@example.com',{overrides:{'project.manage':true}});state.docs.set('weeks/W1',{weekLabel:'W1 2026',projects:[],version:1,isReleased:false});const {draft}=await call('saveDashboardProjectDraft',{expectedRevision:0,project:{name:'Alpha',code:'ALPHA',progress:40}});return draft;}
const publish=(d,extra={})=>call('publishDashboardProjectDraft',{draftId:d.draftId,expectedRevision:d.revision,weekId:'W1',expectedPublishedRevision:null,...extra});
const reason=wanted=>e=>e.details?.reason===wanted;
test('Publish alone writes official content, then draft edits remain isolated until republished',async()=>{let draft=await setup();const first=await publish(draft);assert.equal(first.project.progress,40);assert.equal('editorEmails' in first.project,false);const oldWeek=structuredClone(state.docs.get('weeks/W1'));state.docs.set('weeks/HISTORY',{...oldWeek,isReleased:true});({draft}=await call('saveDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:1,project:{progress:65}}));assert.equal(state.docs.get('weeks/W1').projects[0].progress,40);const second=await publish(draft,{expectedPublishedRevision:first.projectRevision});assert.equal(second.project.progress,65);assert.equal(state.docs.get('weeks/HISTORY').projects[0].progress,40);assert.equal(state.docs.has('projectDrafts/'+draft.draftId),true);});
test('timeout retry is idempotent but cannot mask restored or deleted target',async()=>{const draft=await setup();const first=await publish(draft);const retry=await publish(draft);assert.equal(retry.alreadyPublished,true);assert.equal([...state.docs.keys()].filter(x=>x.startsWith('projectDraftPublicationAudit/')).length,1);state.docs.get('weeks/W1').projects[0].progress=99;await assert.rejects(publish(draft),reason('conflict'));state.docs.get('weeks/W1').projects=[];await assert.rejects(publish(draft),reason('conflict'));assert.equal(first.project.progress,40);});
test('same code legacy project, released target, stale draft and lost grant reject without writes',async()=>{const draft=await setup();state.docs.get('weeks/W1').projects=[{code:'ALPHA',owner:'Owner',progress:0}];await assert.rejects(publish(draft),reason('conflict'));state.docs.get('weeks/W1').projects=[];state.docs.get('weeks/W1').isReleased=true;await assert.rejects(publish(draft),reason('released-week'));state.docs.get('weeks/W1').isReleased=false;await assert.rejects(publish({...draft,revision:99}),reason('conflict'));state.docs.get('userPermissions/owner@example.com').overrides={};await assert.rejects(publish(draft),reason('create-forbidden'));assert.equal(state.docs.get('weeks/W1').version,1);});
test('audit write failure rolls back official snapshot and publication marker',async()=>{const draft=await setup();state.failAudit=true;await assert.rejects(publish(draft),/audit unavailable/);assert.deepEqual(state.docs.get('weeks/W1').projects,[]);assert.equal(state.docs.get('projectDrafts/'+draft.draftId).lastPublication,null);});
test('new week carryover matches stable identity and never updates an earlier week',async()=>{const draft=await setup();const first=await publish(draft);state.docs.set('weeks/W2',{...structuredClone(state.docs.get('weeks/W1')),weekLabel:'W2 2026',version:0});const next=await publish(draft,{weekId:'W2',expectedPublishedRevision:first.projectRevision});assert.equal(next.weekId,'W2');assert.equal(state.docs.get('weeks/W1').version,2);assert.equal(state.docs.get('weeks/W2').version,1);});
test('republish rejects ambiguous identities, stale target and externally changed ownership',async()=>{let d=await setup();const first=await publish(d);({draft:d}=await call('saveDashboardProjectDraft',{draftId:d.draftId,expectedRevision:1,project:{progress:65}}));await assert.rejects(publish(d,{expectedPublishedRevision:'stale'}),reason('conflict'));state.docs.get('weeks/W1').projects.push(structuredClone(first.project));await assert.rejects(publish(d,{expectedPublishedRevision:first.projectRevision}),reason('conflict'));state.docs.get('weeks/W1').projects=[{...first.project,owner:'Other',deputy:''}];await assert.rejects(publish(d,{expectedPublishedRevision:projectRevisionFingerprint(state.docs.get('weeks/W1').projects[0])}),reason('ownership-forbidden'));});

test('later publication prevents rewriting an earlier unreleased reporting week',async()=>{
 let draft=await setup();const first=await publish(draft);
 state.docs.set('weeks/W2',{...structuredClone(state.docs.get('weeks/W1')),weekLabel:'W2 2026'});
 await publish(draft,{weekId:'W2',expectedPublishedRevision:first.projectRevision});
 // A harmless retry of the earlier snapshot is still idempotent.
 assert.equal((await publish(draft)).alreadyPublished,true);
 ({draft}=await call('saveDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:1,project:{progress:65}}));
 await assert.rejects(publish(draft,{expectedPublishedRevision:first.projectRevision}),reason('historical-week'));
 assert.equal(state.docs.get('weeks/W1').projects[0].progress,40);
});
test('a refreshed current fingerprint cannot take over a restored target',async()=>{
 const draft=await setup();await publish(draft);const live=state.docs.get('weeks/W1').projects[0];live.progress=99;
 await assert.rejects(publish(draft,{expectedPublishedRevision:projectRevisionFingerprint(live)}),reason('conflict'));
 assert.equal(live.progress,99);assert.equal([...state.docs.keys()].filter(x=>x.startsWith('projectDraftPublicationAudit/')).length,1);
});
test('persistent publication markers remain bounded across large weekly publications',async()=>{
 let draft=await setup();
 ({draft}=await call('saveDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:1,project:{riskList:Array.from({length:80},()=>({description:'x'.repeat(1500)}))}}));
 let revision=null;
 for(let n=1;n<=12;n++){
  const previous=state.docs.get('weeks/W'+(n-1));state.docs.set('weeks/W'+n,{weekLabel:'W'+n+' 2026',isReleased:false,projects:previous?structuredClone(previous.projects):[]});
  const result=await publish(draft,{weekId:'W'+n,expectedPublishedRevision:revision});revision=result.projectRevision;
 }
 const stored=state.docs.get('projectDrafts/'+draft.draftId);
 assert.ok(Buffer.byteLength(JSON.stringify(stored))<200000);
 assert.match(stored.publicationTargets.W12.projectRevision,/^[a-f0-9]{64}$/);
});
