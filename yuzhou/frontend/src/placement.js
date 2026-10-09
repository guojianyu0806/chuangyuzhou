import {WORKBENCH_MODULES,getWorkbench} from './workbench-model.js';
import {canvasBounds,canvasCardFill} from './canvas.js';
import {placementCards,placementLayout,placeBlock,arrangeBlocks,savePlacement,undoPlacement} from './placement-model.js';
import {escapeHTML as esc} from './services.js';
import {icon} from './icons.js';
import {zoomPlacementView,panPlacementView,PLACEMENT_MIN_SCALE,PLACEMENT_MAX_SCALE} from './placement-camera.js';
import {getCustomBlocks,CUSTOM_BLOCK_KINDS} from './custom-blocks-model.js';
import {CUSTOM_BLOCK_PRESETS} from './custom-block-presets.js';

const mini='<span class="wb-block-mini" aria-hidden="true"><i></i><i></i><i></i></span>';
const glyph=(item)=>`<span class="wb-block-icon" style="--block-color:${canvasCardFill(item.color)}">${icon(item.icon||'folder',20)}</span>`;
export function placementHTML(state){
  const config=getWorkbench(state),visible=placementCards(state);
  return `<section class="wb-placement" aria-labelledby="wb-placement-title">
    <div class="wb-placement-heading"><div><h2 id="wb-placement-title">像摆积木一样，搭好你的工作台</h2><p>选一块，放到右边。这里的位置，会直接成为你的工作台布局。</p></div><span class="wb-placement-count">${visible.length} 块已放置</span></div>
    <div class="wb-placement-workspace"><aside class="wb-palette" aria-label="方块库"><header><h3>方块库</h3><p>从常用场景创建，再自由摆放</p><button type="button" class="wb-palette-create" data-wb-action="create-block">${icon('plus',15)} 自定义方块</button><button type="button" class="wb-palette-ai" data-wb-action="ask-miniapp">${icon('sparkles',15)} 让 AI 造小工具</button></header>
    <label class="wb-palette-search"><span class="sr-only">搜索方块</span><input type="search" data-palette-search placeholder="搜索用途或名称" aria-label="搜索方块"></label>
    <div class="wb-palette-tabs" role="group" aria-label="方块分类"><button type="button" data-palette-tab="scene" aria-pressed="true">场景</button><button type="button" data-palette-tab="mine" aria-pressed="false">我的</button><button type="button" data-palette-tab="builtin" aria-pressed="false">原有</button></div>
    <div class="wb-palette-list">${CUSTOM_BLOCK_PRESETS.map(item=>`<button type="button" class="wb-palette-item" data-palette-group="scene" data-palette-search-text="${esc(item.title+' '+item.description+' '+item.category)}" data-wb-action="create-preset" data-id="${esc(item.id)}" aria-label="创建${esc(item.title)}方块" title="${esc(item.description)}">${glyph(item)}<span class="wb-palette-copy"><strong>${esc(item.title)}</strong><small>${esc(item.category)} · 点击创建</small></span>${icon('plus',16)}</button>`).join('')}
    ${getCustomBlocks(state).items.filter(item=>!item.archived).map(item=>{const type=CUSTOM_BLOCK_KINDS.find(type=>type.kind===item.kind||type.id===item.kind);return `<button type="button" hidden class="wb-palette-item is-placed" data-palette-group="mine" data-palette-search-text="${esc(item.title+' '+item.description)}" data-place-source="${esc(item.id)}" aria-label="选择${esc(item.title)}方块" aria-pressed="false" title="${esc(item.description)}">${glyph({...item,icon:type?.icon||'layers'})}<span class="wb-palette-copy"><strong>${esc(item.title)}</strong><small>${esc(type?.title||'自定义')} · 可以挪动</small></span>${mini}</button>`;}).join('')}
    ${WORKBENCH_MODULES.map(item=>{
      const module=config.modules.find(row=>row.id===item.id);
      return `<button type="button" hidden class="wb-palette-item ${module.enabled?'is-placed':''}" data-palette-group="builtin" data-palette-search-text="${esc(module.title+' '+item.description)}" data-place-source="${esc(item.id)}" aria-label="选择${esc(module.title)}方块" aria-pressed="false" title="${esc(item.description)}">${glyph(item)}<span class="wb-palette-copy"><strong>${esc(module.title)}</strong><small>${module.enabled?'已放置 · 可以挪动':'选择位置后放入'}</small></span>${mini}</button>`;
    }).join('')}</div><p class="wb-palette-empty" data-palette-empty hidden>这里还没有匹配的方块。试试其他分类或创建一个。</p></aside>
    <section class="wb-placement-board" aria-label="摆放工作台方块"><div class="wb-placement-toolbar"><strong>你的工作台</strong><div class="wb-placement-navigation" role="group" aria-label="搭建画布视野"><button type="button" data-place-action="zoom-out" aria-label="缩小搭建画布">−</button><button type="button" data-place-action="zoom-reset" aria-label="恢复搭建画布为100%" title="恢复100%大小">100%</button><button type="button" data-place-action="zoom-in" aria-label="放大搭建画布">+</button><button type="button" class="btn" data-place-action="fit">看全画布</button></div><div class="wb-placement-layout-actions"><button type="button" class="btn" data-place-action="arrange">整齐排列</button><button type="button" class="btn" data-place-action="undo" disabled>撤销上次摆放</button></div></div>
    <p class="wb-placement-hint" role="status" aria-live="polite">先在左边选一个方块，再点击画布放下。</p>
    <div class="wb-placement-stage" tabindex="0" aria-label="方块摆放画布；选择方块后点击位置，方向键微调，回车放下，Escape取消" aria-describedby="wb-placement-help"><div class="wb-placement-ghost" hidden aria-hidden="true"></div><p class="wb-stage-empty" hidden>从左边拿一个方块，放在这里。</p></div>
    <div class="wb-placement-inspector"><span data-place-selection>直接拖动画布里的方块，就能移动它。</span><div><button type="button" data-place-action="left" aria-label="所选方块向左移动" disabled>←</button><button type="button" data-place-action="up" aria-label="所选方块向上移动" disabled>↑</button><button type="button" data-place-action="down" aria-label="所选方块向下移动" disabled>↓</button><button type="button" data-place-action="right" aria-label="所选方块向右移动" disabled>→</button><button type="button" data-place-action="cancel" disabled>取消选择</button></div></div>
    <footer class="wb-placement-footer" id="wb-placement-help"><span>拖动空白处平移 · Ctrl / ⌘ + 滚轮缩放 · 空格拖动或中键也可平移</span><span>放下即保存；点选后可用方向键和回车放置，Esc取消。</span></footer></section></div></section>`;
}

