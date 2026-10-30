import test from 'node:test';import assert from 'node:assert/strict';
import {mountProjectDraftsUi} from '../js/project-drafts-ui.mjs';
import {dashboardSource} from './helpers/dashboard-source.mjs';
class Node{constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.ownerDocument=doc;this.textContent='';}append(...items){this.children.push(...items);}replaceChildren(){this.children=[];}setAttribute(k,v){this.attributes[k]=v;}}
const doc={createElement:tag=>new Node(tag)};
const flatten=n=>[n,...n.children.flatMap(flatten)];
const drafts=[{draftId:'b',revision:2,project:{name:'Beta',code:'B',progress:62},lastPublication:{draftRevision:1,weekId:'W43',publishedAt:'2026-10-23T01:02:00Z'}},{draftId:'a',revision:1,project:{name:'Alpha',code:'A',progress:0},lastPublication:null}];
test('semantic table preserves server order, real states, draft progress and SGT timestamp',()=>{
 const root=new Node('main');mountProjectDraftsUi({root,controller:{},onOpen(){},onNew(){}}).render({drafts,busy:false});const nodes=flatten(root);
 assert.equal(nodes.filter(n=>n.tag==='table').length,1);assert.deepEqual(nodes.filter(n=>n.tag==='th').map(n=>n.textContent),['Project / Code','Draft Progress','Publication Status','Last Published','Actions']);
 assert.deepEqual(nodes.filter(n=>n.tag==='tr'&&n.attributes['data-draft-id']).map(n=>n.attributes['data-draft-id']),['b','a']);
 assert.ok(nodes.some(n=>n.textContent==='Unpublished changes'));assert.ok(nodes.some(n=>n.textContent==='Never published'));assert.ok(nodes.some(n=>/09:02.*SGT/.test(n.textContent)));
 assert.equal(nodes.filter(n=>n.textContent==='New Draft').length,1);assert.equal(nodes.filter(n=>n.textContent==='Refresh').length,1);
});
test('row edit delegates directly to improved opening flow; no duplicate get',async()=>{let opened;const root=new Node('main');mountProjectDraftsUi({root,controller:{open(){throw Error('must use the shared shell handler');}},onOpen:id=>{opened=id;},onNew(){}}).render({drafts,busy:false});flatten(root).find(n=>n.textContent==='Edit Project').onclick();await new Promise(r=>setImmediate(r));assert.equal(opened,'b');});
for(const state of [{drafts:[],busy:true},{drafts:[],busy:false},{drafts:[],busy:false,error:'Permission denied'}])test(`accessible state ${JSON.stringify(state)}`,()=>{const root=new Node('main');mountProjectDraftsUi({root,controller:{},onNew(){}}).render(state);const nodes=flatten(root);assert.ok(nodes.some(n=>n.attributes.role==='status'||n.attributes.role==='alert'));if(state.error)assert.ok(nodes.some(n=>n.textContent==='Permission denied'));});
test('editor exposes a labelled published actions dialog and preserves lifecycle controls',()=>{const source=dashboardSource();assert.doesNotMatch(source,/manage\.textContent = 'Manage Project'/);assert.match(source,/id="projectDraftManage"[^>]+aria-haspopup="dialog"/);assert.doesNotMatch(source,/manage\.className = 'btn-icon project-more-actions/);for(const id of ['projectVisibilityAction','projectDeleteAction','projectVisibilitySelect','archivedProjectsBtn'])assert.ok(source.includes(id));assert.match(source,/Permanently delete this project/);});
