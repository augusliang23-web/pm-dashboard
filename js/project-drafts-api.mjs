export function createProjectDraftsApi({functions,httpsCallable}) {
  const invoke = name => data => httpsCallable(functions,name)(data).then(result=>result.data);
  return {list:invoke('listDashboardProjectDrafts'),get:invoke('getDashboardProjectDraft'),save:invoke('saveDashboardProjectDraft'),publish:invoke('publishDashboardProjectDraft')};
}
