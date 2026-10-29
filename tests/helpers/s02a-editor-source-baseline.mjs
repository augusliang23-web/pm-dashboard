import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const changes=JSON.parse(readFileSync(new URL('../fixtures/s02a-editor-source-delta.json',import.meta.url),'utf8'));
// Test-only exact reversal; historical guards then run unchanged against their original source.
export function normalizeS02aForBaseline(source){
 for(const {before,after} of changes){assert.equal(source.split(after).length-1,1,'S02A exact hunk must match once');source=source.replace(after,()=>before);}
 return source;
}
