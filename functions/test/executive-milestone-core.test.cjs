const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyApprovedRequest,
  applyDirectStructureChange,
  applyItemUpdate,
  authorizeUpdate,
  createChangeRequest,
  createExecutiveLegacyItemId,
  findItemLocation,
  normalizeRole,
} = require('../executive-milestone-core.js');
const {
  canViewConfiguredSection,
  normalizeTimelineConfig,
} = require('../executive-timeline-config.js');

function fixtureWeek() {
  return {
    weekId: '2026-W29',
    strategyLayer: {
      executiveMilestoneTimeline: {
        rows: [
          {
            sectionId: 'ioe-product-portfolio',
            label: 'IoE Product Portfolio',
            cells: {
              q1: [{ id: 'exec-1', text: 'Launch', version: 2, rag: 'green' }],
              q2: [], q3: [], q4: [],
            },
          },
          {
            sectionId: 'customer-engagements',
            label: 'Customer Engagements',
            cells: {
              q1: [],
              q2: [{ id: 'exec-2', text: 'Customer pilot', version: 1, rag: 'yellow' }],
              q3: [], q4: [],
            },
          },
          {
            sectionId: 'investors-strategy',
            label: 'Investors & Strategy',
            cells: {
              q1: [], q2: [],
              q3: [{ id: 'exec-3', text: 'Board review', version: 4, rag: 'green' }],
              q4: [],
            },
          },
        ],
      },
    },
  };
}

test('normalizes approved roles and rejects retired or unknown roles', () => {
  assert.equal(normalizeRole(' Sales '), 'sales');
  assert.equal(normalizeRole('vip'), '');
  assert.equal(normalizeRole('business'), '');
  assert.equal(normalizeRole('unknown'), '');
});

test('core recognizes configured IDs outside the legacy fixed list', () => {
  const config = normalizeTimelineConfig({
    quarters: [{ quarterId: 'launch', label: 'Launch' }],
    sections: [{ sectionId: 'commercial', label: 'Customer Success', viewRoles: ['sales'], updateRoles: ['sales'] }],
  });
  assert.equal(canViewConfiguredSection(config, 'sales', 'commercial'), true);
});

test('cross-grid move rejects a configured destination outside actor policy', () => {
  const config = normalizeTimelineConfig({
    quarters: [{ quarterId: 'q1', label: 'Q1' }, { quarterId: 'q2', label: 'Q2' }, { quarterId: 'q3', label: 'Q3' }, { quarterId: 'q4', label: 'Q4' }],
    sections: [
      { sectionId: 'ioe-product-portfolio', label: 'Product', viewRoles: ['admin', 'executive'], updateRoles: ['admin', 'executive'] },
      { sectionId: 'customer-engagements', label: 'Customer', viewRoles: ['admin', 'executive'], updateRoles: ['admin', 'executive'] },
      { sectionId: 'investors-strategy', label: 'Strategy', viewRoles: ['admin', 'executive', 'sales'], updateRoles: ['admin', 'executive'] },
    ],
  });
  assert.throws(() => createChangeRequest(fixtureWeek(), {
    role: 'sales', itemId: 'exec-3', expectedVersion: 4, changeType: 'move',
    after: { sectionId: 'customer-engagements', quarterKey: 'q4', index: 0 }, reason: 'Move this to the restricted customer workstream.', config,
  }), /not authorized/i);
});

test('enforces every approved update permission', () => {
  const allowed = new Set([
    'admin:ioe-product-portfolio', 'admin:customer-engagements', 'admin:investors-strategy',
    'executive:ioe-product-portfolio', 'executive:customer-engagements', 'executive:investors-strategy',
    'pm:ioe-product-portfolio', 'engineering:ioe-product-portfolio',
    'sales:customer-engagements', 'bd:customer-engagements', 'product:customer-engagements',
  ]);
  const roles = ['admin', 'executive', 'pm', 'engineering', 'sales', 'bd', 'product', 'unknown'];
  const sections = ['ioe-product-portfolio', 'customer-engagements', 'investors-strategy'];
  for (const role of roles) {
    for (const sectionId of sections) {
      const key = `${role}:${sectionId}`;
      if (allowed.has(key)) assert.doesNotThrow(() => authorizeUpdate(role, sectionId), key);
      else assert.throws(() => authorizeUpdate(role, sectionId), /not authorized/i, key);
    }
  }
});

