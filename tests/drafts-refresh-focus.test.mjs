import test from 'node:test';
import assert from 'node:assert/strict';
import {mountProjectDraftsUi} from '../js/project-drafts-ui.mjs';
import {createProjectDraftsController} from '../js/project-drafts-controller.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function dom(){
 let doc;
 class Node{
  constructor(tag){this.tag=tag;this.ownerDocument=doc;this.children=[];this.attributes={};this.disabled=false;}
  append(...nodes){this.children.push(...nodes);}
  contains(n){return this===n||this.children.some(c=>c.contains(n));}
  replaceChildren(){if(this.contains(doc.activeElement))doc.activeElement=doc.body;this.children=[];}
  setAttribute(k,v){this.attributes[k]=v;}
  getAttribute(k){return this.attributes[k]??null;}
  all(){return this.children.flatMap(c=>[c,...c.all()]);}
  querySelectorAll(selector){return this.all().filter(n=>selector==='[data-draft-focus]'?n.attributes['data-draft-focus']!=null:selector==='.draft-table-scroll'?n.className==='draft-table-scroll':false);}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  focus(){if(!this.disabled)doc.activeElement=this;}
 }
 doc={createElement:tag=>new Node(tag)};doc.body=new Node('body');doc.activeElement=doc.body;return {doc,root:new Node('main'),outside:new Node('button')};
}
for(const kind of ['success','failure','empty','outside'])test(`Refresh restores its own keyboard focus after ${kind} without stealing external focus`,async()=>{
 const {doc,root,outside}=dom(),gate=deferred();let calls=0,ui;
 const rows=kind==='empty'?[]:[{draftId:'a',revision:1,project:{name:'A',code:'A'}}];
 const controller=createProjectDraftsController({api:{list:()=>++calls===1?Promise.resolve({drafts:rows,nextCursor:null}):gate.promise},onState:s=>ui?.render(s)});
 ui=mountProjectDraftsUi({root,controller,onNew(){}});controller.setIdentity({uid:'one'});await controller.refresh();
 const refresh=root.querySelectorAll('[data-draft-focus]').find(n=>n.getAttribute('data-draft-focus')==='refresh');refresh.focus();const pending=refresh.onclick();await new Promise(r=>setImmediate(r));assert.equal(root.attributes['aria-busy'],'true');
 if(kind==='outside')outside.focus();
 if(kind==='failure')gate.reject(Error('Refresh failed'));else gate.resolve({drafts:rows,nextCursor:null});await pending;
 assert.equal(root.attributes['aria-busy'],'false');
 if(kind==='outside')assert.equal(doc.activeElement,outside);else assert.equal(doc.activeElement.getAttribute('data-draft-focus'),'refresh');
});
