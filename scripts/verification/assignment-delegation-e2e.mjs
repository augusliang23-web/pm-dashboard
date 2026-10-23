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
const mode='hotfix';
const functional=process.argv.includes('--functional');
const out=resolve(root,'tmp/assignment-delegation'); await mkdir(out, { recursive: true });
const emails = { admin:'sprint.admin@example.test', pm:'sprint.pm@example.test', other:'sprint.other@example.test', vip:'sprint.vip@example.test' };
// Local emulator password is supplied through an environment variable, never placed in QA reports.
const password = process.env.SPRINT_TEST_PASSWORD; assert.ok(password, 'Set SPRINT_TEST_PASSWORD for synthetic users');
const tokens = {}, results = [], measurements = [], pageErrors = [];
async function invoke(name, data, role='admin') {
  const response = await fetch(`http://127.0.0.1:5108/${projectId}/us-central1/${name}`, { method:'POST', headers:{'Content-Type':'application/json', ...(role?{Authorization:`Bearer ${tokens[role]}`}:{})}, body:JSON.stringify({data}) });
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
  await db.collection('dashboardSettings').doc('team-2-portfolio').set({ganttTemplates:{system:['Planning','Delivery'],'hardware-module':['EVT'],software:['Development']},revision:'fixture'});
  await db.collection('releaseCapabilities').doc('v231').set({schemaVersion:1,projectId,drafts:true,archiveRecovery:true,enforceDraftPublish:true});
  const assignment={ownerEmail:emails.pm,deputyEmail:''};
  const saved=await invoke('saveDashboardProjectDraft',{expectedRevision:0,assignment,project:{name:'Synthetic Published',code:'PUBLISHED',progress:45,visibility:'active'}});
  await invoke('publishDashboardProjectDraft',{draftId:saved.draft.draftId,expectedRevision:saved.draft.revision,weekId:'W43',expectedPublishedRevision:null});
  const draft=await invoke('saveDashboardProjectDraft',{expectedRevision:0,assignment,project:{name:'Synthetic Draft',code:'DRAFT',progress:55,visibility:'active'}});
  return draft.draft.draftId;
}
const CAP='project.assignment.delegate';
const check=async(name,fn)=>{await fn();results.push({name,status:'PASS'});console.log('PASS',name);};
const sites={};for(const profile of ['prod','uat']){sites[profile]=resolve(root,'tmp/delegation-'+profile);await buildHosting({rootDir:root,outDir:sites[profile],env:await loadHostingEnv(root,profile)});}
const server=createServer(async(req,res)=>{try{const [,profile,...parts]=new URL(req.url,'http://localhost').pathname.split('/'),site=sites[profile],path=resolve(site,parts.join('/')||'index.html');if(!path.startsWith(site+'/'))return res.writeHead(403).end();res.setHeader('Content-Type',extname(path)==='.html'?'text/html':/\.m?js$/.test(path)?'text/javascript':'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(4198,'127.0.0.1',r));let browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const wait=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await sleep(100);}throw Error('Timed out waiting for synthetic committed result');};
try{
 browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-setuid-sandbox']});
 for(const profile of ['prod','uat']){
 await seed();const contexts=[];
 const login=async role=>{const context=await browser.createBrowserContext();contexts.push(context);const page=await context.newPage();await page.setViewport({width:1440,height:1100});page.on('pageerror',e=>pageErrors.push(e.message));
 await page.setRequestInterception(true);page.on('request',async r=>{if(page.slowDraftList&&r.url().endsWith('/listDashboardProjectDrafts'))await sleep(1500);const u=new URL(r.url());if(['127.0.0.1','localhost','www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname)||u.protocol==='data:')r.continue();else r.abort();});
 await page.goto(`http://127.0.0.1:4198/${profile}/?emulator=1&firestorePort=8188&authPort=9198&functionsPort=5108`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.handleLogin==='function'&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');await page.type('#email',emails[role]);await page.type('#password',password);await page.click('#loginOverlay button');await page.waitForFunction(()=>document.querySelector('#syncDot')?.classList.contains('ok')&&document.querySelector('#bannerTitle')?.textContent.includes('W43')&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');return page;};
 const fill=(page,id,value)=>page.$eval(id,(e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));},value);
 const admin=await login('admin'),row=`[data-capability="${CAP}"]`;
 await check(profile+' Admin-only switch default OFF and audited grant',async()=>{
 await assert.rejects(invoke('setUserPermissionOverrides',{targetEmail:emails.pm,expectedRevision:0,changes:{[CAP]:true}},'pm'));
 await assert.rejects(invoke('setUserPermissionOverrides',{targetEmail:emails.vip,expectedRevision:0,changes:{[CAP]:true}},'admin'));
 const draft=(await invoke('getDashboardProjectDraft',{source:{weekId:'W43',projectCode:'SOURCE'}},'pm')).draft;
 await assert.rejects(invoke('saveDashboardProjectDraft',{draftId:draft.draftId,source:draft.source,expectedRevision:0,project:{},assignment:{ownerEmail:emails.other}},'pm'));
 await admin.click('#userPermissionsBtn');await admin.waitForSelector('#userPermissionsOverlay.open');await admin.waitForFunction(email=>[...document.querySelector('#userPermissionsUserSelect').options].some(o=>o.value===email),{},emails.pm);await admin.select('#userPermissionsUserSelect',emails.pm);await admin.waitForSelector(row+' input');assert.equal(await admin.$eval(row+' input',e=>e.checked),false);
 await admin.click(row+' .permission-switch');await wait(async()=>(await db.collection('userPermissions').doc(emails.pm).get()).data()?.overrides?.[CAP]===true);await admin.waitForFunction(selector=>!document.querySelector(selector).disabled,{},row+' input');assert.equal((await db.collection('userPermissionAudit').get()).size,1);await admin.screenshot({path:resolve(out,profile+'-permission-on.png'),fullPage:false});
 });
 const a=await login('pm');let draft;
 await check(profile+' delegated stage / invalid targets / unrelated denial',async()=>{
 await a.evaluate(()=>window.openProjEdit('SOURCE'));await a.waitForSelector('#projEditOverlay.open');assert.equal(await a.$eval('#pe_owner',e=>e.disabled),false);assert.equal(await a.$eval('#pe_deputy',e=>e.disabled),true);assert.equal(await a.$$eval('#pe_owner option',o=>o.some(e=>e.value==='sprint.admin@example.test')),false);
 const original=(await invoke('getDashboardProjectDraft',{source:{weekId:'W43',projectCode:'SOURCE'}},'pm')).draft;
 for(const target of [emails.admin,emails.vip,'missing@example.test'])await assert.rejects(invoke('saveDashboardProjectDraft',{draftId:original.draftId,source:original.source,expectedRevision:0,project:{},assignment:{ownerEmail:target}},'pm'));
 await assert.rejects(invoke('getDashboardProjectDraft',{source:{weekId:'W43',projectCode:'SOURCE'}},'other'));
 await a.select('#pe_owner',emails.other);await fill(a,'#pe_highlight','Synthetic staged handoff');await a.click('#pe_btn_save');await wait(async()=>{const snap=await db.collection('projectDrafts').doc(original.draftId).get();draft=snap.data();return draft?.pendingAssignment?.ownerEmail===emails.other;});
 assert.equal(draft.assignment.ownerEmail,emails.pm);assert.equal(draft.project.owner,'Sprint PM');assert.equal((await db.collection('weeks').doc('W43').get()).data().projects.find(p=>p.code==='SOURCE').owner,'Sprint PM');await assert.rejects(invoke('getDashboardProjectDraft',{draftId:draft.draftId},'other'));
 await a.waitForFunction(()=>document.querySelector('#projectDraftStatus').textContent.includes('Pending Project Manager'));await a.screenshot({path:resolve(out,profile+'-staged-owner.png'),fullPage:false});
 });
 await check(profile+' revoke blocks publication and preserves staged form',async()=>{
 await admin.click(row+' .permission-switch');await wait(async()=>(await db.collection('userPermissions').doc(emails.pm).get()).data()?.overrides?.[CAP]!==true);await admin.waitForFunction(selector=>!document.querySelector(selector).disabled,{},row+' input');
 await fill(a,'#pe_progress',78);await a.click('#pe_btn_publish');await a.waitForSelector('#projectMutationError.show');assert.equal(await a.$eval('#projEditOverlay',e=>e.classList.contains('open')),true);assert.equal(await a.$eval('#pe_progress',e=>e.value),'78');assert.equal((await db.collection('weeks').doc('W43').get()).data().projects.find(p=>p.code==='SOURCE').owner,'Sprint PM');assert.equal(await a.$eval('#saveToast',e=>e.classList.contains('show')),false);
 await admin.click(row+' .permission-switch');await wait(async()=>(await db.collection('userPermissions').doc(emails.pm).get()).data()?.overrides?.[CAP]===true);await admin.waitForFunction(selector=>!document.querySelector(selector).disabled,{},row+' input');
 });
 let publishData;
 a.on('request',r=>{if(r.url().endsWith('/publishDashboardProjectDraft')&&r.postData())publishData=JSON.parse(r.postData()).data;});
 await check(profile+' publish atomically hands over; former owner denied; limited retry receipt',async()=>{
 a.slowDraftList=true;const started=Date.now();await a.evaluate(()=>{window.saveAndPublishProjectDraft();window.openMyDrafts();});await a.waitForFunction(()=>!document.querySelector('#projEditOverlay').classList.contains('open'));assert.ok(Date.now()-started<1400,'transfer response must survive the delayed list refresh');a.slowDraftList=false;assert.match(await a.$eval('#saveToast',e=>e.textContent),/transferred/i);
 const official=(await db.collection('weeks').doc('W43').get()).data().projects.find(p=>p.code==='SOURCE');assert.equal(official.owner,'Sprint other');assert.equal(official.progress,78);assert.equal(official.highlight,'Synthetic staged handoff');const stored=(await db.collection('projectDrafts').doc(draft.draftId).get()).data();assert.equal(stored.assignment.ownerEmail,emails.other);assert.ok(!stored.editorEmails.includes(emails.pm));assert.equal('pendingAssignment'in stored,false);
 await assert.rejects(invoke('getDashboardProjectDraft',{draftId:draft.draftId},'pm'));await assert.rejects(invoke('getDashboardProjectDraft',{source:{weekId:'W43',projectCode:'SOURCE'}},'pm'));const retry=await invoke('publishDashboardProjectDraft',publishData,'pm');assert.equal(retry.alreadyPublished,true);assert.equal('draft'in retry,false);assert.equal('project'in retry,false);
 });
 const b=await login('other');
 await check(profile+' recipient resume/save/publish and revoke does not revert completed handoff',async()=>{
 await b.evaluate(id=>window.openManagedProjectDraft(id),draft.draftId);await b.waitForSelector('#projEditOverlay.open');assert.equal(await b.$eval('#pe_progress',e=>e.value),'78');assert.equal(await b.$eval('#pe_owner',e=>e.disabled),true);assert.equal(await b.$eval('#userPermissionsBtn',e=>getComputedStyle(e).display==='none'),true);
 await fill(b,'#pe_progress',83);await b.click('#pe_btn_publish');await wait(async()=>(await db.collection('weeks').doc('W43').get()).data().projects.find(p=>p.code==='SOURCE').progress===83);
 await admin.click(row+' .permission-switch');await wait(async()=>(await db.collection('userPermissions').doc(emails.pm).get()).data()?.overrides?.[CAP]!==true);assert.equal((await db.collection('weeks').doc('W43').get()).data().projects.find(p=>p.code==='SOURCE').owner,'Sprint other');assert.equal((await db.collection('userPermissionAudit').get()).size,4);
 await b.screenshot({path:resolve(out,profile+'-recipient-editor.png'),fullPage:false});
 });
 for(const context of contexts)await context.close();
 }
 assert.deepEqual(pageErrors,[]);
}finally{await writeFile(resolve(out,'results.json'),JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),results,pageErrors},null,2));await browser?.close();await new Promise(r=>server.close(r));}
