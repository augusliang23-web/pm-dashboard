import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url)));
const names=['listDashboardProjectDrafts','getDashboardProjectDraft','saveDashboardProjectDraft','publishDashboardProjectDraft'];
test('Owner-authorized v231 override names exactly six Functions without relaxing legacy or Sync policy',()=>{
  const manifest=read('config/deployment-manifest.json');
  const release=manifest.authorizedReleaseOverrides.v231UnifiedProduction;
  assert.equal(release.environment,'prod');
  assert.equal(release.firebaseProjectId,'project-manager-dashboar-a067f');
  assert.deepEqual([...release.functions].sort(),['saveDashboardProject','setDashboardProjectAttention',...names].sort());
  assert.equal(release.sourcePolicy,'exact-final-merged-main-sha');
  assert.equal(release.runtimeServiceAccounts.setDashboardProjectAttention,'pmdash-project-attn');
  assert.equal(release.functions.length,6);
  assert.deepEqual(release.runtimeRolePermissions.pmdashAttentionRuntime,['datastore.databases.get','datastore.entities.get','datastore.entities.update']);
  for(const name of names)assert.equal(release.runtimeServiceAccounts[name],'pmdash-project-drafts');
  assert.deepEqual(manifest.environments.prod.functionsNeverDeploy.productionWeekSync,['syncProductionWeeksToUat','getProductionWeekSyncStatus','restoreUatWeeksSnapshot']);
  assert.deepEqual(manifest.environments.prod.functionsNeverDeploy.projectDrafts,names);
});
test('Production index configuration includes only the two actual Draft query prerequisites',()=>{
  const indexes=read('firestore.prod.indexes.json');
  assert.equal(indexes.indexes.length,2);assert.deepEqual(indexes.fieldOverrides,[]);
  for(const index of indexes.indexes){assert.equal(index.collectionGroup,'projectDrafts');assert.equal(index.queryScope,'COLLECTION');}
  const uat=read('firestore.uat.indexes.json').indexes.filter(i=>i.collectionGroup==='projectDrafts');
  assert.deepEqual(indexes.indexes,uat);
  assert.equal(read('firebase.json').firestore.indexes,'firestore.prod.indexes.json');
});
