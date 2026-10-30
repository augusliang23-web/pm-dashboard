import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../functions/project-drafts.js',import.meta.url),'utf8');
test('Production actor lookup, UID/email requirement and server-side permission resolution are byte-preserved',()=>{const a=source.indexOf('async function readActor('),b=source.indexOf('\nasync function readDraft(',a);assert(a>=0&&b>a);assert.equal(createHash('sha256').update(source.slice(a,b)).digest('hex'),'20bec0866cb907dc31047924583fa860e620acbab9225168d208f64418372f47');});
test('existing Production runtime options remain unchanged',()=>assert(source.includes("const OPTIONS={serviceAccount:'pmdash-project-drafts@',maxInstances:20};")));
