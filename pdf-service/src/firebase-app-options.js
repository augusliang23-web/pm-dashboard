const LOCAL_FIREBASE_PROJECT_ID = 'project-manager-dashboar-a067f';

export function createFirebaseAppOptions(environment = {}, { applicationDefault }) {
  if (environment.FIREBASE_AUTH_EMULATOR_HOST || environment.FIRESTORE_EMULATOR_HOST) {
    return { projectId: environment.GCLOUD_PROJECT || LOCAL_FIREBASE_PROJECT_ID };
  }
  return { credential: applicationDefault() };
}
