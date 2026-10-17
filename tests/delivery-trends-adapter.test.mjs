import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryTrendsInput as adapt } from '../js/delivery-trends-adapter.mjs';
import { calculateDeliveryTrends } from '../shared/delivery-trends.mjs';
import { project as p, week as w } from '../shared/fixtures/delivery-trends.mjs';
const options = (overrides={}) => ({source:'production',asOf:'2026-10-14T00:00:00Z',anchorWeekId:'2026-W41',windowWeeks:6,
 publicationMode:'released',scope:{projectLevel:'system'},canReadWeek:()=>true,canReadProject:()=>true,...overrides});
test('adapter preserves raw progress, reporting period and explicit provenance',()=>{
 const weeks=[w(40,[p({progress:null})]),w(41,[p({progress:0})])];
 const data=adapt({weeks,...options()});assert.equal(data.weeks[0].projects[0].progress,null);
 assert.equal(data.weeks[1].projects[0].progress,0);assert.deepEqual(data.weeks[0].reportingPeriod,{year:2026,week:40});
 assert.equal(data.source,'production');assert.equal(calculateDeliveryTrends(data).summary.weeklyProgressGainPp,null);
});
test('authorization rejects week/project details before diagnostics or calculations',()=>{
 const secret=p({projectId:'private',code:'SECRET',name:'SECRET-NAME',progress:90});
 const data=adapt({weeks:[w(40,[p(),secret]),w(41,[p({progress:30}),secret]),w(42,[secret])],
 ...options({canReadWeek:week=>week.weekId!=='2026-W42',canReadProject:project=>project.projectId!=='private'})});
 const result=calculateDeliveryTrends(data);assert.equal(result.summary.currentCompletionPct,30);
 assert.ok(!JSON.stringify({data,result}).includes('SECRET'));assert.equal(data.weeks.length,2);
});
test('adapter requires explicit boolean authorization and fails closed on callback errors',()=>{
 assert.throws(()=>adapt({weeks:[w(41)],...options({canReadProject:undefined})}));
 assert.throws(()=>adapt({weeks:[w(41)],...options({canReadWeek:()=>{throw new Error('SECRET')}})}), error=>!error.message.includes('SECRET'));
 assert.equal(adapt({weeks:[w(41)],...options({canReadProject:()=>1})}).weeks[0].projects.length,0);
});
test('document IDs survive normalization and explicit ISO labels supply reporting periods',()=>{
 const week={__documentId:'2026-W41',weekLabel:'W41 2026',isReleased:true,projects:[p()]};
 const data=adapt({weeks:[week],...options()});assert.equal(data.weeks[0].weekId,'2026-W41');
 assert.deepEqual(data.weeks[0].reportingPeriod,{year:2026,week:41});
});
test('adapter does not mutate or carry sensitive unrelated fields',()=>{
 const project=p({progress:'',privateEmail:'secret@example.test',budget:{secret:1}});
 const weeks=[w(41,[project])];const before=JSON.stringify(weeks);const data=adapt({weeks,...options()});
 assert.equal(JSON.stringify(weeks),before);assert.equal(data.weeks[0].projects[0].progress,'');
 assert.ok(!JSON.stringify(data).includes('secret'));data.weeks[0].reportingPeriod.week=1;assert.equal(weeks[0].reportingPeriod.week,41);
});
test('authorized malformed projects fail closed while explicit empty and rejected records remain safe',()=>{
 for(const projects of [null,{},'bad'])assert.throws(()=>adapt({weeks:[w(41,projects)],...options()}),/metrics input was not created/);
 const missing=w(41);delete missing.projects;assert.throws(()=>adapt({weeks:[missing],...options()}),/metrics input was not created/);
 assert.equal(adapt({weeks:[w(41,[])],...options()}).weeks[0].projects.length,0);
 assert.equal(adapt({weeks:[w(41,{secret:'PRIVATE'})],...options({canReadWeek:()=>false})}).weeks.length,0);
 assert.equal(adapt({weeks:[w(41,{secret:'DRAFT'},{isReleased:false})],...options()}).weeks.length,0);
});
test('malformed scalar metadata cannot transport nested private objects',()=>{
 const week=w(41,[p({rebaseline:{verified:true,fromBaselineId:{secret:'PRIVATE'},toBaselineId:[]}})],{version:{secret:'PRIVATE'}});
 const data=adapt({weeks:[week],...options()});assert.ok(!JSON.stringify(data).includes('PRIVATE'));
 assert.equal(data.weeks[0].version,null);assert.equal(data.weeks[0].projects[0].rebaseline.fromBaselineId,null);
});
