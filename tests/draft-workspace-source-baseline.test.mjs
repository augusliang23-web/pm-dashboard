import {normalizeDeputyCardForPr79} from './helpers/deputy-card-source-baseline.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
import {normalizePr79DraftWorkspaceForBaseline} from './helpers/draft-workspace-source-baseline.mjs';
const raw=normalizeDeputyCardForPr79(readFileSync(new URL('../index.html',import.meta.url),'utf8')),changes=JSON.parse(readFileSync(new URL('./fixtures/draft-workspace-source-delta.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const verifiedPr74Hash='f2e2d4c51f3fdf4c67daffcfab7ac51ed26b4531af2d040cc0f9cb961fb977c1';
test('exact table/lifecycle reversal reproduces verified PR74 bytes',()=>assert.equal(hash(normalizePr79DraftWorkspaceForBaseline(raw)),verifiedPr74Hash));
for(const [i,h]of changes.entries())test(`workspace delta ${i} rejects modification, omission and duplicate`,()=>{
 assert.throws(()=>normalizePr79DraftWorkspaceForBaseline(raw.replace(h.after,h.after.replace(/\S/,'!'))));assert.throws(()=>normalizePr79DraftWorkspaceForBaseline(raw.replace(h.after,'')));assert.throws(()=>normalizePr79DraftWorkspaceForBaseline(raw+h.after));
});
test('unrelated authorization drift is never masked',()=>{
 const changed=raw.replace('function canCurrentUser(','function unapprovedRole(');assert.notEqual(changed,raw);let result;try{result=normalizePr79DraftWorkspaceForBaseline(changed);}catch{return;}assert.notEqual(hash(result),verifiedPr74Hash);
});
