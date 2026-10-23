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
// Publish always targets the latest applicable reporting week: the last week the existing eligibility rules allow (never a released or historical week).
export function latestPublishWeekId(weeks,draft){return eligibleDraftWeeks(weeks,draft).at(-1)?.id||'';}
export function draftNeedsPublish(draft){return draftPublicationState(draft)!=='Published';}
const emailOf=value=>String(value||'').trim().toLowerCase();
// Server lists only the caller's drafts (Admin: all); the dashboard additionally shows only drafts the viewer authors or is assigned to.
export function visibleDraftsFor(drafts,email){const me=emailOf(email);return (drafts||[]).filter(d=>d&&((d.editorEmails||[]).some(e=>emailOf(e)===me)||emailOf(d.createdBy)===me));}
export function newProjectDrafts(drafts,email,weeks,currentWeekId){return visibleDraftsFor(drafts,email).filter(d=>!d.source&&!d.lastPublication&&latestPublishWeekId(weeks,d)===currentWeekId);}
export function draftForProject(drafts,email,weekId,project){return visibleDraftsFor(drafts,email).find(d=>draftNeedsPublish(d)&&(d.source||d.lastPublication)&&(project?.publication?.draftId===d.draftId||(d.source?.weekId===weekId&&d.source?.projectCode===project?.code)))||null;}
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
export function formatDraftPublishedAt(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Singapore',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date) + ' SGT';
}
export function mountProjectDraftsUi({root,controller,onEdit,onOpen,onNew}) {
  const doc=root.ownerDocument;
  const node=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
  const run=operation=>Promise.resolve().then(operation).catch(()=>{});
  function render(state){
    const focused=doc.activeElement,focusKey=root.contains?.(focused)?focused?.getAttribute('data-draft-focus'):null;
    root.replaceChildren(); root.setAttribute('aria-busy',String(Boolean(state.busy)));
    const toolbar=node('div');toolbar.className='draft-workspace-toolbar';
    if(onNew){const add=node('button','New Draft');add.id='newProjectDraftBtn';add.type='button';add.className='btn btn-primary';add.setAttribute('data-draft-focus','new');add.disabled=state.busy;add.onclick=()=>run(onNew);toolbar.append(add);}
    const refresh=node('button','Refresh');refresh.type='button';refresh.className='btn btn-ghost';refresh.setAttribute('data-draft-focus','refresh');refresh.disabled=state.busy;refresh.onclick=()=>run(()=>controller.refresh());toolbar.append(refresh);root.append(toolbar);
    const message=node('p',state.error||(state.busy?'Loading drafts…':!state.drafts.length?'No drafts yet. Create a draft to begin.':''));message.className='draft-workspace-status';message.setAttribute('role',state.error?'alert':'status');root.append(message);
    if(state.drafts.length){
      const scroll=node('div');scroll.className='draft-table-scroll';scroll.setAttribute('tabindex','0');scroll.setAttribute('data-draft-focus','table');scroll.setAttribute('role','region');scroll.setAttribute('aria-label','My Drafts table. Scroll horizontally for actions.');
      const table=node('table');table.className='draft-table';
      const caption=node('caption','My saved drafts');caption.className='sr-only';table.append(caption);
      const head=node('thead'),header=node('tr');
      for(const text of ['Project / Code','Draft Progress','Publication Status','Last Published','Actions']){const cell=node('th',text);cell.setAttribute('scope','col');header.append(cell);}head.append(header);table.append(head);
      const body=node('tbody');
      for(const draft of state.drafts){
        const row=node('tr');row.className='draft-list-row';row.setAttribute('data-draft-id',draft.draftId);
        const project=node('td');project.setAttribute('data-label','Project / Code');project.append(node('strong',draft.project.name||'Untitled project'),node('span',draft.project.code||'No code yet'));
        const progress=node('td',`${draft.project.progress ?? 0}%`);progress.setAttribute('data-label','Draft Progress');
        const status=node('td',draftPublicationState(draft));status.setAttribute('data-label','Publication Status');
        const published=node('td');published.setAttribute('data-label','Last Published');
        if(draft.lastPublication){published.append(node('span',draft.lastPublication.weekId),node('span',formatDraftPublishedAt(draft.lastPublication.publishedAt)));}else published.textContent='—';
        const actions=node('td');actions.setAttribute('data-label','Actions');
        const edit=node('button','Edit Project');edit.type='button';edit.className='btn btn-ghost';edit.disabled=state.busy;edit.setAttribute('aria-label',`Edit Project: ${draft.project.name||draft.project.code||'Untitled project'}`);edit.setAttribute('data-draft-focus',`edit-${draft.draftId}`);
        edit.onclick=()=>run(async()=>{if(onOpen)return onOpen(draft.draftId);const result=await controller.open(draft.draftId);if(result)await onEdit(result.draft);});actions.append(edit);
        row.append(project,progress,status,published,actions);body.append(row);
      }
      table.append(body);scroll.append(table);root.append(scroll);
    }
    if(state.nextCursor){const more=node('button','Load more');more.type='button';more.className='btn btn-ghost';more.disabled=state.busy;more.setAttribute('data-draft-focus','more');more.onclick=()=>run(()=>controller.refresh({cursor:state.nextCursor}));root.append(more);}
    if(focusKey){const replacement=[...(root.querySelectorAll?.('[data-draft-focus]')||[])].find(n=>n.getAttribute('data-draft-focus')===focusKey);if(replacement&&!replacement.disabled)replacement.focus();else root.querySelector?.('.draft-table-scroll')?.focus();}
  }
  return {render,dispose:()=>root.replaceChildren()};
}
