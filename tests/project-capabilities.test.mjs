import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectCapabilitiesController} from '../js/project-capabilities.mjs';
import {dashboardSource} from './helpers/dashboard-source.mjs';
const active={environmentEligible:true,backendSupported:true,draftsEnabled:true,archiveRecoveryEnabled:true,legacyWritesRestricted:true};
test('capabilities fail closed on unavailable backend, ineligible environment and non-boolean flags',async()=>{
  let value=active;const states=[];
  const controller=createProjectCapabilitiesController({load:async()=>value,onState:s=>states.push(s)});
  await controller.refresh();assert.equal(states.at(-1).draftsEnabled,true);
  for(value of [{...active,environmentEligible:false},{...active,backendSupported:false},{...active,draftsEnabled:'true'}]){
    await controller.refresh();assert.equal(states.at(-1).draftsEnabled,false);
  }
  value=null;await controller.refresh();assert.equal(states.at(-1).archiveRecoveryEnabled,false);
});
test('an old auth session cannot re-enable capabilities after reset',async()=>{
  let complete;const states=[];
  const controller=createProjectCapabilitiesController({load:()=>new Promise(r=>complete=r),onState:s=>states.push(s)});
  const pending=controller.refresh();controller.reset();complete(active);await pending;
  assert.equal(states.at(-1).draftsEnabled,false);
});
test('Production includes only promoted Draft/Archive workflows and keeps Sync/executive writes excluded',()=>{
  const production=dashboardSource('production');
  for(const token of ['id="myDraftsBtn"','id="myDraftsOverlay"','id="archivedProjectsOverlay"','function syncDraftWorkspace(','Save & Publish','expectedSourceRevision']) assert.ok(production.includes(token),token);
  assert.doesNotMatch(production,/uatProductionSyncController\.(open|run|start)\(/);
  assert.doesNotMatch(production,/executiveApi\.\w+\(/);
  assert.match(production,/await loadProjectWriteCapabilities\(\)/);
});
