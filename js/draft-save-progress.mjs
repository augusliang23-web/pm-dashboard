// Visual estimate only: no backend progress is inferred from this timer.
export function createDraftSaveProgress({onUpdate,now=()=>performance.now(),schedule=fn=>setInterval(fn,200),cancel=id=>clearInterval(id)}) {
  const started=now(); let active=true,percent=0;
  const emit=(slow=false)=>onUpdate({percent,slow,active});
  emit();
  const timer=schedule(()=>{
    if(!active)return;
    const elapsed=Math.max(0,now()-started);
    percent=Math.min(90,Math.floor(100*(1-Math.exp(-elapsed/6000))));
    emit(elapsed>=8000);
  });
  return {
    get completed(){return !active && percent===100;},
    finish(){if(!active)return;active=false;cancel(timer);percent=100;emit();},
    stop(){if(!active)return;active=false;cancel(timer);emit();}
  };
}
