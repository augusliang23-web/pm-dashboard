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
export function mountProjectDraftsUi({root,controller,onEdit,canManage=()=>false,onManage=()=>{},getWeeks=()=>[]}) {
  const doc=root.ownerDocument;
  const node=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
  const run=operation=>Promise.resolve().then(operation).catch(()=>{});
  function render(state){
    root.replaceChildren();
    const message=node('p',state.error||'草稿可跨週保留；請開啟編輯畫面，選擇「存成草稿」或「存檔並發布」。');message.setAttribute('role','status');root.append(message);
    const refresh=node('button','重新整理');refresh.className='btn btn-ghost';refresh.disabled=state.busy;refresh.onclick=()=>run(()=>controller.refresh());root.append(refresh);
    if(!state.drafts.length)root.append(node('p',state.busy?'載入中…':'目前沒有草稿。新增專案或編輯既有專案即可開始。'));
    for(const draft of state.drafts){
      const row=node('article');row.className='draft-list-row';
      const label={ 'Never published':'尚未發布',Published:'已發布','Unpublished changes':'有尚未發布的修改'}[draftPublicationState(draft)];
      row.append(node('h4',`${draft.project.name||'未命名專案'} · ${draft.project.code||'尚無代碼'}`),node('p',label),node('p',`草稿進度：${draft.project.progress ?? 0}%`));
      if(draft.lastPublication?.publishedAt)row.append(node('p',`上次發布：${draft.lastPublication.weekId} · ${draft.lastPublication.publishedAt}`));
      const edit=node('button','編輯專案');edit.className='btn btn-primary';edit.disabled=state.busy;edit.onclick=()=>run(async()=>{const result=await controller.open(draft.draftId);if(result)await onEdit(result.draft);});row.append(edit);
      if(draft.lastPublication && canManage()){const manage=node('button','專案管理');manage.className='btn btn-ghost';manage.disabled=state.busy;manage.onclick=()=>run(()=>onManage(draft,draft.lastPublication.weekId));row.append(manage);}
      root.append(row);
    }
    if(state.nextCursor){const more=node('button','載入更多');more.className='btn btn-ghost';more.disabled=state.busy;more.onclick=()=>run(()=>controller.refresh({cursor:state.nextCursor}));root.append(more);}
  }
  return {render,dispose:()=>root.replaceChildren()};
}
