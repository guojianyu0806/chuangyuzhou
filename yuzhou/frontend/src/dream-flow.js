// Sample the complete capture pool independently; there is no deck or page order.
// These temporary appearance counts never edit or persist the original records.
export function createDreamEmitter(items, {random=Math.random}={}) {
  const seen=new Set();
  const source=(Array.isArray(items)?items:[]).filter(item=>{
    if(!item||item.archived||typeof item.id!=='string'||!item.id.trim()||seen.has(item.id))return false;
    seen.add(item.id);return true;
  });
  const sample=()=>{
    const value=Number(random());
    return Number.isFinite(value)?Math.max(0,Math.min(1-Number.EPSILON,value)):0;
  };
  const recent=[],appearances=new Map();
  return {
    get size(){return source.length;},
    pick(excludedIds=[]){
      const excluded=new Set(excludedIds),eligible=source.filter(item=>!excluded.has(item.id));
      if(!eligible.length)return null;
      // Relax only the oldest cooldowns when a small or largely visible pool requires it.
      let cooldown=recent.slice(),candidates=eligible.filter(item=>!cooldown.includes(item.id));
      while(!candidates.length&&cooldown.length){
        cooldown.shift();candidates=eligible.filter(item=>!cooldown.includes(item.id));
      }
      const weights=candidates.map(item=>1/(1+(appearances.get(item.id)||0)));
      let point=sample()*weights.reduce((sum,weight)=>sum+weight,0),chosen=candidates.at(-1);
      for(let i=0;i<candidates.length;i++){
        point-=weights[i];if(point<0){chosen=candidates[i];break;}
      }
      appearances.set(chosen.id,(appearances.get(chosen.id)||0)+1);
      const previous=recent.indexOf(chosen.id);if(previous>=0)recent.splice(previous,1);
      recent.push(chosen.id);if(recent.length>8)recent.shift();
      return chosen;
    },
  };
}

// One pending timeout means a hidden or paused dream never accumulates frames.
export function createDreamPlayback({advance,delay=12000,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let paused=true,destroyed=false,timer=null;
  const clear=()=>{if(timer!==null){clearTimer(timer);timer=null;}};
  function schedule(){
    if(paused||destroyed||timer!==null)return;
    const requested=typeof delay==='function'?delay():delay;
    const interval=Number.isFinite(requested)&&requested>0?requested:12000;
    timer=setTimer(()=>{
      timer=null;
      if(paused||destroyed)return;
      try{advance();}finally{schedule();}
    },interval);
  }
  return {
    setPaused(value){
      const next=!!value;
      if(destroyed||paused===next)return;
      paused=next;
      if(paused)clear();else schedule();
    },
    reset(){
      if(destroyed)return;
      clear();schedule();
    },
    destroy(){destroyed=true;clear();},
  };
}
