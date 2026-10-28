import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftSaveProgress} from '../js/draft-save-progress.mjs';
test('estimated progress stays below confirmation until success and keeps activity after the slow threshold',()=>{
 let time=0,tick,cleared=false;const states=[];
 const progress=createDraftSaveProgress({now:()=>time,onUpdate:s=>states.push(s),schedule:fn=>(tick=fn,1),cancel:()=>{cleared=true;}});
 assert.deepEqual(states.at(-1),{percent:0,slow:false,active:true});
 time=100000;tick();assert.deepEqual(states.at(-1),{percent:90,slow:true,active:true});assert.equal(cleared,false);
 progress.finish();assert.deepEqual(states.at(-1),{percent:100,slow:false,active:false});assert.equal(cleared,true);
});
test('failure stops without reaching 100 and ignores subsequent ticks',()=>{
 let tick;const states=[];const p=createDraftSaveProgress({now:()=>0,onUpdate:s=>states.push(s),schedule:fn=>(tick=fn,1),cancel:()=>{}});
 p.stop();tick();assert.equal(states.some(s=>s.percent===100),false);assert.equal(states.at(-1).active,false);
});
