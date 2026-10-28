// Local-only Chromium harness. Real editor functions and callable adapter; synthetic DOM and callable.
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const puppeteer=require(process.env.PERF_PUPPETEER);
const baseline=process.argv.includes('--baseline');
const currentHtml=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const html=baseline?execFileSync('git',['show','bed827f5196cd74f9bfcddb917ecc60793345a52:index.html'],{encoding:'utf8'}):currentHtml;
const progressSource=readFileSync(new URL('../js/draft-save-progress.mjs',import.meta.url),'utf8').replace('export function ','function ');
const helperStart=currentHtml.indexOf('function beginDraftSaveProgress() {');
const progressHelper=currentHtml.slice(helperStart,currentHtml.indexOf('\n}',helperStart)+2);
function arrow(name){const start=html.indexOf(`window.${name} = async `);assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n};',start)+3);}
function func(name){const start=html.indexOf(`async function ${name}(`);assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n}',start)+2);}
const adapter=readFileSync(new URL('../js/project-drafts-api.mjs',import.meta.url),'utf8').replace('export function ','function ');
const save=arrow('saveProjEdit'), publish=arrow('saveAndPublishProjectDraft');
let start=arrow('saveDraftProject'),editor=func('saveEditorProjectDraft');
if(baseline){
 start=start.replace('if(projectMutationInFlight)return;',"if(projectMutationInFlight)return; performance.mark('pm-draft-save:t0');");
 editor=editor.replace("  const submittedBaseline = serializeEditorState(document.getElementById('projEditOverlay'));","  const submittedBaseline = serializeEditorState(document.getElementById('projEditOverlay'));\n  if (!publishing) performance.mark('pm-draft-save:t2');");
 editor=editor.replace("    showSaveToast(publishing?'Saved and published. Overview and PDF use this official content.':'Draft saved. Overview and PDF are unchanged.');","    showSaveToast(publishing?'Saved and published. Overview and PDF use this official content.':'Draft saved. Overview and PDF are unchanged.');\n    if (!publishing) performance.mark('pm-draft-save:t6-dom');");
}

