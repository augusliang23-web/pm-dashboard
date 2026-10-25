import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const changes=JSON.parse(readFileSync(new URL('../fixtures/sso-source-delta.json',import.meta.url),'utf8'));
// Test-only exact reversal to pinned PR79; runtime authorization tests read actual source.
export function normalizeSsoForBaseline(source){
 for(const {before,after}of changes){assert.equal(source.split(after).length-1,1,'SSO delta must match exactly once; unreviewed drift cannot be normalized');source=source.replace(after,()=>before);}
 return source;
}
