import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {changes,normalizeProdS02ForBaseline} from './helpers/prod-s02-source-baseline.mjs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('exact Production S02 reversal preserves the complete 05019ea frontend including PERF-02A',()=>assert.equal(createHash('sha256').update(normalizeProdS02ForBaseline(source)).digest('hex'),'82e0c3a680db7a51aa3cb42ad8d4b59d13c1b2bd149ecc8dfe1516b4f8528fce'));
for(const [i,h] of changes.entries())test(`Production S02 hunk ${i+1} rejects tampering, deletion and duplication`,()=>{for(const bad of [source.replace(h.after,h.after.replace(/\S/,'!')),source.replace(h.after,''),source+h.after]){let rejected=false;try{rejected=createHash('sha256').update(normalizeProdS02ForBaseline(bad)).digest('hex')!=='82e0c3a680db7a51aa3cb42ad8d4b59d13c1b2bd149ecc8dfe1516b4f8528fce';}catch{rejected=true;}assert(rejected);}});
