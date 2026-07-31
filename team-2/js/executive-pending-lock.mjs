const STRUCTURAL_ACTIONS = new Set(['move', 'rename', 'delete']);

export function pendingExecutiveMilestoneIds(records = []) {
  return new Set((Array.isArray(records) ? records : [])
    .filter(record => record?.state === 'pending')
    .map(record => String(record.itemId || '').trim())
    .filter(Boolean));
}

export function isExecutiveMilestoneActionLocked({ action, itemId, pendingIds }) {
  return STRUCTURAL_ACTIONS.has(String(action || ''))
    && pendingIds instanceof Set
    && pendingIds.has(String(itemId || '').trim());
}
