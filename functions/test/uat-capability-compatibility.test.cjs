const test=require('node:test');
const assert=require('node:assert/strict');
const {projectCapabilities,readProjectCapabilities,assertLegacyProjectWriteAllowed}=require('../draft-environment');
const uat='pm-dashboard-uat-20260820-a7f3',prod='project-manager-dashboar-a067f';
const active={draftsEnabled:true,archiveRecoveryEnabled:true,legacyWritesRestricted:true};
const configurations=[undefined,null,{},
  {schemaVersion:1,projectId:uat,drafts:false,archiveRecovery:false,enforceDraftPublish:false},
  {schemaVersion:1,projectId:prod,drafts:true,archiveRecovery:true,enforceDraftPublish:true},
  {schemaVersion:99,projectId:uat,drafts:true,archiveRecovery:true,enforceDraftPublish:true}];

test('UAT preserves its existing always-enabled policy regardless of a capability document',async()=>{
  for(const configuration of configurations){
    assert.deepEqual(projectCapabilities({GCLOUD_PROJECT:uat},configuration),active);
    const tx={get:async()=>({exists:configuration!==undefined,data:()=>configuration})};
    const db={collection:()=>({doc:()=>({})})};
    assert.deepEqual(await readProjectCapabilities(tx,db,{GCLOUD_PROJECT:uat}),active);
  }
});
test('UAT misconfiguration cannot open legacy create/content writes or disable Admin lifecycle compatibility',()=>{
  for(const configuration of configurations){
    const capabilities=projectCapabilities({GCLOUD_PROJECT:uat},configuration);
    for(const input of [{isNew:true},{existingProject:{visibility:'active'}}]){
      assert.throws(()=>assertLegacyProjectWriteAllowed({...input,capabilities}),e=>e.details?.reason==='draft-publish-required');
    }
    assert.doesNotThrow(()=>assertLegacyProjectWriteAllowed({existingProject:{visibility:'active'},visibilityOnly:true,capabilities}));
    assert.doesNotThrow(()=>assertLegacyProjectWriteAllowed({existingProject:{visibility:'archived'},capabilities}));
  }
});
test('Production activation and emulator explicit activation semantics remain intact',()=>{
  const config={schemaVersion:1,projectId:prod,drafts:true,archiveRecovery:true,enforceDraftPublish:true};
  assert.deepEqual(projectCapabilities({GCLOUD_PROJECT:prod},config),active);
  for(const candidate of [undefined,{...config,drafts:false,archiveRecovery:false},{...config,projectId:uat}]){
    assert.equal(projectCapabilities({GCLOUD_PROJECT:prod},candidate).draftsEnabled,false);
  }
  const emulator='demo-pm-dashboard-v22t';
  assert.equal(projectCapabilities({GCLOUD_PROJECT:emulator,FUNCTIONS_EMULATOR:'true'},
    {...config,projectId:emulator,drafts:false}).draftsEnabled,false);
  assert.deepEqual(projectCapabilities({GCLOUD_PROJECT:uat,GOOGLE_CLOUD_PROJECT:prod},config),
    {draftsEnabled:false,archiveRecoveryEnabled:false,legacyWritesRestricted:false});
});
