const ROLES = new Set(['admin', 'executive', 'pm', 'engineering', 'sales', 'bd', 'product']);

const DEFAULT_SECTIONS = Object.freeze([
  Object.freeze({ sectionId: 'ioe-product-portfolio', label: 'IoE Product Portfolio', viewRoles: ['admin', 'executive', 'pm', 'engineering', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive', 'pm', 'engineering'] }),
  Object.freeze({ sectionId: 'customer-engagements', label: 'Customer Engagements', viewRoles: ['admin', 'executive', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive', 'sales', 'bd', 'product'] }),
  Object.freeze({ sectionId: 'investors-strategy', label: 'Investors & Strategy', viewRoles: ['admin', 'executive', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive'] }),
]);

const DEFAULT_QUARTERS = Object.freeze([
  Object.freeze({ quarterId: 'q1', label: 'Q1' }),
  Object.freeze({ quarterId: 'q2', label: 'Q2' }),
  Object.freeze({ quarterId: 'q3', label: 'Q3' }),
  Object.freeze({ quarterId: 'q4', label: 'Q4' }),
]);

function normalizedRoles(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(role => String(role || '').trim().toLowerCase())
    .filter(role => ROLES.has(role)))];
}

function normalizeSection(value = {}) {
  const sectionId = String(value.sectionId || '').trim();
  const label = String(value.label || '').trim();
  if (!sectionId || !label) return null;
  return { sectionId, label, viewRoles: normalizedRoles(value.viewRoles), updateRoles: normalizedRoles(value.updateRoles) };
}

function normalizeQuarter(value = {}) {
  const quarterId = String(value.quarterId || value.key || '').trim();
  const label = String(value.label || '').trim();
  return quarterId && label ? { quarterId, label } : null;
}

function policyMap(sections) {
  return Object.fromEntries(sections.map(section => [section.sectionId, {
    viewRoles: [...section.viewRoles],
    updateRoles: [...section.updateRoles],
  }]));
}

export const DEFAULT_EXECUTIVE_TIMELINE_CONFIG = Object.freeze({
  version: 1,
  quarters: DEFAULT_QUARTERS,
  sections: DEFAULT_SECTIONS,
  sectionPolicies: Object.freeze(policyMap(DEFAULT_SECTIONS)),
});

export function normalizeExecutiveTimelineConfig(raw = {}) {
  const configuredSections = Array.isArray(raw.sections) ? raw.sections.map(normalizeSection).filter(Boolean) : [];
  const configuredQuarters = Array.isArray(raw.quarters) ? raw.quarters.map(normalizeQuarter).filter(Boolean) : [];
  const sections = configuredSections.length ? configuredSections : DEFAULT_SECTIONS.map(section => ({ ...section, viewRoles: [...section.viewRoles], updateRoles: [...section.updateRoles] }));
  const quarters = configuredQuarters.length ? configuredQuarters : DEFAULT_QUARTERS.map(quarter => ({ ...quarter }));
  return {
    version: Math.max(1, Number.parseInt(raw.version, 10) || 1),
    sections,
    quarters,
    sectionPolicies: policyMap(sections),
  };
}

function sectionById(config, sectionId) {
  return (config?.sections || []).find(section => section.sectionId === String(sectionId || '').trim()) || null;
}

export function canViewConfiguredSection(config, role, sectionId) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  return sectionById(config, sectionId)?.viewRoles.includes(normalizedRole) === true;
}

export function canUpdateConfiguredSection(config, role, sectionId) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  return sectionById(config, sectionId)?.updateRoles.includes(normalizedRole) === true;
}

export function configuredSectionLabel(config, sectionId) {
  return sectionById(config, sectionId)?.label || String(sectionId || '');
}

export function configuredQuarterLabel(config, quarterId) {
  return (config?.quarters || []).find(quarter => quarter.quarterId === String(quarterId || '').trim())?.label || String(quarterId || '');
}
