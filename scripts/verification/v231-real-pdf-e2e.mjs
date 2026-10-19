// Actual authenticated HTTP report path, emulator Firestore and Chromium PDF rendering.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createReportHandler} from '../../pdf-service/src/app.js';
import {createBoundedDeliveryHistoryReader} from '../../pdf-service/src/report-data.js';
import {renderPdfBuffer} from '../../pdf-service/src/pdf-renderer.js';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,FieldPath}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const project='demo-pm-dashboard-v22t';
assert.equal(process.env.GCLOUD_PROJECT,project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9198');
const root=resolve(new URL('../..',import.meta.url).pathname),out=resolve(root,'outputs/v231-real-e2e');await mkdir(out,{recursive:true});
const app=initializeApp({projectId:project}),db=getFirestore(app),auth=getAuth(app);
const registry=JSON.parse(await readFile(resolve(root,'pdf-service/src/targets/registry.json')));
const adapters={
 verifyIdToken:token=>auth.verifyIdToken(token),
 getUserByEmail:async email=>(await db.collection('users').doc(email).get()).data(),
 getWeekById:async id=>(await db.collection('weeks').doc(id).get()).data(),
 getDashboardSettings:async()=>(await db.collection('dashboardSettings').doc('team-2-portfolio').get()).data(),
 getTrendWeeks:async()=>(await db.collection('weeks').get()).docs.map(d=>d.data()),
 getDeliveryHistory:createBoundedDeliveryHistoryReader({db,documentIdField:FieldPath.documentId()}),
 getDeliveryTrendsProvenance:()=>({source:'production',asOf:new Date().toISOString()})
};
const htmls=[];
const handler=createReportHandler({adapters,features:registry.targets.production.features,renderPdf:async html=>{htmls.push(html);return renderPdfBuffer(html);}});
const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;await handler({headers:req.headers,body:JSON.parse(raw)},res);});
await new Promise(r=>server.listen(8181,'127.0.0.1',r));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const results=[];
try{
 const response=await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'qa.admin@example.test',password:'LocalRelease!12345',returnSecureToken:true})});
 const {idToken}=await response.json();assert.ok(idToken);
 const request=async(body,token=idToken)=>fetch('http://127.0.0.1:8181/v1/reports/overview',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 for(const n of [6,12]){
  const body={mode:'overview',weekId:'W38',windowWeeks:n,sections:['health-focus','project-portfolio','portfolio-delivery-performance'],overviewScope:'all',projectCodes:['OLD']};
  const pdf=await request(body);if(pdf.status!==200)throw Error('PDF '+n+' weeks HTTP '+pdf.status+' '+await pdf.text());const html=htmls.at(-1);assert.match(html,new RegExp(n+'-week trend','i'));assert.equal((html.match(/class="dp-axis"/g)||[]).length,n,'actual rendered chart window');const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');await writeFile(resolve(out,`overview-${n}-weeks.pdf`),bytes);await writeFile(resolve(out,`overview-${n}-weeks.html`),htmls.at(-1));results.push({id:n===6?'E17':'E18',result:'PASS',method:'real emulator-authenticated HTTP + actual Firestore history + production feature policy + actual Chromium PDF',bytes:bytes.length});console.log('PASS PDF',n,bytes.length);
 }
 assert.equal((await request({mode:'overview',weekId:'W38',windowWeeks:9,sections:['health-focus'],projectCodes:['OLD']})).status,400);
 assert.equal((await request({mode:'overview',weekId:'W38',windowWeeks:6,sections:['health-focus'],projectCodes:['OLD']},null)).status,401);
 assert.equal((await request({mode:'overview',weekId:'W38',windowWeeks:6,sections:['health-focus'],projectCodes:['OLD']},'invalid')).status,401);
 assert.equal((await request({mode:'project',weekId:'W38',projectCode:'OLD',sections:['project-brief']})).status,400);
 results.push({id:'PDFSecurity',result:'PASS',method:'actual HTTP rejects missing/invalid token, invalid window, UAT-only section'});
}finally{
 await writeFile(resolve(out,'pdf-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),sourceCommit,project,features:registry.targets.production.features,results},null,2));await renderPdfBuffer.close();await new Promise(r=>server.close(r));
}
