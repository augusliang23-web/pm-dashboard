import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as drafts from '../js/project-drafts-controller.mjs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const callback=source.split('\n').find(line=>line.startsWith('const draftController = createProjectDraftsController('));
function setup(error){
 let state,invalidated=0;
 const record={draftId:'private',revision:1,project:{name:'Saved',highlight:'Protected'}};
 const context=vm.createContext({...drafts,projectDraftsApi:{get:async()=>({draft:record}),save:async()=>{throw error;}},latestDraftState:null,draftWorkspaceUi:{render(s){state=s;}},allWeeks:[],draftRenderQueued:false,draftEditorRecord:record,
  invalidateProjectEditorSession(){invalidated++;},showSaveToast(){}});
 vm.runInContext(callback+'\nthis.controller=draftController;',context);
 context.controller.setIdentity({uid:'admin',email:'admin@example.test'});
 return {context,record,get state(){return state;},get invalidated(){return invalidated;}};
}
for(const code of ['permission-denied','functions/permission-denied'])test(`${code} assignment rejection retains private selection and editor`,async()=>{
 const error=Object.assign(Error('Arbitrary localized backend text'),{code,details:{reason:'assignment-forbidden'}}),s=setup(error);
 await s.context.controller.open('private');await assert.rejects(s.context.controller.save({project:{name:'Unsaved'}}),e=>e===error);
 assert.ok(s.state.selected,'assignment rejection must retain selected draft');assert.equal(s.state.selected.draftId,'private');assert.equal(s.context.draftEditorRecord.draftId,'private');assert.equal(s.invalidated,0);assert.equal(s.state.errorReason,'assignment-forbidden');assert.equal(s.state.busy,false);assert.equal(s.state.message,'');
});
for(const [name,code,details] of [
 ['unauthenticated','functions/unauthenticated',undefined],['unauthenticated misleading reason','functions/unauthenticated',{reason:'assignment-forbidden'}],['raw unauthenticated','unauthenticated',{reason:'assignment-forbidden'}],
 ['role revoked','functions/permission-denied',{reason:'role-forbidden'}],['draft revoked','functions/permission-denied',{reason:'draft-forbidden'}],['ownership revoked','permission-denied',{reason:'ownership-forbidden'}],
 ['missing details','functions/permission-denied',undefined],['empty details','functions/permission-denied',{}],['malformed reason','functions/permission-denied',{reason:['assignment-forbidden']}],['unknown denial','functions/permission-denied',{reason:'unknown'}],
])test(`${name} still clears protected controller and editor state`,async()=>{
 const s=setup(Object.assign(Error('assignment-forbidden text must not select recovery'),{code,details}));await s.context.controller.open('private');await assert.rejects(s.context.controller.save({}));
 assert.equal(s.state.selected,null);assert.deepEqual(s.state.drafts,[]);assert.equal(s.context.draftEditorRecord,undefined);assert.equal(s.invalidated,1);
});

test('retry without structured details cannot reuse an earlier recoverable reason',async()=>{
 let attempt=0,state;const c=drafts.createProjectDraftsController({api:{get:async()=>({draft:{draftId:'private'}}),save:async()=>{throw Object.assign(Error('denied'),{code:'functions/permission-denied',...(attempt++===0?{details:{reason:'assignment-forbidden'}}:{})});}},onState:s=>state=s});
 c.setIdentity({uid:'admin'});await c.open('private');await assert.rejects(c.save({}));assert.ok(state.selected);await assert.rejects(c.save({}));assert.equal(state.selected,null);assert.equal(state.errorReason,'');
});
