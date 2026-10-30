import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {getOverviewProjects} from '../js/portfolio-core.mjs';
import {copyPreviousWeekCarryover} from '../week-carryover.mjs';
import {loadAuthorizedReport} from '../pdf-service/src/report-data.js';
import {buildPromptContext,buildWeeklyCopilotPrompt} from '../js/copilot-weekly-update-prompt.mjs';
const require=createRequire(import.meta.url),{createStore}=require('../functions/test/helpers/draft-store.cjs');
const {state,db}=createStore(),firestorePath=createRequire(new URL('../functions/package.json',import.meta.url)).resolve('firebase-admin/firestore');
const real=require(firestorePath);require.cache[firestorePath]={id:firestorePath,filename:firestorePath,loaded:true,exports:{...real,getFirestore:()=>db}};
const api=require('../functions/project-drafts');
process.env.GCLOUD_PROJECT='demo-pm-dashboard-v22t';process.env.FUNCTIONS_EMULATOR='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const email='owner@example.com',call=(name,data)=>api[name].run({auth:{uid:'owner',token:{email}},data:{...data,...(name==='publishDashboardProjectDraft'?{selectedWeekId:data.weekId}:{})}});
function setup(projects=[]){state.docs.clear();state.docs.set('users/'+email,{role:'pm',displayName:'Owner'});state.docs.set('userPermissions/'+email,{overrides:{'project.manage':true}});state.docs.set('weeks/W1',{weekLabel:'W1 2026',isReleased:false,projects});}
const official=()=>state.docs.get('weeks/W1');
const report=extra=>loadAuthorizedReport({request:{mode:'overview',weekId:'W1',sections:['weekly-trend'],overviewScope:'all',...extra},idToken:email,adapters:{verifyIdToken:async()=>({email}),getUserByEmail:async()=>({role:'pm'}),getWeekById:async()=>structuredClone(official()),getTrendWeeks:async()=>[structuredClone(official())]}});
test('actual Save handler leaves Overview, PDF, trend, Copilot and carryover unchanged',async()=>{
  setup([{code:'A',name:'Alpha',owner:'Owner',projectLevel:'system',progress:20,status:'green'},{code:'B',name:'Beta',owner:'Owner',projectLevel:'system',progress:60,status:'yellow'}]);
  const before=structuredClone(official());
  await call('saveDashboardProjectDraft',{expectedRevision:0,project:{name:'Private secret draft',code:'PRIVATE',progress:100,status:'red',budget:{totalEstimated:1000000}}});
  const visible=getOverviewProjects(official().projects,'all');assert.equal(visible.length,2);assert.equal(visible.reduce((n,p)=>n+p.progress,0)/visible.length,40);assert.equal(visible.filter(p=>p.status==='red').length,0);assert.deepEqual(official(),before);
  assert.equal(copyPreviousWeekCarryover(official()).projects.length,2);
  const pdf=await report();assert.equal(pdf.availableProjectCount,2);assert.equal(pdf.trendWeeks[0].projects.length,2);assert.equal(JSON.stringify(pdf).includes('Private secret draft'),false);
  const prompt=buildWeeklyCopilotPrompt(buildPromptContext({weeks:[official()],currentWeek:official(),project:official().projects[0]}));assert.equal(prompt.includes('Private secret draft'),false);
  await assert.rejects(report({mode:'project',projectCode:'PRIVATE',sections:['project-brief']}),/no longer exists/);
});
test('only explicit Publish changes official PDF values; later draft Save leaves the last snapshot intact',async()=>{
  setup();let {draft}=await call('saveDashboardProjectDraft',{expectedRevision:0,project:{name:'Alpha',code:'ALPHA',progress:40}});
  const first=await call('publishDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:1,weekId:'W1',expectedPublishedRevision:null});
  ({draft}=await call('saveDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:1,project:{progress:65}}));
  assert.equal((await report()).week.projects[0].progress,40);
  await call('publishDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:2,weekId:'W1',expectedPublishedRevision:first.projectRevision});
  assert.equal((await report()).week.projects[0].progress,65);
});
test('drafts never fill an empty official portfolio or PDF',async()=>{setup();await call('saveDashboardProjectDraft',{expectedRevision:0,project:{name:'Private',progress:100}});assert.deepEqual(getOverviewProjects(official().projects,'all'),[]);assert.equal((await report()).availableProjectCount,0);});
test('existing project working75 is excluded until current85 is saved and published, then Overview and PDF agree',async()=>{
 setup([{code:'OLD',name:'Existing',owner:'Owner',projectLevel:'system',visibility:'active',progress:40,status:'green'}]);
 let {draft}=await call('getDashboardProjectDraft',{source:{weekId:'W1',projectCode:'OLD'}});
 ({draft}=await call('saveDashboardProjectDraft',{draftId:draft.draftId,source:draft.source,expectedRevision:0,project:{progress:75}}));
 assert.equal(getOverviewProjects(official().projects,'all')[0].progress,40);assert.equal((await report()).week.projects[0].progress,40);
 const {projectRevisionFingerprint}=require('../functions/project-dashboard-writes');
 await call('publishDashboardProjectDraft',{draftId:draft.draftId,source:draft.source,expectedRevision:1,project:{progress:85},weekId:'W1',expectedPublishedRevision:projectRevisionFingerprint(official().projects[0])});
 assert.equal(getOverviewProjects(official().projects,'all').length,1);assert.equal(getOverviewProjects(official().projects,'all')[0].progress,85);assert.equal((await report()).week.projects[0].progress,85);
});
