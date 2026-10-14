const { HttpsError } = require('firebase-functions/v2/https');
const { can } = require('./permission-registry');
const { assertAllowedKeys, assertBoundedJson } = require('./project-dashboard-writes');
const { mergePreservingUnknown } = require('./project-data-merge.cjs');
const PROJECT_KEYS = ['projectLevel','lifecycle','ganttWorkstreams','pdfSummaryLanes','resources','name','code','owner','deputy','customer','location','visibility','milestones','quarterlyMilestones','status','progress','attention','attentionManual','highlight','weeklyActions','riskActions','riskPairs','risk','next','riskList','riskManual','teamMembers','budget','dataStatus'];
const emailKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
function fail(reason, message, code='permission-denied') { throw new HttpsError(code,message,{reason}); }
function assertActor(actor) {
  if (!actor?.uid || !emailKey(actor.email)) fail('unauthenticated','Sign in before using drafts.','unauthenticated');
  if (!['admin','pm'].includes(actor.role)) fail('role-forbidden','Draft permission is required.');
}
function assertDraftAccess(actor, draft, action) {
  assertActor(actor);
  if (!['read','save','first-publish','republish'].includes(action)) fail('invalid-payload','Unsupported draft action.','invalid-argument');
  if (actor.role === 'admin') return;
  if (draft && !draft.editorEmails?.includes(emailKey(actor.email))) fail('draft-forbidden','Draft permission is required.');
  if (((!draft && action === 'save') || action === 'first-publish') && !can('project.manage',{role:actor.role,overrides:actor.permissionOverrides})) fail('create-forbidden','Add / Delete Projects permission is required.');
}
function validateDraftInput(project, {publishing=false} = {}) {
  assertBoundedJson(project); assertAllowedKeys(project,PROJECT_KEYS,'Draft project');
  if ('progress' in project && (typeof project.progress !== 'number' || !Number.isFinite(project.progress) || project.progress < 0 || project.progress > 100)) fail('invalid-payload','Progress must be a number between 0 and 100.','invalid-argument');
  if ('visibility' in project && project.visibility !== 'active') fail('visibility-admin-only','Drafts publish as Active; use the existing visibility administration after publication.');
  for (const key of ['name','code','owner','deputy','customer','location','highlight','weeklyActions','risk','next']) if (key in project && typeof project[key] !== 'string') fail('invalid-payload',`${key} must be text.`,'invalid-argument');
  for (const key of ['milestones','quarterlyMilestones','ganttWorkstreams','pdfSummaryLanes','resources','riskActions','riskPairs','riskList','teamMembers']) if (key in project && !Array.isArray(project[key])) fail('invalid-payload',`${key} must be a list.`,'invalid-argument');
  for (const key of ['budget','dataStatus']) if (key in project && (!project[key] || typeof project[key] !== 'object' || Array.isArray(project[key]))) fail('invalid-payload',`${key} must be an object.`,'invalid-argument');
  if ('projectLevel' in project && !['system','hardware-module','software'].includes(project.projectLevel)) fail('invalid-payload','Select a supported project level.','invalid-argument');
  if (publishing) {
    if (!project.name?.trim() || project.name.length > 128) fail('invalid-payload','Project name is required (maximum 128 characters).','invalid-argument');
    if (!project.code?.trim() || project.code.length > 128) fail('invalid-payload','Project code is required (maximum 128 characters).','invalid-argument');
    if (!project.projectLevel) fail('invalid-payload','Project level is required.','invalid-argument');
  }
  return structuredClone(project);
}
function resolveAssignment({actor,existing,input,assignmentUsers={}}) {
  if (actor.role !== 'admin') {
    if (input.assignment) fail('assignment-forbidden','Only Admin has permission to change draft assignment.');
    return existing ? {assignment:existing.assignment, editorEmails:existing.editorEmails, owner:existing.project.owner,deputy:existing.project.deputy}
      : {assignment:{ownerEmail:emailKey(actor.email),deputyEmail:''},editorEmails:[emailKey(actor.email)],owner:actor.displayName || actor.email,deputy:''};
  }
  if (!input.assignment && existing) return {assignment:existing.assignment,editorEmails:existing.editorEmails,owner:existing.project.owner,deputy:existing.project.deputy};
  const source = input.assignment || {ownerEmail:'',deputyEmail:''};
  assertAllowedKeys(source,['ownerEmail','deputyEmail'],'Assignment');
  const assignment={ownerEmail:emailKey(source.ownerEmail),deputyEmail:emailKey(source.deputyEmail)};
  const labels={};
  for (const [key,email] of Object.entries(assignment)) {
    if (!email) { labels[key]=''; continue; }
    const user=assignmentUsers[email];
    if (user?.role !== 'pm') fail('assignment-forbidden','Assignment must select an existing PM account.');
    labels[key]=user.displayName?.trim() || email;
  }
  return {assignment,editorEmails:[...new Set(Object.values(assignment).filter(Boolean))],owner:labels.ownerEmail,deputy:labels.deputyEmail};
}
function buildDraftRecord({actor,existing=null,input,assignmentUsers,draftId,nowIso}) {
  assertBoundedJson(input); assertAllowedKeys(input,['draftId','expectedRevision','project','assignment'],'Draft request');
  assertDraftAccess(actor,existing,'save');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (existing?.revision || 0)) fail('conflict','Draft revision conflict. Reload before saving.','aborted');
  const assignment=resolveAssignment({actor,existing,input,assignmentUsers});
  const provided=validateDraftInput(input.project);
  for (const key of ['owner','deputy']) if (key in provided && provided[key] !== assignment[key]) fail('assignment-forbidden','Project assignment must match the server-approved account.');
  if (existing?.lastPublication && 'code' in provided && provided.code !== existing.project.code) fail('code-locked','Published project code cannot be changed.');
  const project=validateDraftInput({...mergePreservingUnknown(existing?.project || {name:'',code:'',progress:0,projectLevel:'system',visibility:'active'},provided),owner:assignment.owner,deputy:assignment.deputy});
  return {schemaVersion:1,draftId,project,assignment:assignment.assignment,editorEmails:assignment.editorEmails,revision:(existing?.revision||0)+1,createdAt:existing?.createdAt||nowIso,createdBy:existing?.createdBy||actor.email,updatedAt:nowIso,updatedBy:actor.email,publicationTargets:existing?.publicationTargets||{},lastPublication:existing?.lastPublication||null};
}
function publicDraft(draft) {
  const {publicationTargets,...result}=draft;
  return structuredClone(result);
}
module.exports={emailKey,fail,assertDraftAccess,validateDraftInput,buildDraftRecord,publicDraft};
