// UI glue for the Delivery Trends page (UAT-only). It only prepares authorized input for the shared metrics
// engine and hands the engine's result to the presentation renderers; it never calculates a metric itself.
import { createDeliveryTrendsInput, calculateDeliveryTrends } from './delivery-trends-adapter.mjs';
import { normalizeOverviewScope } from './portfolio-core.mjs';
import { normalizeDashboardRole } from './dashboard-access.mjs';
import {
  DELIVERY_TRENDS_CSS, escapeHtml, renderDeliveryNotices, renderDeliverySummaryCards,
  renderDeliveryProjectRows, renderDeliveryProgressTrend, renderDeliveryPortfolioChanges,
  renderDeliveryTrendsPage, renderDeliveryUnavailable, renderDeliveryWindowToggle
} from './delivery-trends-view.mjs';

export {
  DELIVERY_TRENDS_CSS, escapeHtml, renderDeliveryNotices, renderDeliverySummaryCards,
  renderDeliveryProjectRows, renderDeliveryProgressTrend, renderDeliveryPortfolioChanges,
  renderDeliveryTrendsPage, renderDeliveryUnavailable, renderDeliveryWindowToggle
};

export const DELIVERY_WINDOWS = [6, 12];
export const normalizeDeliveryWindow = value => (Number(value) === 12 ? 12 : 6);

function weekIdOf(week) {
  return week?.weekId || week?.__documentId || null;
}

export const PROTOTYPE_REASON = 'The dashboard is showing built-in prototype data because no saved weekly reports were loaded. Delivery Trends is not available for prototype data and is never presented as verified UAT or Production data.';

// Saved weeks always carry a Firestore document id (week.__documentId). The built-in prototype fallback
// (buildPrototypeWeeks) does not, so a loaded dataset with an unsaved week is not live data.
export function hasUnsavedWeeks(weeks) {
  return Array.isArray(weeks) && weeks.some(week => !weekIdOf(week));
}

// Builds the engine input from the weeks the dashboard has ALREADY loaded under the user's existing access, then
// requires server-confirmed read completeness. Raw lifecycle/progress values are preserved; validated
// period normalization and project scope classification are shared with the PDF pipeline.
export function buildDeliveryTrendsState({
  weeks, currentIdx, windowWeeks = 6, overviewScope = 'system', role, executivePerspective = false,
  visibilityFilter = 'active', source, asOf, historyComplete = false, anchorWeekId: explicitAnchorWeekId
} = {}) {
  const normalizedRole = normalizeDashboardRole(role);
  if (!normalizedRole) return { state: 'unavailable', reason: 'Authorized reporting history is unavailable.' };
  if (historyComplete !== true) return { state: 'unavailable', reason: 'Historical data has not been confirmed by the server. Metrics are unavailable.' };
  const releasedOnly = executivePerspective || ['vip','executive'].includes(normalizedRole);
  const anchor = Array.isArray(weeks) ? (explicitAnchorWeekId ? weeks.find(week => weekIdOf(week) === explicitAnchorWeekId) : weeks[currentIdx]) : null;
  const anchorWeekId = weekIdOf(anchor);
  if (hasUnsavedWeeks(weeks)) return { state: 'unavailable', prototype: true, reason: PROTOTYPE_REASON };
  // Confirmed zero-week reporting history in UAT is empty, not synthetic prototype data.
  if (Array.isArray(weeks) && weeks.length === 0) return { state: 'unavailable', reason: 'Insufficient reporting history to calculate delivery trends.' };
  if (!anchorWeekId) return { state: 'unavailable', reason: 'No reporting week is selected.' };
  try {
    const input = createDeliveryTrendsInput({
      weeks, source, asOf, anchorWeekId, windowWeeks: normalizeDeliveryWindow(windowWeeks),
      publicationMode: releasedOnly ? 'released' : 'include-drafts',
      scope: { projectLevel: normalizeOverviewScope(overviewScope), projectKeys: null },
      canReadWeek: week => (releasedOnly ? week?.isReleased === true : true),
      // Raw records were read under existing week permissions; display scope belongs to the engine.
      canReadProject: () => true
    });
    return { state: 'ready', contract: calculateDeliveryTrends(input), windowWeeks: normalizeDeliveryWindow(windowWeeks) };
  } catch {
    return { state: 'unavailable', reason: 'Delivery trends could not be prepared for this reporting week.' };
  }
}

export function renderDeliveryTrendsPageHtml(state, { windowWeeks = 6 } = {}) {
  const toggle = renderDeliveryWindowToggle(normalizeDeliveryWindow(windowWeeks));
  if (state?.state !== 'ready') return `${toggle}${renderDeliveryUnavailable(state?.reason || 'Delivery trends data is unavailable.')}`;
  return `${toggle}${renderDeliveryTrendsPage(state.contract, { windowWeeks: normalizeDeliveryWindow(windowWeeks) })}`;
}

// Browser-print variant: no interactive controls, always the 6-week default window.
export function renderDeliveryTrendsPrintHtml(state) {
  if (state?.state !== 'ready') return renderDeliveryUnavailable(state?.reason || 'Delivery trends data is unavailable.');
  return renderDeliveryTrendsPage(state.contract, { windowWeeks: 6 });
}

export function installDeliveryTrendsStyles(doc) {
  if (!doc || doc.getElementById('deliveryTrendsStyles')) return;
  const style = doc.createElement('style');
  style.id = 'deliveryTrendsStyles';
  style.textContent = DELIVERY_TRENDS_CSS;
  doc.head.appendChild(style);
}
