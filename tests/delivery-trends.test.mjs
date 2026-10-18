import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDeliveryTrends as calc } from '../shared/delivery-trends.mjs';
import { project as p, week as w, input } from '../shared/fixtures/delivery-trends.mjs';
const pair = (before, after, options = {}) => calc(input([w(40, before), w(41, after)], options));

test('normal paired increase retains public contract and provenance', () => {
  const r = calc(input());
  assert.deepEqual(r.summary, {weeklyProgressGainPp:10, comparableCount:1, projectsProgressedCount:1,
    currentCompletionPct:30, health:{green:1,yellow:0,red:0,unknown:0}});
  assert.equal(r.contractVersion,'delivery-trends/v1'); assert.equal(r.provenance.source,'synthetic');
  assert.equal(r.provenance.anchorWeekId,'2026-W41'); assert.equal(r.provenance.asOf,'2026-10-14T00:00:00Z');
  assert.equal(r.weeklySeries.length,6); assert.equal(r.weeklySeries.at(-1).weeklyProgressGainPp,10);
  assert.ok(Array.isArray(r.projects)); assert.ok(Array.isArray(r.warnings));
  for(const key of ['firstObserved','confirmedCompleted','missingObservation','ambiguousIdentity','enteredScope','exitedScope']) assert.ok(Array.isArray(r.changes[key]));
  assert.ok(!JSON.stringify(r).toLowerCase().includes('cumulative'));
});
test('recorded zero stays available',()=>{const r=pair([p({progress:0})],[p({progress:0})]); assert.equal(r.summary.weeklyProgressGainPp,0);assert.equal(r.summary.projectsProgressedCount,0);assert.equal(r.summary.currentCompletionPct,0);});
test('missing progress differs from valid zero and remains a curve gap',()=>{const r=pair([p({progress:null})],[p({progress:0})]);assert.equal(r.summary.comparableCount,0);assert.equal(r.summary.weeklyProgressGainPp,null);assert.equal(r.summary.projectsProgressedCount,null);assert.equal(r.projects[0].history.at(-2).completionPct,null);});
test('new zero project changes current average without changing paired gain',()=>{const r=pair([p({progress:50})],[p({progress:50}),p({projectId:'b',code:'B',progress:0})]);assert.equal(r.summary.currentCompletionPct,25);assert.equal(r.summary.weeklyProgressGainPp,0);assert.equal(r.changes.firstObserved.length,1);});
test('confirmed completion uses lifecycle transition and can exit scope',()=>{const r=pair([p()],[p({lifecycle:'completed',visibility:'archived',progress:100})]);assert.equal(r.changes.confirmedCompleted.length,1);assert.equal(r.changes.exitedScope.length,1);assert.equal(r.summary.currentCompletionPct,null);});
test('disappearance is unknown and never completed',()=>{const r=pair([p()],[]);assert.equal(r.changes.missingObservation.length,1);assert.equal(r.changes.confirmedCompleted.length,0);});
test('already completed or unknown previous lifecycle is not a completion transition',()=>{for(const lifecycle of ['completed',undefined])assert.equal(pair([p({lifecycle})],[p({lifecycle:'completed'})]).changes.confirmedCompleted.length,0);});
test('duplicate legacy code rejects both ambiguous identities',()=>{const r=pair([p({projectId:null}),p({projectId:null})],[p({projectId:null,progress:40})]);assert.equal(r.summary.comparableCount,0);assert.ok(r.changes.ambiguousIdentity.length);});
test('duplicate immutable ID cannot enter averages or trends',()=>{const r=pair([p()],[p(),p()]);assert.equal(r.summary.comparableCount,0);assert.equal(r.summary.currentCompletionPct,null);assert.ok(r.changes.ambiguousIdentity.length);});
test('unique code legacy matches are explicitly provisional',()=>{const r=pair([p({projectId:null})],[p({projectId:null,progress:40})]);assert.equal(r.summary.weeklyProgressGainPp,20);assert.equal(r.projects[0].identityConfidence,'legacy-provisional');assert.equal(r.status,'partial');});
test('ID permits code rename; code-only rename never matches by name',()=>{assert.equal(pair([p()],[p({code:'RENAMED',progress:40})]).summary.weeklyProgressGainPp,20);const r=pair([p({projectId:null,name:'Same'})],[p({projectId:null,code:'RENAMED',name:'Same'})]);assert.equal(r.summary.comparableCount,0);});
test('mixed ID/legacy records do not silently merge',()=>{assert.equal(pair([p({projectId:null})],[p()]).summary.comparableCount,0);});
test('negative recorded delta is preserved',()=>{const r=pair([p({progress:50})],[p({progress:30})]);assert.equal(r.summary.weeklyProgressGainPp,-20);assert.equal(r.summary.projectsProgressedCount,0);assert.equal(r.changes.confirmedRebaseline.length,0);});
test('verified rebaseline excludes matching pair from denominator',()=>{const r=pair([p({progress:80})],[p({progress:20,baselineId:'b2',rebaseline:{verified:true,fromBaselineId:'b1',toBaselineId:'b2'}})]);assert.equal(r.summary.comparableCount,0);assert.equal(r.changes.confirmedRebaseline.length,1);});
test('unverified or unrelated rebaseline evidence never proves reset',()=>{for(const rebaseline of [{verified:false,fromBaselineId:'b1',toBaselineId:'b2'},{verified:true,fromBaselineId:'other',toBaselineId:'b2'}]){const r=pair([p({progress:80})],[p({progress:20,baselineId:'b2',rebaseline})]);assert.equal(r.summary.weeklyProgressGainPp,-60);assert.equal(r.changes.confirmedRebaseline.length,0);assert.equal(r.status,'partial');}});
test('strict percent validation never coerces invalid values to zero',()=>{for(const value of [null,undefined,'',' ',true,false,'10x','0x10','1e2',-1,101,NaN,Infinity,{},[]]){const r=pair([p()],[p({progress:value})]);assert.equal(r.summary.currentCompletionPct,null,String(value));assert.equal(r.summary.comparableCount,0);}assert.equal(pair([p()],[p({progress:' 30.5 '})]).summary.weeklyProgressGainPp,10.5);});
test('week gap stays visible and does not substitute earlier week',()=>{const r=calc(input([w(39),w(41)]));assert.equal(r.summary.weeklyProgressGainPp,null);assert.equal(r.weeklySeries.at(-2).weekId,null);assert.ok(r.warnings.some(x=>x.code==='missing-calendar-week'));});
test('cross-year ISO week 53 to week 1 is consecutive regardless of input order',()=>{const a=w(53,[p()],{weekId:'old',reportingPeriod:{year:2020,week:53}});const b=w(1,[p({progress:30})],{weekId:'new',reportingPeriod:{year:2021,week:1}});const r=calc(input([b,a],{anchorWeekId:'new'}));assert.equal(r.summary.weeklyProgressGainPp,10);});
test('invalid or duplicated reporting periods fail closed',()=>{for(const weeks of [[w(40),w(41,[],{reportingPeriod:{year:2021,week:53}})],[w(40),w(41,[],{reportingPeriod:{year:2026,week:40}})],[w(40),w(41,[],{reportingPeriod:null})],[w(40),w(41,[],{weekId:'2026-W40'})]])assert.equal(calc(input(weeks)).status,'unavailable');});
test('scope selection never treats member change as project disappearance',()=>{const r=pair([p({projectLevel:'software'})],[p()],{scope:{projectLevel:'system'}});assert.equal(r.changes.enteredScope.length,1);assert.equal(r.changes.firstObserved.length,0);assert.equal(r.summary.comparableCount,0);assert.equal(pair([p()],[p()],{scope:{projectLevel:'software'}}).summary.currentCompletionPct,null);});
test('project selection uses identity keys on both weeks',()=>{const r=pair([p(),p({projectId:'b',code:'B',progress:90})],[p({progress:40}),p({projectId:'b',code:'B',progress:10})],{scope:{projectLevel:'all',projectKeys:['id:a']}});assert.equal(r.summary.weeklyProgressGainPp,20);assert.equal(r.summary.comparableCount,1);});
test('released-only policy never uses a draft baseline; explicit draft policy does',()=>{const weeks=[w(40,[p()],{isReleased:false}),w(41,[p({progress:30})])];assert.equal(calc(input(weeks)).summary.comparableCount,0);assert.equal(calc(input(weeks,{publicationMode:'include-drafts'})).summary.weeklyProgressGainPp,10);assert.equal(calc(input(weeks,{anchorWeekId:weeks[0].weekId})).status,'unavailable');});
test('unsupported policy, scope, provenance or window fails closed',()=>{for(const options of [{publicationMode:'oops'},{scope:{projectLevel:'oops'}},{source:''},{asOf:'invalid'},{windowWeeks:7}])assert.equal(calc(input(undefined,options)).status,'unavailable');});
test('health counts unknown without interpreting RAG as lifecycle',()=>{const r=pair([],['green','yellow','red','blue'].map((status,i)=>p({projectId:String(i),code:String(i),status})));assert.deepEqual(r.summary.health,{green:1,yellow:1,red:1,unknown:1});assert.equal(r.changes.confirmedCompleted.length,0);});
test('N calendar slots use one preceding source week to compute first displayed delta',()=>{const weeks=Array.from({length:7},(_,i)=>w(35+i,[p({progress:i*10})]));const r=calc(input(weeks));assert.equal(r.weeklySeries.length,6);assert.equal(r.weeklySeries[0].weeklyProgressGainPp,10);assert.equal(r.projects[0].history.length,6);});
test('pure deterministic calculation never mutates frozen input',()=>{const data=input();const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}};freeze(data);assert.deepEqual(calc(data),calc(data));});
test('code-only match is ambiguous when an ID row shares its code',()=>{
 const r=pair([p({progress:80}),p({projectId:null,progress:10})],[p({progress:90}),p({projectId:null,progress:30})]);
 assert.equal(r.summary.comparableCount,1);assert.equal(r.summary.weeklyProgressGainPp,10);
 assert.equal(r.summary.currentCompletionPct,90);assert.equal(r.projects.length,1);
 assert.ok(r.changes.ambiguousIdentity.length);
});
test('unavailable input or absent week never claims zero health or zero scope observations',()=>{
 const r=calc({});assert.deepEqual(r.summary.health,{green:null,yellow:null,red:null,unknown:null});
 const gap=calc(input([w(39),w(41)])).weeklySeries.at(-2);
 assert.equal(gap.scopeProjectCount,null);assert.equal(gap.validProgressCount,null);assert.equal(gap.health.green,null);
 const empty=pair([],[]);assert.equal(empty.summary.health.green,0);assert.equal(empty.summary.currentCompletionPct,null);
});
test('12 displayed weeks use 13 records for first and last paired gains',()=>{
 const weeks=Array.from({length:13},(_,i)=>w(29+i,[p({progress:i*5})]));
 const r=calc(input(weeks,{windowWeeks:12}));assert.equal(r.weeklySeries.length,12);
 assert.equal(r.weeklySeries[0].gainPp,5);assert.equal(r.weeklySeries.at(-1).gainPp,5);
 assert.equal(r.projects[0].trend.length,12);
});
