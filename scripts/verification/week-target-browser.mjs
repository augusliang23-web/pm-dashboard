// Auth + Firestore + callable HTTP + actual dashboard. Synthetic emulator ONLY.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildHosting } from '../build-hosting.mjs';
import { loadHostingEnv } from '../hosting-env.mjs';
const root = resolve(new URL('../..', import.meta.url).pathname);
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const puppeteer = createRequire(new URL('../../pdf-service/package.json', import.meta.url))('puppeteer');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const projectId = 'demo-pm-dashboard-v22t';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
const app = initializeApp({ projectId }), db = getFirestore(app), auth = getAuth(app);
const mode = process.argv.includes('--baseline') ? 'baseline' : 'candidate';
const functional=process.argv.includes('--functional');
const out = resolve(root, 'tmp/ux-sprint-01', functional?'flows':mode); await mkdir(out, { recursive: true });
const emails = { admin:'sprint.admin@example.test', pm:'sprint.pm@example.test', other:'sprint.other@example.test', vip:'sprint.vip@example.test' };
// Local emulator password is supplied through an environment variable, never placed in QA reports.
const password = process.env.SPRINT_TEST_PASSWORD; assert.ok(password, 'Set SPRINT_TEST_PASSWORD for synthetic users');
const tokens = {}, results = [], measurements = [], pageErrors = [];
async function invoke(name, data, role='admin') {
  const response = await fetch(`http://127.0.0.1:5108/${projectId}/us-central1/${name}`, { method:'POST', headers:{'Content-Type':'application/json', ...(role?{Authorization:`Bearer ${tokens[role]}`}:{})}, body:JSON.stringify({data:{...data,...(name==='publishDashboardProjectDraft'?{selectedWeekId:data.weekId}:{})}}) });
  const body = await response.json(); if(body.error) throw Object.assign(Error(body.error.message), body.error); return body.result;
}
async function seed() {
  await fetch(`http://127.0.0.1:8188/emulator/v1/projects/${projectId}/databases/(default)/documents`, {method:'DELETE'});
  for(const [role,email] of Object.entries(emails)) {
    try { await auth.createUser({uid:`sprint-${role}`,email,password,emailVerified:true}); } catch(e) { if(e.code!=='auth/email-already-exists' && e.code!=='auth/uid-already-exists') throw e; await auth.updateUser(`sprint-${role}`,{password}); }
    await db.collection('users').doc(email).set({role:role==='other'?'pm':role,displayName:role==='pm'?'Sprint PM':`Sprint ${role}`,isProjectManager:role==='pm'});
    const signed = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})}).then(r=>r.json());
    assert.ok(signed.idToken); tokens[role]=signed.idToken;
  }
  for(let n=30;n<=43;n++) {
    const monday=Date.UTC(2026,0,5)+(n-2)*7*86400000;
    const md=d=>new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
    await db.collection('weeks').doc(`W${n}`).set({weekLabel:`W${n} 2026`,weekDate:`${md(monday)} - ${md(monday+4*86400000)}`,isReleased:n<43,version:1,summary:'Synthetic Sprint fixture',projects:[{code:'SOURCE',name:'Synthetic Source',owner:'Sprint PM',deputy:'',visibility:'active',projectLevel:'system',lifecycle:'active',status:'green',progress:n,attention:'watch',milestones:[],quarterlyMilestones:[],highlight:'Synthetic only'}]});
  }
  await db.collection('users').doc('sprint.other-admin@example.test').set({role:'admin',displayName:'Other synthetic Admin'});
  await db.collection('dashboardSettings').doc('team-2-portfolio').set({ganttTemplates:{system:['Planning','Delivery'],'hardware-module':['EVT'],software:['Development']},revision:'fixture'});
  await db.collection('releaseCapabilities').doc('v231').set({schemaVersion:1,projectId,drafts:true,archiveRecovery:true,enforceDraftPublish:true});
  const assignment={ownerEmail:emails.pm,deputyEmail:''};
  const saved=await invoke('saveDashboardProjectDraft',{expectedRevision:0,assignment,project:{name:'Synthetic Published',code:'PUBLISHED',progress:25,visibility:'active'}});
  await invoke('publishDashboardProjectDraft',{draftId:saved.draft.draftId,expectedRevision:saved.draft.revision,weekId:'W43',expectedPublishedRevision:null});
  const draft=await invoke('saveDashboardProjectDraft',{expectedRevision:0,assignment,project:{name:'Synthetic Draft',code:'DRAFT',progress:55,visibility:'active'}});
  return draft.draft.draftId;
}
await seed();
const oldWeek=(await db.collection('weeks').doc('W43').get()).data();
await db.collection('weeks').doc('W44').set({...oldWeek,weekLabel:'W44 2026',weekDate:'Oct 26 - Oct 30'});
let shared=(await db.collection('projectDrafts').doc(oldWeek.projects.find(p=>p.code==='PUBLISHED').publication.draftId).get()).data();
const fingerprint=require('./project-dashboard-writes.js').projectRevisionFingerprint(oldWeek.projects.find(p=>p.code==='PUBLISHED'));
await invoke('publishDashboardProjectDraft',{draftId:shared.draftId,expectedRevision:shared.revision,weekId:'W44',expectedPublishedRevision:fingerprint});
const before44=(await db.collection('weeks').doc('W44').get()).data();
shared=(await db.collection('projectDrafts').doc(shared.draftId).get()).data();
const site=resolve(root,'tmp/week-target/site'),output=resolve(root,'tmp/week-target/evidence');await mkdir(output,{recursive:true});await buildHosting({rootDir:root,outDir:site,env:await loadHostingEnv(root,'prod')});
const server=createServer(async(req,res)=>{try{const path=resolve(site,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!path.startsWith(site+'/'))return res.writeHead(403).end();const content=await readFile(path);res.setHeader('Content-Type',extname(path)==='.html'?'text/html':/\.m?js$/.test(path)?'text/javascript':'application/octet-stream');res.end(content);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(4198,'127.0.0.1',r));
let browser;try{
 browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-setuid-sandbox']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(!['127.0.0.1','localhost','www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname)&&u.protocol!=='data:')return r.abort();return r.continue();});
 const fill=(sel,v)=>page.$eval(sel,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},v);
 await page.setViewport({width:390,height:1000});await page.goto('http://127.0.0.1:4198/?emulator=1&firestorePort=8188&authPort=9198&functionsPort=5108',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.handleLogin==='function'&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');await fill('#email',emails.admin);await fill('#password',password);await page.click('#loginOverlay button');await page.waitForFunction(()=>document.querySelector('#syncDot')?.classList.contains('ok')&&document.querySelector('#bannerTitle')?.textContent.includes('W44'),{timeout:45000});
 await page.evaluate(()=>window.jumpToWeek(13));await page.waitForFunction(()=>document.querySelector('#bannerTitle')?.textContent.includes('W43'));
 await page.$eval('.proj-card[data-project-code="PUBLISHED"] [data-project-action="edit"]',e=>e.click());await page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')==='false');
 assert.equal(await page.$eval('#pe_progress',e=>e.value),'25');assert.match(await page.$eval('#projectDraftStatus',e=>e.textContent),/Target: W43/);assert.equal(await page.$eval('#pe_btn_save',e=>e.disabled),true);
 await fill('#pe_progress','20');await page.waitForFunction(()=>getComputedStyle(document.querySelector('#globalLoader')).display==='none');
 let confirmation='';const canceled=new Promise(r=>page.once('dialog',async d=>{confirmation=d.message();await d.dismiss();r();}));await page.click('#pe_btn_publish');let cancelTimer;await Promise.race([canceled,new Promise((_,reject)=>cancelTimer=setTimeout(async()=>{console.log('BROWSER_DIAGNOSTIC',JSON.stringify({errors,view:await page.evaluate(()=>({mutation:document.querySelector('#projectMutationError')?.textContent,status:document.querySelector('#projectDraftStatus')?.textContent,buttonDisabled:document.querySelector('#pe_btn_publish')?.disabled,alerts:[...document.querySelectorAll('[role=alert],.resource-validation')].map(e=>e.textContent)}))}));reject(Error('Historical confirmation not reached'));},8000))]);clearTimeout(cancelTimer);assert.match(confirmation,/W43/);assert.deepEqual((await db.collection('weeks').doc('W44').get()).data(),before44);assert.equal((await db.collection('weeks').doc('W43').get()).data().projects.find(p=>p.code==='PUBLISHED').progress,25);
 await page.$eval('#projEditOverlay .modal',e=>e.scrollTop=0);await page.screenshot({path:resolve(output,'historical-target-390.png')});
 page.once('dialog',d=>d.accept());await page.click('#pe_btn_publish');await page.waitForFunction(()=>!document.querySelector('#projEditOverlay').classList.contains('open'),{timeout:30000});
 const w43=(await db.collection('weeks').doc('W43').get()).data(),after44=(await db.collection('weeks').doc('W44').get()).data(),afterDraft=(await db.collection('projectDrafts').doc(shared.draftId).get()).data();
 assert.equal(w43.projects.find(p=>p.code==='PUBLISHED').progress,20);assert.deepEqual(after44,before44);for(const k of ['project','revision','lastPublication','assignment','lastSaveAndPublish'])assert.deepEqual(afterDraft[k],shared[k]);assert.deepEqual(afterDraft.publicationTargets.W44,shared.publicationTargets.W44);assert.deepEqual(errors,[]);
 const correction={draftId:shared.draftId,expectedRevision:shared.revision,weekId:'W43',selectedWeekId:'W43',historicalCorrection:true,expectedPublishedRevision:require('./project-dashboard-writes.js').projectRevisionFingerprint(w43.projects.find(p=>p.code==='PUBLISHED'))};
 const raced=await Promise.allSettled([invoke('publishDashboardProjectDraft',{...correction,project:{progress:22}}),invoke('publishDashboardProjectDraft',{...correction,project:{progress:23}})]);assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal(raced.filter(r=>r.status==='rejected'&&r.reason.details?.reason==='conflict').length,1);
 const current=(await db.collection('weeks').doc('W43').get()).data();await invoke('publishDashboardProjectDraft',{...correction,expectedPublishedRevision:require('./project-dashboard-writes.js').projectRevisionFingerprint(current.projects.find(p=>p.code==='PUBLISHED')),project:{progress:20}});assert.deepEqual((await db.collection('weeks').doc('W44').get()).data(),before44);
 console.log('WEEK_TARGET_CONCURRENT_PASS: one commit and one conflict; later week untouched');
 console.log('WEEK_TARGET_BROWSER_PASS: selected W43 25->20; W44 byte-equivalent 25; cancel safe; later draft and lineage preserved; zero page errors');
 await writeFile(resolve(output,'results.json'),JSON.stringify({selectedWeek:'W43',progress:20,laterWeek:'W44',laterProgress:25,laterWeekUnchanged:true,workingDraftPreserved:true,confirmation,errors},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));await app.delete();}
