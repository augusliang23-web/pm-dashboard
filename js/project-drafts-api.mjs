export function createProjectDraftsApi({functions,httpsCallable}) {
  const invoke = name => data => {
    if (name !== 'saveDashboardProjectDraft') return httpsCallable(functions,name)(data).then(result=>result.data);
    performance.mark('pm-draft-save:t3');
    try {
      return httpsCallable(functions,name)(data).then(result => {
        performance.mark('pm-draft-save:t4'); return result.data;
      }, error => { performance.mark('pm-draft-save:t4'); throw error; });
    } catch (error) { performance.mark('pm-draft-save:t4'); throw error; }
  };
  return {capabilities:()=>invoke('getDashboardProjectDraft')({capabilities:true}),list:invoke('listDashboardProjectDrafts'),get:invoke('getDashboardProjectDraft'),save:invoke('saveDashboardProjectDraft'),publish:invoke('publishDashboardProjectDraft')};
}
