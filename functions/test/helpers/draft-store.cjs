// In-memory Firestore boundary; queued writes commit only after a successful handler.
const clone=v=>structuredClone(v);
function createStore() {
  const state={docs:new Map(),seq:0,failAudit:false};
  const snap=(path)=>({id:path.split('/').at(-1),exists:state.docs.has(path),data:()=>clone(state.docs.get(path)),ref:{path}});
  function query(name,filters=[],sorts=[],maximum=Infinity,cursor=null) {
    return {
      doc(id=`auto-${++state.seq}`){return {path:`${name}/${id}`,id};},
      where(...f){return query(name,[...filters,f],sorts,maximum,cursor);},
      orderBy(key,direction='asc'){return query(name,filters,[...sorts,[typeof key==='string'?key:'__name__',direction]],maximum,cursor);},
      limit(n){return query(name,filters,sorts,n,cursor);},
      startAfter(...values){return query(name,filters,sorts,maximum,values);},
      async get(){
        let docs=[...state.docs.keys()].filter(p=>p.startsWith(name+'/')&&p.split('/').length===2).map(snap);
        docs=docs.filter(d=>filters.every(([key,op,value])=>op==='array-contains'?d.data()[key].includes(value):d.data()[key]===value));
        const values=d=>sorts.map(([key])=>key==='__name__'?d.id:d.data()[key]);
        const compare=(a,b)=>sorts.reduce((r,[,direction],i)=>r || (a[i]<b[i]?-1:a[i]>b[i]?1:0)*(direction==='desc'?-1:1),0);
        docs.sort((a,b)=>compare(values(a),values(b)));
        if(cursor)docs=docs.filter(d=>compare(values(d),cursor)>0);
        return {docs:docs.slice(0,maximum),size:Math.min(docs.length,maximum)};
      },
    };
  }
  const db={collection:query,async runTransaction(fn){const writes=[];let writing=false;const tx={get:async ref=>{if(writing)throw Error('read after write');return ref.get?ref.get():snap(ref.path);},set:(ref,data)=>{writing=true;writes.push(()=>state.docs.set(ref.path,clone(data)));},update:(ref,patch)=>{writing=true;writes.push(()=>state.docs.set(ref.path,{...state.docs.get(ref.path),...clone(patch)}));},create:(ref,data)=>{writing=true;if(state.failAudit&&ref.path.startsWith('projectDraftPublicationAudit/'))throw Error('audit unavailable');if(state.docs.has(ref.path))throw Error('exists');writes.push(()=>state.docs.set(ref.path,clone(data)));}};const result=await fn(tx);writes.forEach(fn=>fn());return result;}};
  return {state,db};
}
module.exports={createStore};
