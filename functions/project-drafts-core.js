const { createHash } = require('node:crypto');
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
  // Product requirement (Control Plane, 2026-10-17): an Admin or PM may create, save and first-publish a project from their own draft.
  // Deleting a project stays behind project.manage; draft access above is still limited to the draft's editors.
}
function validateDraftInput(project, {publishing=false,visibility='active'} = {}) {
  assertBoundedJson(project); assertAllowedKeys(project,PROJECT_KEYS,'Draft project');
  if ('progress' in project && (typeof project.progress !== 'number' || !Number.isFinite(project.progress) || project.progress < 0 || project.progress > 100)) fail('invalid-payload','Progress must be a number between 0 and 100.','invalid-argument');
  if ('visibility' in project && project.visibility !== visibility) fail('visibility-admin-only','Draft saving and publishing cannot change project visibility. Use existing project management.');
  for (const key of ['name','code','owner','deputy','customer','location','highlight','weeklyActions','risk','next']) if (key in project && typeof project[key] !== 'string') fail('invalid-payload',`${key} must be text.`,'invalid-argument');
  for (const key of ['milestones','quarterlyMilestones','ganttWorkstreams','pdfSummaryLanes','riskActions','riskPairs','riskList','teamMembers']) if (key in project && !Array.isArray(project[key])) fail('invalid-payload',`${key} must be a list.`,'invalid-argument');
  for (const key of ['budget','dataStatus','resources']) if (key in project && (!project[key] || typeof project[key] !== 'object' || Array.isArray(project[key]))) fail('invalid-payload',`${key} must be an object.`,'invalid-argument');
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
  assertBoundedJson(input); assertAllowedKeys(input,['draftId','expectedRevision','project','assignment','source'],'Draft request');
  assertDraftAccess(actor,existing,'save');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (existing?.revision || 0)) fail('conflict','Draft revision conflict. Reload before saving.','aborted');
  const assignment=resolveAssignment({actor,existing,input,assignmentUsers});
  const allowedVisibility=existing?.project.visibility || 'active';
  const provided=validateDraftInput(input.project,{visibility:allowedVisibility});
  for (const key of ['owner','deputy']) if (key in provided && provided[key] !== assignment[key]) fail('assignment-forbidden','Project assignment must match the server-approved account.');
  if (existing?.lastPublication && 'code' in provided && provided.code !== existing.project.code) fail('code-locked','Published project code cannot be changed.');
  const project=validateDraftInput({...mergePreservingUnknown(existing?.project || {name:'',code:'',progress:0,projectLevel:'system',visibility:'active'},provided),owner:assignment.owner,deputy:assignment.deputy},{visibility:allowedVisibility});
  return {schemaVersion:1,draftId,project,assignment:assignment.assignment,editorEmails:assignment.editorEmails,revision:(existing?.revision||0)+1,...(existing?.source ? {source:existing.source} : {}),createdAt:existing?.createdAt||nowIso,createdBy:existing?.createdBy||actor.email,updatedAt:nowIso,updatedBy:actor.email,publicationTargets:existing?.publicationTargets||{},lastPublication:existing?.lastPublication||null};
}
function publicDraft(draft) {
  const {publicationTargets,...result}=draft;
  return structuredClone(result);
}
module.exports={emailKey,fail,assertDraftAccess,validateDraftInput,buildDraftRecord,publicDraft,PROJECT_KEYS,publicationDigest,reportingWeekOrder};

