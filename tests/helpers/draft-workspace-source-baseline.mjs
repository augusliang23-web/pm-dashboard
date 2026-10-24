import {normalizeSsoForBaseline} from './sso-source-baseline.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const changes=JSON.parse(readFileSync(new URL('../fixtures/draft-workspace-source-delta.json',import.meta.url),'utf8'));
// Test-only exact reversal of PR75's table/lifecycle HTML. The PR74 guard and all
// three historical hashes stay unchanged; actual-source role tests never use this.
export function normalizeDraftWorkspaceForBaseline(source){
 source=normalizeSsoForBaseline(source);
 for(const {before,after} of changes){
  assert.equal(source.split(after).length-1,1,'Draft workspace delta must match exactly once; unreviewed drift cannot be normalized');
  source=source.replace(after,()=>before);
 }
 return source;
}
