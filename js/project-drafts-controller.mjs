// This state never contains or mutates official reporting weeks.
export function createProjectDraftsController({api,onState=()=>{}}) {
  let identity=null,generation=0,sequence=0;
  let state={drafts:[],nextCursor:null,selected:null,busy:false,error:'',errorCode:'',message:''};
  const emit=()=>onState(structuredClone(state));
  function reset(){generation++;sequence++;identity=null;state={drafts:[],nextCursor:null,selected:null,busy:false,error:'',errorCode:'',message:''};emit();}
  function setIdentity(value){if(JSON.stringify(value)!==JSON.stringify(identity)){reset();identity=value;}}
  async function execute(operation,update){
    if(!identity)throw Error('Sign in before using drafts.');
    const g=generation,s=++sequence;state={...state,busy:true,error:'',errorCode:'',message:''};emit();
    try{const result=await operation();if(g!==generation||s!==sequence)return null;update(result);return result;}
    catch(error){if(g===generation&&s===sequence){state={...state,error:error.message||'Draft request failed.',errorCode:error.code||''};if(['permission-denied','unauthenticated','functions/permission-denied','functions/unauthenticated'].includes(error.code))state={...state,selected:null,drafts:[],nextCursor:null};}throw error;}
    finally{if(g===generation&&s===sequence){state={...state,busy:false};emit();}}
  }
  return {reset,setIdentity,
    refresh:({cursor}={})=>execute(()=>api.list({limit:25,...(cursor?{cursor}:{})}),r=>{state={...state,drafts:cursor?[...state.drafts,...r.drafts]:r.drafts,nextCursor:r.nextCursor};}),
    open:draftId=>execute(()=>api.get({draftId}),r=>{state={...state,selected:r.draft};}),
    save:input=>execute(()=>api.save(input),r=>{state={...state,selected:r.draft,drafts:[r.draft,...state.drafts.filter(d=>d.draftId!==r.draft.draftId)],message:'Draft saved. Overview is unchanged.'};}),
    publish:input=>execute(()=>api.publish(input),r=>{state={...state,message:`Published to ${r.weekId} at ${r.publishedAt}.`};}),
  };
}