const harness=`
let draftSaveProgress=null, activeDraftSavePermit=null, projectMutationInFlight=false, projectMutationInFlightToken=null;
${progressSource}
${progressHelper}
let currentUser={uid:'synthetic'},currentRole='pm',draftEditorSaveIntent='',draftEditorTargetWeekId='';
let draftEditorRecord={draftId:'synthetic',revision:1,project:{},assignment:{ownerEmail:'',deputyEmail:''}};
let projectEditorSession={token:1,authUid:'synthetic',originalProject:{}};
let allWeeks=[],delay=250, outcome='success',requests=0,toast='',shownError='',preparationState=null;
function isProjectEditorSessionCurrent(s){return s===projectEditorSession && currentUser?.uid===s?.authUid;}
function clearProjectMutationError(){document.querySelector('#error').textContent='';}
function setProjectMutationControlsDisabled(x){for(const id of ['pe_btn_save','pe_btn_publish','pe_btn_close'])document.getElementById(id).disabled=x;}
function configureDraftEditor(){document.querySelector('#pe_btn_save').textContent='Save Draft';document.querySelector('#projectDraftStatus').textContent='Draft';}
function showProjectMutationError(e,f){shownError=e?.message||f;document.querySelector('#error').textContent=shownError;}
function showSaveToast(t){toast=t;document.querySelector('#toast').textContent=t;}
function collectEditorResources(){preparationState={text:document.querySelector('#pe_btn_save').textContent,disabled:document.querySelector('#pe_btn_save').disabled,frames:performance.getEntriesByName('pm-draft-save:t1-paint-opportunity').length};if(outcome==='slow-preparation'){performance.mark('test:prepare-start');const end=performance.now()+80;while(performance.now()<end){}performance.mark('test:prepare-end');}return outcome==='validation'?null:{};}
function collectWorkstreams(){return []}; function validateWorkstreams(){return []};function showWorkstreamErrors(){};
function collectMilestonesWithHistory(){return []}; function collectRiskActionPairs(){return []};function getSelectedBudgetMode(){return 'manual'};
function getEditorPortfolioValue(id,v){return v}; function collectSummaryLanes(){return []};function collectTeamMembers(){return []};
function collectBudgetRows(){return []};function collectResourceBudgetStatus(){return {}};
function latestPublishWeekId(){return 'W1'};function buildDraftSaveInput({project}){return {project}};
function serializeEditorState(){return document.querySelector('#pe_name').value};
function closeModal(){document.querySelector('#projEditOverlay').classList.remove('open')};
${adapter}
const api=createProjectDraftsApi({functions:{},httpsCallable:(_,name)=>input=>{
 requests++; return new Promise((resolve,reject)=>{
  if(outcome==='stall')return;
  setTimeout(()=>{if(outcome==='failure'||outcome==='lost')reject(new Error(outcome==='lost'?'Response lost':'Network failure'));
  else resolve({data:{draft:{draftId:'synthetic',revision:2,project:input.project||{}},weekId:'W1'}})},delay);
 });
}});
const draftController={save:input=>api.save(input),publish:input=>api.publish(input)};
${save}\n${start}\n${publish}\n${editor}
window.synthetic={get:()=>({requests,toast,shownError,preparationState,inFlight:projectMutationInFlight,token:projectMutationInFlightToken,baseline:document.querySelector('#projEditOverlay').dataset.editorBaseline,recordRevision:draftEditorRecord?.revision}),
 configure:(d,o)=>{delay=d;outcome=o;},changeSession:()=>{projectEditorSession={token:2,authUid:'synthetic',originalProject:{}};activeDraftSavePermit={session:projectEditorSession};projectMutationInFlight=true;projectMutationInFlightToken=2;draftEditorRecord={draftId:'new',revision:9,project:{},assignment:{}};document.querySelector('#pe_name').value='new session';},
 cancel:()=>{projectEditorSession=null;activeDraftSavePermit=null;projectMutationInFlight=false;projectMutationInFlightToken=null;},
 marks:()=>Object.fromEntries(performance.getEntriesByType('mark').filter(x=>x.name.startsWith('pm-draft-save:')).map(x=>[x.name,x.startTime]))};
`;
const ids=['pe_name','pe_code','pe_owner','pe_deputy','pe_customer','pe_location','pe_visibility','pe_status','pe_progress','pe_attention','pe_highlight','pe_weekly_actions','pe_budget_currency','pe_budget_total'];
const dom=`<div id="projEditOverlay" class="open" data-editor-baseline="original"><div id="projectEditorFields">${ids.map(id=>`<input id="${id}" value="${id==='pe_name'?'Unsaved synthetic value':''}">`).join('')}</div><button id="pe_btn_save">Save Draft</button><button id="pe_btn_publish">Save &amp; Publish</button><button id="pe_btn_close">Close</button><div id="projectDraftPublicationStatus"><div id="projectDraftStatus" role="status"></div></div><div id="error"></div><div id="toast"></div></div>`;
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--disable-gpu']});
async function pageFor(delay=250,outcome='success') {const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.abort());await page.setContent(dom);await page.addScriptTag({content:harness});await page.evaluate((d,o)=>{window.synthetic.configure(d,o);document.getElementById('pe_btn_save').onclick=()=>window.saveDraftProject();document.getElementById('pe_btn_publish').onclick=()=>window.saveAndPublishProjectDraft();},delay,outcome);return page;}
async function waitDone(page){await page.waitForFunction(()=>!window.synthetic.get().inFlight,{timeout:10000});}
const results={conditions:{browser:await browser.version(),fixture:'synthetic DOM using extracted real Save Draft/editor code and callable adapter; mocked backend; local headless browser',viewport:'800x600',network:'all real requests blocked',injectedMs:[250,3000],paint:'DOM updates only; no actual paint is measured and save does not await animation frames',sampleCount:process.argv.includes('--smoke-only')?0:20,baseline,baselineInstrumentation:baseline?'test-only T0, T2, T6 marks plus same mock-callable adapter; no Saving state exists':undefined},scenarios:{},timings:{}};
try {
 let p, after;
 if(!baseline){
 p=await pageFor(250,'success');await p.click('#pe_btn_save');await p.waitForFunction(()=>window.synthetic.get().requests===1);let during=await p.evaluate(()=>window.synthetic.get());assert.equal(during.toast,'');assert.equal(during.preparationState.text,'Saving…');assert.equal(during.preparationState.disabled,true);assert.equal(during.preparationState.frames,0);await waitDone(p);after=await p.evaluate(()=>window.synthetic.get());assert.match(after.toast,/Draft saved/);assert.equal(after.requests,1);results.scenarios.success='PASS';await p.close();
 p=await pageFor(250,'success');await p.evaluate(()=>{window.saveDraftProject();window.saveDraftProject();});await waitDone(p);assert.equal((await p.evaluate(()=>window.synthetic.get())).requests,1);results.scenarios.doubleClick='PASS';await p.close();
 p=await pageFor(1,'validation');await p.click('#pe_btn_save');await waitDone(p);after=await p.evaluate(()=>window.synthetic.get());assert.equal(after.requests,0);assert.equal(await p.$eval('#pe_btn_save',e=>e.disabled),false);results.scenarios.validation='PASS';await p.close();
 for(const outcome of ['failure','lost']){p=await pageFor(20,outcome);await p.click('#pe_btn_save');await waitDone(p);after=await p.evaluate(()=>window.synthetic.get());assert.equal(after.requests,1);assert.equal(after.toast,'');assert.match(after.shownError,/uncertain/);assert.equal(await p.$eval('#pe_name',e=>e.value),'Unsaved synthetic value');results.scenarios[outcome]='PASS';await p.close();}
 p=await pageFor(250,'stall');await p.click('#pe_btn_save');await p.waitForFunction(()=>window.synthetic.get().requests===1);assert.equal(await p.$eval('#pe_btn_save',e=>e.textContent),'Saving…');mkdirSync('/private/tmp/pm-perf-02a-browser-evidence',{recursive:true});await p.screenshot({path:'/private/tmp/pm-perf-02a-browser-evidence/saving.png'});assert.equal((await p.evaluate(()=>window.synthetic.get())).toast,'');results.scenarios.stall='PASS (screenshot while pending)';await p.close();
 p=await pageFor(100,'success');await p.click('#pe_btn_save');await p.waitForFunction(()=>window.synthetic.get().requests===1);await p.evaluate(()=>window.synthetic.changeSession());await new Promise(r=>setTimeout(r,180));after=await p.evaluate(()=>window.synthetic.get());assert.equal(after.token,2);assert.equal(after.inFlight,true);assert.equal(after.recordRevision,9);assert.equal(after.toast,'');assert.equal(await p.$eval('#pe_name',e=>e.value),'new session');results.scenarios.staleSession='PASS';await p.close();
 p=await pageFor(100,'success');await p.click('#pe_btn_save');await p.waitForFunction(()=>window.synthetic.get().requests===1);await p.evaluate(()=>window.synthetic.cancel());await new Promise(r=>setTimeout(r,180));after=await p.evaluate(()=>window.synthetic.get());assert.equal(after.toast,'');results.scenarios.cancel='PASS';await p.close();
 p=await pageFor(30,'success');await p.evaluate(()=>{allWeeks=[{__documentId:'W1',weekLabel:'W1'}]});await p.click('#pe_btn_publish');await p.waitForFunction(()=>window.synthetic.get().requests===1);assert.equal(await p.$eval('#pe_btn_publish',e=>e.textContent),'Publishing…');await waitDone(p);assert.match((await p.evaluate(()=>window.synthetic.get())).toast,/Saved and published/);results.scenarios.publish='PASS';await p.close();
 p=await pageFor(20,'slow-preparation');await p.click('#pe_btn_save');await waitDone(p);after=await p.evaluate(()=>window.synthetic.get());assert.equal(after.preparationState.text,'Saving…');assert.equal(after.preparationState.frames,0);assert.match(after.toast,/Draft saved/);results.scenarios.slowPreparation='PASS (DOM mutation precedes 80ms synchronous work; paint not directly observed)';await p.close();
 if(process.argv.includes('--trace')){
   p=await pageFor(250,'slow-preparation');await p.tracing.start({path:'/private/tmp/pm-perf-02a-browser-evidence/paint-trace.json',screenshots:true});await p.click('#pe_btn_save');await waitDone(p);await p.tracing.stop();await p.close();
   const trace=JSON.parse(readFileSync('/private/tmp/pm-perf-02a-browser-evidence/paint-trace.json','utf8')).traceEvents;
   const begin=trace.find(e=>e.name==='test:prepare-start')?.ts, click=trace.find(e=>e.name==='pm-draft-save:t0')?.ts;
   const snaps=trace.filter(e=>e.name==='Screenshot'&&e.ts>=click&&e.ts<begin&&e.args?.snapshot);
   if(snaps.length)writeFileSync('/private/tmp/pm-perf-02a-browser-evidence/preparation-trace-frame.png',Buffer.from(snaps.at(-1).args.snapshot,'base64'));
   results.scenarios.tracePaint=`${snaps.length} screenshot frame(s) between click and preparation; inspect frame visually`;
 }
 }
 if (!process.argv.includes('--smoke-only')) for(const d of [250,3000]){
  const samples=[];
  for(let i=0;i<20;i++){
    const page=await pageFor(d,'success');await page.click('#pe_btn_save');await waitDone(page);const m=await page.evaluate(()=>window.synthetic.marks());await page.close();const v=k=>m['pm-draft-save:'+k];samples.push({feedbackOpportunity:null,preparation:v('t2')-v('t0'),callable:v('t4')-v('t3'),feedbackDom:v('t6-dom')-v('t0')});
  }
  const q=(k,p)=>k==='feedbackOpportunity'?null:samples.map(x=>x[k]).sort((a,b)=>a-b)[Math.ceil(samples.length*p)-1];
  results.timings[d]={samples,p50:Object.fromEntries(Object.keys(samples[0]).map(k=>[k,q(k,.5)])),p95:Object.fromEntries(Object.keys(samples[0]).map(k=>[k,q(k,.95)]))};
 }
 console.log(JSON.stringify(results,null,2));writeFileSync(baseline?'/private/tmp/pm-perf-02a-browser-evidence/baseline-results.json':process.argv.includes('--smoke-only')?'/private/tmp/pm-perf-02a-browser-evidence/smoke-results.json':'/private/tmp/pm-perf-02a-browser-evidence/results.json',JSON.stringify(results,null,2));
} finally {await browser.close();}
