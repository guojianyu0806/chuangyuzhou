export const RAIL_COLLAPSED=80,RAIL_LABELS_AT=180,RAIL_DEFAULT=254,RAIL_MAX=380;
export function sidebarMaxWidth(viewport){
  return Math.max(RAIL_COLLAPSED,Math.min(RAIL_MAX,Number.isFinite(viewport)?viewport-480:RAIL_MAX));
}
export function sidebarStoredWidth(value){
  const width=Number(value);
  return Number.isFinite(width)&&width>RAIL_COLLAPSED?Math.min(RAIL_MAX,width):RAIL_DEFAULT;
}

/** The width is local presentation state; only an actual collapse/expand changes ui.sidebarPinned. */
export function mountSidebarResize({body,sidebar,handle,pinButton,win=window,readExpanded,writeExpanded,readWidth,writeWidth,onError=()=>{}}){
  let preferred=RAIL_DEFAULT,gesture=null,current=RAIL_COLLAPSED,disposed=false;
  try{preferred=sidebarStoredWidth(readWidth());}catch{}
  const mobile=()=>win.innerWidth<=760;
  const max=()=>sidebarMaxWidth(win.innerWidth);
  const clamp=value=>Math.max(RAIL_COLLAPSED,Math.min(max(),value));
  function paint(width,expanded=width>RAIL_COLLAPSED){
    current=clamp(width);
    body.style.setProperty('--rail-width',`${current}px`);
    // Labels adapt to available space without snapping or discarding the chosen width.
    sidebar.classList.toggle('rail-pinned',current>=RAIL_LABELS_AT);
    handle.setAttribute('aria-valuemax',String(max()));
    handle.setAttribute('aria-valuenow',String(Math.round(current)));
    handle.setAttribute('aria-valuetext',expanded?`侧栏宽度 ${Math.round(current)} 像素`:'侧栏已收起');
    pinButton.setAttribute('aria-pressed',String(expanded));
    pinButton.setAttribute('aria-label',expanded?'收起侧边栏':'展开侧边栏');
    pinButton.querySelector('span').textContent=expanded?'收起侧边栏':'展开侧边栏';
  }
  function sync(){if(!disposed&&!gesture)paint(readExpanded()?Math.min(preferred,max()):RAIL_COLLAPSED,!!readExpanded());}
  function release(){
    const previous=gesture;gesture=null;body.classList.remove('rail-resizing');
    if(previous&&handle.hasPointerCapture?.(previous.id))handle.releasePointerCapture(previous.id);
  }
  function cancel(){release();sync();}
  function commit(value){
    const width=clamp(value),expanded=width>RAIL_COLLAPSED;
    try{if(expanded!==!!readExpanded())writeExpanded(expanded);}catch(error){sync();onError(error);return;}
    if(expanded){
      preferred=width;
      try{writeWidth(width);}catch{onError(new Error('宽度已调整，但本机未能记住设置。'));}
    }
    sync();
  }
  function down(event){
    if(mobile()||gesture||event.button!==0||!Number.isFinite(event.clientX))return;
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
    if(event.key==='ArrowRight')width=current+(event.shiftKey?40:20);
    if(event.key==='ArrowLeft')width=current-(event.shiftKey?40:20);
    if(event.key==='Home')width=RAIL_COLLAPSED;
    if(event.key==='End')width=max();
    if(event.key==='Enter')width=readExpanded()?RAIL_COLLAPSED:preferred;
    if(width!==undefined){event.preventDefault();commit(width);}
  }
  function reset(){if(!mobile()){cancel();commit(RAIL_DEFAULT);}}
  function resize(){cancel();}
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',pointerCancel],['lostpointercapture',pointerCancel],['dblclick',reset]];
  for(const [name,fn] of listeners)handle.addEventListener(name,fn);
  win.addEventListener('keydown',key);win.addEventListener('blur',cancel);win.addEventListener('resize',resize);
  sync();
  return {sync,destroy(){cancel();disposed=true;for(const [name,fn] of listeners)handle.removeEventListener(name,fn);win.removeEventListener('keydown',key);win.removeEventListener('blur',cancel);win.removeEventListener('resize',resize);}};
}
