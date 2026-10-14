import test from 'node:test';import assert from 'node:assert/strict';
import {createProjectDraftsApi} from '../js/project-drafts-api.mjs';
test('Publish preserves target revision and propagates rejection without a save fallback',async()=>{const calls=[];const api=createProjectDraftsApi({functions:{},httpsCallable:(_,name)=>async data=>{calls.push({name,data});throw Error('denied');}});await assert.rejects(api.publish({draftId:'a',expectedPublishedRevision:null}),/denied/);assert.deepEqual(calls,[{name:'publishDashboardProjectDraft',data:{draftId:'a',expectedPublishedRevision:null}}]);});
