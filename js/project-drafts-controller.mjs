// Assignment validation is recoverable; authentication/access loss must still clear private state.
export function isProjectDraftAccessLoss({code,details}={}) {
  return ['unauthenticated','functions/unauthenticated'].includes(code)
    || (['permission-denied','functions/permission-denied'].includes(code) && details?.reason !== 'assignment-forbidden');
}
// This state never contains or mutates official reporting weeks.
export function createProjectDraftsController({api,onState=()=>{}}) {
  let identity=null,generation=0,sequence=0;
  const latest=new Map(),pending=new Set();
  let state={drafts:[],nextCursor:null,selected:null,busy:false,error:'',errorCode:'',errorReason:'',message:''};
  const emit=()=>onState(structuredClone(state));
  function reset(){generation++;latest.clear();pending.clear();identity=null;state={drafts:[],nextCursor:null,selected:null,busy:false,error:'',errorCode:'',errorReason:'',message:''};emit();}
  function setIdentity(value){if(JSON.stringify(value)!==JSON.stringify(identity)){reset();identity=value;}}
  async function execute(lane,operation,update){
    if(!identity)throw Error('Sign in before using drafts.');
    const g=generation,s=++sequence;latest.set(lane,s);pending.add(s);
    state={...state,busy:true,error:'',errorCode:'',errorReason:'',message:''};emit();
    try{
      const result=await operation();if(g!==generation||latest.get(lane)!==s)return null;
      // A list started before the committed mutation must not overwrite the confirmed revision.
      if(lane==='mutation')latest.delete('list');
      update(result);return result;
    }
    catch(error){if(g===generation&&latest.get(lane)===s){state={...state,error:error.message||'Draft request failed.',errorCode:error.code||'',errorReason:error.details?.reason||''};if(isProjectDraftAccessLoss(error))state={...state,selected:null,drafts:[],nextCursor:null};}throw error;}
    finally{if(g===generation){pending.delete(s);state={...state,busy:pending.size>0};emit();}}
  }
  return {reset,setIdentity,
    refresh:({cursor}={})=>execute('list',()=>api.list({limit:25,...(cursor?{cursor}:{})}),r=>{state={...state,drafts:cursor?[...state.drafts,...r.drafts]:r.drafts,nextCursor:r.nextCursor};}),
    openSource:source=>execute('selection',()=>api.get({source}),r=>{state={...state,selected:r.draft};}),
    open:draftId=>execute('selection',()=>api.get({draftId}),r=>{state={...state,selected:r.draft};}),
    save:input=>execute('mutation',()=>api.save(input),r=>{state={...state,selected:r.draft,drafts:[r.draft,...state.drafts.filter(d=>d.draftId!==r.draft.draftId)],message:'Draft saved. Overview is unchanged.'};}),
    publish:input=>execute('mutation',()=>api.publish(input),r=>{state={...state,...(r.draft?{selected:r.draft,drafts:[r.draft,...state.drafts.filter(d=>d.draftId!==r.draft.draftId)]}:{}),message:`Published to ${r.weekId} at ${r.publishedAt}.`};}),
  };
}
