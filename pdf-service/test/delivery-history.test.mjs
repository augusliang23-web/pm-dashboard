import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoundedDeliveryHistoryReader,loadAuthorizedReport} from '../src/report-data.js';
import {buildOverviewReportModel} from '../src/report-model.js';
import {createDeliveryTrendsInput,calculateDeliveryTrends} from '../../js/delivery-trends-adapter.mjs';
import {week,project} from '../../shared/fixtures/delivery-trends.mjs';
const request={mode:'overview',weekId:'2026-W41',overviewScope:'system',sections:['portfolio-delivery-performance']};
const provenance={source:'synthetic',asOf:'2026-10-14T00:00:00Z'};
const ws=[week(40),week(41,[project({progress:30})])];
const adapters=(role='pm',history=ws)=>({verifyIdToken:async()=>({uid:'pdf-fixture',firebase:{sign_in_provider:'password'},email:'user@example.test'}),getUserByEmail:async()=>({authUid:'pdf-fixture',role}),getWeekById:async()=>ws[1],getDeliveryHistory:async()=>({weeks:history,complete:true}),getDeliveryTrendsProvenance:()=>provenance});
test('PDF report/model expose canonical contract identical to browser authorized calculation',async()=>{
 const report=await loadAuthorizedReport({request,idToken:'synthetic-token',adapters:adapters()});
 assert.equal(report.deliveryTrends.summary.weeklyProgressGainPp,10);
 const browser=calculateDeliveryTrends(createDeliveryTrendsInput({...provenance,anchorWeekId:request.weekId,windowWeeks:6,publicationMode:'include-drafts',scope:{projectLevel:'system'},weeks:ws,canReadWeek:()=>true,canReadProject:()=>true}));
 assert.deepEqual(report.deliveryTrends,browser);
 assert.deepEqual(buildOverviewReportModel(report).deliveryTrends,report.deliveryTrends);
});
test('VIP and executive draft history is removed before period/identity diagnostics',async()=>{
 const bad={weekId:'SECRET',isReleased:false,projects:'SECRET'};
 for(const role of ['vip','executive']){
  const report=await loadAuthorizedReport({request,idToken:'token',adapters:adapters(role,[ws[0],bad,ws[1]])});
  assert.equal(report.deliveryTrends.summary.weeklyProgressGainPp,10);assert.ok(!JSON.stringify(report.deliveryTrends).includes('SECRET'));
 }
});
test('role authorization runs before requesting historical data',async()=>{
 let called=false;await assert.rejects(loadAuthorizedReport({request,idToken:'token',adapters:{...adapters('unknown'),getDeliveryHistory:async()=>{called=true;return {weeks:ws,complete:true}}}}));assert.equal(called,false);
});
test('scope and code selection retain missing-progress current projects and hide unselected projects',async()=>{
 const history=[week(40,[project(),project({projectId:'b',code:'B',progress:90})]),week(41,[project({progress:null}),project({projectId:'b',code:'B',progress:100})])];
 const a={...adapters('pm',history),getWeekById:async()=>history[1]};
 const report=await loadAuthorizedReport({request:{...request,projectCodes:['A']},idToken:'token',adapters:a});
 assert.equal(report.deliveryTrends.summary.currentCompletionPct,null);assert.equal(report.deliveryTrends.projects.length,1);assert.equal(report.deliveryTrends.projects[0].isInAnchorScope,true);
});
test('incomplete or unavailable history never falls back to six legacy raw records',async()=>{
 for(const value of [{weeks:ws,complete:false},null]){
  let legacyCalled=false;const a={...adapters(),getDeliveryHistory:async()=>value,getTrendWeeks:async()=>{legacyCalled=true;return ws}};
  const report=await loadAuthorizedReport({request,idToken:'token',adapters:a});
  assert.equal(report.deliveryTrends.status,'unavailable');assert.equal(report.deliveryTrends.summary.currentCompletionPct,null);assert.equal(legacyCalled,false);
 }
});
test('anchor revision change during history read makes metric snapshot unavailable',async()=>{
 const report=await loadAuthorizedReport({request,idToken:'token',adapters:{...adapters('pm',[ws[0],{...ws[1],version:2}]),getWeekById:async()=>({...ws[1],version:1})}});
 assert.equal(report.deliveryTrends.status,'unavailable');assert.ok(report.deliveryTrends.warnings.some(w=>w.code==='anchor-revised-during-read'));
});
test('legacy Overview sections neither read delivery history nor change existing model shape',async()=>{
 let called=false;const report=await loadAuthorizedReport({request:{...request,sections:['health-focus']},idToken:'token',adapters:{...adapters(),getDeliveryHistory:async()=>{called=true;throw Error('unused')}}});
 assert.equal(called,false);assert.equal(report.deliveryTrends,undefined);assert.equal(buildOverviewReportModel(report).deliveryTrends,undefined);
});
function queryFixture(pages) {
 const calls=[];let page=0;const query={where:(...args)=>{calls.push(['where',...args]);return query},orderBy:(...args)=>{calls.push(['orderBy',...args]);return query},limit:(n)=>{calls.push(['limit',n]);return query},startAfter:(id)=>{calls.push(['startAfter',id]);return query},get:async()=>({docs:(pages[page++]||[]).map(w=>({id:w.weekId,data:()=>w}))})};
 return {db:{collection:name=>{calls.push(['collection',name]);return query}},calls,get page(){return page}};
}
test('bounded Firestore reader filters publication before pagination and reads beyond six raw records',async()=>{
 const history=Array.from({length:13},(_,i)=>week(29+i));const f=queryFixture([history.slice(0,7),history.slice(7)]);
 const read=createBoundedDeliveryHistoryReader({db:f.db,documentIdField:'doc-id',pageSize:7,maxPages:2});
 const result=await read({publicationMode:'released'});assert.equal(result.weeks.length,13);assert.equal(result.complete,true);
 assert.ok(f.calls.some(c=>c[0]==='where'&&c[1]==='isReleased'&&c[3]===true));assert.ok(f.calls.some(c=>c[0]==='startAfter'));assert.ok(f.calls.every(c=>c[0]!=='limit'||c[1]===7));
});
test('bounded Firestore reader explicitly reports truncation; unsafe configuration is rejected',async()=>{
 const f=queryFixture(Array.from({length:6},()=>[week(41)]));
 const read=createBoundedDeliveryHistoryReader({db:f.db,documentIdField:'doc-id',pageSize:1,maxPages:6});
 assert.equal((await read({publicationMode:'include-drafts'})).complete,false);assert.equal(f.page,6);
 assert.throws(()=>createBoundedDeliveryHistoryReader({db:f.db,pageSize:1000}));assert.throws(()=>createBoundedDeliveryHistoryReader({db:f.db,maxPages:999}));
});
test('authorized scope exit and confirmed completion match Browser without exposing hidden current metadata',async()=>{
 const history=[week(40,[project({name:'Visible Name'})]),week(41,[project({visibility:'archived',lifecycle:'completed',name:'PRIVATE-CURRENT'})])];
 const a={...adapters('pm',history),getWeekById:async()=>history[1]};
 const report=await loadAuthorizedReport({request,idToken:'token',adapters:a});
 const browser=calculateDeliveryTrends(createDeliveryTrendsInput({...provenance,anchorWeekId:request.weekId,windowWeeks:6,publicationMode:'include-drafts',scope:{projectLevel:'system'},weeks:history,canReadWeek:()=>true,canReadProject:()=>true}));
 assert.deepEqual(report.deliveryTrends,browser);assert.equal(report.deliveryTrends.changes.exitedScope.length,1);
 assert.equal(report.deliveryTrends.changes.confirmedCompleted.length,1);assert.ok(!JSON.stringify(report.deliveryTrends).includes('PRIVATE'));
});
test('null project rows with explicit selection produce diagnostics rather than HTTP failure',async()=>{
 const history=[week(40,[project(),null]),week(41,[project({progress:30}),null])];
 const report=await loadAuthorizedReport({request:{...request,projectCodes:['A']},idToken:'token',adapters:{...adapters('pm',history),getWeekById:async()=>history[1]}});
 assert.equal(report.deliveryTrends.summary.weeklyProgressGainPp,10);assert.equal(report.deliveryTrends.projects.length,1);
});
test('malformed truthy visibility cannot broaden legacy Overview scope or reveal current metadata',async()=>{
 for(const visibility of [{private:'PAYLOAD'},42,true]){
  const history=[week(40,[project({name:'Visible Name'})]),week(41,[project({visibility,name:'PRIVATE-CURRENT'})])];
  const report=await loadAuthorizedReport({request,idToken:'token',adapters:{...adapters('pm',history),getWeekById:async()=>history[1]}});
  const browser=calculateDeliveryTrends(createDeliveryTrendsInput({...provenance,anchorWeekId:request.weekId,windowWeeks:6,publicationMode:'include-drafts',scope:{projectLevel:'system'},weeks:history,canReadWeek:()=>true,canReadProject:()=>true}));
  assert.deepEqual(report.deliveryTrends,browser);assert.equal(report.week.projects.length,0);
  assert.equal(report.deliveryTrends.projects[0].isInAnchorScope,false);assert.equal(report.deliveryTrends.summary.weeklyProgressGainPp,null);
  assert.ok(!JSON.stringify(report.deliveryTrends).includes('PRIVATE'));
 }
});
