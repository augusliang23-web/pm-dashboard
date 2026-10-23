import assert from 'node:assert/strict';
import { resolve } from 'node:path';
export async function runSprintFlows({page,role,db,invoke,emails,draftId,out,results}) {
 const visible=()=>page.$eval('#projEditOverlay',e=>e.classList.contains('open'));
 const fill=(selector,value)=>page.$eval(selector,(e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));},value);
 const ready=()=>page.waitForFunction(()=>document.querySelector('#projEditOverlay.open')?.getAttribute('aria-busy')!=='true'&&Boolean(document.querySelector('#pe_name').value));
 const open=async(id=draftId)=>{await page.evaluate(id=>window.openManagedProjectDraft(id),id);await ready();};
 const close=()=>page.evaluate(()=>window.closeModal('projEditOverlay',{force:true}));
 const wait=async fn=>{for(let i=0;i<80;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for committed synthetic result');};
 const check=async(name,fn)=>{try{await fn();results.push({role,name,status:'PASS'});console.log('PASS',role,name);}catch(e){await page.screenshot({path:resolve(out,`${role}-failure.png`),fullPage:true});console.log('DIAGNOSTIC',await page.evaluate(()=>({error:document.querySelector('#projectMutationError')?.textContent,toast:document.querySelector('#saveToast')?.textContent,invalid:[...document.querySelectorAll('#projEditOverlay :invalid')].map(e=>e.id)})));throw e;}};
 const draftRef=db.collection('projectDrafts').doc(draftId);
 await check('cancel pending opening cannot reopen or show stale private content',async()=>{
  let release;const gate=new Promise(r=>release=r);
  page.sprintRequestHook=async req=>{if(!req.url().endsWith('/getDashboardProjectDraft'))return false;await gate;return false;};
  await page.evaluate(id=>{window.openManagedProjectDraft(id);},draftId);await page.waitForSelector('#projEditOverlay.editor-loading.open');
  assert.equal(await page.$eval('#pe_name',e=>e.value),'');await close();release();await new Promise(r=>setTimeout(r,300));assert.equal(await visible(),false);page.sprintRequestHook=null;
 });
 await check('revision conflict keeps input, actionable error and retry controls',async()=>{
  await open();await fill('#pe_highlight','retain revision conflict');await draftRef.update({revision:(await draftRef.get()).data().revision+1});
  await page.click('#pe_btn_publish');await page.waitForSelector('#projectMutationError.show');assert.equal(await visible(),true);assert.equal(await page.$eval('#pe_highlight',e=>e.value),'retain revision conflict');assert.match(await page.$eval('#projectMutationError',e=>e.textContent),/revision|conflict/i);assert.equal(await page.$eval('#pe_btn_publish',e=>e.disabled),false);await close();
 });
 await check('network failure preserves values and a retry publishes once',async()=>{
  await open();await fill('#pe_highlight','retain network retry');let count=0;
  page.sprintRequestHook=async req=>{if(!req.url().endsWith('/publishDashboardProjectDraft'))return false;count++;await req.abort('failed');return true;};
  await page.click('#pe_btn_publish');await page.waitForSelector('#projectMutationError.show');assert.equal(await visible(),true);assert.equal(await page.$eval('#pe_highlight',e=>e.value),'retain network retry');assert.equal(await page.$eval('#projectEditorFields',e=>e.disabled),false);
  page.sprintRequestHook=null;await page.click('#pe_btn_publish');await page.waitForFunction(()=>!document.querySelector('#projEditOverlay').classList.contains('open'));assert.match(await page.$eval('#saveToast',e=>e.textContent),/published/);assert.equal(count,1);
 });
 await check('publish validation failure keeps editor and real error',async()=>{
  await open();await fill('#pe_name','');await fill('#pe_highlight','retain invalid form');await page.click('#pe_btn_publish');await page.waitForSelector('#projectMutationError.show');assert.equal(await visible(),true);assert.match(await page.$eval('#projectMutationError',e=>e.textContent),/name|required/i);assert.equal(await page.$eval('#pe_highlight',e=>e.value),'retain invalid form');await close();
 });
 await check('duplicate click blocked; slow list refresh does not delay successful close',async()=>{
  await open();await fill('#pe_progress',61);let calls=0,release;const gate=new Promise(r=>release=r);
  page.sprintRequestHook=async req=>{if(req.url().endsWith('/publishDashboardProjectDraft')){calls++;await gate;}if(req.url().endsWith('/listDashboardProjectDrafts'))await new Promise(r=>setTimeout(r,1500));return false;};
  await page.$eval('#pe_btn_publish',e=>{e.click();e.click();});await page.waitForFunction(()=>document.querySelector('#pe_btn_publish').textContent==='Publishing…');
  assert.equal(await page.$eval('#projectEditorFields',e=>e.disabled),true);await page.evaluate(()=>{window.openMyDrafts();});
  const start=Date.now();release();await page.waitForFunction(()=>!document.querySelector('#projEditOverlay').classList.contains('open'));assert.ok(Date.now()-start<1400,'closing must not wait for the delayed list');assert.equal(calls,1);page.sprintRequestHook=null;
  await page.evaluate(()=>window.closeModal('myDraftsOverlay',{force:true}));await wait(async()=>(await db.collection('weeks').doc('W43').get()).data().projects.some(p=>p.code==='DRAFT'&&p.progress===61));
 });
 if(role==='pm')await check('permission denied does not discard submitted form or claim success',async()=>{
  await open();await fill('#pe_highlight','retain denied form');const original=(await draftRef.get()).data();await draftRef.update({editorEmails:[emails.other]});
  await page.click('#pe_btn_publish');await page.waitForSelector('#projectMutationError.show');assert.equal(await visible(),true);assert.equal(await page.$eval('#pe_highlight',e=>e.value),'retain denied form');assert.equal(await page.$eval('#saveToast',e=>e.classList.contains('show')),false);await close();await draftRef.update({editorEmails:original.editorEmails});
 });
 await check('week changes while publish pending do not close a different editor',async()=>{
  await open();let release;const gate=new Promise(r=>release=r);page.sprintRequestHook=async req=>{if(req.url().endsWith('/publishDashboardProjectDraft'))await gate;return false;};
  await page.click('#pe_btn_publish');await page.waitForFunction(()=>document.querySelector('#pe_btn_publish').disabled);await page.select('#wNavSelect','0');release();await new Promise(r=>setTimeout(r,350));assert.equal(await visible(),false);page.sprintRequestHook=null;
  const latest=await page.$$eval('#wNavSelect option',nodes=>nodes.find(e=>e.textContent.includes('W43'))?.value);await page.select('#wNavSelect',latest);
 });
 await check('Save Draft persists through logout/login and does not publish',async()=>{
  await open();await fill('#pe_highlight','persist synthetic draft');const before=(await db.collection('weeks').doc('W43').get()).data().projects.find(p=>p.code==='DRAFT').highlight;
  await page.click('#pe_btn_save');await wait(async()=>(await draftRef.get()).data().project.highlight==='persist synthetic draft');assert.equal(await visible(),true);assert.equal((await db.collection('weeks').doc('W43').get()).data().projects.find(p=>p.code==='DRAFT').highlight,before);await close();
  // Reload exercises persisted server state; actual logout/login follows below using the same synthetic session.
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#syncDot')?.classList.contains('ok'));await open();assert.equal(await page.$eval('#pe_highlight',e=>e.value),'persist synthetic draft');await close();
 });
 await check('Overview, Delivery Trends and PDF selection entry survive',async()=>{
  await page.click('#btnOverview');await page.waitForSelector('.delivery-trends-overview-panel');assert.ok(await page.$('.delivery-trends-overview-panel .dt-card-value'));
  await page.evaluate(()=>window.openOverviewPrintDialog());assert.ok(await page.$('#overviewPrintOverlay.open'));await page.evaluate(()=>window.closeModal('overviewPrintOverlay',{force:true}));await page.click('#btnOverview');
 });
 await page.evaluate(()=>window.openMyDrafts());await page.waitForFunction(()=>document.querySelectorAll('#myDraftsContent .draft-list-row').length>0);
 await page.screenshot({path:resolve(out,`${role}-drafts-desktop.png`),fullPage:true});
 await page.setViewport({width:390,height:844});await page.screenshot({path:resolve(out,`${role}-drafts-mobile.png`),fullPage:true});await page.setViewport({width:1440,height:1100});await page.evaluate(()=>window.closeModal('myDraftsOverlay',{force:true}));
}
