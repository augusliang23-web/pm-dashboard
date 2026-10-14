import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const init=source.match(/function initData__uat\([\s\S]*?\n\}/)[0];
function harness(){let listener;let onError;let options;let current=true;
 const context=vm.createContext({weeksUnsub:null,executiveTimelineConfigUnsub:null,executiveLiveTimelineUnsub:null,executivePendingMilestoneUnsub:null,
 deliveryTrendsRawWeeks:[],deliveryTrendsHistoryState:{source:null,complete:false},db:{},currentRole:'pm',authSessionGeneration:1,currentUser:{uid:'u'},getEmailKey:()=> 'u@example.test',
 canReadDraftWeeks:()=>true,canCurrentUser:()=>false,isAuthInitializationCurrent:()=>current,collection:(_,name)=>({name}),doc:()=>({name:'settings'}),query:(ref)=>ref,orderBy:()=>{},where:()=>{},
 onSnapshot:(target,...args)=>{if(target.name==='weeks'){options=typeof args[0]==='object'?args.shift():null;[listener,onError]=args;}return ()=>{};},
 normalizeProject:p=>({...p,lifecycle:p.lifecycle||'active'}),projectRevisionFingerprint:JSON.stringify,sortWeeksByLabel:x=>x,sortWeeksChronologically:x=>x,
 currentIdx:-1,jumpToLatestOnNextRender:true,allWeeks:[],document:{getElementById:()=>null},render:()=>{},hideLoader:()=>{},showDataLoadError:()=>{},buildPrototypeWeeks:()=>[]});
 vm.runInContext(init+';initData__uat(1,{uid:"u"});',context);
 return {context,callback:s=>listener(s),error:()=>onError(Error('permission denied')),get options(){return options},stale:()=>{current=false}};
}
const snapshot=metadata=>({metadata,docs:[{id:'W41-2026',data:()=>({weekLabel:'W41 2026',projects:[{code:'A',progress:null}]})}]});
test('actual UAT subscriber preserves raw lifecycle/progress and tracks server confirmation',()=>{
 const h=harness();assert.equal(h.options.includeMetadataChanges,true);
 h.callback(snapshot({fromCache:true,hasPendingWrites:false}));assert.equal(h.context.deliveryTrendsHistoryState.complete,false);
 h.callback(snapshot({fromCache:false,hasPendingWrites:false}));assert.equal(h.context.deliveryTrendsHistoryState.complete,true);
 assert.equal(h.context.deliveryTrendsRawWeeks[0].projects[0].lifecycle,undefined);
 assert.equal(h.context.allWeeks[0].projects[0].lifecycle,'active');assert.equal(h.context.deliveryTrendsRawWeeks[0].projects[0].progress,null);
 h.callback(snapshot({fromCache:false,hasPendingWrites:true}));assert.equal(h.context.deliveryTrendsHistoryState.complete,false);
});
test('read errors revoke complete history and stale auth callbacks cannot restore it',()=>{
 const h=harness();h.callback(snapshot({fromCache:false,hasPendingWrites:false}));h.error();
 assert.equal(h.context.deliveryTrendsHistoryState.complete,false);assert.equal(h.context.deliveryTrendsRawWeeks.length,0);
 h.stale();h.callback(snapshot({fromCache:false,hasPendingWrites:false}));assert.equal(h.context.deliveryTrendsRawWeeks.length,0);
});
for (const name of ['showDataLoadError__uat','quiesceDashboardForAuthTransition__uat']) {
 test(`${name} revokes history and clears visible private trends`,()=>{
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'private project metrics',style:{display:'block'},classList:{remove(){}}});return nodes.get(id)};
  const noop=()=>{};
  const context=vm.createContext({console:{error:noop},hideLoader:noop,document:{getElementById:node},currentRole:'pm',allWeeks:[{}],currentIdx:0,
   deliveryTrendsRawWeeks:[{}],deliveryTrendsHistoryState:{complete:true},deliveryTrendsActive:true,deliveryTrendsOwner:'u',
   stopPresenceSystem:noop,stopProjectManagerSubscription:noop,displayNameDirectory:new Map(),weeksUnsub:null,executiveTimelineConfigUnsub:null,executiveLiveTimelineUnsub:null,
   DEFAULT_EXECUTIVE_TIMELINE_CONFIG:{},stopGanttTemplateConfigSubscription:noop,invalidateProjectEditorSession:noop,invalidateGanttTemplateSession:noop,invalidateGanttWindowSession:noop,
   executiveApprovalInboxUnsub:null,setDashboardAccessPending:noop});
  vm.runInContext(source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0]+`;${name}({code:'permission-denied'});`,context);
  assert.equal(context.deliveryTrendsRawWeeks.length,0);assert.equal(context.deliveryTrendsHistoryState.complete,false);
  assert.equal(node('deliveryTrendsView').innerHTML,'');assert.equal(node('deliveryTrendsView').style.display,'none');
 });
}
