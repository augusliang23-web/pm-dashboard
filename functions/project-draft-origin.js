const { createHash } = require('node:crypto');
const { buildAuthenticatedActor, identityTokens, ownershipTokens, ownerOrDeputyMatches, projectRevisionFingerprint } = require('./project-dashboard-writes');
const { fail, PROJECT_KEYS, publicationDigest, reportingWeekOrder } = require('./project-drafts-core');

function sourceDraftId(source) {
  return 'source-' + createHash('sha256').update(JSON.stringify([source.weekId, source.projectCode])).digest('hex');
}
function assertSourceOwnership(actor, project) {
  if(actor.role!=='admin' && project.visibility && project.visibility!=='active')fail('visibility-forbidden','This project is not visible to your account.');
  if (actor.role !== 'admin' && !ownerOrDeputyMatches(project, actor)) {
    fail('ownership-forbidden', 'You no longer have permission to edit this official project.');
  }
}
function sourceProject(week, source, { requireOpen = false } = {}) {
  if (!week) fail('conflict', 'The source reporting week no longer exists.', 'aborted');
  if (requireOpen && week.isReleased === true) fail('released-week', 'This reporting week has been released.', 'failed-precondition');
  const matches = (week.projects || []).filter(project => project.code === source.projectCode);
  if (matches.length !== 1) fail('conflict', 'The source project was removed or is ambiguous.', 'aborted');
  return matches[0];
}
function buildSourceDraft({ actor, week, source, users }) {
  const project = sourceProject(week, source, { requireOpen: true });
  assertSourceOwnership(actor, project);
  const candidates = users.filter(user => String(user.data.role).trim().toLowerCase() === 'pm')
    .map(user => buildAuthenticatedActor({ uid: user.email, email: user.email }, user.data));
  const assigned = label => {
    const emails = new Set();
    let ambiguous = false;
    for (const token of ownershipTokens(label)) {
      const matches = candidates.filter(candidate => identityTokens(candidate).has(token));
      if (matches.length === 1) emails.add(matches[0].email);
      if (matches.length > 1) ambiguous = true;
    }
    return { emails: [...emails], ambiguous };
  };
  const owner = assigned(project.owner), deputy = assigned(project.deputy);
  const editorEmails = [...new Set([...owner.emails, ...deputy.emails])];
  if (actor.role !== 'admin' && (!editorEmails.includes(actor.email) || owner.ambiguous || deputy.ambiguous)) {
    fail('ambiguous-assignment', 'Project assignment must be resolved to a unique PM account by Admin.');
  }
  const fingerprint = projectRevisionFingerprint(project), weekOrder = reportingWeekOrder(week);
  const safeProject = Object.fromEntries(PROJECT_KEYS.filter(key => Object.hasOwn(project, key)).map(key => [key, structuredClone(project[key])]));
  return {
    schemaVersion: 1, draftId: sourceDraftId(source), revision: 0,
    project: {owner:'',deputy:'',...safeProject},
    source: { weekId: source.weekId, projectCode: source.projectCode, expectedRevision: publicationDigest(fingerprint) },
    assignment: { ownerEmail: owner.emails.length === 1 && !owner.ambiguous ? owner.emails[0] : '', deputyEmail: deputy.emails.length === 1 && !deputy.ambiguous ? deputy.emails[0] : '' },
    editorEmails,
    publicationTargets: { [source.weekId]: { draftRevision: 0, projectRevision: publicationDigest(fingerprint) } },
    lastPublication: { weekId: source.weekId, weekOrder, draftRevision: 0, publishedAt: null, publishedBy: null, projectRevision: publicationDigest(fingerprint) },
  };
}
module.exports = { sourceDraftId, sourceProject, assertSourceOwnership, buildSourceDraft };
