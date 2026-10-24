import test from 'node:test';import assert from 'node:assert/strict';
import {createProjectDraftsController} from '../js/project-drafts-controller.mjs';
test('old account responses cannot repopulate draft state',async()=>{let resolve;const states=[];const controller=createProjectDraftsController({api:{list:()=>new Promise(r=>resolve=r)},onState:s=>states.push(s)});controller.setIdentity({uid:'a',email:'a@example.com'});const pending=controller.refresh();controller.setIdentity({uid:'b',email:'b@example.com'});resolve({drafts:[{draftId:'secret'}],nextCursor:null});await pending;assert.deepEqual(states.at(-1).drafts,[]);});
test('saved draft and publish failure remain separate from official data',async()=>{const official={progress:40};let state;const c=createProjectDraftsController({api:{save:async()=>({draft:{draftId:'a',revision:2,project:{progress:65}}}),publish:async()=>{throw Error('conflict');}},onState:s=>state=s});c.setIdentity({uid:'a',email:'a@example.com'});await c.save({});assert.equal(state.selected.project.progress,65);await assert.rejects(c.publish({}),/conflict/);assert.equal(state.selected.project.progress,65);assert.equal(official.progress,40);assert.equal(state.busy,false);});
test('reset invalidates pending save success and clears protected contents',async()=>{let resolve,state;const c=createProjectDraftsController({api:{save:()=>new Promise(r=>resolve=r)},onState:s=>state=s});c.setIdentity({uid:'a',email:'a@example.com'});const pending=c.save({});c.reset();resolve({draft:{project:{highlight:'secret'}}});await pending;assert.equal(state.selected,null);assert.deepEqual(state.drafts,[]);});
test('permission denial clears protected draft state instead of retaining stale access',async()=>{let state;const c=createProjectDraftsController({api:{save:async()=>({draft:{draftId:'a',project:{highlight:'secret'}}}),get:async()=>{throw Object.assign(Error('revoked'),{code:'functions/permission-denied'});}},onState:s=>state=s});c.setIdentity({uid:'a',email:'a@example.com'});await c.save({});await assert.rejects(c.open('a'));assert.equal(state.selected,null);assert.deepEqual(state.drafts,[]);});
test('a list refresh cannot invalidate an authoritative pending publish response',async()=>{
 let finishPublish,finishList,state;
 const c=createProjectDraftsController({api:{publish:()=>new Promise(r=>finishPublish=r),list:()=>new Promise(r=>finishList=r)},onState:s=>state=s});
 c.setIdentity({uid:'a',email:'a@example.com'});
 const publishing=c.publish({draftId:'a'}),refreshing=c.refresh();
 finishPublish({draft:{draftId:'a',revision:2,project:{progress:60}},weekId:'W43'});
 assert.equal((await publishing)?.draft.revision,2);
 finishList({drafts:[{draftId:'a',revision:1}],nextCursor:null});await refreshing;
 assert.equal(state.drafts[0].revision,2,'late stale list must not replace confirmed publication');
 assert.equal(state.busy,false);
});
for(const [code,reason] of [['functions/permission-denied','role-forbidden'],['functions/permission-denied','draft-forbidden'],['permission-denied','ownership-forbidden'],['functions/unauthenticated',undefined]])test(`${code}/${reason}: access loss invalidates older list and selection lanes`,async()=>{
 let listResolve,getResolve,state;
 const c=createProjectDraftsController({api:{list:()=>new Promise(r=>listResolve=r),get:()=>new Promise(r=>getResolve=r),save:async()=>{throw Object.assign(Error('access lost'),{code,details:{reason}});}},onState:s=>state=s});
 c.setIdentity({uid:'a'});const list=c.refresh(),selection=c.open('private');await assert.rejects(c.save({}));
 listResolve({drafts:[{draftId:'private',project:{name:'Secret'}}],nextCursor:'private-cursor'});getResolve({draft:{draftId:'private',project:{name:'Secret'}}});await Promise.all([list,selection]);
 assert.deepEqual(state.drafts,[]);assert.equal(state.selected,null);assert.equal(state.nextCursor,null);assert.equal(state.busy,false);
});
