import { projectRevisionFingerprint } from './project-mutations.mjs';
export function draftPublicationState(draft){return !draft.lastPublication?'Never published':draft.lastPublication.draftRevision===draft.revision?'Published':'Unpublished changes';}
export function eligibleDraftWeeks(weeks){return weeks.filter(w=>w&&w.isReleased!==true).map(w=>({id:w.__documentId||w.weekLabel.replace(/\s+/g,'-'),label:w.weekLabel}));}
export function buildDraftPublicationInput(draft,weekId,week) {
  const target=week?.projects?.find(p=>p.publication?.draftId===draft.draftId);
  return {draftId:draft.draftId,expectedRevision:draft.revision,weekId,expectedPublishedRevision:target?(target.__revisionFingerprint || projectRevisionFingerprint(target)):null};
}
export function mountProjectDraftsUi({root,controller,onEdit,onPublished,getWeeks=()=>[],canPublish=()=>true,canManage=()=>false,onManage=()=>{}}) {
  const doc=root.ownerDocument;
  const node=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
  const run=operation=>Promise.resolve().then(operation).catch(()=>{});
  function render(state){
    const selected=root.querySelector('select')?.value;
    root.replaceChildren();
    const message=node('p',state.error||state.message||'Drafts stay private to their editors. Save Draft does not update Overview.');message.setAttribute('role','status');root.append(message);
    const refresh=node('button','Refresh');refresh.className='btn btn-ghost';refresh.disabled=state.busy;refresh.onclick=()=>run(()=>controller.refresh());root.append(refresh);
    const label=node('label','Publish to week: '),weekSelect=node('select');weekSelect.className='fs';weekSelect.setAttribute('aria-label','Publish to week');
    const weeks=eligibleDraftWeeks(getWeeks());for(const week of weeks){const option=node('option',week.label);option.value=week.id;weekSelect.append(option);}if(weeks.some(w=>w.id===selected))weekSelect.value=selected;
    label.append(weekSelect);root.append(label);
    if(!weeks.length)root.append(node('p','No unpublished week is available. You can still edit and save Drafts.'));
    if(!state.drafts.length)root.append(node('p','No drafts yet. Use New Project to start.'));
    for(const draft of state.drafts){
      const row=node('article');row.className='draft-list-row';
      row.append(node('h4',`${draft.project.name||'Untitled project'} · ${draft.project.code||'No code'}`),node('p',draftPublicationState(draft)),node('p',`Working progress: ${draft.project.progress ?? 0}% · Overview changes only after Publish.`));
      if(draft.lastPublication)row.append(node('p',`Last published: ${draft.lastPublication.weekId} · ${draft.lastPublication.publishedAt}`));
      const edit=node('button','Edit Draft');edit.className='btn btn-ghost';edit.disabled=state.busy;edit.onclick=()=>run(async()=>{const result=await controller.open(draft.draftId);if(result)await onEdit(result.draft);});
      const publish=node('button','Publish');publish.className='btn btn-primary';publish.disabled=state.busy||!weeks.length||!canPublish(draft);
      publish.onclick=()=>run(async()=>{
        // Get the latest saved draft before publishing; an editor never submits unsaved fields here.
        const latest=await controller.open(draft.draftId);if(!latest)return;
        const week=getWeeks().find(w=>(w.__documentId||w.weekLabel.replace(/\s+/g,'-'))===weekSelect.value);
        const result=await controller.publish(buildDraftPublicationInput(latest.draft,weekSelect.value,week));
        if(result){await onPublished(result);await controller.refresh();}
      });row.append(edit,publish);
      if(draft.lastPublication && canManage()){const manage=node('button','Manage published project');manage.className='btn btn-ghost';manage.disabled=state.busy;manage.onclick=()=>run(()=>onManage(draft,weekSelect.value));row.append(manage);}
      root.append(row);
    }
    if(state.nextCursor){const more=node('button','Load more');more.className='btn btn-ghost';more.disabled=state.busy;more.onclick=()=>run(()=>controller.refresh({cursor:state.nextCursor}));root.append(more);}
  }
  return {render,dispose:()=>root.replaceChildren()};
}
