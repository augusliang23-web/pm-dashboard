export function createProjectDraftsApi({functions,httpsCallable}) {
  const invoke = name => data => httpsCallable(functions,name)(data).then(result=>result.data);
  return {capabilities:()=>invoke('getDashboardProjectDraft')({capabilities:true}),list:invoke('listDashboardProjectDrafts'),get:invoke('getDashboardProjectDraft'),save:invoke('saveDashboardProjectDraft'),publish:invoke('publishDashboardProjectDraft')};
}
