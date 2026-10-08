/* finesse · universe dream · real captures, accessible clouds, same-URL focus zoom · 2026-09-20 */
import {mountSurfaceFullscreen} from './fullscreen.js';

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
  const items=Array.isArray(options.items)?options.items:[];
  const small=matchMedia('(max-width:680px)'),reduced=matchMedia('(prefers-reduced-motion:reduce)');
  let alive=true,page=0,query='',paused=false,offscreen=false,selected=null,source=null,animation=null,closing=false,historyPending=false,afterClose=null,closeTimer=0;
  const token=`dream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pageSize=()=>small.matches?6:12;
  const matches=()=>items.filter(item=>!query||`${item.text||''} ${item.tags||''} ${item.category||''} ${item.fileName||''}`.toLocaleLowerCase().includes(query));
  root.innerHTML=`<section class="dream-surface" aria-label="灵感梦境"><header class="dream-toolbar"><div class="dream-heading"><span class="dream-mode-icon">${icon('cloud',22)}</span><div><h2>梦境模式</h2><p>让想法漂浮，点一朵云慢慢读。</p></div></div><div class="dream-tools"><button type="button" class="btn compact" data-dream="exit">${icon('layers',16)}<span>卡片排列</span></button><button type="button" class="icon-btn" data-dream="pause" aria-label="暂停漂浮" aria-pressed="false">${icon('pause',17)}</button><button type="button" class="icon-btn" data-dream="fullscreen" aria-label="全屏梦境">${fullIcon}</button><button type="button" class="btn compact primary" data-dream="create">${icon('plus',17)}<span>新灵感</span></button></div></header><div class="dream-search-row"><label class="dream-search">${icon('search',17)}<input type="search" data-dream-view placeholder="寻找一朵云…" aria-label="搜索梦境中的灵感" maxlength="12000"></label><span class="dream-count" aria-live="polite"></span></div><div class="dream-sky"><div class="dream-horizon" aria-hidden="true"></div><div class="dream-scene" role="list" aria-label="灵感云朵"></div><div class="dream-empty" hidden></div><div class="dream-sky-note" aria-hidden="true">每一个念头，都有自己的形状。</div></div><footer class="dream-footer"><span class="dream-motion-note">云朵轻轻漂浮 · 点击展开</span><nav class="dream-pagination" aria-label="灵感云朵翻页"><button type="button" class="icon-btn" data-dream="prev" aria-label="上一组灵感">${icon('arrow-left',17)}</button><span class="dream-page" aria-live="polite"></span><button type="button" class="icon-btn" data-dream="next" aria-label="下一组灵感">${icon('arrow-right',17)}</button></nav></footer><dialog class="dream-dialog" aria-labelledby="dream-detail-title"><article class="dream-detail"></article></dialog></section>`;
  const surface=root.querySelector('.dream-surface'),scene=root.querySelector('.dream-scene'),dialog=root.querySelector('.dream-dialog'),detail=root.querySelector('.dream-detail');
  const search=root.querySelector('.dream-search input');
  const setPaused=()=>{surface.classList.toggle('dream-paused',paused||offscreen||document.hidden||!!selected||reduced.matches);surface.querySelector('[data-dream="pause"]').disabled=reduced.matches;surface.querySelector('.dream-motion-note').textContent=reduced.matches?'静态梦境 · 点击云朵展开':paused?'漂浮已暂停 · 点击云朵展开':'云朵轻轻漂浮 · 点击展开';};
  function draw(){
    const found=matches(),pages=Math.max(1,Math.ceil(found.length/pageSize()));page=Math.min(page,pages-1);
    scene.innerHTML=found.slice(page*pageSize(),(page+1)*pageSize()).map((item,index)=>{
      const n=hash(item.id),[tint,ink]=cloudPalette(item);
      const title=String(item.text||item.fileName||'未命名灵感');
      return `<div class="dream-cloud-slot" role="listitem" style="--cloud-tint:${tint};--cloud-ink:${ink};--cloud-x:${n%15-7}px;--cloud-y:${(n>>>4)%51-25}px;--cloud-turn:${(n%5-2)*.35}deg;--cloud-duration:${24+n%17}s;--cloud-delay:-${n%25}s;--cloud-breathe:${11+n%9}s;--cloud-stagger:${index*65}ms"><button type="button" class="dream-cloud" data-cloud="${esc(item.id)}" aria-label="展开灵感：${esc(title.slice(0,100))}">${cloudSVG()}<span class="dream-cloud-copy"><span class="dream-cloud-category">${esc(item.category||'灵感')}${item.fileName?` · ${icon('file',11)}`:''}</span><strong>${esc(title.slice(0,90))}</strong>${item.tags?`<small># ${esc(String(item.tags).slice(0,28))}</small>`:''}</span><span class="dream-cloud-glint" aria-hidden="true">✦</span></button></div>`;
    }).join('');
    surface.querySelector('.dream-count').textContent=`${found.length} 朵灵感云`;
    surface.querySelector('.dream-page').textContent=`${page+1} / ${pages}`;
    surface.querySelector('[data-dream="prev"]').disabled=page===0;
    surface.querySelector('[data-dream="next"]').disabled=page===pages-1;
    const empty=surface.querySelector('.dream-empty');empty.hidden=found.length>0;
    empty.innerHTML=`${cloudSVG()}<h3>${query?'这片天空还没有匹配的云':'第一朵云，等你的一个念头。'}</h3><p>${query?'试试内容中的其他词，或清空搜索。':'随手记下的灵感，会在这里轻轻漂浮。'}</p><button type="button" class="btn primary" data-dream="${query?'clear':'create'}">${query?'清空搜索':'记下第一个想法'}</button>`;
    scene.classList.toggle('dream-few',found.length<=3);setPaused();
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
    history.pushState({...history.state,__yuzhouDream:token},'',location.href);
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
    if(history.state?.__yuzhouDream===token){historyPending=true;history.back();closeTimer=setTimeout(()=>finishClose(),220);}else finishClose();
  }
  const popstate=()=>{if(selected&&history.state?.__yuzhouDream!==token)finishClose();};
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
    if(action==='pause'){paused=!paused;button.setAttribute('aria-pressed',String(paused));button.setAttribute('aria-label',paused?'继续漂浮':'暂停漂浮');button.innerHTML=icon(paused?'play':'pause',17);setPaused();}
    if(action==='prev'||action==='next'){page+=action==='prev'?-1:1;draw();surface.querySelector('.dream-search').scrollIntoView({block:'nearest',behavior:'instant'});}
    if(action==='clear'){query='';search.value='';page=0;draw();search.focus();}
    if(action==='fullscreen')fullscreen.toggle();
  };
  const fullscreen=mountSurfaceFullscreen({element:surface,label:'梦境',onChange:active=>{const button=surface.querySelector('[data-dream="fullscreen"]');button.setAttribute('aria-label',active?'退出全屏梦境':'全屏梦境');button.setAttribute('aria-pressed',String(active));}});
  const resize=()=>draw();
  const searchChange=()=>{query=search.value.trim().toLocaleLowerCase();page=0;draw();};
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{offscreen=!entries[0]?.isIntersecting;setPaused();},{threshold:.02}):null;
  observer?.observe(surface);
  surface.addEventListener('click',click);search.addEventListener('input',searchChange);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',unexpectedClose);
  window.addEventListener('popstate',popstate);document.addEventListener('visibilitychange',setPaused);small.addEventListener('change',resize);reduced.addEventListener('change',setPaused);
  draw();
  return ()=>{
    alive=false;clearTimeout(closeTimer);stopAnimation();observer?.disconnect();fullscreen.destroy();
    if(history.state?.__yuzhouDream===token){const next={...history.state};delete next.__yuzhouDream;history.replaceState(next,'',location.href);}
    if(dialog.open)dialog.close();
    surface.removeEventListener('click',click);search.removeEventListener('input',searchChange);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',unexpectedClose);
    window.removeEventListener('popstate',popstate);document.removeEventListener('visibilitychange',setPaused);small.removeEventListener('change',resize);reduced.removeEventListener('change',setPaused);
  };
}




