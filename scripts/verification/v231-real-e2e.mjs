// Real Auth + callable HTTP + Firestore transactions + Chromium. Synthetic emulator data only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {buildHosting} from '../build-hosting.mjs';
import {loadHostingEnv} from '../hosting-env.mjs';
import {projectRevisionFingerprint} from '../../js/project-mutations.mjs';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const pdfRequire=createRequire(new URL('../../pdf-service/package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const puppeteer=pdfRequire('puppeteer');
const root=resolve(new URL('../..',import.meta.url).pathname);
const project='demo-pm-dashboard-v22t';
assert.equal(process.env.GCLOUD_PROJECT,project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9198');
const out=resolve(root,'outputs/v231-real-e2e');await mkdir(out,{recursive:true});
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const results=[];
async function check(id,method,fn){try{await fn();results.push({id,result:'PASS',method});console.log('PASS',id);}catch(error){if(page){await page.screenshot({path:resolve(out,'failure.png'),fullPage:true});console.log('UI DIAGNOSTIC',await page.evaluate(()=>({mutation:document.querySelector('#projectMutationError')?.textContent,workstreams:document.querySelector('#workstreamErrors')?.textContent,invalid:[...document.querySelectorAll('#projEditOverlay :invalid')].map(e=>({id:e.id,message:e.validationMessage})),toast:document.querySelector('#saveToast')?.textContent})));}results.push({id,result:'FAIL',method,error:error.message});throw error;}finally{await writeFile(resolve(out,'results.json'),JSON.stringify({checkedAt:new Date().toISOString(),sourceCommit,project,results},null,2));}}
const app=initializeApp({projectId:project}),db=getFirestore(app),auth=getAuth(app);
const password='LocalRelease!12345';
const emails={admin:'qa.admin@example.test',pm:'qa.pm@example.test',other:'qa.other@example.test',vip:'qa.vip@example.test'};
const tokens={};
async function invoke(name,data,who='pm'){
 const response=await fetch(`http://127.0.0.1:5108/${project}/us-central1/${name}`,{method:'POST',headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+tokens[who]}:{})},body:JSON.stringify({data})});
 const body=await response.json();if(body.error){const error=new Error(body.error.message);Object.assign(error,{status:body.error.status,details:body.error.details});throw error;}return body.result;
}
const reason=wanted=>error=>error.details?.reason===wanted;
const config={schemaVersion:1,projectId:project,drafts:true,archiveRecovery:true,enforceDraftPublish:true};
const weekRef=db.collection('weeks').doc('W40');
const sourceWeekRef=db.collection('weeks').doc('W39');
const data=async ref=>(await ref.get()).data();
const digest=p=>createHash('sha256').update(projectRevisionFingerprint(p)).digest('hex');
let browser,server,page;
try {
 // Reset only the explicitly pinned emulator; no cloud endpoint is used by this script.
 await fetch(`http://127.0.0.1:8188/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
 for(const [role,email] of Object.entries(emails)){
  try{await auth.createUser({uid:'release-'+role,email,password,emailVerified:true});}catch(e){if(e.code!=='auth/email-already-exists' && e.code!=='auth/uid-already-exists')throw e;}
  await db.collection('users').doc(email).set({role:role==='other'?'pm':role,displayName:role==='pm'?'Release PM':role==='other'?'Other PM':'Release '+role,isProjectManager:role==='pm'});
  const response=await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  const signed=await response.json();assert.ok(signed.idToken,'emulator login');tokens[role]=signed.idToken;
 }
 const monday=w=>new Date(Date.UTC(2026,0,5)+(w-2)*7*86400000);
 const md=date=>date.toLocaleString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
 for(let w=27;w<=40;w++){
  const mon=monday(w),fri=new Date(+mon+4*86400000);
  await db.collection('weeks').doc('W'+w).set({weekLabel:`W${w} 2026`,weekDate:`${md(mon)} - ${md(fri)}`,reportingPeriod:{year:2026,week:w},isReleased:w<40,version:1,summary:'隔離測試：交付進度與風險',projects:[{code:'OLD',name:'測試專案 Alpha',owner:'Release PM',deputy:'',visibility:'active',projectLevel:'system',lifecycle:'active',status:'green',progress:w,attention:'watch',milestones:[],quarterlyMilestones:[],highlight:'中文交付測試',weeklyActions:'確認交付進度'}]});
 }
 await db.collection('dashboardSettings').doc('team-2-portfolio').set({ganttTemplates:{system:['Planning','Delivery'],'hardware-module':['EVT'],software:['Development']},revision:'fixture'});
 await db.collection('releaseCapabilities').doc('v231').set({...config,drafts:false,archiveRecovery:false,enforceDraftPublish:false});
 await check('E16a','actual authenticated legacy callable with staged disabled capabilities',async()=>{
  const old=(await data(weekRef)).projects[0];const result=await invoke('saveDashboardProject',{weekId:'W40',projectCode:'OLD',originalCode:'OLD',isNew:false,expectedRevision:projectRevisionFingerprint(old),project:{code:'OLD',progress:41}});assert.equal(result.project.progress,41);
  await assert.rejects(invoke('saveDashboardProjectDraft',{expectedRevision:0,project:{name:'Disabled'}}),reason('draft-environment'));
 });
 const site=resolve(root,'tmp/v231-e2e-hosting');await buildHosting({rootDir:root,outDir:site,env:await loadHostingEnv(root,'prod')});
 server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;const path=resolve(site,'.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(site+'/'))return res.writeHead(403).end();const content=await readFile(path);res.setHeader('Content-Type',extname(path)==='.html'?'text/html':/\.m?js$/.test(path)?'text/javascript':'application/octet-stream');res.end(content);}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(4198,'127.0.0.1',r));
 browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-setuid-sandbox']});page=await browser.newPage();await page.setViewport({width:1440,height:1100});
 const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.log('BROWSER ERROR',error.message);});
 await page.setRequestInterception(true);page.on('request',request=>{const url=new URL(request.url());if(['127.0.0.1','localhost','www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname) || url.protocol==='data:')request.continue();else request.abort();});
 const url='http://127.0.0.1:4198/?emulator=1&firestorePort=8188&authPort=9198&functionsPort=5108';
 const fill=async(selector,value)=>{await page.$eval(selector,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},String(value));};
 const click=async selector=>{await page.waitForFunction(()=>getComputedStyle(document.querySelector('#globalLoader')).display==='none');return page.click(selector);};
 const login=async(role)=>{await page.waitForSelector('#email',{visible:true});await fill('#email',emails[role]);await fill('#password',password);await click('#loginOverlay button');await page.waitForFunction(()=>document.querySelector('#syncDot')?.classList.contains('ok'),{timeout:25000});await page.waitForFunction(()=>document.querySelector('#bannerTitle')?.textContent.includes('W40'),{timeout:15000});};
 const logout=async()=>{await page.evaluate(()=>window.handleLogout());await page.waitForSelector('#email',{visible:true});};
 const waitFor=async(fn)=>{for(let n=0;n<80;n++){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw Error('Timed out waiting for persisted transaction');};
 await page.goto(url,{waitUntil:'domcontentloaded'});await login('pm');
 await check('E16b','real Production-profile Chromium editor while Draft capability is disabled',async()=>{
  assert.equal(await page.$eval('#myDraftsBtn',e=>getComputedStyle(e).display),'none');
  await page.evaluate(()=>window.openProjEdit('OLD'));await page.waitForSelector('#projEditOverlay.open');assert.equal(await page.$eval('#pe_btn_save',e=>e.textContent),'Save Project');await fill('#pe_progress',42);await click('#pe_btn_save');await waitFor(async()=>(await data(weekRef)).projects[0].progress===42);
 });
 await db.collection('releaseCapabilities').doc('v231').set(config);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#myDraftsBtn')?.style.display==='inline-flex',{timeout:25000});
 await logout();await login('admin');
 await check('E01','Admin creates and saves a Draft through real browser/callable',async()=>{
  await click('#addProjectBtn');await page.waitForSelector('#projEditOverlay.open');await fill('#pe_name','Browser release draft');await fill('#pe_code','BROWSER');await page.select('#pe_owner',emails.pm);await fill('#pe_progress',43);await click('#pe_btn_save');await waitFor(async()=>(await db.collection('projectDrafts').get()).size===1);assert.equal((await data(weekRef)).projects.some(p=>p.code==='BROWSER'),false);
 });
 const draftDoc=(await db.collection('projectDrafts').get()).docs[0];let draft=draftDoc.data();
 await logout();await login('pm');
 async function reopen(){await click('#myDraftsBtn');await page.waitForFunction(()=>[...document.querySelectorAll('#myDraftsContent button')].some(e=>e.textContent==='Edit Project' && !e.disabled));await click('#myDraftsContent .draft-list-row button');await page.waitForSelector('#projEditOverlay.open');}
 await check('E02','assigned PM reopens Admin draft and saves via browser',async()=>{await reopen();await fill('#pe_progress',55);await click('#pe_btn_save');await waitFor(async()=>(await data(draftDoc.ref)).revision===2);draft=await data(draftDoc.ref);assert.equal(draft.project.progress,55);});
 await check('E03','browser reload plus logout/login persistence',async()=>{await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#myDraftsBtn')?.style.display==='inline-flex');await reopen();assert.equal(await page.$eval('#pe_progress',e=>e.value),'55');});
 let first;
 await check('E04','PM Save & Publish button uses actual transaction',async()=>{await click('#pe_btn_publish');await waitFor(async()=>(await data(weekRef)).projects.some(p=>p.code==='BROWSER'));});
 await check('E05','authoritative official project reflects submitted publication',async()=>{first=(await data(weekRef)).projects.find(p=>p.code==='BROWSER');assert.equal(first.progress,55);assert.equal(first.owner,'Release PM');});
 await check('E06','real browser republish',async()=>{await fill('#pe_progress',65);await click('#pe_btn_publish');await waitFor(async()=>(await data(weekRef)).projects.find(p=>p.code==='BROWSER')?.progress===65);draft=await data(draftDoc.ref);});
 await check('Retry','actual callable repeated publish retry produces no extra audit',async()=>{const count=(await db.collection('projectDraftPublicationAudit').get()).size;const retry=await invoke('publishDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:draft.revision,weekId:'W40',expectedPublishedRevision:null});assert.equal(retry.alreadyPublished,true);assert.equal((await db.collection('projectDraftPublicationAudit').get()).size,count);});
 await check('E07','actual authenticated stale draft and official revisions are rejected',async()=>{
  await assert.rejects(invoke('saveDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:0,project:{progress:99}}),reason('conflict'));
  const saved=await invoke('saveDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:draft.revision,project:{progress:70}});draft=saved.draft;
  await assert.rejects(invoke('publishDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:draft.revision,weekId:'W40',expectedPublishedRevision:'stale'}),reason('conflict'));
  await assert.rejects(invoke('saveDashboardProject',{weekId:'W40',projectCode:'OLD',originalCode:'OLD',isNew:false,expectedRevision:projectRevisionFingerprint((await data(weekRef)).projects[0]),project:{code:'OLD',progress:99}}),reason('draft-publish-required'));
 });
 await check('E08','actual unauthenticated, wrong-role, wrong-owner and assignment attempts denied',async()=>{
  await assert.rejects(invoke('getDashboardProjectDraft',{draftId:draft.draftId},null));
  await assert.rejects(invoke('getDashboardProjectDraft',{draftId:draft.draftId},'other'),reason('draft-forbidden'));
  await assert.rejects(invoke('saveDashboardProjectDraft',{expectedRevision:0,project:{name:'Bad'}},'vip'),reason('role-forbidden'));
  await assert.rejects(invoke('saveDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:draft.revision,project:{},assignment:{ownerEmail:emails.other}}),reason('assignment-forbidden'));
 });
 await logout();await login('admin');
 await check('E09','Admin archives a controlled project via real callable',async()=>{
  const source=await data(sourceWeekRef);source.isReleased=false;await sourceWeekRef.set(source);
  const live=source.projects[0];await invoke('saveDashboardProject',{weekId:'W39',projectCode:'OLD',originalCode:'OLD',isNew:false,expectedRevision:projectRevisionFingerprint(live),project:{code:'OLD',visibility:'archived'}},'admin');
  await sourceWeekRef.update({isReleased:true});const target=await data(weekRef);target.projects=target.projects.filter(p=>p.code!=='OLD');await weekRef.set(target);
 });
 const historical=await data(sourceWeekRef),archived=historical.projects[0];
 const restore={isArchiveRestore:true,weekId:'W40',sourceWeekId:'W39',projectCode:'OLD',expectedSourceRevision:digest(archived)};
 await check('E10','Admin Archive Recovery modal and Restore button, real transaction',async()=>{
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#archivedProjectsBtn')?.style.display==='inline-flex');await click('#archivedProjectsBtn');await page.waitForSelector('#archivedProjectsListContainer button[data-action="restore"]');
  page.once('dialog',dialog=>dialog.accept());await click('#archivedProjectsListContainer button[data-action="restore"]');await waitFor(async()=>(await data(weekRef)).projects.some(p=>p.code==='OLD'));assert.equal((await data(weekRef)).projects.find(p=>p.code==='OLD').visibility,'active');
 });
 await check('E11','Firestore source byte-equivalent data and unrelated target projects preserved',async()=>{assert.deepEqual(await data(sourceWeekRef),historical);assert.equal((await data(weekRef)).projects.find(p=>p.code==='BROWSER').progress,65);});
 await check('E12','duplicate restore via real callable denied',async()=>{await assert.rejects(invoke('saveDashboardProject',restore,'admin'),reason('conflict'));});
 await check('E13','released target restore denied without write',async()=>{await weekRef.update({isReleased:true});await assert.rejects(invoke('saveDashboardProject',restore,'admin'),reason('week-already-released'));await weekRef.update({isReleased:false});});
 await check('E14','historical target restore and publication denied',async()=>{await assert.rejects(invoke('saveDashboardProject',{...restore,weekId:'W38'},'admin'));await assert.rejects(invoke('publishDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:draft.revision,weekId:'W38',expectedPublishedRevision:null}));});
 await check('E15','publication audit records match actual successful transactions',async()=>{const audits=(await db.collection('projectDraftPublicationAudit').get()).docs.map(d=>d.data());assert.equal(audits.length,2);assert.ok(audits.every(a=>a.draftId===draft.draftId && a.actorEmail===emails.pm && a.actorUid==='release-pm' && a.publishedAt));});
 await check('ArchiveConcurrency','two actual concurrent restore transactions admit one winner and retain target data',async()=>{
  const hist=await data(sourceWeekRef);hist.projects.push({...archived,code:'RACE'});await sourceWeekRef.set(hist);const req={...restore,projectCode:'RACE',expectedSourceRevision:digest(hist.projects.at(-1))};
  const results=await Promise.allSettled([invoke('saveDashboardProject',req,'admin'),invoke('saveDashboardProject',req,'admin')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await data(weekRef)).projects.filter(p=>p.code==='RACE').length,1);
 });
 await check('DelegatedArchive','restore-only PM is allowed without project.manage; undelegated PM denied',async()=>{
  const hist=await data(sourceWeekRef);hist.projects.push({...archived,code:'DELEGATED'});await sourceWeekRef.set(hist);const req={...restore,projectCode:'DELEGATED',expectedSourceRevision:digest(hist.projects.at(-1))};await assert.rejects(invoke('saveDashboardProject',req),reason('role-forbidden'));await db.collection('userPermissions').doc(emails.pm).set({overrides:{'project.archive.restore':true,'project.manage':false}});await invoke('saveDashboardProject',req);assert.equal((await data(weekRef)).projects.find(p=>p.code==='DELEGATED').visibility,'active');
 });
 await check('Overview','real Production profile Overview toggles 6/12-week windows',async()=>{await page.evaluate(()=>window.closeModal('archivedProjectsOverlay',{force:true}));await click('#btnOverview');await page.waitForSelector('[data-overview-trend-window="12"]');await click('[data-overview-trend-window="12"]');await click('[data-overview-trend-window="6"]');await page.screenshot({path:resolve(out,'production-overview.png'),fullPage:true});assert.deepEqual(errors,[]);});
 await check('E21','actual callable rejects cross-project configuration and client project injection without official writes',async()=>{
  const before=await data(weekRef);
  await assert.rejects(invoke('saveDashboardProjectDraft',{projectId:'project-manager-dashboar-a067f',expectedRevision:0,project:{name:'Cross project'}}));
  await db.collection('releaseCapabilities').doc('v231').set({...config,projectId:'project-manager-dashboar-a067f'});
  await assert.rejects(invoke('listDashboardProjectDrafts',{}),reason('draft-environment'));
  await assert.rejects(invoke('saveDashboardProject',restore,'admin'),reason('environment-forbidden'));
  assert.deepEqual(await data(weekRef),before);
  await db.collection('releaseCapabilities').doc('v231').set(config);
 });
 await writeFile(resolve(out,'browser-errors.json'),JSON.stringify(errors,null,2));
} finally {await browser?.close();if(server)await new Promise(r=>server.close(r));}
