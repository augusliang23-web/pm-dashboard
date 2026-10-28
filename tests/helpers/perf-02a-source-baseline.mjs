import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const changes=JSON.parse(readFileSync(new URL('../fixtures/perf-02a-source-delta.json',import.meta.url),'utf8'));
// Reverse only each reviewed PERF-02A hunk, once, before historical guards run.
export function normalizePerf02aForBaseline(source) {
  for (const {before,after} of changes) {
    assert.equal(source.split(after).length-1,1,'PERF-02A exact hunk must match once');
    source=source.replace(after,()=>before);
  }
  return source;
}
