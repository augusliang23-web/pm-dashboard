export function createExecutiveApi({ functions, httpsCallable }) {
  if (!functions || typeof httpsCallable !== 'function') {
    throw new TypeError('Firebase Functions and httpsCallable are required.');
  }
  const call = name => httpsCallable(functions, name);
  const invoke = callable => async payload => (await callable(payload)).data;
  return {
    addUpdate: invoke(call('addExecutiveMilestoneUpdate')),
    createRequest: invoke(call('createExecutiveMilestoneChangeRequest')),
    withdrawRequest: invoke(call('withdrawExecutiveMilestoneChangeRequest')),
    decideRequest: invoke(call('decideExecutiveMilestoneChangeRequest')),
    applyDirectChange: invoke(call('applyDirectExecutiveMilestoneChange')),
    setRagOverride: invoke(call('setExecutiveRagOverride')),
    saveTimelineConfig: invoke(call('saveExecutiveMilestoneTimelineConfig')),
    initializeLiveTimeline: invoke(call('initializeExecutiveMilestoneLiveTimeline')),
  };
}