test('finds an item in Firestore-safe quarter maps', () => {
  const location = findItemLocation(fixtureWeek(), 'exec-2');
  assert.deepEqual(
    { sectionId: location.sectionId, quarterKey: location.quarterKey, itemIndex: location.itemIndex },
    { sectionId: 'customer-engagements', quarterKey: 'q2', itemIndex: 0 },
  );
});

test('finds and upgrades a legacy item through its deterministic id', () => {
  const week = fixtureWeek();
  week.strategyLayer.executiveMilestoneTimeline.rows[0].cells.q4 = ['Legacy launch'];
  const itemId = createExecutiveLegacyItemId('ioe-product-portfolio', 'q4', 0, 'Legacy launch');
  const result = applyItemUpdate(week, {
    role: 'pm', itemId, expectedVersion: 0, rag: 'green', statusText: 'Legacy item reviewed',
    actorEmail: 'pm@example.com', now: '2026-07-18T00:00:00.000Z',
  });
  assert.equal(result.item.id, itemId);
  assert.equal(result.item.version, 1);
});

test('authorizes legacy stored section IDs through the canonical configurable policy', () => {
  const week = fixtureWeek();
  week.strategyLayer.executiveMilestoneTimeline.rows[0].sectionId = 'solution-ecosystem';
  const request = createChangeRequest(week, {
    role: 'pm',
    itemId: 'exec-1',
    expectedVersion: 2,
    changeType: 'move',
    after: { sectionId: 'ioe-product-portfolio', quarterKey: 'q2', index: 0 },
    reason: 'Move this milestone to the next quarter.',
  });

  assert.equal(request.before.sectionId, 'ioe-product-portfolio');
  assert.equal(request.after.sectionId, 'ioe-product-portfolio');
  assert.equal(request.state, 'pending');
});

test('applies one item update immutably and increments its version', () => {
  const week = fixtureWeek();
  const result = applyItemUpdate(week, {
    role: 'pm', itemId: 'exec-1', expectedVersion: 2,
    rag: 'yellow', statusText: 'Supplier date moved', actorEmail: 'pm@example.com',
    now: '2026-07-18T00:00:00.000Z',
  });
  assert.equal(result.item.version, 3);
  assert.equal(result.item.rag, 'yellow');
  assert.equal(result.item.latestStatusText, 'Supplier date moved');
  assert.equal(result.item.latestStatusBy, 'pm@example.com');
  assert.equal(result.updateRecord.ragBefore, 'green');
  assert.equal(result.updateRecord.ragAfter, 'yellow');
  assert.equal(week.strategyLayer.executiveMilestoneTimeline.rows[0].cells.q1[0].version, 2);
});

test('rejects missing RAG explanations, stale versions, and unauthorized sections', () => {
  assert.throws(() => applyItemUpdate(fixtureWeek(), {
    role: 'pm', itemId: 'exec-1', expectedVersion: 2, rag: 'red', statusText: ' ',
  }), /status update is required/i);
  assert.throws(() => applyItemUpdate(fixtureWeek(), {
    role: 'pm', itemId: 'exec-1', expectedVersion: 1, rag: 'green', statusText: 'Reviewed',
  }), /version conflict/i);
  assert.throws(() => applyItemUpdate(fixtureWeek(), {
    role: 'sales', itemId: 'exec-1', expectedVersion: 2, rag: 'green', statusText: 'Reviewed',
  }), /not authorized/i);
});

test('creates a canonical pending request only for visible sections', () => {
  const request = createChangeRequest(fixtureWeek(), {
    requestId: 'req-1', role: 'sales', requesterEmail: 'sales@example.com',
    itemId: 'exec-3', expectedVersion: 4, changeType: 'rename',
    after: { item: { text: 'Quarterly board review' } },
    reason: 'Clarify the milestone', now: '2026-07-18T00:00:00.000Z',
  });
  assert.equal(request.state, 'pending');
  assert.equal(request.before.item.text, 'Board review');
  assert.equal(request.after.item.text, 'Quarterly board review');
  assert.equal(request.targetVersion, 4);
  assert.equal(request.sourceSectionId, 'investors-strategy');
  assert.equal(request.targetSectionId, 'investors-strategy');
  assert.throws(() => createChangeRequest(fixtureWeek(), {
    role: 'pm', requesterEmail: 'pm@example.com', itemId: 'exec-2', expectedVersion: 1,
    changeType: 'rename', after: { item: { text: 'Hidden' } }, reason: 'Rename',
  }), /not authorized/i);
});

