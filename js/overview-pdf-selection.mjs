function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueTextList(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function buildOverviewProjectOptions(projects = []) {
  const seen = new Set();
  const options = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    const code = normalizeText(project?.code);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    options.push({ code, name: normalizeText(project?.name) || code });
  }
  return options;
}

export function reconcileOverviewProjectSelection(projectOptions = [], selectedProjectCodes) {
  const availableCodes = new Set(buildOverviewProjectOptions(projectOptions).map(project => project.code));
  if (!Array.isArray(selectedProjectCodes)) return [...availableCodes];
  return uniqueTextList(selectedProjectCodes).filter(code => availableCodes.has(code));
}

export const DELIVERY_PERFORMANCE_SECTION_ID = 'portfolio-delivery-performance';

// UAT release candidate: set to true ONLY together with (and after) the UAT PDF backend that accepts the new section
// has been deployed and verified (registry.json deliveryPerformanceSection: true for the UAT target). The old backend
// rejects unknown section ids, so deploy the backend first, verify it, then deploy this. The section is still UAT-only:
// isDeliveryPerformancePdfAvailable() requires the UAT profile, so Production never offers or sends it. To switch the
// feature off in an emergency, set this back to false and redeploy Hosting (or roll Hosting back).
export const DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED = true;

export function isDeliveryPerformancePdfAvailable({
  profile,
  backendVerified = DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED,
} = {}) {
  return profile === 'uat' && backendVerified === true;
}

export function buildOverviewPdfRequest({
  sections,
  overviewScope,
  projectCodes,
  executiveAudienceView,
  windowWeeks,
  deliveryPerformanceAvailable = isDeliveryPerformancePdfAvailable({ profile: globalThis.PM_DASHBOARD_ENV?.dashboardProfile }),
} = {}) {
  // Defense in depth: the new section is dropped unless this environment is explicitly verified for it.
  const normalizedSections = uniqueTextList(sections)
    .filter(section => section !== DELIVERY_PERFORMANCE_SECTION_ID || deliveryPerformanceAvailable === true);
  if (!normalizedSections.length) throw new Error('Select at least one section to export.');

  const normalizedProjectCodes = uniqueTextList(projectCodes);
  if (!normalizedProjectCodes.length) throw new Error('Select at least one project to export.');

  const request = {
    mode: 'overview',
    sections: normalizedSections,
    overviewScope: normalizeText(overviewScope).toLowerCase() || 'all',
    projectCodes: normalizedProjectCodes,
  };
  const normalizedAudience = normalizeText(executiveAudienceView);
  if (normalizedAudience && normalizedSections.includes('executive-milestones')) {
    request.executiveAudienceView = normalizedAudience;
  }
  if (normalizedSections.includes(DELIVERY_PERFORMANCE_SECTION_ID) && windowWeeks !== undefined && [6, 12].includes(Number(windowWeeks))) {
    request.windowWeeks = Number(windowWeeks);
  }
  return request;
}
