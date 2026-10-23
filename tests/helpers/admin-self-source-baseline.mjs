import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const delegationChanges=JSON.parse(readFileSync(new URL('../fixtures/assignment-delegation-source-delta.json',import.meta.url),'utf8'));
const changes=JSON.parse(readFileSync(new URL('../fixtures/admin-self-source-delta.json',import.meta.url),'utf8'));
// Restore only the exact reviewed hotfix additions. Original historical hashes remain unchanged.
export function normalizeAdminSelfForBaseline(source){
 for(const {before,after} of [...delegationChanges,...changes]){assert.equal(source.split(after).length-1,1,'Admin-self delta must match exactly once; unexpected drift cannot be normalized');source=source.replace(after,before);}
 return source;
}
