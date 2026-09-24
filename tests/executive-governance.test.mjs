import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXECUTIVE_SECTIONS,
  calculateVisibleExecutiveRag,
  canApproveExecutiveRequest,
  canChangeExecutiveStructure,
  canUpdateExecutiveSection,
  canViewExecutiveSection,
  createExecutiveLegacyItemId,
  getExecutiveUpdateFreshness,
  normalizeExecutiveRole,
  validateExecutiveItemUpdate,
} from '../js/executive-governance.mjs';
import {
  canUpdateConfiguredSection,
  canViewConfiguredSection,
  normalizeExecutiveTimelineConfig,
} from '../js/executive-timeline-config.mjs';

test('uses the approved roles and fixed Executive sections', () => {
  assert.deepEqual(EXECUTIVE_SECTIONS.map(item => [item.sectionId, item.label]), [
    ['ioe-product-portfolio', 'IoE Product Portfolio'],
    ['customer-engagements', 'Customer Engagements'],
    ['investors-strategy', 'Investors & Strategy'],
  ]);
  assert.equal(normalizeExecutiveRole('business'), '');
  assert.equal(normalizeExecutiveRole('unknown-role'), '');
  assert.equal(normalizeExecutiveRole('sales'), 'sales');
  assert.equal(normalizeExecutiveRole('bd'), 'bd');
  assert.equal(normalizeExecutiveRole('executive'), 'executive');
  assert.equal(normalizeExecutiveRole('vip', { allowVipBridge: true }), 'executive');
  assert.equal(normalizeExecutiveRole('vip'), '');
});

test('configured labels do not alter ID-based access', () => {
  const config = normalizeExecutiveTimelineConfig({
    quarters: [{ quarterId: 'launch', label: 'Launch' }],
    sections: [{ sectionId: 'commercial', label: 'Customer Success', viewRoles: ['sales'], updateRoles: ['bd'] }],
  });
  assert.equal(canViewConfiguredSection(config, 'sales', 'commercial'), true);
  assert.equal(canUpdateConfiguredSection(config, 'bd', 'commercial'), true);
  assert.equal(canViewConfiguredSection(config, 'pm', 'commercial'), false);
  assert.equal(config.sections[0].label, 'Customer Success');
  assert.equal(config.quarters[0].label, 'Launch');
});

test('derives a stable legacy item id from its fixed location and text', () => {
  const first = createExecutiveLegacyItemId('ioe-product-portfolio', 'q1', 0, 'Launch');
  assert.equal(first, createExecutiveLegacyItemId('ioe-product-portfolio', 'q1', 0, 'Launch'));
  assert.notEqual(first, createExecutiveLegacyItemId('ioe-product-portfolio', 'q2', 0, 'Launch'));
  assert.match(first, /^exec-[a-z0-9]+$/);
});

test('enforces the approved view and update matrix', () => {
  assert.equal(canUpdateExecutiveSection('pm', 'ioe-product-portfolio'), true);
  assert.equal(canViewExecutiveSection('pm', 'customer-engagements'), false);
  assert.equal(canViewExecutiveSection('sales', 'investors-strategy'), true);
  assert.equal(canUpdateExecutiveSection('sales', 'investors-strategy'), false);
  assert.equal(canUpdateExecutiveSection('bd', 'customer-engagements'), true);
  assert.equal(canUpdateExecutiveSection('product', 'customer-engagements'), true);
  assert.equal(canChangeExecutiveStructure('executive'), true);
  assert.equal(canChangeExecutiveStructure('admin'), true);
  assert.equal(canChangeExecutiveStructure('sales'), false);
  assert.equal(canApproveExecutiveRequest('executive'), true);
  assert.equal(canApproveExecutiveRequest('admin'), false);
  assert.equal(canViewExecutiveSection('unknown-role', 'ioe-product-portfolio'), false);
});

test('calculates RAG from visible items only', () => {
  const items = [
    { sectionId: 'ioe-product-portfolio', rag: 'green' },
    { sectionId: 'customer-engagements', rag: 'red' },
  ];
  assert.equal(calculateVisibleExecutiveRag(items, 'pm'), 'green');
  assert.equal(calculateVisibleExecutiveRag(items, 'executive'), 'red');
  assert.equal(calculateVisibleExecutiveRag(items, 'unknown-role'), null);
});

test('classifies leadership update records without task-status language', () => {
  const now = Date.parse('2026-07-18T00:00:00Z');
  assert.equal(getExecutiveUpdateFreshness('2026-06-17T00:00:00Z', now), 'current');
  assert.equal(getExecutiveUpdateFreshness('2026-06-16T00:00:00Z', now), 'refresh-requested');
  assert.equal(getExecutiveUpdateFreshness('2026-06-02T00:00:00Z', now), 'please-refresh');
  assert.equal(getExecutiveUpdateFreshness('', now), 'missing');
});

test('requires an explanation only when RAG changes', () => {
  assert.throws(
    () => validateExecutiveItemUpdate({ originalRag: 'green', rag: 'yellow', statusText: ' ' }),
    /status update is required/i,
  );
  assert.deepEqual(
    validateExecutiveItemUpdate({ originalRag: 'green', rag: 'green', statusText: ' Monthly review complete ' }),
    { rag: 'green', statusText: 'Monthly review complete' },
  );
});
