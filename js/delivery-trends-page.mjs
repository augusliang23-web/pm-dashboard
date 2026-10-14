// UI glue for the Delivery Trends page (UAT-only). It only prepares authorized input for the shared metrics
// engine and hands the engine's result to the presentation renderers; it never calculates a metric itself.
import { createDeliveryTrendsInput, calculateDeliveryTrends } from './delivery-trends-adapter.mjs';
import { filterRoleVisibleProjects, normalizeOverviewScope } from './portfolio-core.mjs';
import {
  DELIVERY_TRENDS_CSS, renderDeliveryTrendsPage, renderDeliveryUnavailable, renderDeliveryWindowToggle
} from './delivery-trends-view.mjs';

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
// applies the same role / visibility filters the Overview uses. Real Firestore weeks do not carry an authoritative
// ISO reportingPeriod yet (Phase 2A); the engine then reports "unavailable" instead of guessing from labels.
export function buildDeliveryTrendsState({
  weeks, currentIdx, windowWeeks = 6, overviewScope = 'system', role, executivePerspective = false,
  visibilityFilter = 'active', source, asOf
} = {}) {
  const anchor = Array.isArray(weeks) ? weeks[currentIdx] : null;
  const anchorWeekId = weekIdOf(anchor);
  if (hasUnsavedWeeks(weeks)) return { state: 'unavailable', prototype: true, reason: PROTOTYPE_REASON };
  if (!anchorWeekId) return { state: 'unavailable', reason: 'No reporting week is selected.' };
  try {
    const input = createDeliveryTrendsInput({
      weeks, source, asOf, anchorWeekId, windowWeeks: normalizeDeliveryWindow(windowWeeks),
      publicationMode: executivePerspective ? 'released' : 'include-drafts',
      scope: { projectLevel: normalizeOverviewScope(overviewScope), projectKeys: null },
      canReadWeek: week => (executivePerspective ? week?.isReleased === true : true),
      canReadProject: project => filterRoleVisibleProjects([project], {
        role, executivePerspective, vipPerspective: executivePerspective, visibilityFilter
      }).length === 1
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
