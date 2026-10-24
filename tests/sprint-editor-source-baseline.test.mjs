import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizeSprintEditorForBaseline} from './helpers/sprint-editor-source-baseline.mjs';
const raw=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const changes=JSON.parse(readFileSync(new URL('./fixtures/sprint-editor-source-delta.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const baseline='7753c50ab84906d93cef1de86e748e56d315170b5baabebd73aa9d9df4f77cab';
test('bounded Sprint source reversal reproduces original main bytes without new expected hashes',()=>assert.equal(hash(normalizeSprintEditorForBaseline(raw)),baseline));
for(const [i,hunk] of changes.entries())test(`modified, missing or duplicated Sprint hunk ${i} fails closed`,()=>{
 assert.throws(()=>normalizeSprintEditorForBaseline(raw.replace(hunk.after,hunk.after.replace(/\S/,'!'))));
 assert.throws(()=>normalizeSprintEditorForBaseline(raw.replace(hunk.after,'')));
 assert.throws(()=>normalizeSprintEditorForBaseline(raw+hunk.after));
});
test('unrelated permission drift survives normalization and cannot match the frozen baseline',()=>{
 const changed=raw.replace("function canCurrentUser(","function unapprovedPermissionBypass(");assert.notEqual(changed,raw);
 let restored;try{restored=normalizeSprintEditorForBaseline(changed);}catch{return;}
 assert.notEqual(hash(restored),baseline);
});
