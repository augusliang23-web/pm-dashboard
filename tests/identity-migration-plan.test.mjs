import test from 'node:test';import assert from 'node:assert/strict';
import {planIdentityMigration} from '../scripts/identity-migration-plan.mjs';
const input={authUsers:[{uid:'admin-old-uid',email:'admin@example.test',emailVerified:true,providerData:[{providerId:'password'},{providerId:'google.com',uid:'approved-sub',email:'admin@example.test'}]}],dashboardUsers:[{email:'admin@example.test',data:{role:'admin',displayName:'Admin'}}],approvedMappings:[{uid:'admin-old-uid',email:'admin@example.test',googleSubject:'approved-sub'}]};
test('reviewed inventory preserves Admin UID/role and emits additive binding only',()=>{const p=planIdentityMigration(input);assert.deepEqual(p,[{email:'admin@example.test',patch:{authUid:'admin-old-uid',googleSubject:'approved-sub'}}]);assert.equal(input.dashboardUsers[0].data.authUid,undefined);});
for(const [label,mutate]of [
 ['missing approved mapping',i=>i.approvedMappings=[]],
 ['wrong UID',i=>i.approvedMappings[0].uid='other'],
 ['wrong Google subject',i=>i.approvedMappings[0].googleSubject='other'],
 ['email collision',i=>i.authUsers.push({...i.authUsers[0],uid:'other'})],
 ['UID collision',i=>i.approvedMappings.push({...i.approvedMappings[0],email:'pm@example.test'})],
 ['case-colliding user records',i=>i.dashboardUsers.push({...i.dashboardUsers[0],email:'ADMIN@example.test'})],
 ['unapproved reassignment',i=>i.dashboardUsers[0].data.authUid='already-bound-other'],
 ['unprovisioned role',i=>i.dashboardUsers=[]],
 ['disabled Auth account',i=>i.authUsers[0].disabled=true],
 ['wrong Google email',i=>i.authUsers[0].providerData[1].email='other@example.test'],
 ['unverified Google email',i=>i.authUsers[0].emailVerified=false],
])test(label+' fails closed',()=>{const i=structuredClone(input);mutate(i);assert.throws(()=>planIdentityMigration(i));});
test('password-only migration does not automatically approve linked Google',()=>{const i=structuredClone(input);delete i.approvedMappings[0].googleSubject;assert.deepEqual(planIdentityMigration(i)[0].patch,{authUid:'admin-old-uid'});});
