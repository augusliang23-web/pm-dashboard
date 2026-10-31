const {resolveProjectAccount}=require('./project-assignment-eligibility');
const { onCall } = require('firebase-functions/v2/https');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { buildAuthenticatedActor, canRestoreArchivedProject, assertAllowedKeys, assertBoundedJson } = require('./project-dashboard-writes');
const { eligibleProject, readProjectCapabilities } = require('./draft-environment');
const { sortWeeksChronologically, latestValidWeekIndex } = require('./week-order');
const { emailKey, fail, assertDraftAccess, buildDraftRecord, publicDraft, publicationDigest } = require('./project-drafts-core');
const { sourceDraftId, sourceProject, assertSourceOwnership, buildSourceDraft } = require('./project-draft-origin');
const OPTIONS={serviceAccount:'pmdash-project-drafts@',maxInstances:20};
const MAX_ASSIGNMENT_DIRECTORY_USERS=1000;
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
  if(draft.source && actor.role!=='admin'){const week=await tx.get(db.collection('weeks').doc(safeId(draft.source.weekId,'Week')));assertSourceOwnership(actor,sourceProject(week.exists?week.data():null,draft.source));}
  return {ref,draft,persisted:true};
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
    assertDraftAccess(actor,draft,'read');return {ref,draft,persisted:true};
  }
  if(project.publication?.draftId)fail('conflict','The working draft is unavailable. Contact Admin.','aborted');
  const users=await tx.get(db.collection('users'));
  const draft=buildSourceDraft({actor,week:week.data(),source,users:users.docs.map(user=>({email:user.id,data:user.data()}))});
  if(saving && source.expectedRevision!==draft.source.expectedRevision)fail('conflict','The official project changed before this draft was saved. Reload before saving.','aborted');
  return {ref,draft,persisted:false};
}
async function mutationDraft(tx,db,actor,data) {
  if(data.draftId){
    const ref=db.collection('projectDrafts').doc(safeId(data.draftId)),snapshot=await tx.get(ref);
    if(snapshot.exists){
      const found=await readDraft(tx,db,actor,data.draftId);
      if(data.source){validateSource(data.source);if(!found.draft.source || data.source.weekId!==found.draft.source.weekId || data.source.projectCode!==found.draft.source.projectCode || data.source.expectedRevision!==found.draft.source.expectedRevision)fail('conflict','Draft origin does not match.','aborted');}
      return {...found,persisted:true};
    }
    if(data.expectedRevision!==0)fail('conflict','The draft no longer exists.','aborted');
    if(!data.source){
      if(data.draftId.startsWith('source-'))fail('invalid-payload','This draft identifier is reserved for existing projects.','invalid-argument');
      return {ref,draft:null,persisted:false};
    }
  }
  if(data.source){
    const found=await readSourceDraft(tx,db,actor,data.source,{saving:true});
    if(data.draftId && data.draftId!==found.ref.id)fail('conflict','Draft identity does not match its source.','aborted');
    return found;
  }
  return {ref:db.collection('projectDrafts').doc(),draft:null,persisted:false};
}
async function assignmentDirectory(tx,db,actor,data) {
  const assignmentUsers={};
  if(data.assignment){
    if(actor.role!=='admin')fail('assignment-forbidden','Only Admin has permission to change assignment.');
    assertAllowedKeys(data.assignment,['ownerEmail','deputyEmail'],'Assignment');
    if(Object.values(data.assignment).some(value=>typeof value!=='string'))fail('invalid-payload','Assignment email must be text.','invalid-argument');
    const emails=[...new Set(Object.values(data.assignment).map(emailKey).filter(Boolean))];
    for(const email of emails)if(!email.includes('@')||email.includes('/')||email.length>320)fail('invalid-payload','Assignment email is invalid.','invalid-argument');
    if(emails.length){
      const snapshot=await tx.get(db.collection('users').limit(MAX_ASSIGNMENT_DIRECTORY_USERS+1));
      if(snapshot.size>MAX_ASSIGNMENT_DIRECTORY_USERS)fail('assignment-directory-too-large','User directory exceeds the safe assignment validation limit. Contact Admin.','failed-precondition');
      const documents=snapshot.docs.map(doc=>({id:doc.id,data:doc.data()}));
      for(const email of emails)assignmentUsers[email]=resolveProjectAccount(documents,email);
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
  assertAllowedKeys(request.data,['draftId','expectedRevision','weekId','expectedPublishedRevision','project','assignment','source','selectedWeekId','historicalCorrection'],'Publish request');
  const data=request.data,db=getFirestore(),withForm=Object.hasOwn(data,'project');
  const weekId=safeId(data.weekId,'Week');
  if(data.selectedWeekId!==undefined && data.selectedWeekId!==weekId)fail('week-target-mismatch','Selected week and publish target do not match.','failed-precondition');
  if(data.historicalCorrection!==undefined && data.historicalCorrection!==true)fail('invalid-payload','Historical correction confirmation must be explicit.','invalid-argument');
  if(data.historicalCorrection===true && (Object.hasOwn(data,'assignment') || data.assignment!==undefined))fail('assignment-forbidden','Historical corrections cannot change assignment.');
  if(withForm && data.selectedWeekId!==weekId)fail('week-target-mismatch','Reopen the editor to confirm the selected reporting week.','failed-precondition');
  if(withForm) safeId(data.draftId); // Stable identity makes first-publication retries safe.
  if(data.expectedPublishedRevision!==null && typeof data.expectedPublishedRevision!=='string')fail('invalid-payload','Official revision is required.','invalid-argument');
  const requestDigest=withForm?publicationDigest(JSON.stringify({actorUid:request.auth?.uid || '',data})):null;
  return db.runTransaction(async tx=>{
    const actor=await readActor(tx,db,request);
    const found=withForm?await mutationDraft(tx,db,actor,data):await readDraft(tx,db,actor,data.draftId);
    const weekRef=db.collection('weeks').doc(weekId),snapshot=await tx.get(weekRef),week=snapshot.exists?snapshot.data():null;
    const weeksSnapshot=await tx.get(db.collection('weeks'));
    const ordered=sortWeeksChronologically(weeksSnapshot.docs.map(doc=>({...doc.data(),__documentId:doc.id})));
    const latest=ordered[latestValidWeekIndex(ordered)];
    const {planDraftPublication}=require('./project-drafts-core');
    const historical=Boolean(latest && latest.__documentId!==weekId);
    if(!historical && data.historicalCorrection===true)fail('week-target-mismatch','This is not a historical target. Reopen the editor.','failed-precondition');
    if(historical && (!withForm || data.historicalCorrection!==true || data.selectedWeekId!==weekId))fail('historical-week','Confirm the selected historical reporting week before publishing.','failed-precondition');
    if(historical){
      if(Object.hasOwn(data,'assignment') || data.assignment!==undefined)fail('assignment-forbidden','Historical corrections cannot change assignment.');
      const original=found.draft;
      if(!original || data.expectedRevision!==original.revision)fail('conflict','Draft revision conflict. Reload before publishing.','aborted');
      const live=(week?.projects||[]).filter(p=>p.publication?.draftId===original.draftId || (original.source?.weekId===weekId && p.code===original.source.projectCode));
      if(live.length!==1)fail('conflict','The selected historical project is missing or ambiguous.','aborted');
      assertSourceOwnership(actor,live[0]);
      if(week.isReleased===true)fail('released-week','Released reporting weeks cannot be corrected.','failed-precondition');
      const fingerprint=require('./project-dashboard-writes').projectRevisionFingerprint(live[0]);
      const prior=original.publicationTargets?.[weekId];
      if(prior?.correctionRequestDigest===requestDigest && prior.correctionActorUid===actor.uid && prior.projectRevision===publicationDigest(fingerprint))return {weekId,project:live[0],projectRevision:fingerprint,draftRevision:original.revision,publishedAt:live[0].publication.publishedAt,alreadyPublished:true,draft:publicDraft(original)};
      const assignmentUsers=await assignmentDirectory(tx,db,actor,data);
      const {weekId:ignoredWeek,selectedWeekId:ignoredSelected,historicalCorrection:ignoredCorrection,expectedPublishedRevision:ignoredRevision,...saveInput}=data;
      const {PROJECT_KEYS}=require('./project-drafts-core');
      const baselineProject=Object.fromEntries(PROJECT_KEYS.filter(k=>Object.hasOwn(live[0],k)).map(k=>[k,live[0][k]]));
      const staged=buildDraftRecord({actor,existing:{...original,project:baselineProject},input:saveInput,assignmentUsers,draftId:found.ref.id,nowIso:new Date().toISOString()});
      staged.revision=original.revision;
      const result=planDraftPublication({actor,draft:staged,week,input:{...data,historicalCorrection:true},nowIso:new Date().toISOString()});
      const target={...result.draftPatch.publicationTargets[weekId],historicalCorrection:true,correctionRequestDigest:requestDigest,correctionActorUid:actor.uid};
      tx.update(weekRef,result.weekPatch);
      const nowIso=new Date().toISOString();
      const draftRecord=found.persisted?null:{
        schemaVersion:1,
        draftId:original.draftId,
        revision:0,
        project:original.project,
        source:original.source,
        assignment:original.assignment,
        editorEmails:original.editorEmails,
        createdAt:original.createdAt || nowIso,
        createdBy:original.createdBy || actor.email,
        updatedAt:nowIso,
        updatedBy:actor.email,
        lastPublication:original.lastPublication,
        publicationTargets:{...original.publicationTargets,[weekId]:target}
      };
      if(found.persisted){
        tx.update(found.ref,{publicationTargets:{...original.publicationTargets,[weekId]:target}});
      }else{
        tx.set(found.ref,draftRecord);
      }
      tx.create(db.collection('projectDraftPublicationAudit').doc(),{...result.audit,historicalCorrection:true,requestDigest,previousProjectRevision:publicationDigest(fingerprint),projectRevision:target.projectRevision});
      return {weekId,project:result.project,projectRevision:result.projectRevision,draftRevision:original.revision,publishedAt:result.publishedAt,alreadyPublished:false,draft:publicDraft(found.persisted?original:draftRecord)};
    }
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
      const {weekId:ignoredWeek,selectedWeekId:ignoredSelected,historicalCorrection:ignoredCorrection,expectedPublishedRevision:ignoredRevision,...saveInput}=data;
      draft=buildDraftRecord({actor,existing:draft,input:saveInput,assignmentUsers,draftId:found.ref.id,nowIso});
    }
    const result=planDraftPublication({actor,draft,week,input:{...data,expectedRevision:withForm?draft.revision:data.expectedRevision},nowIso});
    if(!latest)fail('historical-week','No valid reporting week exists.','failed-precondition');
    if(!result.alreadyPublished){
      tx.update(weekRef,result.weekPatch);
      if(withForm){
        draft={...draft,...result.draftPatch,lastSaveAndPublish:{requestDigest,actorUid:actor.uid,draftRevision:draft.revision}};
        tx.set(found.ref,draft);
      }else tx.update(found.ref,result.draftPatch);
      tx.create(db.collection('projectDraftPublicationAudit').doc(),result.audit);
    }
    return {weekId,project:result.project,projectRevision:result.projectRevision,draftRevision:draft.revision,publishedAt:result.publishedAt,alreadyPublished:result.alreadyPublished,...(withForm?{draft:publicDraft(draft)}:{})};
  });
});
module.exports.publishDashboardProjectDraft=publishDashboardProjectDraft;
