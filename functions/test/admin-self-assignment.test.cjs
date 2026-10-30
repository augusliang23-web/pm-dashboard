const test=require('node:test'),assert=require('node:assert/strict');
const {buildDraftRecord}=require('../project-drafts-core');
const admin={uid:'a',email:'admin@example.test',role:'admin',displayName:'Synthetic Admin'};
function build(actor=admin,assignment={ownerEmail:admin.email},users={[admin.email]:{role:'admin',displayName:'Synthetic Admin'}}){return buildDraftRecord({actor,input:{expectedRevision:0,project:{name:'Self',code:'SELF'},assignment},assignmentUsers:users,draftId:'self',nowIso:'2026-10-23T00:00:00Z'});}
test('verified Admin may select normalized self only as primary PM',()=>{const d=build(admin,{ownerEmail:' ADMIN@EXAMPLE.TEST '});assert.equal(d.assignment.ownerEmail,admin.email);assert.equal(d.project.owner,'Synthetic Admin');assert.deepEqual(d.editorEmails,[admin.email]);});
test('verified Admin may select self as Deputy',()=>{const d=build(admin,{deputyEmail:admin.email});assert.equal(d.assignment.deputyEmail,admin.email);assert.equal(d.project.deputy,'Synthetic Admin');});
for(const [name,actor,assignment,users] of [
 ['other Admin',admin,{ownerEmail:'other@example.test'},{'other@example.test':{role:'admin'}}],
 ['other Admin deputy',admin,{deputyEmail:'other@example.test'},{'other@example.test':{role:'admin'}}],
 ['missing document',admin,{ownerEmail:admin.email},{}],
 ['invalid role',admin,{ownerEmail:admin.email},{[admin.email]:{role:'vip'}}],
 ['PM cannot assign Admin',{...admin,role:'pm'},{ownerEmail:admin.email},{[admin.email]:{role:'admin'}}],
 ['VIP cannot assign',{...admin,role:'vip'},{ownerEmail:admin.email},{[admin.email]:{role:'admin'}}],
 ['no auth',{...admin,uid:''},{ownerEmail:admin.email},{[admin.email]:{role:'admin'}}]
])test(name+' remains rejected',()=>assert.throws(()=>build(actor,assignment,users)));
test('normal PM targets and automatic PM self remain unchanged',()=>{assert.equal(build(admin,{ownerEmail:'pm@example.test'},{'pm@example.test':{role:'pm',displayName:'PM'}}).project.owner,'PM');assert.equal(build({...admin,role:'pm'},null,{}).assignment.ownerEmail,admin.email);});
