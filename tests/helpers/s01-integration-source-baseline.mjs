import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const changes=JSON.parse(readFileSync(new URL('../fixtures/s01-integration-source-delta.json',import.meta.url),'utf8'));
// Test-only exact reversal from reviewed integration UI to ed3f814 hotfix UI.
// Actual-source behavior/role tests never consume this restored historical source.
export function normalizeIntegrationForHotfixBaseline(source){
 for(const {before,after} of changes){
  assert.equal(source.split(after).length-1,1,'Integration delta must match exactly once; unreviewed drift cannot be normalized');
  source=source.replace(after,()=>before);
 }
 return source;
}
