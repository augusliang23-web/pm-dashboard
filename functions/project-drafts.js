const { can } = require('./permission-registry');
const { onCall } = require('firebase-functions/v2/https');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { buildAuthenticatedActor, canRestoreArchivedProject, assertAllowedKeys, assertBoundedJson } = require('./project-dashboard-writes');
const { eligibleProject, readProjectCapabilities } = require('./draft-environment');
const { sortWeeksChronologically, latestValidWeekIndex } = require('./week-order');
const { emailKey, fail, assertDraftAccess, buildDraftRecord, publicDraft, publicationDigest } = require('./project-drafts-core');
const { sourceDraftId, sourceProject, assertSourceOwnership, buildSourceDraft } = require('./project-draft-origin');
const OPTIONS={serviceAccount:'pmdash-project-drafts@',maxInstances:20};
function safeId(value,label='Draft') {
  if(typeof value!=='string'||!value||value.length>128||/[\/\x00-\x1f]/.test(value)||['.','..','__proto__','constructor','prototype'].includes(value))fail('invalid-payload',`${label} identifier is invalid.`,'invalid-argument');
  return value;
}
function requestData(request,keys){assertBoundedJson(request.data);assertAllowedKeys(request.data,keys,'Draft request');return request.data;}
async function readActor(tx,db,request,{capabilitiesOnly=false}={}){
  const email=emailKey(request.auth?.token?.email),uid=request.auth?.uid;
  if(!uid||!email)fail('unauthenticated','Sign in before using drafts.','unauthenticated');
  const capabilities = await readProjectCapabilities(tx,db);
  if(!capabilitiesOnly && !capabilities.draftsEnabled)fail('draft-environment','Project drafts are not enabled in this environment.','failed-precondition');
  const user=await tx.get(db.collection('users').doc(email));
  if(!user.exists)fail('role-forbidden','Draft permission is required.');
  const permission=await tx.get(db.collection('userPermissions').doc(email));
  const actor=buildAuthenticatedActor({uid,email},user.data(),permission.exists?permission.data():null);
  if(capabilitiesOnly) return {actor,capabilities};
  assertDraftAccess(actor,null,'read');
  return actor;
}
async function readDraft(tx,db,actor,draftId){
  const ref=db.collection('projectDrafts').doc(safeId(draftId));const snapshot=await tx.get(ref);
  if(!snapshot.exists)fail('draft-forbidden','Draft is unavailable.');
  const draft=snapshot.data();assertDraftAccess(actor,draft,'read');
  if(actor.role!=='admin' && (draft.source || draft.lastPublication?.draftRevision>0)) {
    const binding=draft.lastPublication?.draftRevision>0 ? {weekId:draft.lastPublication.weekId,projectCode:draft.project.code} : draft.source;
    const week=await tx.get(db.collection('weeks').doc(safeId(binding.weekId,'Week')));
    const official=sourceProject(week.exists?week.data():null,binding);
    if(draft.source)assertSourceOwnership(actor,official);
    else if(!require('./project-dashboard-writes').ownerOrDeputyMatches(official,actor))fail('ownership-forbidden','You no longer have permission to edit this official project.');
  }
  return {ref,draft};
}
function validateSource(source) {
  assertAllowedKeys(source,['weekId','projectCode','expectedRevision'],'Source project');
  safeId(source.weekId,'Week');
  if(typeof source.projectCode!=='string'||!source.projectCode.trim()||source.projectCode.length>128)fail('invalid-payload','Source project code is invalid.','invalid-argument');
}
async function readSourceDraft(tx,db,actor,source,{saving=false}={}) {
  validateSource(source);
  const week=await tx.get(db.collection('weeks').doc(source.weekId));
  const project=sourceProject(week.exists?week.data():null,source,{requireOpen:true});
  assertSourceOwnership(actor,project);
  if(project.visibility==='archived')fail('archive-lifecycle','Archived projects use existing project management, outside Draft Publish.');
  const draftId=project.publication?.draftId || sourceDraftId(source);
  const ref=db.collection('projectDrafts').doc(safeId(draftId));
  const snapshot=await tx.get(ref);
  if(snapshot.exists){
    const draft=snapshot.data();
    const sourceBinding=project.publication?.draftId
      ? draft.draftId===draftId && draft.project?.code===project.code
      : draft.draftId===draftId && draft.source?.weekId===source.weekId && draft.source?.projectCode===source.projectCode && draft.project?.code===project.code;
    if(!sourceBinding)fail('conflict','The stored draft does not belong to this source project. Contact Admin.','aborted');
    assertDraftAccess(actor,draft,'read');return {ref,draft};
  }
  if(project.publication?.draftId)fail('conflict','The working draft is unavailable. Contact Admin.','aborted');
  const users=await tx.get(db.collection('users'));
  const draft=buildSourceDraft({actor,week:week.data(),source,users:users.docs.map(user=>({email:user.id,data:user.data()}))});
  if(saving && source.expectedRevision!==draft.source.expectedRevision)fail('conflict','The official project changed before this draft was saved. Reload before saving.','aborted');
  return {ref,draft};
}
async function mutationDraft(tx,db,actor,data) {
  if(data.draftId){
    const ref=db.collection('projectDrafts').doc(safeId(data.draftId)),snapshot=await tx.get(ref);
    if(snapshot.exists){
      const found=await readDraft(tx,db,actor,data.draftId);
      if(data.source){validateSource(data.source);if(!found.draft.source || data.source.weekId!==found.draft.source.weekId || data.source.projectCode!==found.draft.source.projectCode || data.source.expectedRevision!==found.draft.source.expectedRevision)fail('conflict','Draft origin does not match.','aborted');}
      return found;
    }
    if(data.expectedRevision!==0)fail('conflict','The draft no longer exists.','aborted');
    if(!data.source){
      if(data.draftId.startsWith('source-'))fail('invalid-payload','This draft identifier is reserved for existing projects.','invalid-argument');
      return {ref,draft:null};
    }
  }
  if(data.source){
    const found=await readSourceDraft(tx,db,actor,data.source,{saving:true});
    if(data.draftId && data.draftId!==found.ref.id)fail('conflict','Draft identity does not match its source.','aborted');
    return found;
  }
  return {ref:db.collection('projectDrafts').doc(),draft:null};
}
async function assignmentDirectory(tx,db,actor,data) {
  const assignmentUsers={};
  if(data.assignment){
    if(actor.role!=='admin' && !can('project.assignment.delegate',{role:actor.role,overrides:actor.permissionOverrides}))fail('assignment-forbidden','Assign Project Manager permission is required.');
    assertAllowedKeys(data.assignment,actor.role==='admin'?['ownerEmail','deputyEmail']:['ownerEmail'],'Assignment');
    for(const value of Object.values(data.assignment)){
      const email=emailKey(value);if(!email)continue;
      if(!email.includes('@')||email.includes('/')||email.length>320)fail('invalid-payload','Assignment email is invalid.','invalid-argument');
      const user=await tx.get(db.collection('users').doc(email));assignmentUsers[email]=user.exists?user.data():null;
    }
  }
  return assignmentUsers;
}
const getDashboardProjectDraft=onCall(OPTIONS,async request=>{
  const data=requestData(request,['draftId','source','capabilities']),db=getFirestore();
  if(data.capabilities===true){
    assertAllowedKeys(data,['capabilities'],'Capability request');
    return db.runTransaction(async tx=>{
      const {actor,capabilities}=await readActor(tx,db,request,{capabilitiesOnly:true});
      return {environmentEligible:Boolean(eligibleProject()),backendSupported:true,...capabilities,draftsEnabled:capabilities.draftsEnabled && ['admin','pm'].includes(actor.role),archiveRecoveryEnabled:capabilities.archiveRecoveryEnabled && canRestoreArchivedProject(actor)};
    });
  }
  if(Object.hasOwn(data,'capabilities'))fail('invalid-payload','Capability request must be explicit.','invalid-argument');
  if(Boolean(data.draftId)===Boolean(data.source))fail('invalid-payload','Select a draft or a source project.','invalid-argument');
  return db.runTransaction(async tx=>{const actor=await readActor(tx,db,request);const {draft}=data.source?await readSourceDraft(tx,db,actor,data.source):await readDraft(tx,db,actor,data.draftId);return {draft:publicDraft(draft)};});
});
const saveDashboardProjectDraft=onCall(OPTIONS,async request=>{
  const data=requestData(request,['draftId','expectedRevision','project','assignment','source']),db=getFirestore();
  return db.runTransaction(async tx=>{
    const actor=await readActor(tx,db,request),found=await mutationDraft(tx,db,actor,data);
    const assignmentUsers=await assignmentDirectory(tx,db,actor,data);
    const draft=buildDraftRecord({actor,existing:found.draft,input:data,assignmentUsers,draftId:found.ref.id,nowIso:new Date().toISOString()});
    tx.set(found.ref,draft);return {draft:publicDraft(draft)};
  });
});
const listDashboardProjectDrafts=onCall(OPTIONS,async request=>{
  const data=requestData(request,['limit','cursor']),db=getFirestore();
  const maximum=data.limit===undefined?25:data.limit;
  if(!Number.isInteger(maximum)||maximum<1||maximum>25)fail('invalid-payload','List limit must be between 1 and 25.','invalid-argument');
  return db.runTransaction(async tx=>{
    const actor=await readActor(tx,db,request);
    let query=db.collection('projectDrafts');
    if(actor.role!=='admin')query=query.where('editorEmails','array-contains',actor.email);
    query=query.orderBy('updatedAt','desc').orderBy(FieldPath.documentId());
    if(data.cursor){
      assertAllowedKeys(data.cursor,['email','role','draftId','updatedAt'],'Draft cursor');
      if(data.cursor.email!==actor.email||data.cursor.role!==actor.role||typeof data.cursor.updatedAt!=='string')fail('invalid-payload','Cursor belongs to a different account.','invalid-argument');
      query=query.startAfter(data.cursor.updatedAt,safeId(data.cursor.draftId));
    }
    const snapshot=await tx.get(query.limit(maximum+1));
    const docs=snapshot.docs.slice(0,maximum),last=docs.at(-1);
    const drafts=[];
    for(const entry of docs){const {draft}=await readDraft(tx,db,actor,entry.id);drafts.push(publicDraft(draft));}
    return {drafts,nextCursor:snapshot.docs.length>maximum?{email:actor.email,role:actor.role,draftId:last.id,updatedAt:last.data().updatedAt}:null};
  });
});
module.exports={safeId,requestData,readActor,readDraft,OPTIONS,getDashboardProjectDraft,saveDashboardProjectDraft,listDashboardProjectDrafts};

