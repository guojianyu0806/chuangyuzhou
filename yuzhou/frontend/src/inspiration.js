// A presentation of real captures. Rendering/search never changes records or canvas geometry.
const PALETTE={'备忘':'#EBC0CC','学习灵感':'#C7B3F5','英语':'#DAE394','链接':'#B8D4EF','消息摘录':'#B7DED0'};
const hash=value=>Array.from(String(value)).reduce((n,char)=>(Math.imul(n,31)+char.charCodeAt(0))>>>0,0);
export const INSPIRATION_FILTERS=[['all','全部灵感'],['学习灵感','学习灵感'],['备忘','备忘'],['英语','英语'],['链接','链接'],['消息摘录','摘录'],['archived','已归档']];
const validColor=value=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value);
export function inspirationAppearance(item,boardColor){
  const base=validColor(boardColor)?boardColor:validColor(item.color)?item.color:PALETTE[item.category]||PALETTE['备忘'];
  const rgb=base.slice(1).match(/../g).map(n=>parseInt(n,16));
  const mix=(weight,light)=>'#'+rgb.map(n=>Math.round(n*weight+light*(1-weight)).toString(16).padStart(2,'0')).join('');
  const length=String(item.text||item.fileName||'').length;
  return {tint:mix(.35,255),edge:mix(.48,80),turn:((hash(item.id)%7)-3)*.45,
    shape:item.category==='消息摘录'?'bubble':item.category==='备忘'||item.fileName?'paper':'soft',
    size:length<42?'brief':length>150?'long':'medium'};
}
export function selectInspirations(items,filter='all',query=''){
  const term=String(query).trim().toLocaleLowerCase();
  return items.filter(item=>(filter==='archived'?item.archived:!item.archived&&(filter==='all'||item.category===filter))&&(!term||[item.text,item.tags,item.category,item.fileName].some(value=>String(value||'').toLocaleLowerCase().includes(term))))
    .sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
}
const burst=`<svg viewBox="0 0 112 106" fill="none" aria-hidden="true"><path d="m55 24 6 18 22-4-12 19 18 13-25 2-2 21-13-18-20 12 5-23-22-6 23-11-5-19Z" fill="currentColor" opacity=".18"/><path d="M57 10v9m30 5-7 8m21 15-11 3M14 27l9 8M9 63l13-2m55 32-5-10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="m47 44 13-5-3 13 10-2-18 19 4-16-10 2Z" fill="currentColor"/></svg>`;
export function renderInspirationCards(items,{esc,icon,boardColors=new Map(),taskCaptureIds=new Set()}={}){
  return items.map((item,index)=>{
    const visual=inspirationAppearance(item,boardColors.get(item.id));
    const body=String(item.text||item.fileName||'未命名灵感'),label=body.slice(0,70);
    const date=new Date(item.createdAt),dateText=Number.isNaN(date.getTime())?'':date.toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
    return `<article class="inspiration-note" role="listitem" data-shape="${visual.shape}" data-size="${visual.size}" style="--spark-tint:${visual.tint};--spark-edge:${visual.edge};--spark-turn:${visual.turn}deg;--spark-delay:${Math.min(index,7)*35}ms">
      <header class="inspiration-note-head"><span class="inspiration-category">${icon(item.category==='消息摘录'?'message':item.fileName?'file':'bolt',14)}${esc(item.category||'灵感')}${item.archived?' · 已归档':''}</span>${dateText?`<time datetime="${esc(item.createdAt)}">${esc(dateText)}</time>`:''}</header>
      <button type="button" class="inspiration-note-open" data-action="edit-capture" data-id="${esc(item.id)}" aria-label="编辑灵感：${esc(label)}"><p>${esc(body)}</p><span class="inspiration-open-hint">展开这个念头 ${icon('arrow-right',14)}</span></button>
      ${item.fileName?`<button type="button" class="inspiration-attachment" data-action="download-capture" data-id="${esc(item.id)}">${icon('file',15)}<span>${esc(item.fileName)}</span>${icon('download',14)}</button>`:''}
      ${item.tags?`<p class="inspiration-tags"># ${esc(item.tags)}</p>`:''}
      <footer class="inspiration-note-actions"><button type="button" data-action="capture-task" data-id="${esc(item.id)}">${icon(taskCaptureIds.has(item.id)?'check-circle':'arrow-right',14)}${taskCaptureIds.has(item.id)?'查看待办':'变成行动'}</button><button type="button" data-action="archive-capture" data-id="${esc(item.id)}" aria-label="${item.archived?'恢复':'归档'}灵感：${esc(label)}">${icon(item.archived?'refresh':'archive',14)}${item.archived?'恢复':'归档'}</button></footer>
    </article>`;
  }).join('');
}
export function mountInspirationWall(ctx,{filter='all',query='',onQuery=()=>{}}={}){
  const {root,state,esc,icon}=ctx;
  const items=state.captures||[],boardColors=new Map((state.boards?.inbox?.cards||[]).map(card=>[card.id,card.color]));
  const taskCaptureIds=new Set((state.tasks||[]).filter(task=>!task.archived).map(task=>task.captureId));
  let currentQuery=query,alive=true,initial=true;
  root.innerHTML=`<section class="inspiration-wall" aria-label="灵感墙">
    <header class="inspiration-intro"><div class="inspiration-title"><div class="inspiration-burst">${burst}</div><small>灵感收集箱</small><h1>接住，<span>这一闪念。</span></h1><p>一句话、一个问题、一段摘录。先记下来，慢慢连成想法。</p></div><div class="inspiration-actions"><button class="btn primary" type="button" data-action="add-capture">${icon('plus',18)}记下一闪念</button><button class="btn" type="button" data-action="capture-file">${icon('upload',17)}添加附件</button><button class="btn soft" type="button" data-action="inspiration-ai">${icon('sparkles',17)}和 AI 理一理</button></div></header>
    <div class="inspiration-tools"><label class="inspiration-search">${icon('search',18)}<input type="search" data-inspiration-view maxlength="240" value="${esc(query)}" placeholder="找回某个想法、标签或附件…" aria-label="搜索灵感"></label><div class="inspiration-views" role="group" aria-label="灵感视图"><button type="button" aria-pressed="true" data-action="inspiration-wall">${icon('bolt',16)}灵感墙</button><button type="button" aria-pressed="false" data-action="inspiration-canvas">${icon('layers',16)}自由画布</button><button type="button" aria-pressed="false" data-action="dream-mode">${icon('cloud',16)}梦境</button></div></div>
    <div class="inspiration-filters" role="group" aria-label="灵感分类">${INSPIRATION_FILTERS.map(([id,label])=>`<button type="button" class="${filter===id?'active':''}" aria-pressed="${filter===id}" data-action="filter" data-filter="${esc(id)}">${esc(label)}</button>`).join('')}</div>
    <div class="inspiration-meta"><span data-inspiration-count role="status" aria-live="polite"></span><span>点击展开 · 让灵感长成行动</span></div>
    <div class="inspiration-scatter" role="list" aria-label="已保存的灵感"></div><div class="inspiration-empty" hidden></div>
    </section>`;
  const input=root.querySelector('[data-inspiration-view]'),grid=root.querySelector('.inspiration-scatter'),empty=root.querySelector('.inspiration-empty'),count=root.querySelector('[data-inspiration-count]');
  function draw(){
    if(!alive)return;
    const selected=selectInspirations(items,filter,currentQuery);
    count.textContent=`${selected.length} 个${filter==='archived'?'已归档的想法':currentQuery.trim()?'匹配的想法':'想法'}`;
    grid.className='inspiration-scatter'+(initial?' is-arriving':'');initial=false;
    grid.innerHTML=renderInspirationCards(selected,{esc,icon,boardColors,taskCaptureIds});
    grid.hidden=!selected.length;empty.hidden=!!selected.length;
    empty.innerHTML=selected.length?'':`${burst}<h2>${currentQuery.trim()?'还没找到这个想法':filter==='archived'?'归档的想法会留在这里':filter==='all'?'下一闪念，从这里开始。':'这一类还没有想法'}</h2><p>${currentQuery.trim()?'换个关键词，试试正文、标签或附件名称。':filter==='archived'?'归档不会删除内容，随时可以恢复。':'不必先想完整。记下一句话，就有了起点。'}</p>${currentQuery.trim()?'<button class="btn" type="button" data-inspiration-clear>清空搜索</button>':filter==='archived'?'':'<button class="btn primary" type="button" data-action="add-capture">记下第一个想法</button>'}`;
  }
  const change=event=>{if(event.target!==input)return;currentQuery=input.value;onQuery(currentQuery);draw();};
  const clear=event=>{if(!event.target.closest('[data-inspiration-clear]'))return;input.value='';currentQuery='';onQuery('');draw();input.focus();};
  root.addEventListener('input',change);root.addEventListener('click',clear);draw();
  return ()=>{alive=false;root.removeEventListener('input',change);root.removeEventListener('click',clear);};
}