function publicationDigest(fingerprint) {
  return createHash('sha256').update(fingerprint).digest('hex');
}
function reportingWeekOrder(week) {
  const match=String(week?.weekLabel || '').match(/^W(\d{1,2})\s+(\d{4})$/i);
  if(!match || Number(match[1])<1 || Number(match[1])>53) fail('invalid-week','Target week has no valid reporting period.','failed-precondition');
  return Number(match[2])*100+Number(match[1]);
}
// Pure publication planner. The handler commits every returned patch in one transaction.
function planDraftPublication({actor,draft,week,input,nowIso}) {
  const {projectRevisionFingerprint,ownerOrDeputyMatches,updateProjectSectionMetadata}=require('./project-dashboard-writes');
  const {withProjectEditorRowIds}=require('./project-data-merge.cjs');
  assertDraftAccess(actor,draft,draft.lastPublication?'republish':'first-publish');
  if(!week)fail('not-found','The target week no longer exists.','not-found');
  if(week.isReleased===true)fail('released-week','Published reporting weeks cannot be changed.','failed-precondition');
  if(input.expectedRevision!==draft.revision)fail('conflict','Draft revision conflict. Reload before publishing.','aborted');
  if(draft.project.visibility === 'archived')fail('archive-lifecycle','Archived projects use existing project management, outside Draft Publish.');
  const source=validateDraftInput(draft.project,{publishing:true,visibility:draft.project.visibility || 'active'});
  if(!draft.source && !draft.assignment.ownerEmail)fail('assignment-forbidden','Select a Project Manager before publishing.','failed-precondition');
  const projects=Array.isArray(week.projects)?week.projects:[];
  if(draft.source && !draft.createdAt && input.weekId!==draft.source.weekId)fail('conflict','An existing project must first publish to its source reporting week.','aborted');
  const matches=projects.filter(p=>p.publication?.draftId===draft.draftId || (draft.source?.weekId===input.weekId && p.code===draft.source.projectCode && !p.publication?.draftId));
  if(matches.length>1)fail('conflict','Multiple official projects claim this draft.','aborted');
  const live=matches[0];
  const target=draft.publicationTargets?.[input.weekId];
  if(draft.source && !Object.values(draft.publicationTargets||{}).some(t=>t.draftRevision>0) && input.weekId!==draft.source.weekId)fail('conflict','An existing project must first publish to its source reporting week.','aborted');
  if(!live && (target || draft.lastPublication))fail('conflict','The published project is absent from this reporting week. Draft Publish cannot recreate it. Use existing project management.','aborted');
  if(projects.some(p=>p!==live&&String(p.code).trim().toLowerCase()===source.code.trim().toLowerCase()))fail('conflict','This code belongs to another project.','aborted');
  if(live && actor.role!=='admin' && !ownerOrDeputyMatches(live,actor))fail('ownership-forbidden','The official project is no longer assigned to you.');
  if(live && live.visibility && live.visibility!=='active')fail('visibility-admin-only','Hidden or archived projects cannot be republished through Drafts.');
  const fingerprint=live?projectRevisionFingerprint(live):null;
  if(target?.draftRevision===draft.revision && live && target.projectRevision===publicationDigest(fingerprint)) {
    return {alreadyPublished:true,project:structuredClone(live),projectRevision:fingerprint,publishedAt:live.publication.publishedAt};
  }
  const weekOrder=reportingWeekOrder(week);
  if(draft.lastPublication && (!Number.isSafeInteger(draft.lastPublication.weekOrder) || weekOrder<draft.lastPublication.weekOrder)) fail('historical-week','Publish to the latest published reporting week or a later week.','failed-precondition');
  if(target && (!live || target.projectRevision!==publicationDigest(fingerprint))) fail('conflict','The published target was changed or restored. Contact Admin before publishing.','aborted');
  if(input.expectedPublishedRevision!==fingerprint)fail('conflict','The official project changed. Reload before publishing.','aborted');
  // Metadata outside the editable project contract belongs to the server / future schema.
  const publication={draftId:draft.draftId,draftRevision:draft.revision,publishedAt:nowIso,publishedBy:actor.email};
  const project={...(live||{}),...withProjectEditorRowIds(source),code:source.code.trim(),publication};
  const sectionUpdatedAt=updateProjectSectionMetadata(live||{},project,{editorName:actor.displayName,savedAt:nowIso});
  if(sectionUpdatedAt)project.sectionUpdatedAt=sectionUpdatedAt;
  const projectRevision=projectRevisionFingerprint(project);
  const nextProjects=live?projects.map(p=>p===live?project:p):[...projects,project];
  const version=Number.isSafeInteger(week.version)?week.version:0;
  const markerRevision=publicationDigest(projectRevision);
  const lastPublication={weekId:input.weekId,weekOrder,draftRevision:draft.revision,publishedAt:nowIso,publishedBy:actor.email,projectRevision:markerRevision};
  return {alreadyPublished:false,project,projectRevision,publishedAt:nowIso,
    weekPatch:{projects:nextProjects,version:version+1,lastModifiedBy:actor.email},
    draftPatch:{lastPublication,publicationTargets:{...draft.publicationTargets,[input.weekId]:{draftRevision:draft.revision,projectRevision:markerRevision}}},
    audit:{draftId:draft.draftId,weekId:input.weekId,draftRevision:draft.revision,actorEmail:actor.email,actorUid:actor.uid,publishedAt:nowIso}};
}
module.exports.planDraftPublication=planDraftPublication;
