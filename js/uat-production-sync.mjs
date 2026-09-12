export const PRODUCTION_SYNC_CONFIRMATION = 'This will replace every UAT reporting week and its projects with the current Production data. UAT-only weeks will be deleted. UAT users, permissions, settings, Executive workflow, and usage records will not be changed. A restorable UAT snapshot will be created first. Production is read-only.';
export const RESTORE_CONFIRMATION = 'This will replace every UAT reporting week with the latest retained UAT snapshot. A new restorable UAT snapshot will be created first. Production will not be accessed.';
export const ROLLED_BACK_MESSAGE = 'UAT sync failed safely; the original UAT weeks were restored.';
export const ROLLBACK_FAILED_MESSAGE = 'Critical: automatic rollback failed. Do not edit UAT weeks until the restore callable succeeds.';

export function canUseProductionWeekSync(role) {
  return String(role || '').trim().toLowerCase() === 'admin';
}

export function createUatProductionSyncApi({ functions, httpsCallable }) {
  const call = name => httpsCallable(functions, name);
  return {
    sync: () => call('syncProductionWeeksToUat')({}).then(result => result.data),
    status: () => call('getProductionWeekSyncStatus')({}).then(result => result.data),
    restore: snapshotId => call('restoreUatWeeksSnapshot')({ snapshotId }).then(result => result.data),
  };
}

export function formatProductionSyncResult(result = {}) {
  return `Production sync completed: ${Number(result.createdCount || 0)} created, ${Number(result.updatedCount || 0)} updated, ${Number(result.deletedCount || 0)} deleted.`;
}

export function formatProductionSyncStatus(status = {}) {
  if (status.running && status.phase) return `Sync in progress: ${status.phase}.`;
  const latestRun = status.latestCompletedRun || status.latestRun;
  if (latestRun?.phase) return `Last operation: ${latestRun.phase}.`;
  return 'No Production sync has been recorded.';
}

function resultMessage(result = {}, kind) {
  if (result.phase === 'rolled_back') return ROLLED_BACK_MESSAGE;
  if (result.phase === 'rollback_failed') return ROLLBACK_FAILED_MESSAGE;
  if (kind === 'restore' && result.phase === 'restored') return 'UAT weeks were restored from the latest retained snapshot.';
  if (kind === 'sync' && result.phase === 'succeeded') return formatProductionSyncResult(result);
  return 'Production data operation completed.';
}

export function createUatProductionSyncController({ api, getRole, view }) {
  const state = { busy: false, status: null, result: '', confirmation: null };
  const isAdmin = () => canUseProductionWeekSync(getRole());
  const operationBusy = () => state.busy || state.status?.running === true;
  const latestSnapshotId = () => state.status?.latestSnapshot?.snapshotId
    || state.status?.latestRestorableSnapshot?.snapshotId
    || '';

  function publish() {
    view.render({
      ...state,
      isAdmin: isAdmin(),
      syncDisabled: operationBusy(),
      restoreDisabled: operationBusy() || !latestSnapshotId(),
      statusText: formatProductionSyncStatus(state.status || {}),
    });
  }

  async function refreshStatus({ keepBusy = false } = {}) {
    if (!isAdmin()) {
      state.status = null;
      state.confirmation = null;
      state.busy = false;
      publish();
      return null;
    }
    if (!keepBusy) state.busy = true;
    publish();
    try {
      state.status = await api.status();
      return state.status;
    } catch {
      if (!state.result) state.result = 'Unable to refresh Production sync status.';
      return null;
    } finally {
      if (!keepBusy) state.busy = false;
      publish();
    }
  }

  function requestSync() {
    if (!isAdmin() || operationBusy() || state.confirmation) return false;
    state.confirmation = 'sync';
    publish();
    view.confirm({ kind: 'sync', message: PRODUCTION_SYNC_CONFIRMATION });
    return true;
  }

  function requestRestore() {
    if (!isAdmin() || operationBusy() || state.confirmation || !latestSnapshotId()) return false;
    state.confirmation = 'restore';
    publish();
    view.confirm({ kind: 'restore', message: RESTORE_CONFIRMATION });
    return true;
  }

  function cancelConfirmation() {
    state.confirmation = null;
    publish();
  }

  async function confirm(kind) {
    if (state.confirmation !== kind || state.busy) return false;
    if (!isAdmin()) {
      state.confirmation = null;
      publish();
      return false;
    }
    const snapshotId = kind === 'restore' ? latestSnapshotId() : '';
    if (kind === 'restore' && !snapshotId) return false;

    state.confirmation = null;
    state.busy = true;
    state.result = '';
    publish();
    try {
      const result = kind === 'sync' ? await api.sync() : await api.restore(snapshotId);
      state.result = resultMessage(result, kind);
    } catch {
      state.result = kind === 'sync'
        ? 'Unable to complete Production data sync.'
        : 'Unable to restore the latest retained UAT snapshot.';
    } finally {
      await refreshStatus({ keepBusy: true });
      state.busy = false;
      publish();
    }
    return true;
  }

  return {
    open: refreshStatus,
    refreshStatus,
    requestSync,
    requestRestore,
    cancelConfirmation,
    confirmSync: () => confirm('sync'),
    confirmRestore: () => confirm('restore'),
  };
}
