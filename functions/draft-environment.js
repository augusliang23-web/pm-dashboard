const { HttpsError } = require('firebase-functions/v2/https');
function draftsEnabled(environment = process.env) {
  const ids = [environment.GCLOUD_PROJECT, environment.GOOGLE_CLOUD_PROJECT].filter(Boolean);
  return ids.length > 0 && ids.every(id => id === ids[0])
    && (ids[0] === 'pm-dashboard-uat-20260820-a7f3'
      || (environment.FUNCTIONS_EMULATOR === 'true' && ids[0] === 'demo-pm-dashboard-v22t'));
}
function assertDraftEnvironment(environment = process.env) {
  if (!draftsEnabled(environment)) throw new HttpsError('failed-precondition', 'Project drafts are available only in UAT.', { reason:'draft-environment' });
}
module.exports = { draftsEnabled, assertDraftEnvironment };

function assertLegacyProjectWriteAllowed({environment=process.env,existingProject,isNew=false,visibilityOnly=false}) {
  if(draftsEnabled(environment) && (isNew || (existingProject && !visibilityOnly))) {
    throw new HttpsError('failed-precondition','請在專案編輯畫面選擇「存成草稿」或「存檔並發布」。',{reason:'draft-publish-required'});
  }
}
module.exports.assertLegacyProjectWriteAllowed=assertLegacyProjectWriteAllowed;
