import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {normalizePerf02aForBaseline} from './helpers/perf-02a-source-baseline.mjs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const changes=JSON.parse(readFileSync(new URL('./fixtures/perf-02a-source-delta.json',import.meta.url),'utf8'));
test('PERF-02A exact reversal restores the pinned source',()=>assert.equal(normalizePerf02aForBaseline(source),execFileSync('git',['show','bed827f5196cd74f9bfcddb917ecc60793345a52:index.html'],{encoding:'utf8'})));
for(const [i,h] of changes.entries())test(`PERF-02A hunk ${i} rejects modification, omission, and duplication`,()=>{
  for(const bad of [source.replace(h.after,h.after.replace(/\S/,'!')),source.replace(h.after,''),source+h.after])assert.throws(()=>normalizePerf02aForBaseline(bad));
});