test('approves an exact proposal once and increments the target version', () => {
  const request = createChangeRequest(fixtureWeek(), {
    requestId: 'req-1', role: 'sales', requesterEmail: 'sales@example.com',
    itemId: 'exec-3', expectedVersion: 4, changeType: 'rename',
    after: { item: { text: 'Quarterly board review' } }, reason: 'Clarify',
  });
  const result = applyApprovedRequest(fixtureWeek(), request, {
    role: 'executive', actorEmail: 'owner@example.com', decisionNote: 'Approved',
    now: '2026-07-18T01:00:00.000Z',
  });
  const applied = findItemLocation(result.week, 'exec-3').item;
  assert.equal(applied.text, 'Quarterly board review');
  assert.equal(applied.version, 5);
  assert.equal(result.request.state, 'applied');
  assert.equal(result.audit.action, 'approved-change');

  const repeated = applyApprovedRequest(result.week, result.request, {
    role: 'executive', actorEmail: 'owner@example.com',
  });
  assert.equal(repeated.alreadyApplied, true);
  assert.equal(findItemLocation(repeated.week, 'exec-3').item.version, 5);
});

test('marks a stale approval conflict without overwriting the week', () => {
  const request = createChangeRequest(fixtureWeek(), {
    role: 'sales', requesterEmail: 'sales@example.com', itemId: 'exec-3', expectedVersion: 4,
    changeType: 'delete', reason: 'No longer required',
  });
  const changed = fixtureWeek();
  changed.strategyLayer.executiveMilestoneTimeline.rows[2].cells.q3[0].version = 5;
  const result = applyApprovedRequest(changed, request, {
    role: 'executive', actorEmail: 'owner@example.com',
  });
  assert.equal(result.request.state, 'conflict');
  assert.deepEqual(result.week, changed);
});

test('marks an approval conflict when its target was deleted', () => {
  const request = createChangeRequest(fixtureWeek(), {
    role: 'sales', requesterEmail: 'sales@example.com', itemId: 'exec-3', expectedVersion: 4,
    changeType: 'rename', after: { item: { text: 'Updated board review' } }, reason: 'Clarify',
  });
  const changed = fixtureWeek();
  changed.strategyLayer.executiveMilestoneTimeline.rows[2].cells.q3 = [];
  const result = applyApprovedRequest(changed, request, {
    role: 'executive', actorEmail: 'owner@example.com',
  });
  assert.equal(result.request.state, 'conflict');
  assert.match(result.request.conflictReason, /not found/i);
  assert.deepEqual(result.week, changed);
});

test('requires Admin or Executive and an audit reason for direct changes', () => {
  const input = {
    role: 'admin', actorEmail: 'admin@example.com', itemId: 'exec-1', expectedVersion: 2,
    changeType: 'move-quarter',
    after: { sectionId: 'ioe-product-portfolio', quarterKey: 'q2', index: 0 },
    reason: 'Schedule moved', now: '2026-07-18T00:00:00.000Z',
  };
  assert.throws(() => applyDirectStructureChange(fixtureWeek(), { ...input, reason: ' ' }), /reason is required/i);
  assert.throws(() => applyDirectStructureChange(fixtureWeek(), { ...input, role: 'sales' }), /not authorized/i);
  const result = applyDirectStructureChange(fixtureWeek(), input);
  assert.equal(findItemLocation(result.week, 'exec-1').quarterKey, 'q2');
  assert.equal(result.audit.action, 'direct-change');
  assert.equal(result.audit.reason, 'Schedule moved');
});

test('moves a milestone to a different section and quarter in one exact proposal', () => {
  const week = fixtureWeek();
  const proposal = createChangeRequest(week, {
    role: 'sales', requesterEmail: 'sales@example.com', itemId: 'exec-3', expectedVersion: 4,
    changeType: 'move',
    after: { sectionId: 'customer-engagements', quarterKey: 'q4', index: 0 },
    reason: 'The commercial milestone is now planned for the Q4 customer workstream.',
  });
  assert.equal(proposal.after.sectionId, 'customer-engagements');
  assert.equal(proposal.after.quarterKey, 'q4');
  const applied = applyApprovedRequest(week, proposal, { role: 'executive', actorEmail: 'executive@example.com' });
  assert.equal(applied.week.strategyLayer.executiveMilestoneTimeline.rows[1].cells.q4[0].id, 'exec-3');
});
