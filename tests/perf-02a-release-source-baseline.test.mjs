import {normalizeProdS02ForBaseline} from './helpers/prod-s02-source-baseline.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizePerf02aForBaseline} from './helpers/perf-02a-source-baseline.mjs';
const source=normalizeProdS02ForBaseline(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
const changes=JSON.parse(readFileSync(new URL('./fixtures/perf-02a-source-delta.json',import.meta.url),'utf8'));
test('exact PERF-02A reversal restores Production baseline bytes',()=>{
 const restored=normalizePerf02aForBaseline(source);
 assert.equal(createHash('sha256').update(restored).digest('hex'),'dce6db70bb4e03fd3ecad98c2aa927a0f4ef3009bf307abcccccff0aeeef05a4');
});
for (const [index,h] of changes.entries()) test(`PERF-02A hunk ${index+1} rejects altered, removed and duplicated content`,()=>{
 for(const bad of [source.replace(h.after,h.after.replace(/\S/,'!')),source.replace(h.after,''),source+h.after]) assert.throws(()=>normalizePerf02aForBaseline(bad));
});
