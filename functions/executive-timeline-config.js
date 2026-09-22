'use strict';

const ROLES = new Set(['admin', 'executive', 'pm', 'engineering', 'sales', 'bd', 'product']);
const DEFAULT_SECTIONS = [
  { sectionId: 'ioe-product-portfolio', label: 'IoE Product Portfolio', viewRoles: ['admin', 'executive', 'pm', 'engineering', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive', 'pm', 'engineering'] },
  { sectionId: 'customer-engagements', label: 'Customer Engagements', viewRoles: ['admin', 'executive', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive', 'sales', 'bd', 'product'] },
  { sectionId: 'investors-strategy', label: 'Investors & Strategy', viewRoles: ['admin', 'executive', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive'] },
];
const DEFAULT_QUARTERS = [
  { quarterId: 'q1', label: 'Q1' }, { quarterId: 'q2', label: 'Q2' }, { quarterId: 'q3', label: 'Q3' }, { quarterId: 'q4', label: 'Q4' },
];

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalizedRoles(value) { return [...new Set((Array.isArray(value) ? value : []).map(role => String(role || '').trim().toLowerCase()).filter(role => ROLES.has(role)))]; }
function normalizeSection(value = {}) {
  const sectionId = String(value.sectionId || '').trim(); const label = String(value.label || '').trim();
  return sectionId && label ? { sectionId, label, viewRoles: normalizedRoles(value.viewRoles), updateRoles: normalizedRoles(value.updateRoles) } : null;
}
function normalizeQuarter(value = {}) {
  const quarterId = String(value.quarterId || value.key || '').trim(); const label = String(value.label || '').trim();
  return quarterId && label ? { quarterId, label } : null;
}
function sectionPolicies(sections) { return Object.fromEntries(sections.map(section => [section.sectionId, { viewRoles: [...section.viewRoles], updateRoles: [...section.updateRoles] }])); }
function defaultTimelineConfig() { return normalizeTimelineConfig({ version: 1, sections: DEFAULT_SECTIONS, quarters: DEFAULT_QUARTERS }); }
function normalizeTimelineConfig(raw = {}) {
  const sections = Array.isArray(raw.sections) ? raw.sections.map(normalizeSection).filter(Boolean) : [];
  const quarters = Array.isArray(raw.quarters) ? raw.quarters.map(normalizeQuarter).filter(Boolean) : [];
  const normalizedSections = sections.length ? sections : clone(DEFAULT_SECTIONS);
  const normalizedQuarters = quarters.length ? quarters : clone(DEFAULT_QUARTERS);
  return { version: Math.max(1, Number.parseInt(raw.version, 10) || 1), sections: normalizedSections, quarters: normalizedQuarters, sectionPolicies: sectionPolicies(normalizedSections) };
}
function sectionById(config, sectionId) { return (config?.sections || []).find(section => section.sectionId === String(sectionId || '').trim()) || null; }
function canViewConfiguredSection(config, role, sectionId) { return sectionById(config, sectionId)?.viewRoles.includes(String(role || '').trim().toLowerCase()) === true; }
function canUpdateConfiguredSection(config, role, sectionId) { return sectionById(config, sectionId)?.updateRoles.includes(String(role || '').trim().toLowerCase()) === true; }

module.exports = { defaultTimelineConfig, normalizeTimelineConfig, canViewConfiguredSection, canUpdateConfiguredSection };
