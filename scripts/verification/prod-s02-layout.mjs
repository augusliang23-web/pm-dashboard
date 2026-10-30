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
  const saved=await invoke('saveDashboardProjectDraft',{expectedRevision:0,assignment,project:{name:'Synthetic Published',code:'PUBLISHED',progress:45,visibility:'active'}});
  await invoke('publishDashboardProjectDraft',{draftId:saved.draft.draftId,expectedRevision:saved.draft.revision,weekId:'W43',expectedPublishedRevision:null});
  const draft=await invoke('saveDashboardProjectDraft',{expectedRevision:0,assignment,project:{name:'Synthetic Draft',code:'DRAFT',progress:55,visibility:'active'}});
  return draft.draft.draftId;
}
const fixtureId=await seed();
const before=process.argv.includes('--before');
const output=resolve(root,'tmp/s02a-ui',before?'before':'after');await mkdir(output,{recursive:true});
const site=resolve(root,'tmp/s02a-ui/site');await buildHosting({rootDir:root,outDir:site,env:await loadHostingEnv(root,'prod')});
const server=createServer(async(req,res)=>{try{const path=resolve(site,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!path.startsWith(site+'/'))return res.writeHead(403).end();const content=await readFile(path);res.setHeader('Content-Type',extname(path)==='.html'?'text/html':/\.m?js$/.test(path)?'text/javascript':'application/octet-stream');res.end(content);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(4198,'127.0.0.1',r));
let browser;
try {
 browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-setuid-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',async r=>{const u=new URL(r.url());if(!['127.0.0.1','localhost','www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname)&&u.protocol!=='data:')return r.abort();if(page.s02aHook && await page.s02aHook(r))return;return r.continue();});
 const fill=(sel,value)=>page.$eval(sel,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},value);
 await page.setViewport({width:1440,height:1000});await page.goto('http://127.0.0.1:4198/?emulator=1&firestorePort=8188&authPort=9198&functionsPort=5108',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.handleLogin==='function'&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');await fill('#email',emails.admin);await fill('#password',password);await page.click('#loginOverlay button');await page.waitForFunction(()=>document.querySelector('#syncDot')?.classList.contains('ok')&&document.querySelector('#bannerTitle')?.textContent.includes('W43'),{timeout:45000});
 for(const width of [1440,390,320]) {
  await page.setViewport({width,height:1000});await page.waitForSelector('.proj-card[data-project-code="SOURCE"]');await page.$eval('.proj-card[data-project-code="SOURCE"]',e=>e.scrollIntoView({block:'center'}));await page.screenshot({path:resolve(output,`card-${width}.png`)});
  const cardState=await page.$eval('.proj-card[data-project-code="SOURCE"]',e=>{const b=e.querySelector('[data-project-action="edit"]'),a=b?.getBoundingClientRect(),s=e.querySelector('.card-status')?.getBoundingClientRect();return {more:e.querySelectorAll('.project-more-actions').length,edit:!!b,overlap:!!(a&&s&&Math.min(a.right,s.right)>Math.max(a.left,s.left)&&Math.min(a.bottom,s.bottom)>Math.max(a.top,s.top))};});
  await page.$eval('.proj-card[data-project-code="SOURCE"] [data-project-action="edit"]',e=>e.click());await page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')==='false',{timeout:15000});await page.$eval('#pe_details',e=>e.open=true);await page.$eval('#pe_deputy',e=>e.scrollIntoView({block:'center'}));
  const geom=await page.evaluate(()=>{const sel=document.querySelector('#pe_deputy').getBoundingClientRect(),modal=document.querySelector('#projEditOverlay .modal').getBoundingClientRect(),parent=document.querySelector('#pe_deputy').parentElement.getBoundingClientRect();return {left:sel.left,right:sel.right,modalLeft:modal.left,modalRight:modal.right,parentLeft:parent.left,parentRight:parent.right,bodyScroll:document.documentElement.scrollWidth,viewport:innerWidth,backgroundOverflow:[...document.body.querySelectorAll('*')].filter(e=>!e.closest('.overlay')&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().right>innerWidth+1).slice(0,15).map(e=>({tag:e.tagName,id:e.id,cls:String(e.className).slice(0,60),right:Math.round(e.getBoundingClientRect().right)})),modalScroll:document.querySelector('#projEditOverlay .modal').scrollWidth,modalClient:document.querySelector('#projEditOverlay .modal').clientWidth,overflowNodes:[...document.querySelectorAll('#projEditOverlay .modal *')].filter(e=>{const r=e.getBoundingClientRect(),m=document.querySelector('#projEditOverlay .modal').getBoundingClientRect();return r.width>0&&r.height>0&&(r.right>m.right+1||r.left<m.left-1)}).slice(0,20).map(e=>({tag:e.tagName,id:e.id,cls:String(e.className).slice(0,80),right:Math.round(e.getBoundingClientRect().right)})),actions:[...document.querySelectorAll('.project-save-actions button:not([hidden])')].filter(e=>getComputedStyle(e).display!=='none').map(e=>({id:e.id,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom}))};});await page.screenshot({path:resolve(output,`editor-${width}.png`)});results.push({width,cardState,geom});
  if(!before){assert.equal(cardState.more,0,'card has no lifecycle menu');assert.equal(cardState.edit,true);assert.equal(cardState.overlap,false,'status and edit must not overlap');assert.ok(geom.left>=geom.modalLeft-1&&geom.right<=geom.modalRight+1,'Deputy inside modal');assert.ok(geom.left>=geom.parentLeft-1&&geom.right<=geom.parentRight+1,'Deputy inside field');assert.ok(geom.modalScroll<=geom.modalClient+1,'editor has no unintended horizontal overflow');for(const [i,a] of geom.actions.entries()){assert.ok(a.left>=geom.modalLeft-1&&a.right<=geom.modalRight+1,'editor action stays inside modal');for(const b of geom.actions.slice(i+1))assert.ok(!(Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)),'editor actions must not overlap');}await page.waitForSelector('#projectDraftManage:not([hidden])');}
  await page.evaluate(()=>window.closeModal('projEditOverlay',{force:true}));
 }
 await writeFile(resolve(output,'geometry.json'),JSON.stringify({results},null,2));
 if(!before&&!process.argv.includes('--geometry-only')){await page.setViewport({width:1440,height:1000});await page.$eval('.proj-card[data-project-code="SOURCE"] [data-project-action="edit"]',e=>e.click());await page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')==='false');await page.focus('#projectDraftManage');await page.keyboard.press('Enter');await page.waitForSelector('#publishedProjectActionsOverlay.open');assert.equal(await page.$eval('#projectVisibilityAction',e=>getComputedStyle(e).display!=='none'),true);assert.equal(await page.$eval('#projectDeleteAction',e=>getComputedStyle(e).display!=='none'),true);await page.screenshot({path:resolve(output,'published-actions.png')});let confirmation='';page.once('dialog',async d=>{confirmation=d.message();await d.dismiss();});await page.click('#projectDeleteAction');assert.match(confirmation,/Permanently delete/);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#publishedProjectActionsOverlay').classList.contains('open'));assert.equal(await page.evaluate(()=>document.activeElement.id),'projectDraftManage');
 await fill('#pe_highlight','Synthetic S02A save');let release,calls=0;const gate=new Promise(r=>release=r);page.s02aHook=async req=>{if(!req.url().endsWith('/saveDashboardProjectDraft')||req.method()!=='POST')return false;calls++;await gate;return false;};await page.$eval('#pe_btn_save',e=>{e.click();e.click();});await page.waitForFunction(()=>document.querySelector('#draftSaveProgress:not([hidden]) .draft-save-label')?.textContent.includes('Saving'));for(let i=0;i<100&&!calls;i++)await new Promise(r=>setTimeout(r,50));assert.equal(calls,1);assert.doesNotMatch(await page.$eval('#draftSaveProgress',e=>e.innerText),/100%|Draft saved/);release();await page.waitForFunction(()=>document.querySelector('#draftSaveProgress .draft-save-label')?.textContent.includes('100%'),{timeout:30000});page.s02aHook=null;assert.equal(calls,1);await page.click('#pe_btn_publish');await page.waitForFunction(()=>!document.querySelector('#projEditOverlay').classList.contains('open'),{timeout:30000});
 await page.evaluate(()=>window.handleLogout());await page.waitForFunction(()=>getComputedStyle(document.querySelector('#loginOverlay')).display!=='none'&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');await fill('#email',emails.pm);await fill('#password',password);await page.click('#loginOverlay button');await page.waitForFunction(()=>document.querySelector('#syncDot')?.classList.contains('ok')&&document.querySelector('#bannerTitle')?.textContent.includes('W43'),{timeout:45000});await page.$eval('.proj-card[data-project-code="SOURCE"] [data-project-action="edit"]',e=>e.click());await page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')==='false');assert.equal(await page.$eval('#projectDraftManage',e=>e.hidden),true,'ordinary PM cannot access published actions');assert.equal(await page.$eval('#pe_deputy',e=>e.disabled),true);await page.evaluate(()=>window.closeModal('projEditOverlay',{force:true}));results.push({adminActions:'PASS',deleteConfirmation:'PASS',keyboardFocus:'PASS',saveDraftAndPublish:'PASS',duplicateSave:'PASS',pmRestricted:'PASS'});}
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({results,errors},null,2));
} finally {await browser?.close();await new Promise(r=>server.close(r));}
