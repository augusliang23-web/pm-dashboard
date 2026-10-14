const { onCall } = require('firebase-functions/v2/https');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { buildAuthenticatedActor, assertAllowedKeys, assertBoundedJson } = require('./project-dashboard-writes');
const { assertDraftEnvironment } = require('./draft-environment');
const { emailKey, fail, assertDraftAccess, buildDraftRecord, publicDraft } = require('./project-drafts-core');
const OPTIONS={serviceAccount:'pmdash-project-drafts@',maxInstances:20};
function safeId(value,label='Draft') {
  if(typeof value!=='string'||!value||value.length>128||/[\/\x00-\x1f]/.test(value)||['.','..','__proto__','constructor','prototype'].includes(value))fail('invalid-payload',`${label} identifier is invalid.`,'invalid-argument');
  return value;
}
function requestData(request,keys){assertDraftEnvironment();assertBoundedJson(request.data);assertAllowedKeys(request.data,keys,'Draft request');return request.data;}
async function readActor(tx,db,request){
  const email=emailKey(request.auth?.token?.email),uid=request.auth?.uid;
  if(!uid||!email)fail('unauthenticated','Sign in before using drafts.','unauthenticated');
  const user=await tx.get(db.collection('users').doc(email));
  if(!user.exists)fail('role-forbidden','Draft permission is required.');
  const permission=await tx.get(db.collection('userPermissions').doc(email));
  const actor=buildAuthenticatedActor({uid,email},user.data(),permission.exists?permission.data():null);
  assertDraftAccess(actor,null,'read');
  return actor;
}
async function readDraft(tx,db,actor,draftId){
  const ref=db.collection('projectDrafts').doc(safeId(draftId));const snapshot=await tx.get(ref);
  if(!snapshot.exists)fail('draft-forbidden','Draft is unavailable.');
  const draft=snapshot.data();assertDraftAccess(actor,draft,'read');return {ref,draft};
}
const getDashboardProjectDraft=onCall(OPTIONS,async request=>{
  const data=requestData(request,['draftId']),db=getFirestore();
  return db.runTransaction(async tx=>{const actor=await readActor(tx,db,request);const {draft}=await readDraft(tx,db,actor,data.draftId);return {draft:publicDraft(draft)};});
});
const saveDashboardProjectDraft=onCall(OPTIONS,async request=>{
  const data=requestData(request,['draftId','expectedRevision','project','assignment']),db=getFirestore();
  return db.runTransaction(async tx=>{
    const actor=await readActor(tx,db,request);
    const found=data.draftId?await readDraft(tx,db,actor,data.draftId):{ref:db.collection('projectDrafts').doc(),draft:null};
    const assignmentUsers={};
    if(data.assignment){
      if(actor.role!=='admin')fail('assignment-forbidden','Only Admin has permission to change assignment.');
      assertAllowedKeys(data.assignment,['ownerEmail','deputyEmail'],'Assignment');
      for(const value of Object.values(data.assignment)){
        const email=emailKey(value);if(!email)continue;
        if(!email.includes('@')||email.includes('/')||email.length>320)fail('invalid-payload','Assignment email is invalid.','invalid-argument');
        const user=await tx.get(db.collection('users').doc(email));
        assignmentUsers[email]=user.exists?user.data():null;
      }
    }
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
    const drafts=docs.map(doc=>{const draft=doc.data();assertDraftAccess(actor,draft,'read');return publicDraft(draft);});
    return {drafts,nextCursor:snapshot.docs.length>maximum?{email:actor.email,role:actor.role,draftId:last.id,updatedAt:last.data().updatedAt}:null};
  });
});
module.exports={safeId,requestData,readActor,readDraft,OPTIONS,getDashboardProjectDraft,saveDashboardProjectDraft,listDashboardProjectDrafts};

const publishDashboardProjectDraft=onCall(OPTIONS,async request=>{
  assertDraftEnvironment();
  assertBoundedJson(request.data,{maxStringLength:256*1024});
  assertAllowedKeys(request.data,['draftId','expectedRevision','weekId','expectedPublishedRevision'],'Publish request');
  const data=request.data,db=getFirestore();
  const weekId=safeId(data.weekId,'Week');
  if(data.expectedPublishedRevision!==null && typeof data.expectedPublishedRevision!=='string')fail('invalid-payload','Official revision is required.','invalid-argument');
  return db.runTransaction(async tx=>{
    const actor=await readActor(tx,db,request),{ref,draft}=await readDraft(tx,db,actor,data.draftId);
    const weekRef=db.collection('weeks').doc(weekId),snapshot=await tx.get(weekRef);
    const {planDraftPublication}=require('./project-drafts-core');
    const result=planDraftPublication({actor,draft,week:snapshot.exists?snapshot.data():null,input:data,nowIso:new Date().toISOString()});
    if(!result.alreadyPublished){
      tx.update(weekRef,result.weekPatch);tx.update(ref,result.draftPatch);
      tx.create(db.collection('projectDraftPublicationAudit').doc(),result.audit);
    }
    return {weekId,project:result.project,projectRevision:result.projectRevision,draftRevision:draft.revision,publishedAt:result.publishedAt,alreadyPublished:result.alreadyPublished};
  });
});
module.exports.publishDashboardProjectDraft=publishDashboardProjectDraft;
