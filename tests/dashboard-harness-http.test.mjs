import test from 'node:test';
import assert from 'node:assert/strict';
import {serveProfile} from './browser/dashboard-harness.mjs';
test('browser fixture server returns 404 for a missing asset and keeps serving valid assets',async()=>{
 const server=await serveProfile('prod');
 try {
  assert.equal((await fetch(`${server.baseUrl}/favicon.ico`)).status,204);
  const missing=await fetch(`${server.baseUrl}/missing-synthetic-asset.js`);
  assert.equal(missing.status,404);
  const page=await fetch(`${server.baseUrl}/`);
  assert.equal(page.status,200);
  assert.match(await page.text(),/<!doctype html>/i);
 } finally {await server.close();}
});
