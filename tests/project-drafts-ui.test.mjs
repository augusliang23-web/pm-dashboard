import test from 'node:test';import assert from 'node:assert/strict';
import {draftPublicationState,eligibleDraftWeeks} from '../js/project-drafts-ui.mjs';
test('draft states distinguish never-published, published and unpublished edits',()=>{assert.equal(draftPublicationState({revision:1,lastPublication:null}),'Never published');assert.equal(draftPublicationState({revision:2,lastPublication:{draftRevision:1}}),'Unpublished changes');assert.equal(draftPublicationState({revision:2,lastPublication:{draftRevision:2}}),'Published');});
test('no open week leaves no publish target while stored draft remains editable',()=>{assert.deepEqual(eligibleDraftWeeks([{isReleased:true}]),[]);assert.deepEqual(eligibleDraftWeeks([{__documentId:'W1',weekLabel:'W1',isReleased:false}]).map(w=>w.id),['W1']);});
test('Publish compares the server fingerprint rather than normalized display fields', async()=>{const {buildDraftPublicationInput}=await import('../js/project-drafts-ui.mjs');const project={progress:40,publication:{draftId:'a'},displayOnly:true};Object.defineProperty(project,'__revisionFingerprint',{value:'stored-version'});assert.deepEqual(buildDraftPublicationInput({draftId:'a',revision:3},'W1',{projects:[project]}),{draftId:'a',expectedRevision:3,weekId:'W1',expectedPublishedRevision:'stored-version'});});
test('Publish targets exclude reporting weeks before the latest publication',()=>{
 const weeks=[{weekLabel:'W9 2026'},{weekLabel:'W10 2026'},{weekLabel:'W1 2027'},{weekLabel:'invalid'}];
 assert.deepEqual(eligibleDraftWeeks(weeks,{lastPublication:{weekOrder:202610}}).map(w=>w.label),['W10 2026','W1 2027']);
});
test('My Drafts resumes editing instead of exposing a separate publication step',async()=>{
 const {mountProjectDraftsUi}=await import('../js/project-drafts-ui.mjs');
 class Node {constructor(tag,text){this.tag=tag;this.children=[];this.value='';this.textContent=text||'';this.ownerDocument=doc;}append(...items){this.children.push(...items);}replaceChildren(){this.children=[];}setAttribute(){} }
 const doc={createElement:tag=>new Node(tag)},root=new Node('main');let edited;
 const controller={open:async id=>({draft:{draftId:id,revision:3}})};
 const ui=mountProjectDraftsUi({root,controller,onEdit:draft=>{edited=draft;}});ui.render({drafts:[{draftId:'a',revision:3,project:{}}]});
 const row=root.children.find(node=>node.tag==='article');assert.equal(row.children.filter(node=>node.textContent==='Publish').length,0);
 row.children.find(node=>node.textContent==='編輯專案').onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(edited.revision,3);
});
