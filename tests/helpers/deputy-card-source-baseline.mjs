import {normalizeS02aForBaseline} from './s02a-editor-source-baseline.mjs';
import {normalizePerf02aForBaseline} from './perf-02a-source-baseline.mjs';
import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const changes=JSON.parse(readFileSync(new URL('../fixtures/deputy-card-source-delta.json',import.meta.url),'utf8'));
// Exact test-only reversal to approved PR79; actual behavior tests always use current source.
export function normalizePriorDeputyCardForPr79(source){source=normalizePerf02aForBaseline(source);for(const {before,after}of changes){assert.equal(source.split(after).length-1,1,'Deputy/card exact delta must match once');source=source.replace(after,()=>before);}return source;}

export function normalizeDeputyCardForPr79(source){return normalizePriorDeputyCardForPr79(normalizeS02aForBaseline(source));}
