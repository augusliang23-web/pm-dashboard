// Bounded R6 lab: authentic fixed-generation old handlers, local demo storage/auth only. See docs/r6-rollback/REPORT.md.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
const root=resolve(process.env.R6_LAB_ROOT||process.cwd()),require=createRequire(resolve(root,'deps/package.json'));
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9198');
const projectId='demo-pm-dashboard-v22t',app=initializeApp({projectId}),db=getFirestore(app),auth=getAuth(app);
const puppeteer=createRequire(process.env.R6_BROWSER_PACKAGE||resolve(root,'candidate/pdf-service/package.json'))('puppeteer');
const emails={admin:'mixed.admin@example.test',second:'mixed.second@example.test',pm:'mixed.pm@example.test',other:'mixed.other@example.test',vip:'mixed.vip@example.test'},password=randomBytes(18).toString('base64url'),tokens={};
const results=[],trace=[];let mode='old',browser,server,stripAuth=false;const errors=[];
const snapshot=async()=>({drafts:(await db.collection('projectDrafts').get()).docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.id.localeCompare(b.id)),weeks:(await db.collection('weeks').get()).docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.id.localeCompare(b.id))});
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,status:'FAIL',error:e.stack});console.error('FAIL '+name+' '+e.stack);throw e;}}
async function invoke(name,data,who='admin') {const r=await fetch('http://127.0.0.1:5108/'+projectId+'/us-central1/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+tokens[who]}:{})},body:JSON.stringify({data})});const b=await r.json();if(b.error)throw Object.assign(Error(b.error.message),b.error);return b.result;}
const project=(code)=>({name:'Synthetic '+code,code,progress:21,projectLevel:'system',visibility:'active'});
const fingerprint=(await import(resolve(root,'candidate/js/project-mutations.mjs'))).projectRevisionFingerprint;
const wait=async(fn,label)=>{for(let n=0;n<150;n++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+label);};
const reason=want=>e=>e.details?.reason===want;
async function pmCycle(prefix){let {draft}=await invoke('saveDashboardProjectDraft',{expectedRevision:0,project:project(prefix)},'pm');assert.equal(draft.assignment.ownerEmail,emails.pm);assert.equal((await invoke('getDashboardProjectDraft',{draftId:draft.draftId},'pm')).draft.project.code,prefix);await invoke('publishDashboardProjectDraft',{draftId:draft.draftId,expectedRevision:draft.revision,weekId:'W43',expectedPublishedRevision:null},'pm');assert.ok((await invoke('listDashboardProjectDrafts',{},'pm')).drafts.some(d=>d.draftId===draft.draftId));return draft;}
async function newPage(site,who='admin'){
 const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width:1440,height:1100});page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(['127.0.0.1','localhost','www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname)||u.protocol==='data:')r.continue();else r.abort();});
 const fill=(selector,value)=>page.$eval(selector,(e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));},value);
 const ready=()=>page.waitForFunction(()=>document.querySelector('#syncDot')?.classList.contains('ok')&&document.querySelector('#bannerTitle')?.textContent.includes('W43')&&getComputedStyle(document.querySelector('#globalLoader')).display==='none',{timeout:30000});
 const login=async(who)=>{await page.waitForFunction(()=>typeof window.handleLogin==='function'&&getComputedStyle(document.querySelector('#globalLoader')).display==='none');await fill('#email',emails[who]);await fill('#password',password);await page.click('#loginOverlay button');await ready();};
 await page.goto('http://127.0.0.1:4198/'+site+'/?emulator=1&firestorePort=8188&authPort=9198&functionsPort=5108',{waitUntil:'domcontentloaded'});await login(who);await page.waitForSelector('#addProjectBtn',{visible:true,timeout:15000});
 const open=async id=>{await page.evaluate(id=>window.openManagedProjectDraft(id),id);await page.waitForSelector('#projEditOverlay.open');};
 const close=async()=>{await page.waitForFunction(()=>!document.querySelector('#pe_btn_save').disabled);await page.evaluate(()=>window.closeModal('projEditOverlay',{force:true}));};
 return {page,context,fill,ready,login,open,close};
}
async function browserPm(site,code){const p=await newPage(site,'pm');await p.page.click('#addProjectBtn');await p.page.waitForSelector('#projEditOverlay.open');await p.fill('#pe_name',code);await p.fill('#pe_code',code);await p.page.click('#pe_btn_save');const draft=await wait(async()=>{const s=await db.collection('projectDrafts').get();return s.docs.map(d=>d.data()).find(d=>d.project.code===code);},code+' save');await p.page.waitForFunction(()=>!document.querySelector('#pe_btn_publish').disabled);await p.page.click('#pe_btn_publish');await wait(async()=>(await db.collection('weeks').doc('W43').get()).data().projects.some(x=>x.code===code),code+' publish');await p.context.close();assert.equal(draft.assignment.ownerEmail,emails.pm);}
try{
 server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path.startsWith('/'+projectId+'/us-central1/')){const name=path.split('/').at(-1),mapped=name==='saveDashboardProjectDraft'?(mode==='old'?'oldSave':'newSave'):name==='publishDashboardProjectDraft'?(mode==='old'?'oldPublish':'newPublish'):name;
   const allowed=['oldSave','newSave','oldPublish','newPublish','getDashboardProjectDraft','listDashboardProjectDrafts','saveDashboardProject'];if(!allowed.includes(mapped)){res.writeHead(403).end();return;}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);trace.push({mode,name,target:mapped});const upstream=await fetch('http://127.0.0.1:5118/'+projectId+'/us-central1/'+mapped,{method:req.method,headers:{'content-type':'application/json',...(req.headers.authorization&&!stripAuth?{authorization:req.headers.authorization}:{}),...(req.headers.origin?{origin:req.headers.origin}:{}),...(req.headers['access-control-request-method']?{'access-control-request-method':req.headers['access-control-request-method']}:{}),...(req.headers['access-control-request-headers']?{'access-control-request-headers':req.headers['access-control-request-headers']}:{})},...(req.method!=='OPTIONS'?{body:Buffer.concat(chunks)}:{})});res.writeHead(upstream.status,Object.fromEntries([...upstream.headers].filter(([k])=>!['content-length','content-encoding','transfer-encoding'].includes(k))));const bytes=Buffer.from(await upstream.arrayBuffer());try{const body=JSON.parse(bytes);if(body.error){trace.at(-1).errorCode=body.error.status;trace.at(-1).errorReason=body.error.details?.reason;}}catch{}res.end(bytes);return;
  }
  const [,site,...parts]=path.split('/');if(!['old','new','prod'].includes(site)){res.writeHead(404).end();return;}const dir=resolve(root,site+'-site'),file=resolve(dir,parts.join('/')||'index.html');if(!file.startsWith(dir+'/')){res.writeHead(403).end();return;}res.setHeader('Content-Type',extname(file)==='.html'?'text/html':/\.m?js$/.test(file)?'text/javascript':'application/octet-stream');res.end(await readFile(file));
 }catch(e){console.error('HTTP',e.message);res.writeHead(500).end();}});
 await new Promise(r=>server.listen(5108,'127.0.0.1',r));
 // A second local listener shares the same routing handler for actual static dashboard pages.
 const staticServer=createServer(server.listeners('request')[0]);await new Promise(r=>staticServer.listen(4198,'127.0.0.1',r));server.staticServer=staticServer;
 await fetch('http://127.0.0.1:9198/emulator/v1/projects/'+projectId+'/accounts',{method:'DELETE'});
 await fetch('http://127.0.0.1:8188/emulator/v1/projects/'+projectId+'/databases/(default)/documents',{method:'DELETE'});
 for(const [who,email] of Object.entries(emails)){await auth.createUser({uid:'mixed-'+who,email,password,emailVerified:true});await db.collection('users').doc(email).set({role:['admin','second'].includes(who)?'admin':who==='other'?'pm':who,displayName:'Mixed '+who,isProjectManager:['pm','other'].includes(who)});const signed=await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})}).then(r=>r.json());assert.ok(signed.idToken);tokens[who]=signed.idToken;}
 for(let n=41;n<=43;n++)await db.collection('weeks').doc('W'+n).set({weekLabel:'W'+n+' 2026',weekDate:'Oct '+(5+(n-41)*7)+' - Oct '+(9+(n-41)*7),isReleased:false,version:1,projects:[],summary:'Synthetic mixed-version fixture'});
 await db.collection('dashboardSettings').doc('team-2-portfolio').set({ganttTemplates:{system:['Planning','Delivery'],'hardware-module':['EVT'],software:['Development']},revision:'fixture'});
 assert.equal((await db.collection('releaseCapabilities').doc('v231').get()).exists,false);
 browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-setuid-sandbox']});
 mode='old';await check('Baseline old PM and missing capability document',async()=>{await pmCycle('BASE-PM');assert.equal((await invoke('getDashboardProjectDraft',{capabilities:true})).draftsEnabled,true);});
 mode='new';const saved=await invoke('saveDashboardProjectDraft',{expectedRevision:0,project:{...project('T3-SELF'),name:'T3-SELF'},assignment:{ownerEmail:emails.admin}});const selfId=saved.draft.draftId;await invoke('publishDashboardProjectDraft',{draftId:selfId,expectedRevision:saved.draft.revision,weekId:'W43',expectedPublishedRevision:null});mode='old';
 await check('R1 old Hosting remains forbidden: absent Admin option; persisted data unchanged',async()=>{const before=await snapshot(),p=await newPage('old');await p.open(selfId);assert.equal(await p.page.$eval('#pe_owner',e=>e.value),'');await p.context.close();assert.deepEqual(await snapshot(),before);});
 for(const profile of ['new','prod']){
  await check('R2 '+profile+' existing Admin owner progress saves by two Admins',async()=>{for(const [who,value] of [['admin',81],['second',82]]){const p=await newPage(profile,who);await p.open(selfId);assert.equal(await p.page.$eval('#pe_owner',e=>e.value),emails.admin);await p.fill('#pe_progress',value);await p.page.click('#pe_btn_save');await wait(async()=>(await db.collection('projectDrafts').doc(selfId).get()).data().project.progress===value,'R2 progress');assert.equal((await db.collection('projectDrafts').doc(selfId).get()).data().assignment.ownerEmail,emails.admin);await p.context.close();}});
  await check('R3 '+profile+' old Publish preserves official Admin owner and content',async()=>{const p=await newPage(profile);await p.open(selfId);await p.fill('#pe_progress',83);await p.page.click('#pe_btn_publish');await wait(async()=>(await db.collection('weeks').doc('W43').get()).data().projects.find(x=>x.code==='T3-SELF')?.progress===83,'R3 publish');assert.equal((await db.collection('weeks').doc('W43').get()).data().projects.find(x=>x.code==='T3-SELF').owner,'Mixed admin');await p.context.close();});
  await check('R5 '+profile+' old backend PM browser save and publish',()=>browserPm(profile,'PM-'+profile.toUpperCase()));
  for(const action of ['save','publish'])await check('R6 '+profile+' '+action+' assignment rejection retains all inputs, inline error and retry',async()=>{
   const before=await snapshot(),p=await newPage(profile),code='R6-'+profile.toUpperCase()+'-'+action.toUpperCase();await p.page.click('#addProjectBtn');await p.page.waitForSelector('#projEditOverlay.open');
   for(const [selector,value] of [['#pe_name',code],['#pe_code',code],['#pe_progress',37],['#pe_customer','Unsaved customer'],['#pe_location','Unsaved location']])await p.fill(selector,value);
   await p.page.select('#pe_owner',emails.admin);await p.page.select('#pe_lifecycle','on-hold');
   const form=()=>p.page.$$eval('#projEditOverlay input, #projEditOverlay select, #projEditOverlay textarea',es=>es.map(e=>({id:e.id,value:e.value,checked:e.checked??null})));
   const original=await form();await p.page.click(action==='save'?'#pe_btn_save':'#pe_btn_publish');await p.page.waitForFunction(()=>document.querySelector('#projectMutationError').classList.contains('show')&&!document.querySelector('#pe_btn_save').disabled,{timeout:15000});
   assert.equal(await p.page.$eval('#projEditOverlay',e=>e.classList.contains('open')),true);assert.deepEqual(await form(),original);assert.equal(await p.page.$eval('#pe_owner',e=>e.value),emails.admin);assert.match(await p.page.$eval('#projectMutationError',e=>e.textContent),/Assignment must select an existing PM account/);assert.equal(await p.page.$eval('#saveToast',e=>e.classList.contains('show')),false);assert.deepEqual(await snapshot(),before);
   await p.page.screenshot({path:resolve(root,'r6-green-'+profile+'-'+action+'.png')});
   await p.page.select('#pe_owner',emails.pm);await p.page.click('#pe_btn_save');const draft=await wait(async()=>(await db.collection('projectDrafts').get()).docs.map(d=>d.data()).find(d=>d.project.code===code),'R6 retry');assert.equal(draft.project.name,code);assert.equal(draft.project.customer,'Unsaved customer');assert.equal(draft.assignment.ownerEmail,emails.pm);await p.context.close();
  });
  for(const kind of ['unauthenticated','role-forbidden','draft-forbidden'])await check('Security '+profile+' '+kind+' real backend rejection clears protected editor',async()=>{
   const who=kind==='draft-forbidden'?'pm':'admin';const {draft}=await invoke('saveDashboardProjectDraft',{expectedRevision:0,project:project('SECURITY-'+profile+'-'+kind)},who);
   const p=await newPage(profile,who);await p.open(draft.draftId);await p.fill('#pe_name','Unsaved protected input');
   if(kind==='unauthenticated')stripAuth=true;
   if(kind==='role-forbidden')await db.collection('users').doc(emails.admin).update({role:'vip'});
   if(kind==='draft-forbidden')await db.collection('projectDrafts').doc(draft.draftId).update({editorEmails:[emails.other]});
   const before=await snapshot();await p.page.click('#pe_btn_save');await p.page.waitForFunction(()=>!document.querySelector('#projEditOverlay').classList.contains('open'),{timeout:15000});
   assert.equal(await p.page.$eval('#pe_name',e=>e.value),'');assert.deepEqual(await snapshot(),before);const last=trace.findLast(t=>t.name==='saveDashboardProjectDraft'&&t.errorReason);assert.equal(last.errorReason,kind);
   stripAuth=false;if(kind==='role-forbidden')await db.collection('users').doc(emails.admin).update({role:'admin'});await p.context.close();
  });
 }
 await check('R4 old backend API denies new assignment without writes and permits PM',async()=>{const before=await snapshot();await assert.rejects(invoke('saveDashboardProjectDraft',{expectedRevision:0,project:project('R4-DENY'),assignment:{ownerEmail:emails.admin}}),reason('assignment-forbidden'));assert.deepEqual(await snapshot(),before);await pmCycle('R4-PM');});
 await check('R7 original self owner and published content remain intact',async()=>{const d=(await db.collection('projectDrafts').doc(selfId).get()).data(),p=(await db.collection('weeks').doc('W43').get()).data().projects.find(p=>p.code==='T3-SELF');assert.equal(d.assignment.ownerEmail,emails.admin);assert.equal(d.project.name,'T3-SELF');assert.equal(d.project.progress,83);assert.equal(p.owner,'Mixed admin');assert.equal(p.progress,83);assert.equal(p.name,'T3-SELF');});
 assert.equal((await db.collection('releaseCapabilities').doc('v231').get()).exists,false);assert.deepEqual(errors,[]);
 console.log('ALL '+results.length+' GROUPS PASS');
}finally{await writeFile(resolve(root,'r6-green-results.json'),JSON.stringify({results,errors,trace,missingCapabilityDocument:!(await db.collection('releaseCapabilities').doc('v231').get()).exists,finalSnapshot:await snapshot()},null,2));await browser?.close();await new Promise(r=>server?.staticServer?.close(r));await new Promise(r=>server?.close(r));await db.terminate();}
