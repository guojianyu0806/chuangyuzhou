export const RAIL_COLLAPSED=80,RAIL_LABELS_AT=180,RAIL_DEFAULT=254,RAIL_MAX=380;
export const RAIL_MOTION_MS=360;
export function sidebarMaxWidth(viewport){
  return Math.max(RAIL_COLLAPSED,Math.min(RAIL_MAX,Number.isFinite(viewport)?viewport-480:RAIL_MAX));
}
export function sidebarStoredWidth(value){
  const width=Number(value);
  return Number.isFinite(width)&&width>RAIL_COLLAPSED?Math.min(RAIL_MAX,width):RAIL_DEFAULT;
}

/** The width is local presentation state; only an actual collapse/expand changes ui.sidebarPinned. */
export function mountSidebarResize({body,sidebar,handle,pinButton,win=window,readExpanded,writeExpanded,readWidth,writeWidth,onError=()=>{}}){
  let preferred=RAIL_DEFAULT,gesture=null,current=RAIL_COLLAPSED,disposed=false,motion=null,frame=null,committing=false;
  const reduced=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  try{preferred=sidebarStoredWidth(readWidth());}catch{}
  const mobile=()=>win.innerWidth<=760;
  const max=()=>sidebarMaxWidth(win.innerWidth);
  const clamp=value=>Math.max(RAIL_COLLAPSED,Math.min(max(),value));
  function paint(width,expanded=width>RAIL_COLLAPSED){
    current=clamp(width);
    body.style.setProperty('--rail-width',`${current}px`);
    // Labels adapt to available space without snapping or discarding the chosen width.
    sidebar.classList.toggle('rail-pinned',current>=RAIL_LABELS_AT&&(!motion||motion.to>=RAIL_LABELS_AT));
    handle.setAttribute('aria-valuemax',String(max()));
    handle.setAttribute('aria-valuenow',String(Math.round(current)));
    handle.setAttribute('aria-valuetext',expanded?`侧栏宽度 ${Math.round(current)} 像素`:'侧栏已收起');
    pinButton.setAttribute('aria-pressed',String(expanded));
    pinButton.setAttribute('aria-label',expanded?'收起侧边栏':'展开侧边栏');
    pinButton.querySelector('span').textContent=expanded?'收起侧边栏':'展开侧边栏';
  }
  function stopMotion(){if(frame!==null)win.cancelAnimationFrame?.(frame);frame=null;motion=null;body.classList.remove('rail-animating');}
  function show(width,expanded,animate){
    if(motion?.to===width&&motion.expanded===expanded)return;
    stopMotion();
    if(!animate||mobile()||reduced?.matches||!win.requestAnimationFrame||Math.abs(width-current)<.5){paint(width,expanded);return;}
    const run={from:current,to:width,expanded,start:null};motion=run;body.classList.add('rail-animating');
    const tick=now=>{
      if(disposed||motion!==run)return;
      if(run.start===null)run.start=now;
      const progress=Math.min(1,Math.max(0,(now-run.start)/RAIL_MOTION_MS));
      if(progress===1){stopMotion();paint(width,expanded);return;}
      // A small damped spring settles without persisting any intermediate width.
      const eased=1-Math.exp(-10*progress)*(Math.cos(9*progress)+(10/9)*Math.sin(9*progress));
      paint(run.from+(width-run.from)*eased,expanded);
      frame=win.requestAnimationFrame(tick);
    };
    paint(current,expanded);frame=win.requestAnimationFrame(tick);
  }
  function sync({animate=false}={}){if(!disposed&&!gesture&&!committing)show(readExpanded()?Math.min(preferred,max()):RAIL_COLLAPSED,!!readExpanded(),animate);}
  function release(){
    const previous=gesture;gesture=null;body.classList.remove('rail-resizing');
    if(previous&&handle.hasPointerCapture?.(previous.id))handle.releasePointerCapture(previous.id);
    // Pointer focus must not leave a full-height keyboard outline after a drop.
    if(previous)handle.blur?.();
  }
  function cancel(){release();stopMotion();sync();}
  function commit(value,{animate=false}={}){
    const width=clamp(value),expanded=width>RAIL_COLLAPSED;
    committing=true;
    try{if(expanded!==!!readExpanded())writeExpanded(expanded);}catch(error){committing=false;stopMotion();sync();onError(error);return;}
    if(expanded){
      preferred=width;
      try{writeWidth(width);}catch{onError(new Error('宽度已调整，但本机未能记住设置。'));}
    }
    committing=false;sync({animate});
  }
  function down(event){
    if(mobile()||gesture||event.button!==0||!Number.isFinite(event.clientX))return;
    stopMotion();
    gesture={id:event.pointerId,x:event.clientX,width:current,moved:false};
    handle.focus();handle.setPointerCapture?.(event.pointerId);body.classList.add('rail-resizing');event.preventDefault();
  }
  function move(event){
    if(!gesture||gesture.id!==event.pointerId||!Number.isFinite(event.clientX))return;
    if(event.clientX!==gesture.x)gesture.moved=true;
    if(gesture.moved)paint(clamp(gesture.width+event.clientX-gesture.x));
  }
  function up(event){
    if(!gesture||gesture.id!==event.pointerId)return;
    const moved=gesture.moved,width=current;release();
    if(moved)commit(width);else sync();
  }
  function pointerCancel(event){if(gesture?.id===event.pointerId)cancel();}
  function key(event){
    if(event.key==='Escape'&&gesture){event.preventDefault();cancel();return;}
    if(event.target!==handle||mobile()||gesture||event.ctrlKey||event.metaKey||event.altKey)return;
    let width;
    if(event.key==='ArrowRight')width=(motion?.to??current)+(event.shiftKey?40:20);
    if(event.key==='ArrowLeft')width=(motion?.to??current)-(event.shiftKey?40:20);
    if(event.key==='Home')width=RAIL_COLLAPSED;
    if(event.key==='End')width=max();
    if(event.key==='Enter')width=readExpanded()?RAIL_COLLAPSED:preferred;
    if(width!==undefined){event.preventDefault();commit(width,{animate:['Home','End','Enter'].includes(event.key)});}
  }
  function reset(){if(!mobile()){release();stopMotion();commit(RAIL_DEFAULT,{animate:true});}}
  function resize(){cancel();}
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',pointerCancel],['lostpointercapture',pointerCancel],['dblclick',reset]];
  for(const [name,fn] of listeners)handle.addEventListener(name,fn);
  win.addEventListener('keydown',key);win.addEventListener('blur',cancel);win.addEventListener('resize',resize);
  const motionPreference=()=>{if(reduced.matches){stopMotion();sync();}};
  reduced?.addEventListener?.('change',motionPreference);
  sync();
  return {sync,destroy(){cancel();disposed=true;reduced?.removeEventListener?.('change',motionPreference);for(const [name,fn] of listeners)handle.removeEventListener(name,fn);win.removeEventListener('keydown',key);win.removeEventListener('blur',cancel);win.removeEventListener('resize',resize);}};
}
