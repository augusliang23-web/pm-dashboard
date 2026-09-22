const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const functionsRoot = path.resolve(__dirname, '..');
const read = file => readFileSync(path.join(functionsRoot, file), 'utf8');

test('defines all Executive milestone callable handlers', () => {
  const source = read('executive-milestones.js');
  for (const name of [
    'addExecutiveMilestoneUpdate',
    'createExecutiveMilestoneChangeRequest',
    'decideExecutiveMilestoneChangeRequest',
    'applyDirectExecutiveMilestoneChange',
    'setExecutiveRagOverride',
    'saveExecutiveMilestoneTimelineConfig',
    'withdrawExecutiveMilestoneChangeRequest',
  ]) {
    assert.match(source, new RegExp(`const\\s+${name}\\s*=\\s*onCall`), name);
  }
});

test('Executive mutations read and write the live timeline rather than a reporting week', () => {
  const source = read('executive-milestones.js');
  assert.match(source, /liveTimelineRef\(db\)/);
  assert.match(source, /transaction\.get\(liveRef\)/);
  assert.match(source, /transaction\.set\(liveRef,/);
  assert.doesNotMatch(source, /const weekId = requireWeekId\(request\.data\)/);
});

test('only Admin can initialise the live Executive timeline from a selected week', () => {
  const source = read('executive-milestones.js');
  assert.match(source, /const initializeExecutiveMilestoneLiveTimeline = onCall/);
  assert.match(source, /Only administrators can initialize the live Executive timeline/);
  assert.match(read('index.js'), /exports\.initializeExecutiveMilestoneLiveTimeline/);
});

test('defines and exports a requester-only Executive change withdrawal callable', () => {
  const source = read('executive-milestones.js');
  assert.match(source, /const\s+withdrawExecutiveMilestoneChangeRequest\s*=\s*onCall/);
  assert.match(source, /Only the requester can withdraw this change request/);
  assert.match(source, /state:\s*'withdrawn'/);
  assert.match(source, /withdrawnAt:/);
  assert.match(source, /withdrawnBy:/);
  assert.match(read('index.js'), /exports\.withdrawExecutiveMilestoneChangeRequest\s*=\s*executiveMilestones\.withdrawExecutiveMilestoneChangeRequest/);
});

test('requires and audits Executive rejection comments', () => {
  const source = read('executive-milestones.js');
  assert.match(source, /const decisionNote = String\(request\.data\?\.decisionNote \|\| ''\)\.trim\(\)/);
  assert.match(source, /decision === 'reject' && !decisionNote/);
  assert.match(source, /A rejection comment is required/);
  assert.match(source, /action:\s*'rejected-change'/);
  assert.match(source, /decisionNote,/);
  assert.match(source, /transaction\.create\(auditRef, rejectedAudit\)/);
});

test('authenticates from the token email and reloads the actor role in each transaction', () => {
  const source = read('executive-milestones.js');
  assert.match(source, /request\.auth\.token\.email/);
  assert.match(source, /collection\(['"]users['"]\)\.doc\(email\)/);
  assert.match(source, /transaction\.get\(userRef\)/);
  assert.match(source, /normalizeRole\(userSnapshot\.data\(\)\.role/);
  assert.match(source, /db\.runTransaction/g);
  assert.doesNotMatch(source, /allowVipBridge:\s*true/);
});

test('keeps live timeline writes and append-only records in atomic transactions', () => {
  const source = read('executive-milestones.js');
  assert.match(source, /liveTimelineRef/);
  assert.match(source, /executiveMilestoneUpdates/);
  assert.match(source, /executiveMilestoneChangeRequests/);
  assert.match(source, /executiveMilestoneAudit/);
  assert.match(source, /transaction\.set\(liveRef, nextState/);
  assert.match(source, /timelineVersion:/);
  assert.match(source, /transaction\.create\(updateRef/);
  assert.match(source, /transaction\.create\(requestRef/);
  assert.match(source, /transaction\.create\(auditRef/);
  assert.match(source, /Executive milestones have not been initialized/);
});

test('keeps every Executive mutation independent of reporting-week release state', () => {
  const source = read('executive-milestones.js');
  assert.match(
    source,
    /const addExecutiveMilestoneUpdate[\s\S]*?readLiveTimeline\(transaction\)/,
  );
  assert.match(
    source,
    /const createExecutiveMilestoneChangeRequest[\s\S]*?readLiveTimeline\(transaction\)/,
  );
});

test('reloads live timeline configuration for every Executive mutation', () => {
  const source = read('executive-milestones.js');
  assert.match(source, /collection\(['"]executiveMilestoneConfig['"]\)\.doc\(['"]timeline['"]\)/);
  assert.match(source, /normalizeTimelineConfig/);
  assert.match(source, /configVersion/);
  assert.match(source, /config,\s*$/m);
});

test('applies canonical section IDs when evaluating legacy stored RAG rows', () => {
  const source = read('executive-milestones.js');
  assert.match(source, /canonicalSectionId/);
  assert.match(source, /rows\.find\(candidate => canonicalSectionId\(candidate\?\.sectionId\) === canonicalSectionId\(targetId\)\)/);
});

test('defines a version-checked timeline configuration change with audit', () => {
  const source = read('executive-milestones.js');
  assert.match(source, /saveExecutiveMilestoneTimelineConfig/);
  assert.match(source, /timeline-config-change/);
  assert.match(source, /expectedVersion/);
  assert.match(source, /Only Admin or Executive Owner can edit timeline settings/);
});

test('exports every callable beside presence aggregation', () => {
  const source = read('index.js');
  assert.match(source, /aggregatePresenceSessions/);
  for (const name of [
    'addExecutiveMilestoneUpdate',
    'createExecutiveMilestoneChangeRequest',
    'decideExecutiveMilestoneChangeRequest',
    'applyDirectExecutiveMilestoneChange',
    'setExecutiveRagOverride',
    'saveExecutiveMilestoneTimelineConfig',
    'withdrawExecutiveMilestoneChangeRequest',
  ]) {
    assert.match(source, new RegExp(`exports\\.${name}\\s*=\\s*executiveMilestones\\.${name}`), name);
  }
});
