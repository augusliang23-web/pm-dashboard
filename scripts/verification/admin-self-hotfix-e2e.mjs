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
const out=resolve(root,'tmp/admin-self-hotfix'); await mkdir(out, { recursive: true });
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
await seed();
await db.collection('users').doc('another.admin@example.test').set({role:'admin',displayName:'Other Admin'});
try{await auth.createUser({email:'another.admin@example.test',password,emailVerified:true});}catch(e){if(e.code!=='auth/email-already-exists')throw e;}
const otherSigned=await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'another.admin@example.test',password,returnSecureToken:true})}).then(r=>r.json());tokens.second=otherSigned.idToken;
await db.collection('users').doc('invalid@example.test').set({role:'vip',displayName:'Invalid PM'});
const check=async(name,fn)=>{await fn();results.push({name,status:'PASS'});console.log('PASS',name);};
const project={name:'Backend Self',code:'API-SELF',progress:40,projectLevel:'system',visibility:'active'};
await check('backend A-G create/save/publish/reopen/republish and PM contracts',async()=>{
 let {draft}=await invoke('saveDashboardProjectDraft',{expectedRevision:0,project,assignment:{ownerEmail:emails.admin}});
 assert.equal(draft.project.owner,'Sprint admin');assert.equal(draft.assignment.ownerEmail,emails.admin);
 let result=await invoke('publishDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:draft.revision,weekId:'W43',expectedPublishedRevision:null});
 draft=(await invoke('getDashboardProjectDraft',{draftId:draft.draftId})).draft;
 const live=(await db.collection('weeks').doc('W43').get()).data().projects.find(p=>p.code===project.code);
 const {projectRevisionFingerprint}=await import('../../js/project-mutations.mjs');
 result=await invoke('publishDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:draft.revision,project:{progress:67},weekId:'W43',expectedPublishedRevision:projectRevisionFingerprint(live)});
 assert.equal(result.project.owner,'Sprint admin');assert.equal(result.project.progress,67);
 await assert.rejects(invoke('saveDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:0,project:{progress:99}}));
 const pm=await invoke('saveDashboardProjectDraft',{expectedRevision:0,project:{...project,code:'PM-SELF'}},'pm');assert.equal(pm.draft.assignment.ownerEmail,emails.pm);
 const delegated=await invoke('saveDashboardProjectDraft',{expectedRevision:0,project:{...project,code:'PM-ASSIGNED'},assignment:{ownerEmail:emails.pm}});assert.equal(delegated.draft.assignment.ownerEmail,emails.pm);
 await assert.rejects(invoke('getDashboardProjectDraft',{draftId:draft.draftId},'other'));
});
for(const [name,role,assignment,extra] of [
 ['other Admin','admin',{ownerEmail:'another.admin@example.test'},{}],['PM assigning Admin','pm',{ownerEmail:emails.admin},{}],['VIP','vip',{ownerEmail:emails.admin},{}],['forged role','pm',{ownerEmail:emails.admin},{role:'admin'}],['missing target','admin',{ownerEmail:'missing@example.test'},{}],['invalid role','admin',{ownerEmail:'invalid@example.test'},{}],['deputy Admin','admin',{ownerEmail:emails.pm,deputyEmail:emails.admin},{}],['anonymous',null,{ownerEmail:emails.admin},{}]
])await check(`backend rejects ${name} on save AND publish without writes`,async()=>{
 const before=(await db.collection('projectDrafts').get()).size,week=(await db.collection('weeks').doc('W43').get()).data();
 const input={expectedRevision:0,project:{...project,code:'DENY'},assignment,...extra};
 await assert.rejects(invoke('saveDashboardProjectDraft',input,role));await assert.rejects(invoke('publishDashboardProjectDraft',{...input,weekId:'W43',expectedPublishedRevision:null},role));
 assert.equal((await db.collection('projectDrafts').get()).size,before);assert.deepEqual((await db.collection('weeks').doc('W43').get()).data(),week);
});
const sites={};for(const profile of ['prod','uat']){sites[profile]=resolve(root,'tmp/admin-self-'+profile);await buildHosting({rootDir:root,outDir:sites[profile],env:await loadHostingEnv(root,profile)});}
const server=createServer(async(req,res)=>{try{const [,,...parts]=new URL(req.url,'http://localhost').pathname.split('/'),profile=new URL(req.url,'http://localhost').pathname.split('/')[1],site=sites[profile],path=resolve(site,parts.join('/')||'index.html');if(!path.startsWith(site+'/'))return res.writeHead(403).end();res.setHeader('Content-Type',extname(path)==='.html'?'text/html':/\.m?js$/.test(path)?'text/javascript':'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(4198,'127.0.0.1',r));let browser;
try{
 browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-setuid-sandbox']});
 for(const profile of ['prod','uat'])await check(`${profile} browser create/save/publish/reopen/relogin/week/edit`,async()=>{
 const context=await browser.createBrowserContext(),page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));await page.setViewport({width:1440,height:1100});
 await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(['127.0.0.1','localhost','www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname)||u.protocol==='data:')r.continue();else r.abort();});
 const fill=(id,value)=>page.$eval(id,(e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));},value);
 const ready=()=>page.waitForFunction(()=>document.querySelector('#syncDot')?.classList.contains('ok')&&document.querySelector('#bannerTitle')?.textContent.includes('W43')&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');
 const login=async()=>{await page.waitForFunction(()=>typeof window.handleLogin==='function'&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');await fill('#email',emails.admin);await fill('#password',password);await page.click('#loginOverlay button');await ready();};
 const code='SELF-'+profile.toUpperCase(),wait=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+code);};
 await page.goto(`http://127.0.0.1:4198/${profile}/?emulator=1&firestorePort=8188&authPort=9198&functionsPort=5108`,{waitUntil:'domcontentloaded'});await login();
 await page.click('#addProjectBtn');await page.waitForSelector('#projEditOverlay.open');await page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')!=='true');
 const options=await page.$$eval('#pe_owner option',o=>o.map(e=>({value:e.value,text:e.textContent})));assert.equal(options.filter(o=>o.value===emails.admin).length,1);assert.ok(options.find(o=>o.value===emails.admin).text.includes('Sprint admin'));assert.ok(!options.some(o=>o.value==='another.admin@example.test'));assert.equal(await page.$$eval('#pe_deputy option',o=>o.some(e=>e.value==='sprint.admin@example.test')),false);
 await fill('#pe_name',code);await fill('#pe_code',code);await page.select('#pe_owner',emails.admin);await page.click('#pe_btn_save');
 let draft;await wait(async()=>{const docs=await db.collection('projectDrafts').get();draft=docs.docs.map(d=>d.data()).find(d=>d.project.code===code);return draft;});assert.equal(draft.assignment.ownerEmail,emails.admin);
 await page.waitForFunction(()=>!document.querySelector('#pe_btn_publish').disabled);await page.click('#pe_btn_publish');await wait(async()=>(await db.collection('weeks').doc('W43').get()).data().projects.some(p=>p.code===code));
 await page.waitForFunction(()=>!document.querySelector('#pe_btn_publish').disabled);await page.evaluate(()=>window.closeModal('projEditOverlay',{force:true}));
 await page.reload({waitUntil:'domcontentloaded'});await ready();await page.evaluate(id=>window.openManagedProjectDraft(id),draft.draftId);await page.waitForSelector('#projEditOverlay.open');await page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')!=='true');assert.equal(await page.$eval('#pe_owner',e=>e.value),emails.admin);
 await fill('#pe_progress',73);await page.click('#pe_btn_publish');await wait(async()=>(await db.collection('weeks').doc('W43').get()).data().projects.find(p=>p.code===code)?.progress===73);
 await page.waitForFunction(()=>!document.querySelector('#pe_btn_publish').disabled);await page.evaluate(()=>window.closeModal('projEditOverlay',{force:true}));await page.evaluate(()=>window.handleLogout());await page.waitForSelector('#email',{visible:true});await login();await page.evaluate(()=>{window.navWeek(-1);window.navWeek(1);});await page.evaluate(id=>window.openManagedProjectDraft(id),draft.draftId);await page.waitForSelector('#projEditOverlay.open');await page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')!=='true');assert.equal(await page.$eval('#pe_owner',e=>e.value),emails.admin);
 await page.screenshot({path:resolve(out,profile+'-self-owner.png'),fullPage:false});
 await page.evaluate(()=>window.closeModal('projEditOverlay',{force:true}));await page.evaluate(()=>window.handleLogout());await page.waitForSelector('#email',{visible:true});await fill('#email','another.admin@example.test');await fill('#password',password);await page.waitForFunction(()=>getComputedStyle(document.querySelector('#globalLoader')).display==='none');await page.click('#loginOverlay button');await ready();
 await page.evaluate(id=>window.openManagedProjectDraft(id),draft.draftId);await page.waitForSelector('#projEditOverlay.open');await page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')!=='true');assert.equal(await page.$eval('#pe_owner',e=>e.value),emails.admin);assert.equal(await page.$eval('#pe_owner',e=>e.selectedOptions[0].disabled),true);
 await fill('#pe_progress',74);await page.click('#pe_btn_save');await wait(async()=>(await db.collection('projectDrafts').doc(draft.draftId).get()).data().project.progress===74);assert.equal((await db.collection('projectDrafts').doc(draft.draftId).get()).data().assignment.ownerEmail,emails.admin);
 await context.close();
 });assert.deepEqual(pageErrors,[]);
}finally{await writeFile(resolve(out,'results.json'),JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),results,pageErrors},null,2));await browser?.close();await new Promise(r=>server.close(r));}