const publishDashboardProjectDraft=onCall(OPTIONS,async request=>{
  assertBoundedJson(request.data,{maxStringLength:256*1024});
  assertAllowedKeys(request.data,['draftId','expectedRevision','weekId','expectedPublishedRevision','project','assignment','source'],'Publish request');
  const data=request.data,db=getFirestore(),withForm=Object.hasOwn(data,'project');
  const weekId=safeId(data.weekId,'Week');
  if(withForm) safeId(data.draftId); // Stable identity makes first-publication retries safe.
  if(data.expectedPublishedRevision!==null && typeof data.expectedPublishedRevision!=='string')fail('invalid-payload','Official revision is required.','invalid-argument');
  const requestDigest=publicationDigest(JSON.stringify({actorUid:request.auth?.uid || '',data}));
  return db.runTransaction(async tx=>{
    const actor=await readActor(tx,db,request);
    // An exact retry after access was transferred returns only a success receipt, never private draft data.
    if(data.draftId){
      const receipt=await tx.get(db.collection('projectDrafts').doc(safeId(data.draftId)));
      const committed=receipt.exists?receipt.data():null;
      if(committed?.lastAssignmentTransfer?.requestDigest===requestDigest && committed.lastAssignmentTransfer.actorUid===actor.uid
        && committed.lastAssignmentTransfer.revision===committed.revision && actor.role!=='admin' && !committed.editorEmails.includes(actor.email)){
        const official=await tx.get(db.collection('weeks').doc(weekId));
        const live=official.exists?official.data().projects?.find(p=>p.publication?.draftId===committed.draftId):null;
        if(live && live.publication.draftRevision===committed.revision && publicationDigest(require('./project-dashboard-writes').projectRevisionFingerprint(live))===committed.lastPublication?.projectRevision)
          return {transferred:true,alreadyPublished:true,weekId,ownerEmail:committed.assignment.ownerEmail,ownerName:live.owner};
      }
    }
    const found=withForm?await mutationDraft(tx,db,actor,data):await readDraft(tx,db,actor,data.draftId);
    const weekRef=db.collection('weeks').doc(weekId),snapshot=await tx.get(weekRef),week=snapshot.exists?snapshot.data():null;
    const weeksSnapshot=await tx.get(db.collection('weeks'));
    const ordered=sortWeeksChronologically(weeksSnapshot.docs.map(doc=>({...doc.data(),__documentId:doc.id})));
    const latest=ordered[latestValidWeekIndex(ordered)];
    const {planDraftPublication}=require('./project-drafts-core');
    const retry=found.draft?.lastSaveAndPublish;
    if(withForm && retry?.requestDigest===requestDigest && retry.actorUid===actor.uid && retry.draftRevision===found.draft.revision){
      const result=planDraftPublication({actor,draft:found.draft,week,input:{...data,expectedRevision:found.draft.revision},nowIso:new Date().toISOString()});
      if(!result.alreadyPublished)fail('conflict','The official publication changed after this request.','aborted');
      return {weekId,project:result.project,projectRevision:result.projectRevision,draftRevision:found.draft.revision,publishedAt:result.publishedAt,alreadyPublished:true,draft:publicDraft(found.draft)};
    }
    let draft=found.draft;
    const nowIso=new Date().toISOString();
    if(withForm){
      const assignmentUsers=await assignmentDirectory(tx,db,actor,data);
      const {weekId:ignoredWeek,expectedPublishedRevision:ignoredRevision,...saveInput}=data;
      draft=buildDraftRecord({actor,existing:draft,input:saveInput,assignmentUsers,draftId:found.ref.id,nowIso});
    }
    const pendingUsers=draft.pendingAssignment?await assignmentDirectory(tx,db,actor,{assignment:{ownerEmail:draft.pendingAssignment.ownerEmail}}):{};
    const prepared=require('./project-drafts-core').preparePendingAssignment({actor,draft,assignmentUsers:pendingUsers});
    draft=prepared.draft;
    const result=planDraftPublication({actor,draft,week,input:{...data,expectedRevision:withForm?draft.revision:data.expectedRevision},nowIso});
    if(!result.alreadyPublished && (!latest || latest.__documentId!==weekId))fail('historical-week','Publish only to the latest reporting week.','failed-precondition');
    if(!result.alreadyPublished){
      tx.update(weekRef,result.weekPatch);
      draft={...draft,editorEmails:prepared.editorEmails};
      if(prepared.transferred)draft.lastAssignmentTransfer={actorUid:actor.uid,requestDigest,revision:draft.revision};
      if(withForm){
        draft={...draft,...result.draftPatch,lastSaveAndPublish:{requestDigest,actorUid:actor.uid,draftRevision:draft.revision}};
        tx.set(found.ref,draft);
      }else tx.set(found.ref,{...draft,...result.draftPatch});
      tx.create(db.collection('projectDraftPublicationAudit').doc(),{...result.audit,...(prepared.transferred?{assignmentChange:{before:found.draft?.assignment.ownerEmail || actor.email,after:draft.assignment.ownerEmail}}:{})});
    }
    if(prepared.transferred && actor.role!=='admin' && !prepared.editorEmails.includes(actor.email))return {transferred:true,alreadyPublished:result.alreadyPublished,weekId,ownerEmail:draft.assignment.ownerEmail,ownerName:result.project.owner};
    return {weekId,project:result.project,projectRevision:result.projectRevision,draftRevision:draft.revision,publishedAt:result.publishedAt,alreadyPublished:result.alreadyPublished,...(withForm?{draft:publicDraft(draft)}:{})};
  });
});
module.exports.publishDashboardProjectDraft=publishDashboardProjectDraft;
