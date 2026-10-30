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
  const response = await fetch(`http://127.0.0.1:5108/${projectId}/us-central1/${name}`, { method:'POST', headers:{'Content-Type':'application/json', ...(role?{Authorization:`Bearer ${tokens[role]}`}:{})}, body:JSON.stringify({data}) });
  const body = await response.json(); if(body.error) throw Object.assign(Error(body.error.message), body.error); return body.result;
}
async function seed() {
  await fetch(`http://127.0.0.1:8188/emulator/v1/projects/${projectId}/databases/(default)/documents`, {method:'DELETE'});
  for(const [role,email] of Object.entries(emails)) {
    try { await auth.createUser({uid:`sprint-${role}`,email,password,emailVerified:true}); } catch(e) { if(e.code!=='auth/email-already-exists' && e.code!=='auth/uid-already-exists') throw e; await auth.updateUser(`sprint-${role}`,{password}); }
    await db.collection('users').doc(email).set({role:role==='other'?'pm':role,displayName:role==='pm'?'Sprint PM':`Sprint ${role}`,isProjectManager:role==='pm',authUid:`sprint-${role}`});
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
  const saved=await invoke('saveDashboardProjectDraft',{expectedRevision:0,assignment,project:{name:'Synthetic Published',code:'PUBLISHED',progress:45,visibility:'active'}});
  await invoke('publishDashboardProjectDraft',{draftId:saved.draft.draftId,expectedRevision:saved.draft.revision,weekId:'W43',expectedPublishedRevision:null});
  const draft=await invoke('saveDashboardProjectDraft',{expectedRevision:0,assignment,project:{name:'Synthetic Draft',code:'DRAFT',progress:55,visibility:'active'}});
  return draft.draft.draftId;
}

await seed();
// Exercise real callable HTTP authorization with isolated synthetic emulator records.
for(const bad of [{role:'admin'},{role:'pm',disabled:true},{role:'pm',active:false},{role:'vip'}]){
 const email='sprint.invalid@example.test';await db.collection('users').doc(email).set(bad);
 await assert.rejects(invoke('saveDashboardProjectDraft',{draftId:'denied',expectedRevision:0,project:{name:'Denied',code:'DENIED'},assignment:{ownerEmail:emails.pm,deputyEmail:email}}),e=>e.details?.reason==='assignment-forbidden');
 assert.equal((await db.collection('projectDrafts').doc('denied').get()).exists,false);
}
await db.collection('users').doc(' SPRINT.PM@example.test ').set({role:'pm'});
await assert.rejects(invoke('saveDashboardProjectDraft',{draftId:'ambiguous',expectedRevision:0,project:{name:'Denied',code:'DENIED'},assignment:{ownerEmail:emails.pm,deputyEmail:emails.admin}}),e=>e.details?.reason==='assignment-forbidden');
await db.collection('users').doc(' SPRINT.PM@example.test ').delete();
await assert.rejects(invoke('saveDashboardProjectDraft',{draftId:'denied',expectedRevision:0,project:{name:'Denied',code:'DENIED'},assignment:{ownerEmail:emails.pm,deputyEmail:emails.admin}},'pm'),e=>e.details?.reason==='assignment-forbidden');
await assert.rejects(invoke('saveDashboardProjectDraft',{expectedRevision:0,project:{}},null));
console.log('SYNTHETIC_SECURITY: other Admin, disabled/inactive/unsupported, duplicate, PM assignment, anonymous DENY; zero denied drafts written');

const site=resolve(root,'tmp/s02b-browser/site');await buildHosting({rootDir:root,outDir:site,env:await loadHostingEnv(root,'prod')});
const server=createServer(async(req,res)=>{try{const path=resolve(site,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!path.startsWith(site+'/'))return res.writeHead(403).end();const content=await readFile(path);res.setHeader('Content-Type',extname(path)==='.html'?'text/html':/\.m?js$/.test(path)?'text/javascript':'application/octet-stream');res.end(content);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(4198,'127.0.0.1',r));
let browser;
try{
 browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-setuid-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',async r=>{const u=new URL(r.url());if(!['127.0.0.1','localhost','www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname)&&u.protocol!=='data:')return r.abort();if(page.s02abHook && await page.s02abHook(r))return;return r.continue();});
 const fill=(sel,value)=>page.$eval(sel,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},value);
 await page.setViewport({width:390,height:1000});await page.goto('http://127.0.0.1:4198/?emulator=1&firestorePort=8188&authPort=9198&functionsPort=5108',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.handleLogin==='function'&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');await fill('#email',emails.admin);await fill('#password',password);await page.click('#loginOverlay button');await page.waitForFunction(()=>document.querySelector('#syncDot')?.classList.contains('ok')&&document.querySelector('#bannerTitle')?.textContent.includes('W43'),{timeout:45000});
 await page.waitForSelector('.proj-card[data-project-code="SOURCE"]');for(const width of [320,390]){await page.setViewport({width,height:1000});const card=await page.$eval('.proj-card[data-project-code="SOURCE"]',e=>{const button=e.querySelector('[data-project-action="edit"]'),status=e.querySelector('.card-status'),a=button?.getBoundingClientRect(),b=status?.getBoundingClientRect();return {edit:!!button,status:!!status,more:e.querySelectorAll('.project-more-actions').length,overlap:!!(a&&b&&Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top))}});assert(card.edit&&card.status&&!card.more&&!card.overlap);}await page.$eval('.proj-card[data-project-code="SOURCE"] [data-project-action="edit"]',e=>e.click());await page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')==='false',{timeout:15000});await page.$eval('#pe_details',e=>e.open=true);
 const options=await page.$eval('#pe_deputy',e=>[...e.options].map(o=>o.value));assert(options.includes(emails.admin));assert(options.includes(emails.pm));assert(!options.includes('sprint.other-admin@example.test'));
 for(const width of [320,390]){await page.setViewport({width,height:1000});const bounds=await page.$eval('#pe_deputy',e=>{const a=e.getBoundingClientRect(),m=e.closest('.modal').getBoundingClientRect();return {left:a.left,right:a.right,modalLeft:m.left,modalRight:m.right}});assert(bounds.left>=bounds.modalLeft-1&&bounds.right<=bounds.modalRight+1);}assert.equal(await page.evaluate(()=>document.querySelector('#projectDraftManage').parentElement===document.querySelector('#pe_btn_save').parentElement),true);assert.equal(options.filter(v=>v===emails.admin).length,1);await page.waitForFunction(()=>getComputedStyle(document.querySelector('#globalLoader')).display==='none',{timeout:30000});await page.waitForSelector('#projectDraftManage:not([hidden])');await page.click('#projectDraftManage');await page.waitForSelector('#publishedProjectActionsOverlay.open');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#publishedProjectActionsOverlay').classList.contains('open'));
 await page.select('#pe_owner',emails.pm);await page.select('#pe_deputy',emails.admin);let release,calls=0;const gate=new Promise(r=>release=r);page.s02abHook=async req=>{if(!req.url().endsWith('/saveDashboardProjectDraft')||req.method()!=='POST')return false;calls++;await gate;return false;};await page.waitForFunction(()=>getComputedStyle(document.querySelector('#globalLoader')).display==='none',{timeout:30000});await page.click('#pe_btn_save');await page.waitForFunction(()=>document.querySelector('#draftSaveProgress:not([hidden]) .draft-save-label')?.textContent.includes('Saving'));for(let i=0;i<100&&!calls;i++)await new Promise(r=>setTimeout(r,50));assert.equal(calls,1);assert.doesNotMatch(await page.$eval('#draftSaveProgress',e=>e.innerText),/100%|Draft saved/);release();page.s02abHook=null;console.log('POINTER',JSON.stringify(await page.$eval('#pe_btn_save',e=>{const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {button:e.id,hit:h?.id||h?.className,inside:!!h&&e.contains(h)}})));try{await page.waitForFunction(()=>document.querySelector('#draftSaveProgress .draft-save-label')?.textContent.includes('100%'),{timeout:8000});}catch(e){console.log('SYNTHETIC_DIAGNOSTIC',JSON.stringify({errors,view:await page.evaluate(()=>({error:document.querySelector('#projectMutationError')?.textContent,status:document.querySelector('#projectDraftStatus')?.textContent,alerts:[...document.querySelectorAll('.error.show,[role=alert],.resource-validation')].map(e=>e.textContent.trim()).filter(Boolean).slice(0,10),button:document.querySelector('#pe_btn_save')?.textContent}))}));throw e;}
 await page.evaluate(()=>window.closeModal('projEditOverlay',{force:true}));await page.evaluate(()=>window.openMyDrafts());await page.waitForFunction(()=>[...document.querySelectorAll('.draft-list-row')].some(r=>r.textContent.includes('SOURCE')),{timeout:15000});await page.evaluate(()=>[...document.querySelectorAll('.draft-list-row')].find(r=>r.textContent.includes('SOURCE')).querySelector('button').click());await page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')==='false');assert.equal(await page.$eval('#pe_deputy',e=>e.value),emails.admin);assert.equal(await page.$eval('#pe_owner',e=>e.value),emails.pm);
 await page.click('#pe_btn_publish');await page.waitForFunction(()=>!document.querySelector('#projEditOverlay').classList.contains('open'),{timeout:30000});const week=(await db.collection('weeks').doc('W43').get()).data();const published=week.projects.find(p=>p.code==='SOURCE');assert.ok(published);assert.equal(published.deputy,'Sprint admin');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({syntheticOnly:true,adminSelfDeputy:'PASS',otherAdminExcluded:'PASS',saveReopenPublish:'PASS',progressConfirmed:'PASS',editor320and390:'PASS',pendingNoFalseCompletion:'PASS',managementPlacement:'PASS',cardNoOverlap:'PASS',pageErrors:errors.length}));
}finally{await browser?.close();await new Promise(r=>server.close(r));await app.delete();}
