import { getLocalEmulatorConfig } from '../js/local-emulator-config.mjs';
import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const html=await dashboardSourceAsync('uat');
const start=html.indexOf('const localEmulator = getLocalEmulatorConfig(window.location);');
const appInit=html.indexOf('FIREBASE_CONFIG);',start);
const end=appInit+'FIREBASE_CONFIG);'.length;
assert.ok(start>=0 && appInit>start);
for (const [hostname,search,expected] of [
  ['localhost','?emulator=1','demo-pm-dashboard-v22t'],
  ['127.0.0.1','?emulator=1','demo-pm-dashboard-v22t'],
  ['localhost','','pm-dashboard-uat-20260820-a7f3'],
  ['augusliang23-web.github.io','?emulator=1','pm-dashboard-uat-20260820-a7f3'],
]) test(`${hostname}${search} initializes the intended Firebase project`,()=>{
  let initialized;
  runInNewContext(html.slice(start,end),{
    window:{location:{hostname,search}},URLSearchParams,getLocalEmulatorConfig,IS_UAT_PROFILE:true,
    FIREBASE_CONFIG:{projectId:'pm-dashboard-uat-20260820-a7f3',apiKey:'fixture'},
    initializeApp:config=>{initialized=config;return {};},
  });
  assert.equal(initialized.projectId,expected);
  assert.equal(initialized.apiKey,'fixture');
});
