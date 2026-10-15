const test=require('node:test'); const assert=require('node:assert/strict');
const {assertDraftEnvironment}=require('../draft-environment');
test('draft runtime is UAT-only and rejects conflicting or absent identities',()=>{
  assert.doesNotThrow(()=>assertDraftEnvironment({GCLOUD_PROJECT:'pm-dashboard-uat-20260820-a7f3'}));
  assert.doesNotThrow(()=>assertDraftEnvironment({FUNCTIONS_EMULATOR:'true',GCLOUD_PROJECT:'demo-pm-dashboard-v22t'}));
  for(const env of [{},{GCLOUD_PROJECT:'production'},{GCLOUD_PROJECT:'demo-pm-dashboard-v22t'},{GCLOUD_PROJECT:'pm-dashboard-uat-20260820-a7f3',GOOGLE_CLOUD_PROJECT:'other'},{FUNCTIONS_EMULATOR:'true',GCLOUD_PROJECT:'project-manager-dashboar-a067f'}]) assert.throws(()=>assertDraftEnvironment(env),/UAT/i);
});
