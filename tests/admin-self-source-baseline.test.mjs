import {normalizeIntegrationForHotfixBaseline} from './helpers/s01-integration-source-baseline.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import {normalizeAdminSelfForBaseline} from './helpers/admin-self-source-baseline.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const baselineHash='7753c50ab84906d93cef1de86e748e56d315170b5baabebd73aa9d9df4f77cab';
// Retain historical hotfix guard controls after an independently guarded exact integration reversal.
const raw=normalizeIntegrationForHotfixBaseline(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
test('only approved Admin-self delta restores byte-exact main source',()=>{assert.equal(hash(normalizeAdminSelfForBaseline(raw)),baselineHash);});
for(const [name,from,to] of [['other Admin',"getEmailKey({email:d.id}) === email && d.data().role === 'admin'","d.data().role === 'admin'"],['deputy widening',"key === 'ownerEmail' && adminSelfOption","adminSelfOption"],['role widening',"d.data().role === 'admin'","true"]])test('guard rejects '+name,()=>assert.throws(()=>normalizeAdminSelfForBaseline(raw.replace(from,to))));
test('unrelated changes survive normalization and fail historical equivalence',()=>{assert.notEqual(hash(normalizeAdminSelfForBaseline(raw.replace('function configureDraftEditor(draftMode)', 'function configureDraftEditor(unapproved)'))),baselineHash);});
