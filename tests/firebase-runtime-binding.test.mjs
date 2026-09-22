import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('const isLocalPreview =');
const end=html.indexOf('const PROFESSIONAL_PDF_SERVICE_URL',start);
assert.ok(start>=0 && end>start);
for (const [hostname,search,expected] of [
  ['localhost','?emulator=1','demo-pm-dashboard-v22t'],
  ['127.0.0.1','?emulator=1','demo-pm-dashboard-v22t'],
  ['localhost','','pm-dashboard-uat-20260820-a7f3'],
  ['augusliang23-web.github.io','?emulator=1','pm-dashboard-uat-20260820-a7f3'],
]) test(`${hostname}${search} initializes the intended Firebase project`,()=>{
  let initialized;
  runInNewContext(html.slice(start,end),{
    window:{location:{hostname,search}},URLSearchParams,
    FIREBASE_CONFIG:{projectId:'pm-dashboard-uat-20260820-a7f3',apiKey:'fixture'},
    initializeApp:config=>{initialized=config;return {};},
  });
  assert.equal(initialized.projectId,expected);
  assert.equal(initialized.apiKey,'fixture');
});
