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
const out=resolve(root,'tmp/deputy-card-ui',process.argv.includes('--baseline')?'before':'after'); await mkdir(out, { recursive: true });
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
    await db.collection('weeks').doc(`W${n}`).set({weekLabel:`W${n} 2026`,weekDate:`${md(monday)} - ${md(monday+4*86400000)}`,isReleased:n<43,version:1,summary:'Synthetic Sprint fixture',projects:[{code:'SOURCE',name:'Synthetic Source',owner:'Sprint PM',deputy:'Sprint other',visibility:'active',projectLevel:'system',lifecycle:'active',status:'green',progress:n,attention:'watch',milestones:[],quarterlyMilestones:[],highlight:'Synthetic only'}]});
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
for(const [email,data] of Object.entries({'another.admin@example.test':{role:'admin',displayName:'Other Admin'},'disabled.pm@example.test':{role:'pm',displayName:'Disabled PM',disabled:true},'inactive.pm@example.test':{role:'pm',displayName:'Inactive PM',active:false}}))await db.collection('users').doc(email).set(data);
const weekRef=db.collection('weeks').doc('W43'),week=(await weekRef.get()).data();
week.projects=['green','yellow','red'].map((status,i)=>({...week.projects[0],code:'SOURCE'+i,status,name:'Synthetic Project '+i+' — long title to verify wrapping without clipping'}));await weekRef.set(week);
const buildRoot=process.argv.includes('--baseline')?resolve(root,'../pm-s01-final-integration'):root;
if(process.argv.includes('--baseline'))assert.equal(execFileSync('git',['-C',buildRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'30b19c7d82118d19595006192e16401a7c9d1d49');
const site=resolve(root,'tmp/deputy-card-ui/site');await buildHosting({rootDir:buildRoot,outDir:site,env:await loadHostingEnv(root,'uat')});
const server=createServer(async(req,res)=>{try{const path=resolve(site,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!path.startsWith(site+'/'))return res.writeHead(403).end();res.setHeader('Content-Type',extname(path)==='.html'?'text/html':/\.m?js$/.test(path)?'text/javascript':'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(4198,'127.0.0.1',r));let browser;
const failures=[],baseline=process.argv.includes('--baseline');
const check=(name,condition,detail)=>{results.push({name,status:condition?'PASS':'FAIL',detail});if(!condition)failures.push(name);};
try{
 browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-setuid-sandbox']});const page=await browser.newPage();page.on('pageerror',e=>pageErrors.push(e.message));await page.setViewport({width:1440,height:1100});
 const fill=(id,value)=>page.$eval(id,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},value);
 const ready=()=>page.waitForFunction(()=>document.querySelector('#syncDot')?.classList.contains('ok')&&document.querySelector('#bannerTitle')?.textContent.includes('W43')&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');
 const editorReady=()=>page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')==='false');
 await page.goto('http://127.0.0.1:4198/?emulator=1&firestorePort=8188&authPort=9198&functionsPort=5108',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.handleLogin==='function'&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');await fill('#email',emails.admin);await fill('#password',password);await page.click('#loginOverlay button');await ready();
 for(const width of [1440,1024,768,390,320]){
  await page.setViewport({width,height:1100});await page.waitForSelector('.proj-card[data-project-code="SOURCE0"]');
  const geometry=await page.$$eval('.proj-card[data-project-code]',async cards=>{const rows=[];for(const card of cards){card.scrollIntoView({block:'center'});await new Promise(requestAnimationFrame);const status=card.querySelector('.card-status'),actions=[...card.querySelectorAll('.card-actions button')],s=status.getBoundingClientRect(),c=card.getBoundingClientRect();rows.push({code:card.dataset.projectCode,status:status.textContent,buttons:actions.length,overlap:actions.some(b=>{const a=b.getBoundingClientRect();return Math.min(a.right,s.right)>Math.max(a.left,s.left)&&Math.min(a.bottom,s.bottom)>Math.max(a.top,s.top);}),clickable:actions.every(b=>{const a=b.getBoundingClientRect(),top=document.elementFromPoint(a.x+a.width/2,a.y+a.height/2);return top===b||b.contains(top);}),inside:s.left>=c.left&&s.right<=c.right,overflow:card.scrollWidth>card.clientWidth});}return rows;});
  check(`card geometry and hit targets at ${width}px`,geometry.length===3&&geometry.every(g=>!g.overlap&&g.clickable&&g.inside&&!g.overflow&&g.buttons===2),geometry);
  if([1440,390,320].includes(width)){await page.screenshot({path:resolve(out,`cards-${width}.png`),fullPage:true});const card=await page.$('.proj-card[data-project-code="SOURCE0"]');await card.screenshot({path:resolve(out,`card-${width}.png`)});}
 }
 await page.setViewport({width:1440,height:1100});await page.click('.proj-card[data-project-code="SOURCE0"] .project-more-actions');await page.waitForSelector('#publishedProjectActionsOverlay.open');check('More opens existing lifecycle actions',await page.$eval('#publishedProjectActionsOverlay',el=>/Visibility|Archive|Delete/.test(el.textContent)));await page.evaluate(()=>window.closeModal('publishedProjectActionsOverlay',{force:true}));
 await page.click('.proj-card[data-project-code="SOURCE0"] [data-project-action="edit"]');await editorReady();
 check('S01 editor has immediate ready shell',await page.$eval('#projEditOverlay',e=>e.classList.contains('open')));
 const options=await page.$$eval('#pe_deputy option',o=>o.map(e=>({value:e.value,text:e.textContent,disabled:e.disabled,selected:e.selected})));
 check('Admin self appears once as Deputy',options.filter(o=>o.value===emails.admin&&!o.disabled).length===1,options);
 check('PM and Unassigned remain available',options.some(o=>o.value===emails.pm)&&options.some(o=>o.value===''));
 check('unauthorized and disabled targets absent',!options.some(o=>['another.admin@example.test','disabled.pm@example.test','inactive.pm@example.test',emails.vip].includes(o.value)&&!o.disabled));
 check('existing Deputy loads before save',await page.$eval('#pe_deputy',e=>e.value)===emails.other);
 const stored=(await weekRef.get()).data().projects[0];check('opening does not rewrite saved Deputy',stored.deputy==='Sprint other');
 await page.click('#pe_details summary');await page.$eval('#pe_deputy',e=>{e.size=8;e.scrollIntoView({block:'center'});});await page.screenshot({path:resolve(out,'deputy-options.png'),fullPage:false});await page.$eval('#pe_deputy',e=>e.size=0);
 if(!baseline){
  await page.select('#pe_owner',emails.pm);await page.select('#pe_deputy',emails.admin);await page.click('#pe_btn_save');
  await page.waitForFunction(()=>!document.querySelector('#pe_btn_save').disabled);let saved;for(let i=0;i<100;i++){const docs=await db.collection('projectDrafts').get();saved=docs.docs.map(d=>d.data()).find(d=>d.project.code==='SOURCE0'&&d.assignment.deputyEmail===emails.admin);if(saved)break;await new Promise(r=>setTimeout(r,100));}assert.ok(saved,'saved Admin Deputy');
  await page.evaluate(()=>window.closeModal('projEditOverlay',{force:true}));await page.evaluate(id=>window.openManagedProjectDraft(id),saved.draftId);await editorReady();check('save/reopen keeps Admin Deputy',await page.$eval('#pe_deputy',e=>e.value)===emails.admin);
  await page.click('#pe_btn_publish');await page.waitForFunction(()=>!document.querySelector('#projEditOverlay').classList.contains('open'));check('publish closes editor after confirmed success',(await weekRef.get()).data().projects[0].deputy==='Sprint admin');
  await page.evaluate(()=>window.handleLogout());await page.waitForFunction(()=>getComputedStyle(document.querySelector('#loginOverlay')).display!=='none'&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');await fill('#email',emails.pm);await fill('#password',password);await page.click('#loginOverlay button');await ready();check('PM retains PM role',await page.$eval('#displayRole',e=>e.textContent.trim().toLowerCase())==='pm');
  await page.click('.proj-card[data-project-code="SOURCE0"] [data-project-action="edit"]');await editorReady();check('PM cannot change assignment',await page.$eval('#pe_deputy',e=>e.disabled)&&await page.$eval('#pe_owner',e=>e.disabled));
 }
 assert.deepEqual(pageErrors,[]);if(!baseline)assert.deepEqual(failures,[]);else assert.ok(failures.includes('Admin self appears once as Deputy')&&failures.some(s=>s.startsWith('card geometry')),'baseline reproduces both bugs');
}finally{await writeFile(resolve(out,'results.json'),JSON.stringify({sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode:baseline?'baseline':'fixed',results,pageErrors,failures},null,2));await browser?.close();await new Promise(r=>server.close(r));}
