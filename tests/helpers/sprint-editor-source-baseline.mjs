import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const changes=JSON.parse(readFileSync(new URL('../fixtures/sprint-editor-source-delta.json',import.meta.url),'utf8'));
// Test-only, enumerated reversal of the authorized PR74 editor delta. Never used by
// actual-source role/behavior tests; all three original historical hashes stay fixed.
export function normalizeSprintEditorForBaseline(source) {
 for(const {before,after} of changes) {
  assert.equal(source.split(after).length-1,1,'Sprint editor delta must match exactly once; unreviewed drift cannot be normalized');
  source=source.replace(after,()=>before);
 }
 return source;
}
