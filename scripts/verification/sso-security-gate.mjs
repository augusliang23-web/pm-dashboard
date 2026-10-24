// Synthetic, isolated Firestore emulator ONLY. No external OAuth or live token is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc} from 'firebase/firestore';
import {loadAuthorizedReport} from '../../pdf-service/src/report-data.js';
const projectId='demo-pm-dashboard-v22t';
assert.equal(process.env.GCLOUD_PROJECT,projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8081');
process.env.FUNCTIONS_EMULATOR='true'; // Required only for the asserted demo runtime; never activates a live project.
const email='sso.admin@example.test',uid='sso-admin';
const passwordClaims={email,firebase:{sign_in_provider:'password'}};
const googleClaims={email,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':['approved-sub']}}};
const record={role:'admin',displayName:'SSO Admin',authUid:uid,googleSubject:'approved-sub'};
const results=[];
for(const rulesFile of ['firestore.rules','firestore.uat.rules','firestore.shared-backend.rules'])test(rulesFile+' enforces UID/provider binding before dashboard data',async()=>{
 const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8081,rules:readFileSync(rulesFile,'utf8')}});
 try{
  await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'users',email),record);await setDoc(doc(db,'weeks','W43'),{isReleased:false,projects:[]});await setDoc(doc(db,'userPermissions',email),{overrides:{}});});
  for(const claims of [passwordClaims,googleClaims])await assertSucceeds(getDoc(doc(env.authenticatedContext(uid,claims).firestore(),'weeks','W43')));
  for(const [wrongUid,claims]of [['other-uid',passwordClaims],['other-uid',googleClaims],[uid,{...googleClaims,email_verified:false}],[uid,{...googleClaims,firebase:{sign_in_provider:'google.com',identities:{'google.com':['other-sub']}}}],[uid,{email,firebase:{sign_in_provider:'custom'}}]]){
   const db=env.authenticatedContext(wrongUid,claims).firestore();
   for(const path of ['weeks/W43','users/'+email,'userPermissions/'+email])await assertFails(getDoc(doc(db,path)));
  }
  for(const patch of [{authUid:''},{authUid:'other-uid'},{active:false},{googleSubject:''}]){
   await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'users',email),{...record,...patch}));
   await assertFails(getDoc(doc(env.authenticatedContext(uid,googleClaims).firestore(),'weeks','W43')));
  }
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'users',email),record));
  await assertFails(setDoc(doc(env.authenticatedContext(uid,passwordClaims).firestore(),'users',email),{...record,authUid:'attacker'}));
  results.push({name:rulesFile,status:'PASS'});
 }finally{await env.cleanup();}
});
test('all 24 authenticated callable entrypoints deny mismatched UID before business access',async()=>{
 const require=createRequire(new URL('../../functions/package.json',import.meta.url));
 const callables=require('./index.js');
 const {getFirestore}=require('firebase-admin/firestore');const db=getFirestore();
 await db.collection('users').doc(email).set(record);
 await db.collection('releaseCapabilities').doc('v231').set({schemaVersion:1,projectId,drafts:true,archiveRecovery:true,enforceDraftPublish:true});
 const sync=require('./production-week-sync.js');
 Object.assign(callables,sync.createCallableHandlers({onCall:(_,fn)=>({run:fn}),environment:{GCLOUD_PROJECT:'pm-dashboard-uat-20260820-a7f3'},getUatDb:()=>db,getProductionDb:()=>{throw Error('No production access allowed');}}));
 const entries=Object.entries(callables).filter(([name,v])=>name!=='aggregatePresenceSessions'&&typeof v?.run==='function');assert.equal(entries.length,24);
 for(const [name,handler]of entries){
  const data=name==='getDashboardProjectDraft'?{capabilities:true}:name==='publishDashboardProjectDraft'?{weekId:'W43',draftId:'test',expectedRevision:1,expectedPublishedRevision:null}:name==='restoreUatWeeksSnapshot'?{snapshotId:'synthetic'}:{};
  const extra={withdrawExecutiveMilestoneChangeRequest:{requestId:'synthetic'},decideExecutiveMilestoneChangeRequest:{requestId:'synthetic',decision:'approve'},saveExecutiveMilestoneTimelineConfig:{expectedVersion:1,reason:'synthetic'},initializeExecutiveMilestoneLiveTimeline:{sourceWeekId:'W43'},setExecutiveRagOverride:{scope:'section',targetId:'synthetic',reason:'synthetic',rag:null}}[name]||{};
  await assert.rejects(()=>handler.run({auth:{uid:'unapproved-uid',token:googleClaims},data:{...data,...extra}}),e=>{assert.equal(e.code,'permission-denied',name+': '+e.message);assert.equal(e.details?.reason,'identity-binding-mismatch',name);return true;});
  results.push({name,status:'PASS'});
 }
 // No business write path was entered.
 assert.equal((await db.collection('projectDrafts').get()).size,0);
});
test('PM email role cannot be inherited by another UID at the actual draft callable',async()=>{
 const require=createRequire(new URL('../../functions/package.json',import.meta.url));const {getFirestore}=require('firebase-admin/firestore');const db=getFirestore();
 await db.collection('users').doc('sso.pm@example.test').set({authUid:'approved-pm',role:'pm',displayName:'PM'});
 await assert.rejects(()=>require('./project-drafts.js').getDashboardProjectDraft.run({auth:{uid:'other-pm',token:{email:'sso.pm@example.test',firebase:{sign_in_provider:'password'}}},data:{capabilities:true}}),e=>e.details?.reason==='identity-binding-mismatch');
 results.push({name:'PM callable UID isolation',status:'PASS'});
});
test('PDF denies wrong UID/unapproved Google before reading any reporting week',async()=>{
 let reads=0;
 const adapters={verifyIdToken:async()=>({uid:'wrong',...googleClaims}),getUserByEmail:async()=>record,getWeekById:async()=>{reads++;return {isReleased:true,projects:[]};}};
 await assert.rejects(()=>loadAuthorizedReport({request:{mode:'overview',weekId:'W43',sections:[]},idToken:'synthetic-not-a-token',adapters}),/identity-binding-mismatch/);assert.equal(reads,0);
 adapters.verifyIdToken=async()=>({uid,...googleClaims});adapters.getUserByEmail=async()=>({...record,googleSubject:'other'});
 await assert.rejects(()=>loadAuthorizedReport({request:{mode:'overview',weekId:'W43',sections:[]},idToken:'synthetic-not-a-token',adapters}),/identity-google-unapproved/);assert.equal(reads,0);
 results.push({name:'pdf binding before data read',status:'PASS'});
});
process.on('beforeExit',()=>{mkdirSync('tmp/sso-google-v1',{recursive:true});writeFileSync('tmp/sso-google-v1/security-gate.json',JSON.stringify({results,evidence:'Rules real emulator; callables actual .run handlers with synthetic auth context; PDF real loader with synthetic verified-token adapter'},null,2));});
