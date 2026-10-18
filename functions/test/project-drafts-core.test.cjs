const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDraftRecord, assertDraftAccess, validateDraftInput } = require('../project-drafts-core');
const admin = { uid:'a', email:'admin@example.com', role:'admin', displayName:'Admin' };
const pm = { uid:'p', email:'owner@example.com', role:'pm', displayName:'Owner', permissionOverrides:{'project.manage':true} };
const nowIso = '2026-10-14T00:00:00Z';
const create = (actor=pm, input={expectedRevision:0,project:{name:'',code:'',progress:0}}) => buildDraftRecord({actor,input,draftId:'draft-one',nowIso,assignmentUsers:{}});
test('an Admin or PM can create a new draft without project.manage, and it stays incomplete until Publish', () => {
  const draft = create();
  assert.deepEqual(draft.editorEmails, ['owner@example.com']);
  assert.equal(draft.project.owner,'Owner'); assert.equal(draft.revision,1);
  assert.equal(draft.lastPublication,null);
  assert.doesNotThrow(()=>create({...pm,permissionOverrides:{}}));                 // no project.manage needed to create a draft
  assert.throws(()=>create({...pm,role:'vip'}), /permission/i);                      // other roles still cannot
  assert.doesNotThrow(()=>validateDraftInput(draft.project,{publishing:false}));
  assert.throws(()=>validateDraftInput(draft.project,{publishing:true}), /name|code/i);
});
test('stored email ACL, not display-name or forged role, controls draft access', () => {
  const draft=create();
  assert.doesNotThrow(()=>assertDraftAccess({...pm,permissionOverrides:{}},draft,'save'));
  for (const actor of [null,{...pm,email:'other@example.com'}, {...pm,role:'engineering'}, {...pm,role:'PM'}, {...pm,uid:''}]) {
    assert.throws(()=>assertDraftAccess(actor,draft,'read'), /permission|sign in/i);
  }
  assert.doesNotThrow(()=>assertDraftAccess(admin,draft,'read'));
});
test('revision, metadata, assignment and published code cannot be forged', () => {
  const existing=create();
  const save=input=>buildDraftRecord({actor:pm,existing,input,draftId:existing.draftId,nowIso});
  assert.throws(()=>save({expectedRevision:0,project:{}}), /conflict/i);
  assert.throws(()=>save({expectedRevision:1,project:{},editorEmails:['other@example.com']}), /unsupported/i);
  assert.throws(()=>save({expectedRevision:1,project:{owner:'Other'}}), /assignment/i);
  assert.throws(()=>save({expectedRevision:1,project:{},assignment:{ownerEmail:'other@example.com'}}), /permission/i);
  const published={...existing,project:{...existing.project,code:'ALPHA'},lastPublication:{weekId:'W1'},publicationTargets:{W1:{draftRevision:1}}};
  assert.throws(()=>buildDraftRecord({actor:pm,existing:published,input:{expectedRevision:1,project:{code:'BETA'}},draftId:'draft-one',nowIso}), /code/i);
  const saved=save({expectedRevision:1,project:{progress:65}});
  assert.equal(saved.project.progress,65); assert.equal(existing.project.progress,0);
});
test('draft fields are bounded and progress values must be real percentages', () => {
  for (const progress of [-1,101,NaN,'40']) assert.throws(()=>validateDraftInput({progress}), /progress|finite/i);
  for (const progress of [0,100]) assert.equal(validateDraftInput({progress}).progress,progress);
  for (const project of [{visibility:'archived'},{publication:{}},{highlight:'x'.repeat(20001)},{teamMembers:Array(2001).fill({})}]) assert.throws(()=>validateDraftInput(project));
});
test('Admin assignment resolves directory users and PM cannot borrow a same-name user', () => {
  const draft=buildDraftRecord({actor:admin,input:{expectedRevision:0,project:{},assignment:{ownerEmail:'pm@example.com',deputyEmail:''}},assignmentUsers:{'pm@example.com':{role:'pm',displayName:'Person'}},draftId:'assigned',nowIso});
  assert.deepEqual(draft.editorEmails,['pm@example.com']);
  assert.equal(draft.project.owner,'Person');
  assert.throws(()=>assertDraftAccess({...pm,email:'impostor@example.com',displayName:'Person'},draft,'read'));
});
test('existing editor discipline resources are maps, not an array',()=>{assert.deepEqual(validateDraftInput({resources:{firmware:{estimated:12,actual:4}}}).resources,{firmware:{estimated:12,actual:4}});});
