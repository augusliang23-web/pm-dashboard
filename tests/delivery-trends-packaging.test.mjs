import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,mkdtemp,rm,copyFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { syncDeliveryTrendsPackage } from '../scripts/package-delivery-trends.mjs';
import { collectHostingAssets } from '../scripts/hosting-assets.mjs';
import { calculateDeliveryTrends } from '../shared/delivery-trends.mjs';
import { input } from '../shared/fixtures/delivery-trends.mjs';
const root=resolve(new URL('..',import.meta.url).pathname);
test('committed PDF source and hash match authoritative engine',async()=>{
 assert.deepEqual(await readFile(join(root,'shared/delivery-trends.mjs')),await readFile(join(root,'pdf-service/src/generated/delivery-trends.mjs')));
 await syncDeliveryTrendsPackage({rootDir:root,check:true});
});
test('standalone src artifact imports and returns identical presentation metrics',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v23-artifact-'));
 try {
  await mkdir(join(dir,'generated'));await copyFile(join(root,'pdf-service/src/generated/delivery-trends.mjs'),join(dir,'generated/delivery-trends.mjs'));
  await writeFile(join(dir,'fixture.json'),JSON.stringify(input()));
  const script=`import {readFileSync} from 'node:fs';import {calculateDeliveryTrends} from './generated/delivery-trends.mjs';console.log(JSON.stringify(calculateDeliveryTrends(JSON.parse(readFileSync('./fixture.json')))));`;
  const actual=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:dir,encoding:'utf8'}));
  assert.deepEqual(actual,calculateDeliveryTrends(input()));assert.equal(actual.summary.weeklyProgressGainPp,10);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('package check rejects drift without repairing it; generation is deterministic',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v23-package-'));
 try {
  await mkdir(join(dir,'shared'));await copyFile(join(root,'shared/delivery-trends.mjs'),join(dir,'shared/delivery-trends.mjs'));
  await syncDeliveryTrendsPackage({rootDir:dir});const generated=join(dir,'pdf-service/src/generated/delivery-trends.mjs');
  const before=await readFile(generated);await syncDeliveryTrendsPackage({rootDir:dir});assert.deepEqual(await readFile(generated),before);
  await writeFile(generated,'export const drift=true;');await assert.rejects(syncDeliveryTrendsPackage({rootDir:dir,check:true}));assert.equal(await readFile(generated,'utf8'),'export const drift=true;');
  await syncDeliveryTrendsPackage({rootDir:dir});await writeFile(join(dir,'shared/delivery-trends.mjs'),'changed');await assert.rejects(syncDeliveryTrendsPackage({rootDir:dir,check:true}));
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('Hosting collector includes shared engine through future static adapter import',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v23-hosting-'));
 try {
  await mkdir(join(dir,'js'));await mkdir(join(dir,'shared'));
  await writeFile(join(dir,'index.html'),'<script type="module">import "./js/delivery-trends-adapter.mjs";</script>');
  await copyFile(join(root,'js/delivery-trends-adapter.mjs'),join(dir,'js/delivery-trends-adapter.mjs'));
  await copyFile(join(root,'shared/delivery-trends.mjs'),join(dir,'shared/delivery-trends.mjs'));
  const assets=await collectHostingAssets(dir);assert.ok(assets.includes('shared/delivery-trends.mjs'));assert.ok(assets.includes('js/delivery-trends-adapter.mjs'));
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('standalone package checksum rejects modified artifact even without repository source',async()=>{
 const {verifyDeliveryTrendsPackage}=await import('../pdf-service/src/verify-delivery-trends-package.mjs');
 const dir=await mkdtemp(join(tmpdir(),'v23-checksum-'));
 try {
  await mkdir(join(dir,'generated'));await copyFile(join(root,'pdf-service/src/generated/delivery-trends.mjs'),join(dir,'generated/delivery-trends.mjs'));
  await copyFile(join(root,'pdf-service/src/generated/delivery-trends.sha256'),join(dir,'generated/delivery-trends.sha256'));
  await verifyDeliveryTrendsPackage({srcDir:dir});
  await writeFile(join(dir,'generated/delivery-trends.mjs'),'export const drift=true;');
  await assert.rejects(verifyDeliveryTrendsPackage({srcDir:dir}),/checksum mismatch/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('PDF deployment refuses recomputed-hash drift before deployment or env file creation',async()=>{
 const {runPdfDeploy}=await import('../pdf-service/scripts/deploy-pdf.mjs');
 const {createHash}=await import('node:crypto');
 const dir=await mkdtemp(join(tmpdir(),'v23-deploy-drift-'));let deployCalls=0;let envCalls=0;
 try {
  await mkdir(join(dir,'pdf-service/src/generated'),{recursive:true});await mkdir(join(dir,'shared'));
  await copyFile(join(root,'shared/delivery-trends.mjs'),join(dir,'shared/delivery-trends.mjs'));
  const modified=Buffer.concat([await readFile(join(root,'shared/delivery-trends.mjs')),Buffer.from('\n// drift\n')]);
  await writeFile(join(dir,'pdf-service/src/generated/delivery-trends.mjs'),modified);
  await writeFile(join(dir,'pdf-service/src/generated/delivery-trends.sha256'),createHash('sha256').update(modified).digest('hex'));
  await assert.rejects(runPdfDeploy(['--target','uat'],{cwd:join(dir,'pdf-service'),getGitState:async()=>({dirty:false}),
   getTrackedFiles:async()=>['src/server.js'],getUploadCandidates:async()=>['src/server.js'],log:()=>{},
   onEnvFile:()=>envCalls++,run:async()=>{deployCalls++;return 0;}}),/authoritative shared source/);
  assert.equal(deployCalls,0);assert.equal(envCalls,0);
 } finally {await rm(dir,{recursive:true,force:true});}
});
