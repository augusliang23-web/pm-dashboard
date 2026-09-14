export const PRODUCTION_SYNC_CONFIRMATION = 'This will replace every UAT reporting week and its projects with the current Production data. UAT-only weeks will be deleted. UAT users, permissions, settings, Executive workflow, and usage records will not be changed. A restorable UAT snapshot will be created first. Production is read-only.';
export const RESTORE_CONFIRMATION = 'This will replace every UAT reporting week with the latest retained UAT snapshot. A new restorable UAT snapshot will be created first. Production will not be accessed.';
export const ROLLED_BACK_MESSAGE = 'UAT sync failed safely; the original UAT weeks were restored.';
export const ROLLBACK_FAILED_MESSAGE = 'Critical: automatic rollback failed. Do not edit UAT weeks until the restore callable succeeds.';

export function canUseProductionWeekSync(role) {
  return String(role || '').trim().toLowerCase() === 'admin';
}

export function showInlineProductionSyncConfirmation({ container, messageNode, message }) {
  if (!container || !messageNode) return false;
  messageNode.textContent = String(message || '');
  container.hidden = false;
  return true;
}

export function hideInlineProductionSyncConfirmation(container) {
  if (!container) return false;
  container.hidden = true;
  return true;
}

export function bindProductionSyncActions({
  syncButton,
  restoreButton,
  confirmSyncButton,
  cancelSyncButton,
  confirmRestoreButton,
  cancelRestoreButton,
  requestSync,
  requestRestore,
  confirmSync,
  cancelSync,
  confirmRestore,
  cancelRestore,
}) {
  if ((syncButton && typeof requestSync !== 'function') || (!syncButton && requestSync !== undefined)) return false;
  const actions = [
    ...(syncButton ? [[syncButton, requestSync]] : []),
    [restoreButton, requestRestore],
    [confirmSyncButton, confirmSync],
    [cancelSyncButton, cancelSync],
    [confirmRestoreButton, confirmRestore],
    [cancelRestoreButton, cancelRestore],
  ];
  if (actions.some(([button, action]) => !button || typeof action !== 'function')) return false;
  actions.forEach(([button, action]) => {
    button.addEventListener('click', event => {
      event.preventDefault();
      action();
    });
  });
  return true;
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

export function applyProductionSyncButtonState({ syncButton, restoreButton }, state) {
  syncButton.disabled = !state.isAdmin || state.syncDisabled;
  restoreButton.disabled = !state.isAdmin || state.restoreDisabled;
  const ariaBusy = state.operationBusy ? 'true' : 'false';
  syncButton.setAttribute('aria-busy', ariaBusy);
  restoreButton.setAttribute('aria-busy', ariaBusy);
}

export function formatProductionSyncStatus(status = {}) {
  const latestRun = status.latestRun || status.latestCompletedRun;
  if (status.recoveryRequired === true) return ROLLBACK_FAILED_MESSAGE;
  if (status.running && status.phase && !['rolled_back', 'rollback_failed'].includes(status.phase)) {
    return `Sync in progress: ${status.phase}.`;
  }
  if (status.phase === 'rollback_failed' || latestRun?.phase === 'rollback_failed') return ROLLBACK_FAILED_MESSAGE;
  if (latestRun?.phase === 'rolled_back') return ROLLED_BACK_MESSAGE;
  if (SAFE_ERROR_MESSAGES[latestRun?.errorCode]) return SAFE_ERROR_MESSAGES[latestRun.errorCode];
  if (latestRun?.phase) return `Last operation: ${latestRun.phase}.`;
  return 'No Production sync has been recorded.';
}

export function getLatestSuccessfulOperation(status = {}) {
  const completed = status.latestCompletedRun;
  return ['succeeded', 'restored'].includes(completed?.phase) ? completed : null;
}

function resultMessage(result = {}, kind) {
  if (result.phase === 'rolled_back') return ROLLED_BACK_MESSAGE;
  if (result.phase === 'rollback_failed') return ROLLBACK_FAILED_MESSAGE;
  if (kind === 'restore' && result.phase === 'restored') return 'UAT weeks were restored from the latest retained snapshot.';
  if (kind === 'sync' && result.phase === 'succeeded') return formatProductionSyncResult(result);
  return 'Production data operation completed.';
}

const SAFE_ERROR_MESSAGES = Object.freeze({
  'operation-in-progress': 'Another UAT data operation is already running. Wait for it to finish, then refresh status.',
  'production-source-empty': 'Production returned no reporting weeks. No UAT data was changed; verify Production data before retrying.',
  'production-source-invalid': 'Production contains a reporting week value that cannot be copied safely. No UAT data was changed; correct the source data before retrying.',
  'production-source-incomplete': 'The Production read could not be verified as complete. No UAT data was changed; retry after checking the source service.',
  'snapshot-integrity-failed': 'The safety snapshot could not be verified. No UAT data was changed; contact an administrator.',
  'snapshot-not-retained': 'The selected snapshot is no longer retained. Refresh status before trying restore again.',
  'lease-lost': 'The operation stopped because its safety lease was lost. Refresh status before retrying.',
});

function errorMessage(error, kind) {
  const safe = SAFE_ERROR_MESSAGES[error?.details?.reason];
  if (safe) return safe;
  return kind === 'sync'
    ? 'Unable to complete Production data sync.'
    : 'Unable to restore the latest retained UAT snapshot.';
}

export function createUatProductionSyncController({ api, getRole, view }) {
  const state = { busy: false, status: null, result: '', confirmation: null };
  const isAdmin = () => canUseProductionWeekSync(getRole());
  const operationBusy = () => state.busy || state.status?.running === true;
  const latestSnapshotId = () => state.status?.latestSnapshot?.snapshotId
    || state.status?.latestRestorableSnapshot?.snapshotId
    || '';

  function publish() {
    const operationIsBusy = operationBusy();
    view.render({
      ...state,
      isAdmin: isAdmin(),
      operationBusy: operationIsBusy,
      syncDisabled: operationIsBusy,
      restoreDisabled: operationIsBusy || !latestSnapshotId(),
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
    const decision = view.confirm({ kind: 'sync', message: PRODUCTION_SYNC_CONFIRMATION });
    if (decision === true) return confirm('sync');
    if (decision === false) {
      cancelConfirmation();
      return false;
    }
    return true;
  }

  function requestRestore() {
    if (!isAdmin() || operationBusy() || state.confirmation || !latestSnapshotId()) return false;
    state.confirmation = 'restore';
    publish();
    const decision = view.confirm({ kind: 'restore', message: RESTORE_CONFIRMATION });
    if (decision === true) return confirm('restore');
    if (decision === false) {
      cancelConfirmation();
      return false;
    }
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
    } catch (error) {
      state.result = errorMessage(error, kind);
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

// Start the controller first: confirmSync/confirmRestore synchronously clear
// the pending confirmation and mark the request busy before the modal closes.
// The close callback may therefore use the normal cancellation path safely.
export function submitUatProductionSyncConfirmation({ controller, close }) {
  const operation = controller.confirmSync();
  close();
  return operation;
}

export function submitInlineUatProductionSyncConfirmation({ controller, close }) {
  const requested = controller.requestSync();
  if (requested !== true) return requested;
  return submitUatProductionSyncConfirmation({ controller, close });
}

export function submitUatProductionRestoreConfirmation({ controller, close }) {
  const operation = controller.confirmRestore();
  close();
  return operation;
}
