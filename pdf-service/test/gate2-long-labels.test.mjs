import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {renderDeliveryPerformanceDocument} from '../src/delivery-performance-report.js';
import {syntheticContract} from '../../tests/delivery-trends-synthetic-fixtures.mjs';
test('physical PDF name cells expose the full long project label without clipping',async()=>{
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage();await page.emulateMediaType('print');
 const c=syntheticContract();c.projects[0].name='Synthetic international programme for manufacturing validation, customer enablement and enterprise delivery across multiple regional teams. Coordinated integration and release readiness review - Project Name Tail 0';
 await page.setContent(renderDeliveryPerformanceDocument(c));
 const measurements=await page.$eval('.dp-name',el=>({client:el.clientHeight,scroll:el.scrollHeight}));
 assert.ok(measurements.client>=measurements.scroll,JSON.stringify(measurements));
 }finally{await browser.close()}
});
