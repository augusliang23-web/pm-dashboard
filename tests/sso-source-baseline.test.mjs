import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
import{normalizeSsoForBaseline}from'./helpers/sso-source-baseline.mjs';
const raw=readFileSync(new URL('../index.html',import.meta.url),'utf8'),changes=JSON.parse(readFileSync(new URL('./fixtures/sso-source-delta.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');const pinned='dce6db70bb4e03fd3ecad98c2aa927a0f4ef3009bf307abcccccff0aeeef05a4';
test('exact SSO delta restores pinned PR79 source without rewriting historical hashes',()=>assert.equal(hash(normalizeSsoForBaseline(raw)),pinned));
for(const [i,h]of changes.entries())test(`SSO hunk ${i} rejects modification, omission and duplication`,()=>{assert.throws(()=>normalizeSsoForBaseline(raw.replace(h.after,()=>h.after.replace(/\S/,'!'))));assert.throws(()=>normalizeSsoForBaseline(raw.replace(h.after,'')));assert.throws(()=>normalizeSsoForBaseline(raw+h.after));});
test('unrelated authorization drift is never normalized away',()=>{const changed=raw.replace('function canCurrentUser(','function unapprovedAuth(');assert.notEqual(changed,raw);let restored;try{restored=normalizeSsoForBaseline(changed);}catch{return;}assert.notEqual(hash(restored),pinned);});
