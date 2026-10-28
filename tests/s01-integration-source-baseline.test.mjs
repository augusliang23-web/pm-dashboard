import {normalizePerf02aForBaseline} from './helpers/perf-02a-source-baseline.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizePr79IntegrationForHotfixBaseline} from './helpers/s01-integration-source-baseline.mjs';
const raw=normalizePerf02aForBaseline(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
const changes=JSON.parse(readFileSync(new URL('./fixtures/s01-integration-source-delta.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const approvedHotfixHash='4f6639a81fc43e47bb7212f8f5c4c1578e1df1934e2352f30a51eece4ecd1320';
test('integration exact reversal reproduces approved ed3f814 hotfix HTML',()=>assert.equal(hash(normalizePr79IntegrationForHotfixBaseline(raw)),approvedHotfixHash));
for(const [i,h]of changes.entries())test(`integration hunk ${i} rejects modification, omission and duplication`,()=>{
 assert.throws(()=>normalizePr79IntegrationForHotfixBaseline(raw.replace(h.after,()=>h.after.replace(/\S/,'!'))));
 assert.throws(()=>normalizePr79IntegrationForHotfixBaseline(raw.replace(h.after,'')));
 assert.throws(()=>normalizePr79IntegrationForHotfixBaseline(raw+h.after));
});
test('unrelated authorization drift cannot match hotfix provenance',()=>{
 const changed=raw.replace('function canCurrentUser(','function unapprovedPermission(');assert.notEqual(changed,raw);
 let restored;try{restored=normalizePr79IntegrationForHotfixBaseline(changed);}catch{return;}
 assert.notEqual(hash(restored),approvedHotfixHash);
});
