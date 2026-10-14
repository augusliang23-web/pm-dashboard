import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDeliveryTrends} from '../shared/delivery-trends.mjs';
import {input} from '../shared/fixtures/delivery-trends.mjs';
test('PR50 presentation fields carry the same calculated values without renamed public fields',()=>{
 const result=calculateDeliveryTrends(input());
 assert.equal(result.weeklySeries.at(-1).gainPp,10);
 assert.equal(result.weeklySeries.at(-1).comparableCount,1);
 assert.equal(result.projects[0].currentCompletionPct,30);
 assert.equal(result.projects[0].weeklyChangePp,10);
 assert.equal(result.projects[0].comparable,true);
 assert.equal(result.projects[0].trend.at(-1).progressPct,30);
 assert.equal(result.projects[0].trend.at(-2).progressPct,20);
});
