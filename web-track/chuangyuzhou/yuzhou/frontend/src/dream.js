/* finesse · universe dream · real captures, accessible clouds, same-URL focus zoom · 2026-09-20 */
import {mountSurfaceFullscreen} from './fullscreen.js';
import {createDreamEmitter,createDreamPlayback} from './dream-flow.js';
import {placeDreamThought} from './dream-layout.js';
import {createDreamMotion} from './dream-motion.js';

const CLOUD_PATH='M58 155C28 155 12 141 12 122c0-19 13-33 33-35C39 61 59 38 86 43c10-31 51-33 69-8 26-10 55 5 58 30 25-4 49 15 48 39 21 3 31 16 28 30-3 15-17 21-41 21Z';
const TINTS={'备忘':['#ffe1ef','#b25480'],'学习灵感':['#e6ddff','#7652b2'],'英语':['#eff7bf','#657525'],'链接':['#dceaff','#4974a8'],'消息摘录':['#d2f5ee','#317d72']};
function cloudPalette(item){
  const color=String(item.color||'').trim();
  if(!/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(color))return TINTS[item.category]||TINTS['备忘'];
  const hex=color.length===4?color.slice(1).split('').map(c=>c+c).join(''):color.slice(1);
  const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
  // Keep every chosen hue recognizable while giving the dark cloud lettering a light surface.
  const tint=rgb.map(n=>Math.round(n*.3+255*.7));
  const ink=rgb.map(n=>Math.round(n*.32+32*.68));
  return [tint,ink].map(channels=>'#'+channels.map(n=>n.toString(16).padStart(2,'0')).join(''));
}
const hash=value=>Array.from(String(value)).reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,0);
const cloudSVG=()=>`<svg class="dream-cloud-shape" viewBox="0 0 300 176" aria-hidden="true"><path d="${CLOUD_PATH}"/><path class="dream-cloud-sheen" d="M58 63c4-14 16-22 29-19M99 37c12-14 29-13 39-1"/></svg>`;
const fullIcon='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';

