// Auth + Firestore + callable HTTP + actual dashboard. Synthetic emulator ONLY.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildHosting } from '../build-hosting.mjs';
import { loadHostingEnv } from '../hosting-env.mjs';
import { runSprintFlows } from './ux-sprint-01-scenarios.mjs';
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
    await db.collection('users').doc(email).set({authUid:`sprint-${role}`,role:role==='other'?'pm':role,displayName:role==='pm'?'Sprint PM':`Sprint ${role}`,isProjectManager:role==='pm'});
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
const draftId=await seed();
const site=resolve(root,`tmp/ux-sprint-01/site-${mode}`);
let sourceRoot=root;
if(mode==='baseline'){
 sourceRoot=resolve(root,'tmp/ux-sprint-01/baseline-source');await mkdir(sourceRoot,{recursive:true});
 const archive=resolve(root,'tmp/ux-sprint-01/baseline.tar');
 await writeFile(archive,execFileSync('git',['archive','b3b7a51d5db680cfc87acdf24d06d73a9de2aaac'],{maxBuffer:64*1024*1024}));
 execFileSync('tar',['-xf',archive,'-C',sourceRoot]);
}
await buildHosting({rootDir:sourceRoot,outDir:site,env:await loadHostingEnv(sourceRoot,'prod')});
const server=createServer(async(req,res)=>{try { const pathname=new URL(req.url,'http://localhost').pathname; const path=resolve(site,'.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(site+'/'))return res.writeHead(403).end(); const content=await readFile(path);res.setHeader('Content-Type',extname(path)==='.html'?'text/html':/\.m?js$/.test(path)?'text/javascript':'application/octet-stream');res.end(content); } catch {res.writeHead(404).end();}});
await new Promise(r=>server.listen(4198,'127.0.0.1',r));
let browser;
try {
  browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-setuid-sandbox']});
  for(const role of ['admin','pm']) {
    const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width:1440,height:1100});
    let delay=0, activeRequests=[];const requestStarts=new Map();
    page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text());});
    await page.setRequestInterception(true);
    page.on('request',async request=>{const u=new URL(request.url());if(!['127.0.0.1','localhost','www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname) && u.protocol!=='data:')return request.abort();if(page.sprintRequestHook && await page.sprintRequestHook(request))return;if(u.pathname.endsWith('/getDashboardProjectDraft')){requestStarts.set(request,performance.now());if(delay)await new Promise(r=>setTimeout(r,delay));}await request.continue();});
    page.on('requestfinished',req=>{if(requestStarts.has(req)){activeRequests.push(performance.now()-requestStarts.get(req));requestStarts.delete(req);}});
    await page.goto('http://127.0.0.1:4198/?emulator=1&firestorePort=8188&authPort=9198&functionsPort=5108',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof window.handleLogin==='function');await page.type('#email',emails[role]);await page.type('#password',password);await page.waitForFunction(()=>getComputedStyle(document.querySelector('#globalLoader')).display==='none');await page.click('#loginOverlay button');
    try {await page.waitForFunction(()=>document.querySelector('#syncDot')?.classList.contains('ok') && document.querySelector('#bannerTitle')?.textContent.includes('W43'),{timeout:45000});}catch(e){console.log(await page.evaluate(()=>({body:document.body.innerText.slice(0,1500),banner:document.querySelector('#bannerTitle')?.textContent})));throw e;}
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#globalLoader')).display==='none');
    if(functional){await runSprintFlows({page,role,db,invoke,emails,draftId,out,results});await context.close();continue;}
    for(const extraCallableDelayMs of [0,250]) {
      delay=extraCallableDelayMs;
      for(const entry of ['source-card','published-card','my-drafts','draft-card']) {
        const samples=[];
        for(let i=0;i<20;i++) {
          if(entry==='my-drafts') {await page.evaluate(()=>window.openMyDrafts());await page.waitForFunction(()=>!document.querySelector('#myDraftsContent button')?.disabled);}
          const selector=entry==='source-card'?'[data-project-action="edit"][data-project-code="SOURCE"]':entry==='published-card'?'[data-project-action="edit"][data-project-code="PUBLISHED"]':entry==='my-drafts'?`#myDraftsContent [data-draft-id="${draftId}"] button`:`.draft-project-card[data-draft-id="${draftId}"]`;
          // Baseline rows do not have data-draft-id; select the actual row by its synthetic code.
          let target=await page.$(selector);
          if(!target && entry==='my-drafts')target=await page.evaluateHandle(()=>[...document.querySelectorAll('#myDraftsContent .draft-list-row')].find(e=>e.textContent.includes('Synthetic Draft'))?.querySelector('button'));
          assert.ok(target && await target.evaluate(e=>Boolean(e)),selector);
          await target.evaluate(el=>{window.__sprintTiming=null;el.addEventListener('click',()=>{const start=performance.now();let feedback=null,shell=null;function tick(){const overlay=document.querySelector('#projEditOverlay'),visible=overlay.classList.contains('open');const loading=overlay.getAttribute('aria-busy')==='true';const ready=visible&&!loading&&Boolean(document.querySelector('#pe_name').value);const now=performance.now()-start;if(feedback===null&&(visible||el.disabled))feedback=now;if(shell===null&&visible)shell=now;if(ready){window.__sprintTiming={feedbackMs:feedback,shellMs:shell,readyMs:now};return;}requestAnimationFrame(tick);}tick();},{once:true,capture:true});});
          activeRequests=[];const before=await page.metrics();await target.click();
          await page.waitForFunction(()=>window.__sprintTiming!==null,{timeout:20000});
          const sample=await page.evaluate(()=>window.__sprintTiming),after=await page.metrics();
          samples.push({...sample,jsTaskMs:(after.TaskDuration-before.TaskDuration)*1000,backendRequestMs:activeRequests.reduce((s,n)=>s+n,0),backendRequests:activeRequests.length});
          await page.evaluate(()=>window.closeModal('projEditOverlay',{force:true}));
          await page.waitForFunction(()=>!document.querySelector('#projEditOverlay').classList.contains('open'));
        }
        const quantile=(key,q)=>samples.map(s=>s[key]).sort((a,b)=>a-b)[Math.ceil(samples.length*q)-1];
        const summary={role,entry,extraCallableDelayMs,samples,median:Object.fromEntries(['feedbackMs','shellMs','readyMs','jsTaskMs','backendRequestMs','backendRequests'].map(k=>[k,quantile(k,.5)])),p95:Object.fromEntries(['feedbackMs','shellMs','readyMs','jsTaskMs','backendRequestMs'].map(k=>[k,quantile(k,.95)]))};measurements.push(summary);
        console.log(JSON.stringify({role,entry,extraCallableDelayMs,median:summary.median,p95:summary.p95}));
        await writeFile(resolve(out,'performance.json'),JSON.stringify({mode,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),conditions:{browser:await browser.version(),viewport:'1440x1100',cpuThrottle:1,fixture:'synthetic emulator W30-W43; 2 drafts; 4 users',samplesPerCell:20,extraCallableDelay:'outbound request interception; not cloud latency'},measurements},null,2));
      }
    }
    await page.screenshot({path:resolve(out,`${role}-dashboard.png`),fullPage:true});await context.close();
  }
  assert.deepEqual(pageErrors,[]);
  if(!functional)results.push({check:'performance matrix',status:'PASS'});
} finally {await writeFile(resolve(out,'results.json'),JSON.stringify({results,pageErrors},null,2));await browser?.close();await new Promise(r=>server.close(r));}
