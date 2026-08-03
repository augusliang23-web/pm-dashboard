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

export function buildOverviewPdfRequest({
  sections,
  overviewScope,
  projectCodes,
  executiveAudienceView,
} = {}) {
  const normalizedSections = uniqueTextList(sections);
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
  return request;
}

