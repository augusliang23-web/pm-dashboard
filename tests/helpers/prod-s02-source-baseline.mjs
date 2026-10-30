import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const changes=JSON.parse(readFileSync(new URL('../fixtures/prod-s02-source-delta.json',import.meta.url),'utf8'));
export function normalizeProdS02ForBaseline(source){
 if(!source.includes('import "./js/project-assignment-eligibility.js";'))return source;
 for(const {before,after} of changes){assert.equal(source.split(after).length-1,1,'Production S02 exact hunk must match once');source=source.replace(after,()=>before);}
 return source;
}
