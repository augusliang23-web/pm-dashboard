import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {dashboardIdentityError}=require('../functions/dashboard-identity.js');
const identity={uid:'approved-admin',email:'admin@example.test',claims:{email:'admin@example.test',firebase:{sign_in_provider:'password'}}};
const user={authUid:'approved-admin',role:'admin',googleSubject:'approved-google-sub'};
const google={...identity,claims:{...identity.claims,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':['approved-google-sub']}}}};
test('bound password and separately approved Google retain the same UID/role',()=>{assert.equal(dashboardIdentityError(identity,user),'');assert.equal(dashboardIdentityError(google,user),'');});
for(const role of ['admin','pm'])test(`${role} email cannot transfer privileges to another UID`,()=>assert.equal(dashboardIdentityError({...identity,uid:'unapproved'}, {...user,role}),'identity-binding-mismatch'));
for(const [label,input,record,reason]of [
 ['missing binding',identity,{role:'admin'},'identity-binding-required'],
 ['missing account',identity,null,'identity-binding-required'],
 ['disabled',identity,{...user,active:false},'identity-disabled'],
 ['unrecognized role',identity,{...user,role:'superadmin'},'identity-role-forbidden'],
 ['unknown provider',{...identity,claims:{...identity.claims,firebase:{sign_in_provider:'custom'}}},user,'identity-provider-forbidden'],
 ['unverified Google',{...google,claims:{...google.claims,email_verified:false}},user,'identity-google-unverified'],
 ['unapproved Google',google,{...user,googleSubject:undefined},'identity-google-unapproved'],
 ['wrong Google subject',google,{...user,googleSubject:'other-sub'},'identity-google-unapproved'],
 ['multiple Google subjects',{...google,claims:{...google.claims,firebase:{...google.claims.firebase,identities:{'google.com':['approved-google-sub','other']}}}},user,'identity-google-unapproved'],
 ['missing uid',{...identity,uid:''},user,'identity-binding-required'],
 ['email claim mismatch',{...identity,claims:{...identity.claims,email:'pm@example.test'}},user,'identity-email-mismatch'],
 ['forged token role',{...identity,claims:{...identity.claims,role:'admin'}},{...user,role:'pm'},''],
])test(label,()=>assert.equal(dashboardIdentityError(input,record),reason));
test('all shipped runtimes contain identical pure identity contract',()=>{const source=readFileSync(new URL('../functions/dashboard-identity.js',import.meta.url));for(const f of ['../js/dashboard-identity.js','../pdf-service/src/dashboard-identity.js'])assert.deepEqual(readFileSync(new URL(f,import.meta.url)),source);});
