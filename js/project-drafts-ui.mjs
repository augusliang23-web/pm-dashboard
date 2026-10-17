import { projectRevisionFingerprint } from './project-mutations.mjs';
export function draftPublicationState(draft){return !draft.lastPublication?'Never published':draft.lastPublication.draftRevision===draft.revision?'Published':'Unpublished changes';}
export function eligibleDraftWeeks(weeks,draft){
  return weeks.filter(w=>{
    if(!w || w.isReleased===true)return false;
    if(draft?.source && draft.lastPublication?.draftRevision===0 && (w.__documentId||w.weekLabel.replace(/\s+/g,'-'))!==draft.source.weekId)return false;
    if(!draft?.lastPublication)return true;
    const match=String(w.weekLabel || '').match(/^W(\d{1,2})\s+(\d{4})$/i);
    return match && Number(match[1])>=1 && Number(match[1])<=53 && Number(match[2])*100+Number(match[1])>=draft.lastPublication.weekOrder;
  }).map(w=>({id:w.__documentId||w.weekLabel.replace(/\s+/g,'-'),label:w.weekLabel}));
}
export function buildDraftPublicationInput(draft,weekId,week) {
  const target=week?.projects?.find(p=>p.publication?.draftId===draft.draftId || (draft.source?.weekId===weekId && p.code===draft.source.projectCode && !p.publication?.draftId));
  return {draftId:draft.draftId,expectedRevision:draft.revision,weekId,expectedPublishedRevision:target?(target.__revisionFingerprint || projectRevisionFingerprint(target)):null};
}
export function buildDraftSaveInput({draft,project,assignment,weekId,week}) {
  const {owner,deputy,...content}=project;
  return {draftId:draft.draftId,expectedRevision:draft.revision,project:content,
    ...(draft.source?{source:draft.source}:{}),...(assignment?{assignment}:{}),
    ...(weekId?buildDraftPublicationInput(draft,weekId,week):{})};
}
export function mountProjectDraftsUi({root,controller,onEdit}) {
  const doc=root.ownerDocument;
  const node=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
  const run=operation=>Promise.resolve().then(operation).catch(()=>{});
  function render(state){
    root.replaceChildren();
    const message=node('p',state.error||'Drafts remain available across weeks. Open the editor and choose Save Draft or Save & Publish.');message.setAttribute('role','status');root.append(message);
    const refresh=node('button','Refresh');refresh.className='btn btn-ghost';refresh.disabled=state.busy;refresh.onclick=()=>run(()=>controller.refresh());root.append(refresh);
    if(!state.drafts.length)root.append(node('p',state.busy?'Loading…':'No drafts yet. Add a project or edit an existing active project to begin.'));
    for(const draft of state.drafts){
      const row=node('article');row.className='draft-list-row';
      const label={ 'Never published':'Never published',Published:'Published','Unpublished changes':'Unpublished changes'}[draftPublicationState(draft)];
      row.append(node('h4',`${draft.project.name||'Untitled project'} · ${draft.project.code||'No code yet'}`),node('p',label),node('p',`Draft progress: ${draft.project.progress ?? 0}%`));
      if(draft.lastPublication?.publishedAt)row.append(node('p',`Last published: ${draft.lastPublication.weekId} · ${draft.lastPublication.publishedAt}`));
      const edit=node('button','Edit Project');edit.className='btn btn-primary';edit.disabled=state.busy;edit.onclick=()=>run(async()=>{const result=await controller.open(draft.draftId);if(result)await onEdit(result.draft);});row.append(edit);
      root.append(row);
    }
    if(state.nextCursor){const more=node('button','Load more');more.className='btn btn-ghost';more.disabled=state.busy;more.onclick=()=>run(()=>controller.refresh({cursor:state.nextCursor}));root.append(more);}
  }
  return {render,dispose:()=>root.replaceChildren()};
}
