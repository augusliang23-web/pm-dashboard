import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dashboardSource } from './helpers/dashboard-source.mjs';
import { draftForProject, draftNeedsPublish, latestPublishWeekId, newProjectDrafts, visibleDraftsFor, eligibleDraftWeeks } from '../js/project-drafts-ui.mjs';

const week = (label, extra = {}) => ({ weekLabel: label, __documentId: label.replace(/\s+/g, '-'), isReleased: false, projects: [], ...extra });
const WEEKS = [week('W38 2026', { isReleased: true }), week('W39 2026'), week('W40 2026')];
const mine = 'pm@example.com', other = 'other@example.com';
const draft = (over = {}) => ({ draftId: 'd1', revision: 1, project: { name: 'N', code: 'C' }, editorEmails: [mine], createdBy: mine, lastPublication: null, ...over });

test('Save & Publish targets the latest applicable week and never a released or historical week', () => {
  assert.equal(latestPublishWeekId(WEEKS, draft()), 'W40-2026');
  assert.equal(latestPublishWeekId([week('W39 2026'), week('W40 2026', { isReleased: true })], draft()), 'W39-2026');           // the latest open week
  assert.equal(latestPublishWeekId([week('W39 2026', { isReleased: true })], draft()), '');                                   // nothing open: no silent fallback
  const published = draft({ revision: 2, lastPublication: { draftRevision: 1, weekOrder: 202640, weekId: 'W40-2026' } });
  assert.equal(latestPublishWeekId(WEEKS, published), 'W40-2026');
  assert.deepEqual(eligibleDraftWeeks(WEEKS, published).map(w => w.id), ['W40-2026']);                                         // W39 is historical for a project already published in W40
  const legacy = draft({ source: { weekId: 'W39-2026', projectCode: 'OLD' }, lastPublication: { draftRevision: 0, weekOrder: 0, weekId: 'W39-2026' } });
  assert.equal(latestPublishWeekId(WEEKS, legacy), 'W39-2026');                                                               // an existing project publishes only into its own source week
});

test('a new unpublished draft shows as one card on its author\'s dashboard only, on the publishing week only', () => {
  const drafts = [draft(), draft({ draftId: 'd2', editorEmails: [other], createdBy: other })];
  assert.deepEqual(newProjectDrafts(drafts, mine, WEEKS, 'W40-2026').map(d => d.draftId), ['d1']);
  assert.deepEqual(newProjectDrafts(drafts, other, WEEKS, 'W40-2026').map(d => d.draftId), ['d2']);
  assert.deepEqual(newProjectDrafts(drafts, 'third@example.com', WEEKS, 'W40-2026'), []);
  assert.deepEqual(newProjectDrafts(drafts, mine, WEEKS, 'W39-2026'), [], 'not shown on other weeks');
  const saved = [draft({ revision: 2, project: { name: 'N2' } })];                                                           // repeated Save Draft replaces the same draftId
  assert.equal(newProjectDrafts([...saved, draft()].filter((d, i, all) => all.findIndex(x => x.draftId === d.draftId) === i), mine, WEEKS, 'W40-2026').length, 1);
  assert.equal(visibleDraftsFor([draft({ editorEmails: [], createdBy: 'x@example.com' })], mine).length, 0);
});

test('an existing project shows Draft only to the author while changes are unpublished, and not after publishing', () => {
  const project = { code: 'OLD', publication: undefined };
  const pending = draft({ source: { weekId: 'W40-2026', projectCode: 'OLD' } });
  assert.equal(draftForProject([pending], mine, 'W40-2026', project)?.draftId, 'd1');
  assert.equal(draftForProject([pending], other, 'W40-2026', project), null, 'another user sees only the published version');
  assert.equal(draftForProject([pending], mine, 'W39-2026', project), null, 'a different week is not affected');
  const managed = draft({ revision: 3, lastPublication: { draftRevision: 2 } });
  assert.equal(draftForProject([managed], mine, 'W40-2026', { code: 'X', publication: { draftId: 'd1' } })?.draftId, 'd1');
  const published = draft({ revision: 3, lastPublication: { draftRevision: 3 } });
  assert.equal(draftNeedsPublish(published), false);
  assert.equal(draftForProject([published], mine, 'W40-2026', { code: 'X', publication: { draftId: 'd1' } }), null, 'publishing removes the Draft label');
  assert.deepEqual(newProjectDrafts([draft({ lastPublication: { draftRevision: 1 } })], mine, WEEKS, 'W40-2026'), [], 'a published new project is no longer a draft card');
});

test('UAT page: no My Drafts button, no week selector, drafts are local dashboard decorations only, PM owner is prefilled', () => {
  const uat = dashboardSource('uat');
  assert.equal(uat.includes('id="myDraftsBtn"'), false);
  assert.equal(uat.includes('projectDraftTargetWeek\')'), false);
  assert.equal(/createElement\('select'\)[^\n]*projectDraftTargetWeek/.test(uat), false);
  assert.match(uat, /function decorateDraftCards\(/);
  assert.match(uat, /if \(typeof decorateDraftCards === 'function'\) decorateDraftCards\(\);/);
  assert.match(uat, /ownerSelect\.value = ownName/);
  const production = dashboardSource('production');
  assert.equal(production.includes('decorateDraftCards'), false, 'Production is unchanged');
  assert.equal(production.includes('project-drafts-ui'), false);
});
