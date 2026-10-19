import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDeliveryTrendsState} from '../js/delivery-trends-page.mjs';
import {loadAuthorizedReport} from '../pdf-service/src/report-data.js';
import {buildOverviewReportModel} from '../pdf-service/src/report-model.js';
import {renderOverviewReportHtml} from '../pdf-service/src/overview-report.js';
import {parseReportRequest} from '../pdf-service/src/report-request.js';
import {loadTargetRegistry,resolveRuntimeTarget} from '../pdf-service/src/environment.js';
const base={source:'synthetic',asOf:'2026-10-14T00:00:00Z',role:'pm',historyComplete:true,overviewScope:'system'};
const project=(overrides={})=>({projectId:'a',code:'A',name:'Synthetic A',owner:'Synthetic PM',progress:20,status:'green',visibility:'active',lifecycle:'active',projectLevel:'system',baselineId:'b1',...overrides});
const weeks=()=>Array.from({length:13},(_,i)=>({weekId:`W${29+i}-2026`,weekLabel:`W${29+i} 2026`,version:1,isReleased:true,projects:[project({progress:10+i*2})]}));
const browser=(ws,options={})=>buildDeliveryTrendsState({...base,weeks:ws,currentIdx:ws.length-1,...options});
async function pdf(ws,options={}){
 const request=parseReportRequest({mode:'overview',weekId:ws.at(-1).weekId,overviewScope:'system',sections:['health-focus','portfolio-delivery-performance'],projectCodes:ws.at(-1).projects.map(p=>p.code)},{deliveryPerformanceSection:true});
 return loadAuthorizedReport({request,idToken:'synthetic',adapters:{verifyIdToken:async()=>({email:'synthetic@example.test'}),getUserByEmail:async()=>({role:options.role||'pm'}),getWeekById:async()=>ws.at(-1),getDeliveryHistory:async()=>({weeks:ws,complete:true}),deliveryTrendsWindowWeeks:options.windowWeeks||6,getDeliveryTrendsProvenance:()=>({source:base.source,asOf:base.asOf})}});
}
test('actual page→data→model→renderer share six/twelve-week metric definitions',async()=>{
 for(const windowWeeks of [6,12]){
  const ws=weeks();const web=browser(ws,{windowWeeks});const report=await pdf(ws,{windowWeeks});
  assert.deepEqual(web.contract,report.deliveryTrends);assert.deepEqual(buildOverviewReportModel(report).deliveryTrends,web.contract);
  const html=renderOverviewReportHtml(report);assert.match(html,/2pp/);assert.match(html,/34%/);
 }
});
test('cached/unproven Browser history does not expose trusted numbers',()=>{
 const r=browser(weeks(),{historyComplete:false});assert.ok(r.state==='unavailable'||r.contract.status==='unavailable');
 assert.ok(r.state==='unavailable'||r.contract.summary.weeklyProgressGainPp===null);
});
test('explicit raw anchor ID wins over collection order and future records do not leak',()=>{
 const ws=weeks();ws.at(-1).projects[0].name='FUTURE-PRIVATE';
 const r=browser(ws,{currentIdx:12,anchorWeekId:ws[9].weekId});
 assert.equal(r.contract.provenance.anchorWeekId,ws[9].weekId);assert.ok(!JSON.stringify(r).includes('FUTURE-PRIVATE'));
});
test('VIP/executive cannot use drafts outside executive perspective',()=>{
 const ws=weeks();ws.at(-1).isReleased=false;
 for(const role of ['vip','executive']){
  const r=browser(ws,{role,executivePerspective:false});assert.ok(r.state==='unavailable'||r.contract.summary.weeklyProgressGainPp===null);
 }
});
test('scope exits and missing raw lifecycle agree in actual Web and PDF flows',async()=>{
 const ws=weeks();delete ws.at(-2).projects[0].lifecycle;
 ws.at(-1).projects[0]={...ws.at(-1).projects[0],visibility:'archived',lifecycle:'completed',name:'PRIVATE-NOW'};
 const web=browser(ws);const report=await pdf(ws);assert.deepEqual(web.contract,report.deliveryTrends);
 assert.equal(web.contract.changes.exitedScope.length,1);assert.equal(web.contract.changes.confirmedCompleted.length,0);
 assert.ok(!JSON.stringify(web.contract).includes('PRIVATE-NOW'));
});
test('unrecognized role fails closed',()=>{const r=browser(weeks(),{role:'unknown'});assert.equal(r.state,'unavailable');});
test('runtime capability is gated by target registry features and fails closed when missing',()=>{
 const registry=loadTargetRegistry();
 const env=name=>{const t=registry.targets[name];return {PDF_ENVIRONMENT:name,FIREBASE_PROJECT_ID:t.firebaseProjectId,ALLOWED_ORIGIN:t.allowedOrigins.join(','),K_SERVICE:t.serviceName};};
 // Production release candidate: both shipped UAT and Production targets enable the section via target features.
 assert.equal(resolveRuntimeTarget(env('uat'),registry).features.deliveryPerformanceSection,true);
 assert.equal(resolveRuntimeTarget(env('production'),registry).features.deliveryPerformanceSection,true);
 delete registry.targets.uat.features.deliveryPerformanceSection;
 assert.equal(resolveRuntimeTarget(env('uat'),registry).features.deliveryPerformanceSection,false);
 registry.targets.uat.features.deliveryPerformanceSection=true;
 assert.equal(resolveRuntimeTarget(env('uat'),registry).features.deliveryPerformanceSection,true);
 delete registry.targets.production.features.deliveryPerformanceSection;
 assert.equal(resolveRuntimeTarget(env('production'),registry).features.deliveryPerformanceSection,false);
 registry.targets.production.features.deliveryPerformanceSection=true;
 assert.equal(resolveRuntimeTarget(env('production'),registry).features.deliveryPerformanceSection,true);
});
test('selecting every current project preserves full portfolio disappearance diagnostics',async()=>{
 const ws=weeks();for(const week of ws.slice(0,-1))week.projects.push(project({projectId:'gone',code:'G',name:'Previously Visible',progress:50}));
 const web=browser(ws);const report=await pdf(ws);assert.deepEqual(web.contract,report.deliveryTrends);
 assert.equal(web.contract.changes.missingObservation.length,1);
});
test('server-complete short history remains partial with explicit missing-week/baseline warnings',()=>{
 for(const windowWeeks of [6,12]){const ws=weeks().slice(-6);const state=browser(ws,{windowWeeks});assert.equal(state.contract.status,'partial');
  assert.ok(state.contract.warnings.some(w=>w.code==='missing-calendar-week'||w.code==='comparison-baseline-unavailable'));
 }
});
test('combined Overview excludes future ISO years from the legacy weekly trend section',async()=>{
 const ws=weeks();const anchor=ws.at(-1);const future={...anchor,weekId:'W1-2027',weekLabel:'W1 2027',projects:[project({name:'FUTURE PRIVATE'})]};
 const request=parseReportRequest({mode:'overview',weekId:anchor.weekId,projectCodes:['A'],sections:['weekly-trend','portfolio-delivery-performance']},{deliveryPerformanceSection:true});
 const report=await loadAuthorizedReport({request,idToken:'synthetic',adapters:{verifyIdToken:async()=>({email:'synthetic@example.test'}),getUserByEmail:async()=>({role:'pm'}),getWeekById:async()=>anchor,getTrendWeeks:async()=>[ws.at(-2),anchor,future],getDeliveryHistory:async()=>({weeks:[...ws,future],complete:true}),getDeliveryTrendsProvenance:()=>({source:'synthetic'})}});
 assert.ok(!JSON.stringify(report).includes('FUTURE PRIVATE'));assert.equal(report.trendWeeks.length,2);
});
