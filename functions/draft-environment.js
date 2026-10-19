const { HttpsError } = require('firebase-functions/v2/https');
const PRODUCTION_PROJECT = 'project-manager-dashboar-a067f';
const UAT_PROJECT = 'pm-dashboard-uat-20260820-a7f3';
const EMULATOR_PROJECT = 'demo-pm-dashboard-v22t';

function eligibleProject(environment = process.env) {
  const ids = [environment.GCLOUD_PROJECT, environment.GOOGLE_CLOUD_PROJECT].filter(Boolean);
  if (!ids.length || !ids.every(id => id === ids[0])) return null;
  const id = ids[0];
  if (id === PRODUCTION_PROJECT) return environment.FUNCTIONS_EMULATOR === 'true' ? null : id;
  if (id === UAT_PROJECT) return id;
  return id === EMULATOR_PROJECT && environment.FUNCTIONS_EMULATOR === 'true' ? id : null;
}
function projectCapabilities(environment = process.env, configuration) {
  const id = eligibleProject(environment);
  const inactive = { draftsEnabled:false, archiveRecoveryEnabled:false, legacyWritesRestricted:false };
  if (!id) return inactive;
  // Preserve UAT/emulator behavior. Production always requires explicit activation.
  if (configuration === undefined && id !== PRODUCTION_PROJECT) {
    return { draftsEnabled:true, archiveRecoveryEnabled:true, legacyWritesRestricted:true };
  }
  if (!configuration || configuration.schemaVersion !== 1 || configuration.projectId !== id) return inactive;
  return {
    draftsEnabled:configuration.drafts === true,
    archiveRecoveryEnabled:configuration.archiveRecovery === true,
    legacyWritesRestricted:configuration.drafts === true && configuration.enforceDraftPublish === true,
  };
}
function draftsEnabled(environment = process.env, configuration) {
  return projectCapabilities(environment, configuration).draftsEnabled;
}
function archiveRecoveryEnabled(environment = process.env, configuration) {
  return projectCapabilities(environment, configuration).archiveRecoveryEnabled;
}
async function readProjectCapabilities(transaction, db, environment = process.env) {
  if (!eligibleProject(environment)) return projectCapabilities(environment);
  const snapshot = await transaction.get(db.collection('releaseCapabilities').doc('v231'));
  return projectCapabilities(environment, snapshot.exists ? snapshot.data() : undefined);
}
function assertDraftEnvironment(environment = process.env, configuration) {
  if (!draftsEnabled(environment, configuration)) {
    throw new HttpsError('failed-precondition', 'Project drafts are not enabled in this environment (UAT or explicitly activated Production).', { reason:'draft-environment' });
  }
}
function assertLegacyProjectWriteAllowed({environment=process.env, capabilities=projectCapabilities(environment), existingProject,isNew=false,visibilityOnly=false}) {
  if (capabilities.legacyWritesRestricted && (isNew || (existingProject && existingProject.visibility !== 'archived' && !visibilityOnly))) {
    throw new HttpsError('failed-precondition','Reload the dashboard, open the project editor and choose Save Draft or Save & Publish.',{reason:'draft-publish-required'});
  }
}
module.exports = { eligibleProject, projectCapabilities, readProjectCapabilities, draftsEnabled, archiveRecoveryEnabled, assertDraftEnvironment, assertLegacyProjectWriteAllowed };
