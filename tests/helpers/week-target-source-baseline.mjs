import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
export const changes=JSON.parse(readFileSync(new URL('../fixtures/week-target-source-delta.json',import.meta.url),'utf8'));
export function normalizeWeekTargetForBaseline(source){if(!source.includes('isHistoricalPublishWeek'))return source;for(const {before,after}of changes){assert.equal(source.split(after).length-1,1,'Week target exact hunk must match once');source=source.replace(after,()=>before);}return source;}
