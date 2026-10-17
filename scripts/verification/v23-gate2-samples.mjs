// Synthetic integration evidence: no network/Firestore/auth providers. Uses actual combined modules.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createReportHandler} from '../../pdf-service/src/app.js';
import {loadAuthorizedReport} from '../../pdf-service/src/report-data.js';
import {parseReportRequest} from '../../pdf-service/src/report-request.js';
import {buildDeliveryTrendsState,renderDeliveryTrendsPageHtml} from '../../js/delivery-trends-page.mjs';
import {renderPdfBuffer} from '../../pdf-service/src/pdf-renderer.js';
import {DELIVERY_TRENDS_CSS} from '../../js/delivery-trends-view.mjs';
const out=fileURLToPath(new URL('../../output/pdf/gate2/',import.meta.url));
const provenance={source:'synthetic',asOf:'2026-10-14T00:00:00Z'};
export function sampleWeeks(count,{missing=false,long=false}={}){
 const weeks=Array.from({length:13},(_,i)=>({weekId:`W${29+i}-2026`,weekLabel:`W${29+i} 2026`,reportingPeriod:{year:2026,week:29+i},version:1,isReleased:true,projects:Array.from({length:count},(_,j)=>({
  projectId:`synthetic-${j}`,code:`SYN-${j}`,name:long?`Synthetic international programme for manufacturing validation, customer enablement and enterprise delivery across multiple regional teams. Coordinated integration and release readiness review - Project Name Tail ${j}`:`Synthetic Project ${j+1}`,
  owner:long?`Synthetic cross-functional programme manager responsible for systems engineering, quality assurance and regional delivery coordination - Manager Tail ${j}`:`Synthetic Manager ${j+1}`,
  projectLevel:'system',visibility:'active',lifecycle:'active',baselineId:'baseline-1',progress:10+i*2+j*5,status:['green','yellow','red'][j%3],highlight:'Synthetic validation progress.',riskActions:[],milestones:[]
 }))}));
 if(missing){weeks.splice(10,1);const anchor=weeks.at(-1),prior=weeks.at(-2);anchor.projects[0].progress=null;anchor.projects[1].progress=0;anchor.projects[2].progress=prior.projects[2].progress;anchor.projects[3].progress=prior.projects[3].progress-20;
  for(const week of weeks.slice(0,-1))week.projects.push({projectId:'previous-only',code:'OLD',name:'Previously visible synthetic project',owner:'Synthetic Manager',projectLevel:'system',visibility:'active',lifecycle:'active',progress:80});}
 return weeks;
}
const cases=[['six-projects',6,{}],['seven-projects',7,{}],['fourteen-projects',14,{}],['missing-observations',6,{missing:true}],['long-names',6,{long:true}],['twelve-week-input',7,{windowWeeks:12}]];
await mkdir(out,{recursive:true});const evidence=[];
try {
 for(const [name,count,options] of cases){
  const weeks=sampleWeeks(count,options),anchor=weeks.at(-1),windowWeeks=options.windowWeeks||6;
  const requestBody={mode:'overview',weekId:anchor.weekId,overviewScope:'system',sections:['health-focus','portfolio-delivery-performance','risk-actions'],projectCodes:anchor.projects.map(p=>p.code)};
  const adapters={verifyIdToken:async()=>({email:'synthetic@example.test'}),getUserByEmail:async()=>({role:'pm'}),getWeekById:async()=>anchor,getDeliveryHistory:async()=>({weeks,complete:true}),getDeliveryTrendsProvenance:()=>provenance,deliveryTrendsWindowWeeks:windowWeeks};
  const report=await loadAuthorizedReport({request:parseReportRequest(requestBody,{deliveryPerformanceSection:true}),idToken:'synthetic-token',adapters});
  const web=buildDeliveryTrendsState({...provenance,weeks,currentIdx:weeks.length-1,role:'pm',historyComplete:true,windowWeeks,overviewScope:'system'});
  assert.deepEqual(web.contract,report.deliveryTrends);
  assert.equal(report.deliveryTrends.summary.weeklyProgressGainPp,options.missing?-10.6:2);
  assert.equal(report.deliveryTrends.summary.projectsProgressedCount,options.missing?2:count);
  const browserHtml=`<!doctype html><style>:root{--bg:#f7f8fc;--s1:white;--s2:#f7f8fc;--s3:#eef1f6;--border:#dde3eb;--border2:#cdd5e1;--text:#17243a;--muted:#66758a;--text-light:#415169;--blue:#3264db;--green:#16825d;--red:#bf3333;--yellow:#ad7600;--accent-hov:#3264db}body{font-family:Arial,sans-serif;padding:24px}${DELIVERY_TRENDS_CSS}</style>${renderDeliveryTrendsPageHtml(web,{windowWeeks})}`;
  await writeFile(join(out,`${name}.html`),browserHtml);
  let pdf;let status;const response={statusCode:0,setHeader:()=>{},writeHead:n=>{status=n;return response},end:data=>{pdf=data}};
  await createReportHandler({adapters,renderPdf:renderPdfBuffer,features:{deliveryPerformanceSection:true}})({headers:{authorization:'Bearer synthetic-token'},body:requestBody},response);
  assert.equal(response.statusCode||status,200,Buffer.isBuffer(pdf)?'PDF response expected':String(pdf));assert.ok(pdf.byteLength>1000);await writeFile(join(out,`${name}.pdf`),pdf);
  evidence.push({case:name,count,windowWeeks,summary:report.deliveryTrends.summary,warnings:report.deliveryTrends.warnings.map(w=>w.code),pdfPages:(Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length});
 }
 await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence.map(({case:name,pdfPages,summary})=>({name,pdfPages,gainPp:summary.weeklyProgressGainPp})),null,2));
} finally {await renderPdfBuffer.close();}