export function mountDream(ctx, options={}) {
  const {root,icon,esc}=ctx;
  const items=(Array.isArray(options.items)?options.items:[]).filter(item=>!item.archived);
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  let alive=true,query='',paused=false,offscreen=false,selected=null,source=null,animation=null,closing=false,historyPending=false,afterClose=null,closeTimer=0;
  let emitter=createDreamEmitter(items),found=items,compact=false,tickMs=2400,lastSize='',stopped=false,hardBlocked=false,burstRequest=null;
  const thoughts=new Map();
  const token=`dream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const matches=()=>items.filter(item=>!query||`${item.text||''} ${item.tags||''} ${item.category||''} ${item.fileName||''}`.toLocaleLowerCase().includes(query));
  root.innerHTML=`<section class="dream-surface" aria-label="灵感梦境"><header class="dream-toolbar"><div class="dream-heading"><span class="dream-mode-icon">${icon('cloud',22)}</span><div><h2>梦境模式</h2><p>让旧念头，重新流过来。</p></div></div><div class="dream-tools"><button type="button" class="btn compact" data-dream="exit">${icon('layers',16)}<span>灵感墙</span></button><button type="button" class="btn compact" data-dream="pause" aria-label="暂停流动" aria-pressed="false">${icon('pause',17)}<span>暂停</span></button><button type="button" class="icon-btn" data-dream="fullscreen" aria-label="全屏梦境">${fullIcon}</button><button type="button" class="btn compact primary" data-dream="create">${icon('plus',17)}<span>记下联想</span></button></div></header><div class="dream-search-row"><label class="dream-search">${icon('search',17)}<input type="search" data-dream-view placeholder="从一个词开始联想…" aria-label="搜索梦境中的灵感" maxlength="12000"></label><span class="dream-count" aria-live="polite"></span></div><div class="dream-sky"><div class="dream-horizon" aria-hidden="true"></div><div class="dream-current" aria-hidden="true"></div><div class="dream-scene" role="list" aria-label="正在浮现的旧念头" aria-live="off"></div><div class="dream-empty" hidden></div><div class="dream-sky-note">不急着整理，看看哪个念头会让你停下来。<small>念头正在自行流动。悬停接住一条，其余继续；点开阅读全文。</small></div></div><footer class="dream-footer"><span class="dream-motion-note"></span><button type="button" class="btn compact" data-dream="next">${icon('sparkles',17)}<span>让灵感涌来</span></button></footer><dialog class="dream-dialog" aria-labelledby="dream-detail-title"><article class="dream-detail"></article></dialog></section>`;
  const surface=root.querySelector('.dream-surface'),scene=root.querySelector('.dream-scene'),dialog=root.querySelector('.dream-dialog'),detail=root.querySelector('.dream-detail');
  const search=root.querySelector('.dream-search input');
  const playback=createDreamPlayback({delay:()=>{tickMs=1800+Math.random()*1400;return tickMs;},advance:evolve});
  // Pause both the clock and the visual layers. Global editor/AI overlays can sit outside this surface.
  const setPaused=()=>{
    if(!alive)return;
    if(reduced.matches)for(const thought of thoughts.values())if(thought.leaving&&thought!==burstRequest?.thought)retire(thought,true);
    const overlay=!!document.querySelector('#modal[open],#ai-drawer:not([hidden])');
    hardBlocked=offscreen||document.hidden||!!selected||overlay;
    stopped=paused||hardBlocked||reduced.matches;
    surface.classList.toggle('dream-burst-blocked',hardBlocked);
    for(const thought of thoughts.values()){
      thought.held=thought.hovered||thought.element.contains(document.activeElement);
      thought.element.classList.toggle('dream-held',thought.held);
      if(thought.held&&!thought.leaving&&thought!==burstRequest?.thought)thought.element.classList.add('dream-instant');
      if(stopped||thought.held)thought.motion?.pause();else thought.motion?.play();
    }
    if(stopped)for(const thought of thoughts.values())if(!thought.leaving&&thought!==burstRequest?.thought)thought.element.classList.add('dream-instant');
    surface.classList.toggle('dream-paused',stopped);
    playback.setPaused(stopped||found.length<2);
    const button=surface.querySelector('[data-dream="pause"]');
    button.disabled=reduced.matches;button.setAttribute('aria-pressed',String(paused||reduced.matches));
    button.setAttribute('aria-label',paused?'继续流动':'暂停流动');
    button.innerHTML=icon(paused?'play':'pause',17)+`<span>${paused?'继续':'暂停'}</span>`;
    surface.querySelector('.dream-motion-note').textContent=reduced.matches?'静态梦境 · 可手动唤起灵感':paused?'已暂停 · 按自己的节奏读':selected||overlay?'为你停留 · 关闭后自动继续':found.length===0?'记下念头，让它在这里流动':found.length===1?'念头正在流动 · 随时记下新的联想':'自动流动中 · 旧念头会不断随机浮现';
    syncBurst();
  };
  const bounds=()=>({width:scene.clientWidth,height:scene.clientHeight});
  const capacity=()=>compact?3:5;
  function startMotion(thought,occupied=occupiedPositions(thought)){
    thought.motion?.cancel();thought.motion=null;
    const plan=createDreamMotion({...bounds(),position:thought.position,occupied});
    thought.area=plan?.area||thought.position;
    if(!plan||typeof thought.element.animate!=='function')return;
    thought.life=plan.duration;
    thought.motion=thought.element.animate(plan.keyframes,{duration:plan.duration,iterations:Infinity,direction:'alternate',easing:'ease-in-out',fill:'both'});
    if(stopped||reduced.matches||thought.held)thought.motion.pause();
  }
  function occupiedPositions(exclude){
    // Reserve each whole journey so two readable clouds cannot drift through one another.
    return [...thoughts.values()].filter(thought=>thought!==exclude).map(thought=>thought.area||thought.position);
  }
  function emitThought(instant=false,manual=false){
    if(thoughts.size>=capacity())return false;
    const position=placeDreamThought({...bounds(),occupied:occupiedPositions()});
    if(!position)return false;
    const item=emitter.pick([...thoughts.keys()]);if(!item)return false;
    const n=hash(item.id),[tint,ink]=cloudPalette(item),title=String(item.text||item.fileName||'未命名灵感');
    const date=new Date(item.createdAt),when=Number.isNaN(date.getTime())?'曾经记下':date.toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
    const element=document.createElement('div');
    element.className='dream-cloud-slot'+(Math.random()<.55?' dream-bright':'')+(instant?' dream-instant':'')+(manual?' dream-manual-transition':'');
    element.setAttribute('role','listitem');
    element.style.cssText=`--cloud-tint:${tint};--cloud-ink:${ink};--cloud-shimmer:${4+n%4}s;--cloud-phase:-${n%7}s;left:${position.x}px;top:${position.y}px;width:${position.w}px;`;
    element.innerHTML=`<div class="dream-cloud-arrival"><button type="button" class="dream-cloud" data-cloud="${esc(item.id)}" aria-label="展开灵感：${esc(title.slice(0,100))}">${cloudSVG()}<span class="dream-cloud-copy"><span class="dream-cloud-category">${esc(item.category||'灵感')}${item.fileName?` · ${icon('file',11)}`:''}</span><strong>${esc(title.slice(0,130))}</strong><small>${esc(when)}的念头</small></span><span class="dream-cloud-glint" aria-hidden="true">✦</span></button></div>`;
    scene.append(element);
    const thought={item,element,position,age:0,life:24000,leaving:false,hovered:false,held:false,motion:null};
    thoughts.set(item.id,thought);startMotion(thought);
    return thought;
  }
  function retire(thought,immediate=false){
    if(thought.leaving&&!immediate)return;
    thought.leaving=true;
    if(immediate||reduced.matches){thought.motion?.cancel();thought.element.remove();thoughts.delete(thought.item.id);return;}
    thought.element.classList.add('dream-leaving');
  }
  const depart=event=>{
    const element=event.target.closest('.dream-cloud-slot');
    if(burstRequest?.thought.element===element){
      const expected=burstRequest.phase!=='arrive'?'dream-depart':['dream-arrive','dream-emerge'];
      if((Array.isArray(expected)?expected.includes(event.animationName):event.animationName===expected)&&!hardBlocked&&!burstRequest.thought.held)finishBurstPhase(burstRequest);
      return;
    }
    if(event.animationName!=='dream-depart')return;
    const thought=[...thoughts.values()].find(value=>value.element===element);
    if(thought?.leaving){
      thought.motion?.cancel();element.remove();thoughts.delete(thought.item.id);
      if(alive&&!thoughts.size&&!burstRequest)emitThought();
    }
  };
  function evolve(){
    for(const thought of thoughts.values()){
      if(thought.held||thought===burstRequest?.thought)continue;
      thought.age+=tickMs;
      if(found.length>1&&thought.age>=thought.life)retire(thought);
    }
    // A requested arrival owns the next free slot, without resetting anyone else's clock.
    if(!burstRequest){emitThought();if(Math.random()<.24)emitThought();}
  }
  function updateBurstButton(){
    const button=surface.querySelector('[data-dream="next"]');
    button.setAttribute('aria-busy',String(!!burstRequest));
    button.classList.toggle('dream-burst-pending',!!burstRequest);
  }
  function pauseBurstTimer(request){
    if(!request.timer)return;
    clearTimeout(request.timer);request.timer=0;
    request.remaining=Math.max(0,request.remaining-(performance.now()-request.started));
  }
  function syncBurst(){
    const request=burstRequest;if(!request)return;
    if(hardBlocked||request.thought.held){pauseBurstTimer(request);return;}
    if(reduced.matches){finishBurstPhase(request);return;}
    if(request.timer)return;
    request.started=performance.now();
    // animationend is primary; the bounded fallback also handles a cancelled CSS animation.
    request.timer=setTimeout(()=>{request.timer=0;if(alive&&burstRequest===request)finishBurstPhase(request);},request.remaining);
  }
  function beginBurstPhase(thought,phase){
    thought.element.classList.remove('dream-instant');
    thought.element.classList.add('dream-manual-transition');
    thought.element.classList.toggle('dream-manual-wait',phase==='wait');
    burstRequest={thought,phase,timer:0,started:0,remaining:(phase==='wait'?1100:phase==='depart'?420:680)+60};
    updateBurstButton();syncBurst();
  }
  function finishBurstPhase(request){
    if(!alive||burstRequest!==request||hardBlocked||request.thought.held)return;
    clearTimeout(request.timer);request.timer=0;
    const thought=request.thought;burstRequest=null;
    thought.element.classList.remove('dream-manual-transition','dream-manual-wait');
    if(request.phase!=='arrive'){
      retire(thought,true);
      const added=emitThought(reduced.matches,true);
      if(added){beginBurstPhase(added,'arrive');return;}
    }else{
      // Removing the shorter animation must not restart the natural arrival on this node.
      thought.element.classList.add('dream-instant');
    }
    updateBurstButton();
  }
  function cancelBurst(){
    const request=burstRequest;if(!request)return;
    clearTimeout(request.timer);burstRequest=null;
    request.thought.element.classList.remove('dream-manual-transition','dream-manual-wait');
    if(request.phase!=='wait'){request.thought.element.classList.remove('dream-leaving');request.thought.leaving=false;}
    request.thought.element.classList.add('dream-instant');
    updateBurstButton();
  }
  function burst(){
    // Repeated presses merge into the transition already in flight; focus stays on the button.
    if(!alive||burstRequest||found.length<2||hardBlocked)return;
    const added=emitThought(reduced.matches,true);
    if(added){beginBurstPhase(added,'arrive');return;}
    const candidates=[...thoughts.values()].filter(thought=>!thought.held).sort((a,b)=>b.age-a.age);
    const oldest=candidates.find(thought=>thought.leaving)||candidates[0];
    if(!oldest)return;
    if(reduced.matches){
      retire(oldest,true);const replacement=emitThought(true);
      if(replacement)replacement.element.classList.add('dream-instant');
      return;
    }
    // Adopt an existing departure at its current opacity/phase instead of fading another cloud.
    if(oldest.leaving)beginBurstPhase(oldest,'wait');
    else{retire(oldest);beginBurstPhase(oldest,'depart');}
  }
  function draw(){
    cancelBurst();
    for(const thought of thoughts.values())thought.motion?.cancel();
    thoughts.clear();scene.innerHTML='';
    for(let i=0;i<Math.min(2,found.length);i++)emitThought(true);
    surface.querySelector('.dream-count').textContent=`${found.length} 个${query?'匹配的':'旧'}念头`;
    surface.querySelector('[data-dream="next"]').disabled=found.length<2;
    const empty=surface.querySelector('.dream-empty');empty.hidden=found.length>0;
    empty.innerHTML=`${cloudSVG()}<h3>${query?'还没有与这个词有关的念头':'让第一个念头，在这里出现。'}</h3><p>${query?'试试内容中的其他词，或清空搜索。':'随手记下的灵感，会在这里不期而遇。'}</p><button type="button" class="btn primary" data-dream="${query?'clear':'create'}">${query?'清空搜索':'记下第一个想法'}</button>`;
    surface.querySelector('.dream-sky-note').hidden=!found.length;
    setPaused();
  }
  function stopAnimation(){animation?.cancel();animation=null;}
  function animateZoom(open){
    stopAnimation();
    if(reduced.matches||!source?.isConnected||typeof detail.animate!=='function')return Promise.resolve();
    const a=source.getBoundingClientRect(),b=detail.getBoundingClientRect();
    const transform=`translate(${a.left+a.width/2-b.left-b.width/2}px,${a.top+a.height/2-b.top-b.height/2}px) scale(${Math.min(1,a.width/b.width)},${Math.min(1,a.height/b.height)})`;
    const frames=[{transform,opacity:.4},{transform:'translate(0,0) scale(1,1)',opacity:1}];
    const own=detail.animate(open?frames:[...frames].reverse(),{duration:open?480:280,easing:'cubic-bezier(.22,.72,.24,1)',fill:'both'});animation=own;
    return own.finished.catch(()=>{}).then(()=>{if(animation===own){own.cancel();animation=null;}});
  }
  function openDetail(id,button){
    if(selected||!alive)return;
    const item=items.find(item=>item.id===id);if(!item)return;
    selected=item;source=button;closing=false;historyPending=false;
    const [tint,ink]=cloudPalette(item);
    detail.style.setProperty('--cloud-tint',tint);detail.style.setProperty('--cloud-ink',ink);
    const created=new Date(item.createdAt),date=Number.isNaN(created.getTime())?'':created.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'});
    detail.innerHTML=`<header class="dream-detail-head"><span class="dream-detail-symbol">${icon('cloud',24)}</span><div><span>${esc(item.category||'灵感')}${date?` · ${esc(date)}`:''}</span><h2 id="dream-detail-title">这一刻的想法</h2></div><button type="button" class="icon-btn" data-dream="close" data-close aria-label="收起云朵">${icon('close',20)}</button></header><div class="dream-detail-scroll"><div class="dream-detail-text">${esc(item.text||item.fileName||'这条灵感还没有文字。')}</div>${item.tags?`<p class="dream-detail-tags"># ${esc(item.tags)}</p>`:''}${item.fileName?`<button type="button" class="dream-attachment" data-dream="download" ${options.onDownload?'':'disabled'}>${icon('file',20)}<span>${esc(item.fileName)}</span>${icon('download',17)}</button>`:''}</div><footer class="dream-detail-foot"><button type="button" class="btn" data-dream="edit">${icon('edit',16)} 编辑灵感</button>${options.onArchive?`<button type="button" class="text-btn" data-dream="archive">${icon(item.archived?'refresh':'archive',16)} ${item.archived?'恢复':'归档'}</button>`:''}<button type="button" class="text-btn dream-return" data-dream="close">回到梦境 ${icon('arrow-left',15)}</button></footer>`;
    surface.classList.add('has-dream-open');surface.setAttribute('data-dream-detail-open','');setPaused();dialog.showModal();
    // A same-URL history entry lets Android/browser Back fold the cloud first.
    history.pushState({...history.state,__czbYuzhouDream:token},'',location.href);
    detail.querySelector('[data-dream="close"]').focus({preventScroll:true});
    animateZoom(true);
  }
  async function finishClose(immediate=false){
    if(!selected||closing)return;closing=true;clearTimeout(closeTimer);
    const selectedId=selected.id;
    if(!immediate)await animateZoom(false);else stopAnimation();
    if(!alive)return;
    dialog.close();selected=null;closing=false;historyPending=false;surface.classList.remove('has-dream-open');surface.removeAttribute('data-dream-detail-open');setPaused();
    const returnFocus=source?.isConnected?source:scene.querySelector(`[data-cloud="${CSS.escape(selectedId)}"]`)||search;
    returnFocus.focus({preventScroll:true});
    const callback=afterClose;afterClose=null;callback?.();
  }
  function dismiss(callback){
    if(!selected||closing||historyPending)return;afterClose=typeof callback==='function'?callback:null;
    if(history.state?.__czbYuzhouDream===token){historyPending=true;history.back();closeTimer=setTimeout(()=>finishClose(),220);}else finishClose();
  }
  const popstate=()=>{if(selected&&history.state?.__czbYuzhouDream!==token)finishClose();};
  const cancel=event=>{event.preventDefault();dismiss();};
  const unexpectedClose=()=>{if(selected&&!closing)dismiss();};
  const click=event=>{
    const cloud=event.target.closest('[data-cloud]');if(cloud){openDetail(cloud.dataset.cloud,cloud);return;}
    const button=event.target.closest('[data-dream]');if(!button||button.disabled)return;
    const action=button.dataset.dream;
    if(action==='exit')options.onExit?.();
    if(action==='create')options.onCreate?.();
    if(action==='close')dismiss();
    if(action==='edit'){const id=selected?.id;dismiss(()=>options.onEdit?.(id));}
    if(action==='archive'){const id=selected?.id;dismiss(()=>options.onArchive?.(id));}
    if(action==='download'&&selected)options.onDownload?.(selected.id);
    if(action==='pause'){paused=!paused;setPaused();}
    if(action==='next')burst();
    if(action==='clear'){search.value='';searchChange();search.focus();setPaused();}
    if(action==='fullscreen')fullscreen.toggle();
  };
  const fullscreen=mountSurfaceFullscreen({element:surface,label:'梦境',onChange:active=>{const button=surface.querySelector('[data-dream="fullscreen"]');button.setAttribute('aria-label',active?'退出全屏梦境':'全屏梦境');button.setAttribute('aria-pressed',String(active));}});
  const resize=()=>{
    compact=surface.getBoundingClientRect().width<700;surface.classList.toggle('dream-compact',compact);
    const size=bounds(),signature=`${size.width}:${size.height}`;
    // A hidden/captured surface can briefly report no usable area. Keep its thoughts until visible.
    if(size.width<248||size.height<215)return;
    if(signature===lastSize)return;lastSize=signature;
    cancelBurst();
    const occupied=[];
    for(const thought of thoughts.values()){
      const position=placeDreamThought({...bounds(),occupied});
      if(!position){if(thought.item!==selected&&!thought.element.contains(document.activeElement))retire(thought,true);continue;}
      thought.position=position;
      Object.assign(thought.element.style,{left:position.x+'px',top:position.y+'px',width:position.w+'px'});
      thought.age=0;startMotion(thought,occupied);occupied.push(thought.area);
    }
    if(!thoughts.size&&found.length)emitThought(true);
  };
  const searchChange=()=>{query=search.value.trim().toLocaleLowerCase();found=matches();emitter=createDreamEmitter(found);draw();playback.reset();};
  const pointerOver=event=>{
    const cloud=event.target.closest('[data-cloud]'),thought=thoughts.get(cloud?.dataset.cloud);
    if(event.pointerType!=='touch'&&thought){thought.hovered=true;setPaused();}
  };
  const pointerOut=event=>{
    const cloud=event.target.closest('[data-cloud]'),thought=thoughts.get(cloud?.dataset.cloud);
    if(thought&&event.relatedTarget?.closest?.('[data-cloud]')!==cloud){thought.hovered=false;setPaused();}
  };
  const focusChange=()=>queueMicrotask(setPaused);
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{offscreen=!entries[0]?.isIntersecting;setPaused();},{threshold:.02}):null;
  const sizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;
  // Observe only overlay visibility, never record content or the scene's animated attributes.
  const overlayObserver=typeof MutationObserver==='function'?new MutationObserver(setPaused):null;
  for(const overlay of document.querySelectorAll('#modal,#ai-drawer'))overlayObserver?.observe(overlay,{attributes:true,attributeFilter:['open','hidden']});
  sizeObserver?.observe(surface);
  observer?.observe(surface);
  surface.addEventListener('click',click);search.addEventListener('input',searchChange);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',unexpectedClose);
  scene.addEventListener('animationend',depart);scene.addEventListener('pointerover',pointerOver);scene.addEventListener('pointerout',pointerOut);
  surface.addEventListener('focusin',focusChange);surface.addEventListener('focusout',focusChange);
  window.addEventListener('popstate',popstate);window.addEventListener('resize',resize);document.addEventListener('visibilitychange',setPaused);reduced.addEventListener('change',setPaused);
  resize();draw();
  return ()=>{
    alive=false;cancelBurst();clearTimeout(closeTimer);stopAnimation();playback.destroy();observer?.disconnect();sizeObserver?.disconnect();overlayObserver?.disconnect();fullscreen.destroy();
    for(const thought of thoughts.values())thought.motion?.cancel();
    if(history.state?.__czbYuzhouDream===token){const next={...history.state};delete next.__czbYuzhouDream;history.replaceState(next,'',location.href);}
    if(dialog.open)dialog.close();
    surface.removeEventListener('click',click);search.removeEventListener('input',searchChange);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',unexpectedClose);
    scene.removeEventListener('animationend',depart);scene.removeEventListener('pointerover',pointerOver);scene.removeEventListener('pointerout',pointerOut);
    surface.removeEventListener('focusin',focusChange);surface.removeEventListener('focusout',focusChange);
    window.removeEventListener('popstate',popstate);window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',setPaused);reduced.removeEventListener('change',setPaused);
  };
}