/** Screen-only transform: opening or resizing the builder does not edit state. */
export function placementViewport(cards,width,height){
  const bounds=canvasBounds(cards),x=Math.min(0,bounds.x-80),y=Math.min(0,bounds.y-80);
  const w=Math.max(1440,bounds.x+bounds.w-x+240),h=Math.max(920,bounds.y+bounds.h-y+240);
  const scale=Math.max(.001,Math.min((Math.max(100,width)-32)/w,(Math.max(100,height)-32)/h,.85));
  return {x,y,scale,left:16,top:16};
}
export function placementPoint(view,rect,clientX,clientY,offset={x:0,y:0}){
  return {x:Math.round(((clientX-rect.left-view.left)/view.scale+view.x-offset.x)/40)*40,
    y:Math.round(((clientY-rect.top-view.top)/view.scale+view.y-offset.y)/40)*40};
}

export function mountPlacement(ctx,session={}){
  const {root,state,toast}=ctx,stage=root.querySelector('.wb-placement-stage');
  if(!stage)return ()=>{};
  let active=true,gesture=null,view=null,point=null,lastSize='',spaceHeld=false;
  session.placingId=null;
  const ghost=stage.querySelector('.wb-placement-ghost'),hint=root.querySelector('.wb-placement-hint');
  const selected=()=>placementLayout(state).cards.find(card=>card.id===(session.placingId||session.selectedId));
  const titleFor=id=>getWorkbench(state).modules.find(item=>item.id===id)?.title||getCustomBlocks(state).items.find(item=>item.id===id)?.title||(state.spaces||[]).find(item=>item.id===id)?.title||'方块';
  function filterPalette(){
    const group=session.paletteGroup||'scene',search=String(session.paletteSearch||'').trim().toLowerCase();let count=0;
    root.querySelectorAll('[data-palette-group]').forEach(button=>{button.hidden=button.dataset.paletteGroup!==group||!String(button.dataset.paletteSearchText||'').toLowerCase().includes(search);if(!button.hidden)count++;});
    root.querySelectorAll('[data-palette-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.paletteTab===group)));
    const empty=root.querySelector('[data-palette-empty]');if(empty)empty.hidden=count>0;
  }
  function searchPalette(event){if(event.target.matches?.('[data-palette-search]')){session.paletteSearch=event.target.value;filterPalette();}}
  function geometry(element,card){
    Object.assign(element.style,{left:`${view.left+(card.x-view.x)*view.scale}px`,top:`${view.top+(card.y-view.y)*view.scale}px`,width:`${card.w*view.scale}px`,height:`${card.h*view.scale}px`});
    element.classList.toggle('is-small',card.w*view.scale<120||card.h*view.scale<110);
    element.classList.toggle('is-compact',card.h*view.scale<160);
  }
  function status(message){hint.textContent=message;}
  // Camera navigation stays outside saved workspace state and AI context.
  function paintCamera(next=view){
    view=next;session.viewport={size:lastSize,view};
    const cards=new Map(placementCards(state).map(card=>[card.id,card]));
    stage.querySelectorAll('[data-place-card]').forEach(element=>{const card=cards.get(element.dataset.placeCard);if(card)geometry(element,card);});
    stage.style.backgroundSize=`${40*view.scale}px ${40*view.scale}px`;
    stage.style.backgroundPosition=`${view.left-view.x*view.scale}px ${view.top-view.y*view.scale}px`;
    const percent=(view.scale*100).toFixed(view.scale<.01?1:0);
    root.querySelector('[data-place-action="zoom-reset"]').textContent=`${percent}%`;
    root.querySelector('[data-place-action="zoom-out"]').disabled=view.scale<=PLACEMENT_MIN_SCALE;
    root.querySelector('[data-place-action="zoom-in"]').disabled=view.scale>=PLACEMENT_MAX_SCALE;
    if(session.placingId&&point)showGhost(point);
  }
  function zoom(scale,anchor){
    if(gesture)return;
    const rect=stage.getBoundingClientRect();
    paintCamera(zoomPlacementView(view,scale,anchor||{x:rect.width/2,y:rect.height/2}));
    status(session.placingId?`视野已缩放；「${titleFor(session.placingId)}」仍待放下。`:`画布缩放至${(view.scale*100).toFixed(view.scale<.01?1:0)}%，拖动空白处查看其他位置。`);
  }
  function refreshSelection(){
    const id=session.placingId||session.selectedId;
    root.querySelectorAll('[data-place-source],[data-place-card]').forEach(button=>button.setAttribute('aria-pressed',String((button.dataset.placeSource||button.dataset.placeCard)===id)));
    root.querySelector('[data-place-selection]').textContent=id?`已选择「${titleFor(id)}」${session.placingId?' · 在画布上选位置':' · 可拖动或用箭头移动'}`:'直接拖动画布里的方块，就能移动它。';
    root.querySelectorAll('[data-place-action]').forEach(button=>{const action=button.dataset.placeAction;if(['left','right','up','down','cancel'].includes(action))button.disabled=!id;if(action==='undo')button.disabled=!session.undo;});
    stage.classList.toggle('is-placing',!!session.placingId);
  }
  function draw({fit=false}={}){
    const cards=placementCards(state),rect=stage.getBoundingClientRect();
    lastSize=`${rect.width},${rect.height}`;
    // Keep the camera still after a drop so the saved block stays under the pointer.
    // Explicit fit, a new visit or a resized viewport can choose a new overview.
    view=!fit&&session.viewport?.size===lastSize?session.viewport.view:placementViewport(cards,rect.width,rect.height);
    session.viewport={size:lastSize,view};
    stage.querySelectorAll('[data-place-card]').forEach(element=>element.remove());
    cards.forEach(card=>{
      const button=document.createElement('button');button.type='button';button.className='wb-placed-block';button.dataset.placeCard=card.id;
      button.setAttribute('aria-label',`移动${card.title}方块`);button.style.setProperty('--block-color',canvasCardFill(card.color));
      button.innerHTML=`${glyph(card)}<strong>${esc(card.title)}</strong><small>${esc(card.description||'文件、笔记和待办')}</small>${mini}<span class="wb-block-badge">拖动摆放</span>`;
      geometry(button,card);stage.insertBefore(button,ghost);
    });
    paintCamera();
    stage.querySelector('.wb-stage-empty').hidden=cards.length>0;
    root.querySelector('.wb-placement-count').textContent=`${cards.length} 块已放置`;
    refreshSelection();
    if(session.focusId){const button=[...stage.querySelectorAll('[data-place-card]')].find(item=>item.dataset.placeCard===session.focusId);button?.focus({preventScroll:true});delete session.focusId;}
  }
  function showGhost(next){
    const card=selected();if(!card)return;
    point=next;geometry(ghost,{...card,...next});ghost.style.setProperty('--block-color',canvasCardFill(card.color));ghost.textContent=titleFor(card.id);ghost.hidden=false;
  }
  function pick(id){
    session.placingId=id;session.selectedId=id;const card=selected();
    const rect=stage.getBoundingClientRect();point=placementPoint(view,rect,rect.left+rect.width/2,rect.top+rect.height/2,{x:card.w/2,y:card.h/2});
    showGhost(point);refreshSelection();status(`「${titleFor(id)}」已拿起：点击画布放下，或用方向键调整后按回车。`);
  }
  function redraw(){if(ctx.onPlacementSaved)ctx.onPlacementSaved();else{draw();ghost.hidden=true;}}
  function commit(id,next){
    try{
      session.undo=savePlacement(ctx,workspace=>placeBlock(workspace,id,next));session.undoViewport=session.viewport;session.placingId=null;session.selectedId=id;session.focusId=id;session.message=`「${titleFor(id)}」已放好，位置已保存。`;
      redraw();toast(session.message);
    }catch(error){ghost.hidden=true;gesture=null;session.placingId=null;refreshSelection();status(error.message||'保存失败，已恢复原位置。');toast(error.message||'保存失败，已恢复原位置。');}
  }
  function cancel(message='已取消，没有改变位置。'){
    const current=gesture;gesture=null;if(current?.element.hasPointerCapture?.(current.pointerId))current.element.releasePointerCapture(current.pointerId);
    if(current?.kind==='pan')paintCamera(current.view);
    spaceHeld=false;session.placingId=null;session.selectedId=null;point=null;ghost.hidden=true;stage.classList.remove('is-dragging','is-panning','can-pan');refreshSelection();status(message);
  }
  function inside(event){const rect=stage.getBoundingClientRect();return event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;}
  function begin(event){
    if(!active)return;
    if(gesture&&gesture.pointerId!==event.pointerId)return;
    const button=event.target.closest('[data-place-source],[data-place-card]');
    if(stage.contains(event.target)&&(event.button===1||(event.button===0&&(spaceHeld||!button)))){
      gesture={kind:'pan',pointerId:event.pointerId,element:stage,startX:event.clientX,startY:event.clientY,moved:false,view,forced:spaceHeld||event.button===1};
      stage.setPointerCapture?.(event.pointerId);stage.focus({preventScroll:true});event.preventDefault();return;
    }
    if(!active||!button||event.button!==0||!root.contains(button))return;
    const source=!!button.dataset.placeSource,id=button.dataset.placeSource||button.dataset.placeCard;
    const card=placementLayout(state).cards.find(item=>item.id===id);if(!card)return;
    const rect=stage.getBoundingClientRect();
    gesture={pointerId:event.pointerId,id,source,element:button,startX:event.clientX,startY:event.clientY,moved:false,offset:source?{x:card.w/2,y:card.h/2}:{x:(event.clientX-rect.left-view.left)/view.scale+view.x-card.x,y:(event.clientY-rect.top-view.top)/view.scale+view.y-card.y}};
    button.setPointerCapture?.(event.pointerId);
  }
  function move(event){
    if(!active)return;
    if(gesture&&gesture.pointerId!==event.pointerId)return;
    if(gesture&&gesture.pointerId===event.pointerId){
      if(!gesture.moved&&Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)<6)return;
      if(gesture.kind==='pan'){
        gesture.moved=true;stage.classList.add('is-panning');
        paintCamera(panPlacementView(gesture.view,event.clientX-gesture.startX,event.clientY-gesture.startY));
        event.preventDefault();return;
      }
      gesture.moved=true;session.selectedId=gesture.id;session.placingId=gesture.id;stage.classList.add('is-dragging');refreshSelection();
      if(inside(event)){showGhost(placementPoint(view,stage.getBoundingClientRect(),event.clientX,event.clientY,gesture.offset));status(`松开放下「${titleFor(gesture.id)}」。`);}else{ghost.hidden=true;status('拖到右边画布内，再松开放下。');}
      event.preventDefault();
    }else if(session.placingId&&stage.contains(event.target)){
      const card=selected();showGhost(placementPoint(view,stage.getBoundingClientRect(),event.clientX,event.clientY,{x:card.w/2,y:card.h/2}));
    }
  }
  function finish(event){
    if(!gesture||gesture.pointerId!==event.pointerId)return;
    const current=gesture;gesture=null;
    if(current.element.hasPointerCapture?.(event.pointerId))current.element.releasePointerCapture(event.pointerId);
    stage.classList.remove('is-dragging','is-panning');
    if(current.kind==='pan'){
      if(event.type==='pointercancel')paintCamera(current.view);
      if(current.moved||current.forced||event.type==='pointercancel'){session.suppressClickUntil=Date.now()+350;session.suppressPanClick=true;}
      if(current.moved)status(session.placingId?`画布已移动；「${titleFor(session.placingId)}」仍待放下。`:'画布视野已移动，方块位置没有改变。');
      return;
    }
    if(event.type==='pointercancel'){cancel();session.suppressClickUntil=Date.now()+250;session.suppressPanClick=false;return;}
    if(!current.moved)return;
    session.suppressClickUntil=Date.now()+350;session.suppressPanClick=false;
    if(inside(event))commit(current.id,placementPoint(view,stage.getBoundingClientRect(),event.clientX,event.clientY,current.offset));else cancel('未放入画布，原来的位置保持不变。');
  }
  function click(event){
    const tab=event.target.closest('[data-palette-tab]');if(tab){session.paletteGroup=tab.dataset.paletteTab;filterPalette();return;}
    if(Date.now()<(session.suppressClickUntil||0)&&!event.target.closest('[data-place-action]')){
      if(!session.suppressPanClick||stage.contains(event.target))return;
      session.suppressClickUntil=0;
    }
    const source=event.target.closest('[data-place-source]');if(source){pick(source.dataset.placeSource);return;}
    const action=event.target.closest('[data-place-action]')?.dataset.placeAction;
    if(action){
      try{
        if(action==='cancel')cancel();
        if(action==='fit'){draw({fit:true});status('已显示全部方块。');}
        if(action==='zoom-in')zoom(view.scale*1.2);
        if(action==='zoom-out')zoom(view.scale/1.2);
        if(action==='zoom-reset')zoom(1);
        if(action==='arrange'){session.undo=savePlacement(ctx,arrangeBlocks);session.undoViewport=session.viewport;session.placingId=null;session.viewport=null;session.message='方块已整齐排列，可撤销。';redraw();toast(session.message);}
        if(action==='undo'){if(!undoPlacement(ctx,session.undo)){status('布局已有其他修改，未覆盖这些改动。');toast('布局已有其他修改，不能撤销这一步。');session.undo=null;refreshSelection();return;}session.undo=null;session.viewport=session.undoViewport||null;session.undoViewport=null;session.placingId=null;session.selectedId=null;session.message='已撤销上次摆放。';redraw();toast(session.message);}
        if(['left','right','up','down'].includes(action)){const card=selected();if(!card)return;const next={...(session.placingId?point:card)};next.x+=(action==='left'?-40:action==='right'?40:0);next.y+=(action==='up'?-40:action==='down'?40:0);if(session.placingId)showGhost(next);else commit(card.id,next);}
      }catch(error){status(error.message);toast(error.message);}return;
    }
    if(session.placingId&&stage.contains(event.target)){
      if(event.detail===0&&event.target.closest('[data-place-card]')){showGhost(selected());stage.focus();return;}
      const card=selected();commit(card.id,placementPoint(view,stage.getBoundingClientRect(),event.clientX,event.clientY,{x:card.w/2,y:card.h/2}));return;
    }
    const card=event.target.closest('[data-place-card]');if(card){session.selectedId=card.dataset.placeCard;refreshSelection();status(`已选择「${titleFor(session.selectedId)}」：拖动或用方向键移动。`);}
  }
  function keydown(event){
    if(event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
    if(event.key==='Escape'){cancel();event.preventDefault();return;}
    if(stage.contains(event.target)){
      if(event.code==='Space'||event.key===' '){spaceHeld=true;stage.classList.add('can-pan');event.preventDefault();return;}
      if(!event.ctrlKey&&!event.metaKey&&['+','=','-','0'].includes(event.key)){zoom(event.key==='0'?1:view.scale*(event.key==='-'?1/1.2:1.2));event.preventDefault();return;}
      if(!session.placingId&&event.target===stage){
        const delta={ArrowLeft:[60,0],ArrowRight:[-60,0],ArrowUp:[0,60],ArrowDown:[0,-60]}[event.key];
        if(delta&&!gesture){paintCamera(panPlacementView(view,...delta));status('画布视野已移动，方块位置没有改变。');event.preventDefault();return;}
      }
    }
    if(!session.placingId&&!stage.contains(event.target))return;
    const focusedCard=event.target.closest('[data-place-card]');if(!session.placingId&&focusedCard){session.selectedId=focusedCard.dataset.placeCard;refreshSelection();}
    const card=selected();if(!card)return;
    const direction={ArrowLeft:[-40,0],ArrowRight:[40,0],ArrowUp:[0,-40],ArrowDown:[0,40]}[event.key];
    if(direction){event.preventDefault();const base=session.placingId?point:card,next={x:base.x+direction[0],y:base.y+direction[1]};if(session.placingId)showGhost(next);else commit(card.id,next);}
    if(event.key==='Enter'&&session.placingId){event.preventDefault();commit(card.id,point);}
  }
  function wheel(event){
    event.preventDefault();if(gesture)return;
    const rect=stage.getBoundingClientRect(),unit=event.deltaMode===1?16:event.deltaMode===2?rect.height:1;
    if(event.ctrlKey||event.metaKey)zoom(view.scale*Math.exp(Math.max(-8,Math.min(8,-event.deltaY*unit*.002))),{x:event.clientX-rect.left,y:event.clientY-rect.top});
    else{paintCamera(panPlacementView(view,-(event.shiftKey?event.deltaY:event.deltaX)*unit,-(event.shiftKey?event.deltaX:event.deltaY)*unit));status(session.placingId?`画布已移动；「${titleFor(session.placingId)}」仍待放下。`:'画布视野已移动，方块位置没有改变。');}
  }
  const resize=new ResizeObserver(()=>{const rect=stage.getBoundingClientRect();if(!gesture&&`${rect.width},${rect.height}`!==lastSize)draw();});resize.observe(stage);
  root.addEventListener('click',click);root.addEventListener('pointerdown',begin);root.addEventListener('pointermove',move);root.addEventListener('pointerup',finish);root.addEventListener('pointercancel',finish);root.addEventListener('keydown',keydown);
  root.addEventListener('input',searchPalette);
  stage.addEventListener('wheel',wheel,{passive:false});
  const keyup=event=>{if(event.code==='Space'||event.key===' '){if(spaceHeld&&stage.contains(event.target))event.preventDefault();spaceHeld=false;stage.classList.remove('can-pan');}};window.addEventListener('keyup',keyup);
  const blur=()=>{spaceHeld=false;stage.classList.remove('can-pan');if(gesture)cancel();};window.addEventListener('blur',blur);
  const lost=event=>{if(gesture?.pointerId===event.pointerId)cancel();};root.addEventListener('lostpointercapture',lost);
  draw();filterPalette();const search=root.querySelector('[data-palette-search]');if(search)search.value=session.paletteSearch||'';if(session.message)status(session.message);
  return ()=>{active=false;const current=gesture;gesture=null;if(current?.element.hasPointerCapture?.(current.pointerId))current.element.releasePointerCapture(current.pointerId);resize.disconnect();window.removeEventListener('blur',blur);window.removeEventListener('keyup',keyup);stage.removeEventListener('wheel',wheel);for(const [name,listener] of [['click',click],['input',searchPalette],['pointerdown',begin],['pointermove',move],['pointerup',finish],['pointercancel',finish],['lostpointercapture',lost],['keydown',keydown]])root.removeEventListener(name,listener);};
}
