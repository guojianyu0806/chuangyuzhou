import {eventsOnDate} from './calendar-model.js';
import {summarizeCompetitions} from './competitions-model.js';
/* Free-position workspace canvas. Persisted coordinates are independent of viewport size. */
import {formatMoney,localDate,selectEntries,summarizeEntries} from './ledger-model.js';
import {CARD_PRESENTATIONS,normalizePresentation,normalizeStackPointer,stackMetrics,stackLayout} from './card-layouts.js';
import {weekForDate,entriesForWeek} from './timetable-model.js';
import {mountSurfaceFullscreen} from './fullscreen.js';
const PRESETS = {
  ai:      { x:36, y:40, w:540, h:380, color:'#B3A0FF', title:'AI 收件台', icon:'sparkles', label:'把零散，变有序。' },
  courses: { x:612, y:40, w:310, h:272, color:'#AE88FF', title:'课程空间', icon:'book', label:'让知识，连成线。' },
  english: { x:958, y:76, w:320, h:344, color:'#D8F649', title:'六级随身练', icon:'graduation', label:'碎片时间，也能向前。' },
  inbox:   { x:36, y:456, w:268, h:238, color:'#FF9CCE', title:'灵感收集箱', icon:'inbox', label:'先接住每一个想法。' },
  tasks:   { x:612, y:348, w:310, h:272, color:'#63E6DC', title:'备忘与待办', icon:'check-circle', label:'把事情，一件件做好。' },
  review:  { x:958, y:456, w:320, h:238, color:'#9DC5FF', title:'生活回顾', icon:'chart', label:'看见日常中的每一步。' },
  ledger:  { x:958, y:730, w:320, h:272, color:'#FFBC7C', title:'记账', icon:'wallet', label:'每一笔，都有去处。' },
  calendar: { x:382, y:1014, w:320, h:272, color:'#FF9CCE', title:'日历', icon:'calendar', label:'计划、标注和注意事项。' },
  timetable: { x:36, y:1014, w:320, h:272, color:'#8EDBE8', title:'学期课表', icon:'timetable', label:'按教学周，安排上课的每一天。' },
  competitions: { x:728, y:1040, w:320, h:272, color:'#D8F649', title:'比赛', icon:'flag', label:'截止节点、准备事项与参赛进度。' }
};
const COLORS=['#AE88FF','#63E6DC','#D8F649','#FF9CCE','#9DC5FF','#FFBC7C','#B3A0FF','#B4E6B9'];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const finite=(n,fallback)=>Number.isFinite(Number(n))?Number(n):fallback;
const validColor=value=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value);
const color=value=>validColor(value)?value:'#AE88FF';
const luminance=rgb=>rgb.map(c=>{const n=c/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
export function canvasCardFill(value) {
  const rgb=color(value).slice(1).match(/../g).map(n=>parseInt(n,16));
  let weight=.83,mixed;
  do{mixed=rgb.map(n=>Math.round(n*weight+255*(1-weight)));weight-=.04;}while(luminance(mixed)<.46&&weight>0);
  return `#${mixed.map(n=>n.toString(16).padStart(2,'0')).join('')}`;
}
const customSpot=index=>index===0?{x:340,y:456,w:236,h:238}:index===1?{x:612,y:656,w:310,h:238}:{x:36+((index-2)%3)*346,y:930+Math.floor((index-2)/3)*286,w:310,h:250};

export function ensureCanvas(state, presets = PRESETS) {
  if(!Array.isArray(state.spaces))state.spaces=[];
  if(!state.canvas||typeof state.canvas!=='object')state.canvas={};
  const canvas=state.canvas;
  if(!Array.isArray(canvas.cards))canvas.cards=[];
  const seen=new Set();
  canvas.cards=canvas.cards.filter(card=>card&&typeof card.id==='string'&&!seen.has(card.id)&&seen.add(card.id));
  const defaults=[...Object.entries(presets).map(([id,p])=>({id,...p})),...state.spaces.map((space,index)=>({id:space.id,...customSpot(index),color:color(space.color)}))];
  for(const def of defaults){
    let card=canvas.cards.find(c=>c.id===def.id);
    if(!card){
      const overlaps=c=>def.x<c.x+c.w+16&&def.x+def.w+16>c.x&&def.y<c.y+c.h+16&&def.y+def.h+16>c.y;
      if((!presets[def.id]||['ledger','timetable','calendar','competitions'].includes(def.id))&&canvas.cards.some(overlaps)){def.x=36;def.y=Math.max(...canvas.cards.map(c=>finite(c.y,0)+finite(c.h,250)))+36;}
      card={id:def.id,x:def.x,y:def.y,w:def.w,h:def.h,color:def.color};canvas.cards.push(card);
    }
    card.x=clamp(finite(card.x,def.x),-100000,100000);
    card.y=clamp(finite(card.y,def.y),-100000,100000);
    card.w=clamp(finite(card.w,def.w),def.id==='ai'?390:220,1100);
    card.h=clamp(finite(card.h,def.h),def.id==='ai'?350:220,850);
    if(!validColor(card.color))card.color=def.color;
  }
  const v=canvas.view;
  canvas.view={x:clamp(finite(v?.x,0),-150000,150000),y:clamp(finite(v?.y,0),-150000,150000),zoom:clamp(finite(v?.zoom,1),.3,1.6)};
  canvas.snap=canvas.snap!==false;
  canvas.stackPointer=normalizeStackPointer(canvas.stackPointer);
  return canvas;
}

export function canvasBounds(cards) {
  if(!cards.length)return {x:0,y:0,w:1000,h:650};
  const x=Math.min(...cards.map(c=>c.x)),y=Math.min(...cards.map(c=>c.y));
  return {x,y,w:Math.max(...cards.map(c=>c.x+c.w))-x,h:Math.max(...cards.map(c=>c.y+c.h))-y};
}

export function zoomAt(view,zoom,point) {
  const next=clamp(zoom,.3,1.6),ratio=next/view.zoom;
  return {zoom:next,x:point.x-(point.x-view.x)*ratio,y:point.y-(point.y-view.y)*ratio};
}

export function mountCanvas(ctx, collection) {
  const {root,state,save,icon,esc,toast,modal,go}=ctx;
  const itemById=new Map((collection?.items||state.spaces||[]).map(item=>[item.id,item]));
  const presets=collection?Object.fromEntries(collection.items.map((item,index)=>[item.id,{...item,x:36+(index%3)*380,y:40+Math.floor(index/3)*366,w:340,h:330,label:item.subtitle||''}])):PRESETS;
  const addedCard=collection?.layout?.initialized?collection.items.find(item=>!collection.layout.cards?.some(card=>card.id===item.id)):null;
  if(collection&&collection.layout?.cards?.length){
    const occupied=[...collection.layout.cards];
    for(const [id,card] of Object.entries(presets)){
      if(occupied.some(existing=>existing.id===id))continue;
      const overlaps=existing=>card.x<existing.x+existing.w+16&&card.x+card.w+16>existing.x&&card.y<existing.y+existing.h+16&&card.y+card.h+16>existing.y;
      if(occupied.some(overlaps)){card.x=36;card.y=Math.max(...occupied.map(existing=>finite(existing.y,0)+finite(existing.h,330)))+36;}
      occupied.push(card);
    }
  }
  const canvas=collection?ensureCanvas({canvas:collection.layout,spaces:[]},presets):ensureCanvas(state);
  const collectionText=(key,item,fallback)=>typeof collection?.[key]==='function'?collection[key](item):collection?.[key]??fallback;
  let alive=true,editing=false,spaceHeld=false,interaction=null,suppressClickUntil=0,saveTimer=0,composerCleanup=null,raf=0,dragDepth=new Map();
  const pointers=new Map(),cardElements=new Map();
  let presentation=normalizePresentation(canvas.presentation,matchMedia('(max-width:680px)').matches?'list':'canvas');
  let stackRaf=0,stackReady=false,stackFocus=0,stackDrag=null,lastStackPointer=0;
  const reducedMotion=matchMedia('(prefers-reduced-motion:reduce)');
  const visibleCards=()=>canvas.cards.filter(c=>collection?itemById.has(c.id)&&(!collection.matches||collection.matches(itemById.get(c.id))):(presets[c.id]||itemById.has(c.id)&&!itemById.get(c.id).archived));
  const dataFor=card=>{
    if(collection){const item=itemById.get(card.id);return {...item,color:color(card.color||item?.color),label:item?.subtitle||''};}
    const preset=presets[card.id];
    if(preset)return {...preset,color:color(card.color||preset.color),id:card.id};
    const space=itemById.get(card.id);
    return {...space,color:color(space?.color||card.color),icon:space?.icon||'folder',label:space?.description||'文件、笔记和事务，都有自己的位置。'};
  };
  const persist=()=>{if(!alive)return false;try{save();return true;}catch{return false;/* App save handler explains quota or concurrent-window errors. */}};
  const markCustomized=()=>{canvas.customized=true;canvas.modifiedAt=new Date().toISOString();};
  const delayedSave=()=>{markCustomized();clearTimeout(saveTimer);saveTimer=setTimeout(persist,260);};
  const safeIcon=(name,size=20)=>icon(name||'folder',size);
  const dragIcon='<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="5" r="1.5"/><circle cx="16" cy="5" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/></svg>';
  const resizeIcon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 19 10-10M15 19l4-4"/></svg>';
  const fitIcon='<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
  const gridIcon='<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';

  root.innerHTML=`<section class="space-desktop ${collection?.hideHeader?'cv-nested':''}" aria-labelledby="canvas-title">
    <header class="cv-pagehead cv-compact-header"><div class="cv-heading"><h1 id="canvas-title">${esc(collection?.title||'我的空间')}<span class="cv-title-dot">.</span></h1></div><div class="cv-head-actions"><button class="cv-button cv-arrange-toggle" type="button" data-cv="arrange" aria-label="选择卡片排列方式" aria-haspopup="dialog">${gridIcon}<span>排列</span>${icon('chevron-down',13)}</button><button class="cv-button cv-create" type="button" data-cv="create" ${collection?.createLabel===false?'hidden':''}>${icon('plus',19)}<span>${esc(collection?.createLabel||'新建空间')}</span></button></div></header>
    ${collection?.toolbar||''}

    <div class="cv-viewport" tabindex="0" aria-label="工作区卡片"><div class="cv-stack-scroll"><div class="cv-world"></div></div><div class="cv-stack-focusline" aria-hidden="true" hidden></div><aside class="cv-stack-rail" aria-label="堆叠展开位置" hidden><button class="cv-stack-pointer" type="button" role="slider" aria-label="上下拖动，调节卡片展开位置" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">${icon('chevron-right',22)}</button><span class="cv-stack-readout" aria-hidden="true"></span></aside><div class="cv-stack-controls" hidden><span>滑动卡片 · 拖动左侧指针展开</span><button type="button" data-cv="stack-prev" aria-label="上一张卡片">${icon('arrow-left',17)}</button><button type="button" data-cv="stack-next" aria-label="下一张卡片">${icon('arrow-right',17)}</button></div><div class="cv-edit-message" hidden>${dragIcon}<span>拖动卡片排位置 · 拖右下角改大小 · 点菜单换颜色</span></div></div>
    <footer class="cv-statusbar"><div class="cv-zoom-controls" role="group" aria-label="画布视图"><button type="button" data-cv="zoom-out" aria-label="缩小画布">−</button><button type="button" data-cv="reset-zoom" class="cv-zoom-number" title="还原为100%">100%</button><button type="button" data-cv="zoom-in" aria-label="放大画布">+</button><i></i><button type="button" data-cv="fit" title="让所有卡片进入视野" aria-label="适应全部卡片">${fitIcon}</button><button type="button" data-cv="home" title="回到起始位置" aria-label="回到画布中心">${icon('home',18)}</button></div></footer>
    <div class="sr-only" role="status" aria-live="polite" data-cv-live></div>
  </section>`;
  const section=root.querySelector('.space-desktop'),viewport=root.querySelector('.cv-viewport'),world=root.querySelector('.cv-world'),live=root.querySelector('[data-cv-live]');
  const fullscreenButton=document.createElement('button');
  fullscreenButton.type='button';fullscreenButton.className='cv-fullscreen-toggle';fullscreenButton.dataset.cv='fullscreen';
  fullscreenButton.setAttribute('aria-label','全屏画布');fullscreenButton.setAttribute('aria-pressed','false');fullscreenButton.title='全屏画布';
  fullscreenButton.innerHTML=`${fitIcon}<span>全屏</span>`;
  section.querySelector('.cv-head-actions').append(section.querySelector('.cv-zoom-controls'));
  section.querySelector('.cv-compact-header').append(fullscreenButton);
  const stackScroll=viewport.querySelector('.cv-stack-scroll'),stackRail=viewport.querySelector('.cv-stack-rail'),stackPointer=viewport.querySelector('.cv-stack-pointer'),stackLine=viewport.querySelector('.cv-stack-focusline'),stackControls=viewport.querySelector('.cv-stack-controls');
  section.querySelector('.cv-statusbar').append(stackControls);
  if(collection?.hideHeader)section.querySelector('.cv-heading').hidden=true;

  function selectPresentation(action){
    if(!alive||!CARD_PRESENTATIONS.includes(action))return;
    if(interaction)finish({type:'pointercancel',pointerId:interaction.id});
    finishStackPointer({type:'pointercancel',pointerId:stackDrag?.id});
    presentation=action;canvas.presentation=action;stackReady=false;markCustomized();
    if(action!=='canvas')setEditing(false);
    section.querySelector('[data-cv="arrange"]').title=`排列方式：${presentationLabel(action)}`;
    applyView();persist();
  }
  function presentationLabel(value){return ({canvas:'自由画布',list:'自适应','grid-2':'两列','grid-3':'三列',stack:'堆叠'})[value];}
  function arrangeDialog(){
    modal({title:'卡片排列',body:`<div class="cv-arrange-options">${CARD_PRESENTATIONS.map(value=>`<button type="button" data-cv-choice="${value}" aria-pressed="${presentation===value}">${value==='stack'?icon('layers',20):value==='list'?icon('list',20):gridIcon}<span>${presentationLabel(value)}</span>${presentation===value?icon('check',18):''}</button>`).join('')}</div><button type="button" class="cv-open-settings" data-cv-settings>${icon('settings',18)}<span>画布设置</span>${icon('chevron-right',16)}</button>`});
    const host=document.querySelector('#modal');
    host.querySelectorAll('[data-cv-choice]').forEach(button=>button.onclick=()=>{ctx.closeModal();selectPresentation(button.dataset.cvChoice);});
    host.querySelector('[data-cv-settings]').onclick=canvasSettings;
  }
  function openArchives(){
        const spaces=state.spaces.filter(s=>s.archived);
        modal({title:'已归档的空间',body:`<p class="cv-settings-hint">归档保留了资料。进入空间后，可以恢复到主页。</p><div class="cv-archive-list">${spaces.map(space=>`<button type="button" data-archive-space="${esc(space.id)}"><span style="--space-color:${color(space.color)}">${safeIcon(space.icon,22)}</span><div><strong>${esc(space.title)}</strong><small>${esc(space.description||'资料已保留')}</small></div>${icon('arrow-right',18)}</button>`).join('')}</div>`});
        document.querySelector('#modal')?.querySelectorAll('[data-archive-space]').forEach(button=>button.onclick=()=>{const id=button.dataset.archiveSpace;ctx.closeModal();ctx.enterCard?.(id);});return;
  }
  function canvasSettings(){
    modal({title:'画布设置',body:`<label class="cv-setting-switch"><span>网格吸附</span><input type="checkbox" name="snap" ${canvas.snap?'checked':''}></label>`,submitLabel:'保存设置',onSubmit:data=>{
      if(!alive)return false;
      const before=canvas.snap;canvas.snap=data.has('snap');markCustomized();
      try{save();}catch(error){canvas.snap=before;throw error;}
    }});
    if(!collection&&state.spaces.some(space=>space.archived)){
      const button=document.createElement('button');button.type='button';button.className='cv-open-settings';button.textContent='已归档的空间';
      button.onclick=openArchives;
      document.querySelector('#modal .modal-body').append(button);
    }
  }
  function cardContent(card) {
    if(collection?.renderCard)return collection.renderCard(card,dataFor(card));
    const d=dataFor(card),courseCount=(state.courses||[]).filter(course=>!course.archived).length,taskCount=(state.tasks||[]).filter(t=>!t.done&&!t.archived).length,captureCount=(state.captures||[]).filter(c=>!c.archived).length;
    if(card.id==='ai')return `<div class="cv-ai-title"><span class="cv-ai-orbit" aria-hidden="true">${icon('sparkles',29)}</span><div><h2>有什么事，交给我。</h2><p>先聊清楚，再归入你的空间。</p></div></div><div class="cv-ai-host" data-ai-host></div>`;
    if(card.id==='competitions'){
      const summary=summarizeCompetitions(state.competitions);
      return `<div class="cv-card-copy"><span class="cv-card-kicker">COMPETITIONS</span><h2>比赛</h2><p>${esc(d.label)}</p></div><div class="cv-space-counts"><span>${summary.active} 项进行中</span><span>${summary.upcoming} 个近期截止</span></div><p class="cv-small">${summary.overdue?`${summary.overdue} 个节点已逾期 · `:''}${summary.unfinishedTasks} 项准备事项待完成</p>`;
    }
    if(card.id==='ledger'){
      const month=localDate().slice(0,7),last=localDate(new Date(Number(month.slice(0,4)),Number(month.slice(5)),0)),totals=summarizeEntries(selectEntries(state.ledger||{entries:[],projects:[]},{start:month+'-01',end:last,scope:'total'}));
      return `<div class="cv-card-copy"><span class="cv-card-kicker">YOUR DAILY LEDGER</span><h2>记账</h2><p>${esc(d.label)}</p></div><div class="cv-ledger-total"><span>本月总账支出${state.mode==='demo'?' · 示例':''}</span><strong>¥${formatMoney(totals.expenseCents)}</strong></div><div class="cv-space-counts"><span>${totals.count} 笔收支</span><span>日期 · 项目</span></div>`;
    }
    if(card.id==='calendar'){
      const events=eventsOnDate(state.calendar||{events:[]},localDate());
      return `<div class="cv-card-copy"><span class="cv-card-kicker">MAKE ROOM FOR WHAT MATTERS</span><h2>日历</h2><p>${esc(d.label)}</p></div><div class="cv-space-counts"><span>今天 ${events.length} 条安排</span></div><p>${esc(events[0]?.title||'点击日期，安排你的下一件事。')}</p>`;
    }
    if(card.id==='timetable'){
      const table=state.timetable,term=table?.terms.find(t=>t.id===table.activeTermId)||table?.terms[0],week=term?weekForDate(term,localDate()):0,inTerm=term&&week>0&&week<=term.totalWeeks;
      const count=term?(inTerm?entriesForWeek(term,week):term.entries.filter(e=>!e.archived)).length:0;
      return `<div class="cv-card-copy"><span class="cv-card-kicker">MY SEMESTER</span><h2>学期课表</h2><p>${esc(term?.title||d.label)}</p></div><div class="cv-card-detail"><strong>${term?(inTerm?week:'—'):'+'}</strong><span>${inTerm?'教学周':'独立课程安排'}</span></div><div class="cv-space-counts"><span>${count} ${inTerm?'次课 · 本周':'条上课安排'}</span><span>${esc(term?.campus||'设置学期与作息')}</span></div>`;
    }
    if(card.id==='courses')return `<div class="cv-card-copy"><span class="cv-card-kicker">LEARNING SPACE</span><h2>课程空间</h2><p>${esc(d.label)}</p></div><div class="cv-course-art" aria-hidden="true"><span>${icon('code',26)}</span><span>${icon('file',25)}</span><span>${icon('book',29)}</span></div><div class="cv-card-detail"><strong>${courseCount}</strong><span>门课程，持续积累</span></div>`;
    if(card.id==='english')return `<div class="cv-card-copy"><span class="cv-card-kicker">CET–6 / EVERY LITTLE STEP</span><h2>每天一点，<br>离六级更近。</h2></div><div class="cv-english-word" aria-hidden="true">KEEP<br><span>GOING</span><b>↗</b></div><div class="cv-english-actions"><button type="button" data-cv="vocabulary">${icon('book',16)}背单词</button><button type="button" data-cv="reading">${icon('play',15)}随时刷题</button></div>`;
    if(card.id==='tasks')return `<div class="cv-card-copy"><span class="cv-card-kicker">ONE THING AT A TIME</span><h2>备忘与待办</h2><p>${esc(d.label)}</p></div><div class="cv-task-lines">${(state.tasks||[]).filter(t=>!t.done&&!t.archived).slice(0,2).map(t=>`<div><span></span><span>${esc(t.title)}</span></div>`).join('')||'<div><span></span><span>想到的事情，随手记在这里</span></div>'}</div><div class="cv-card-detail"><strong>${taskCount}</strong><span>件待办</span></div>`;
    if(card.id==='inbox')return `<div class="cv-card-copy"><span class="cv-card-kicker">CATCH YOUR IDEAS</span><h2>灵感收集箱</h2><p>不用整理，先记下来。</p></div><span class="cv-sticker-art" aria-hidden="true">${icon('bolt',54)}</span><div class="cv-card-detail"><strong>${captureCount}</strong><span>条待整理内容</span></div>`;
    if(card.id==='review')return `<div class="cv-card-copy"><span class="cv-card-kicker">YOUR LITTLE WINS</span><h2>生活回顾</h2><p>${esc(d.label)}</p></div><div class="cv-review-art" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span>${icon('arrow-right',25)}</div><div class="cv-card-detail"><strong>${(state.tasks||[]).filter(t=>t.done&&!t.archived).length}</strong><span>件已完成的事</span></div>`;
    const files=(d.files||[]).filter(file=>!file.archived).length,notes=(d.notes||[]).filter(note=>!note.archived).length,tasks=(state.tasks||[]).filter(t=>t.spaceId===card.id&&!t.done&&!t.archived).length;
    return `<div class="cv-card-copy"><span class="cv-card-kicker">${d.type==='course'?'MY CLASSROOM':d.type==='project'?'MY PROJECT':'MY OWN SPACE'}</span><h2>${esc(d.title||'未命名空间')}</h2><p>${esc(d.description||'收藏资料、记录想法，安排属于你的事。')}</p></div><div class="cv-custom-art" aria-hidden="true">${safeIcon(d.icon,72)}</div><div class="cv-space-counts"><span>${files} 份文件</span><span>${notes} 篇笔记</span>${tasks?`<span>${tasks} 件待办</span>`:''}</div>`;
  }

  function drawCards() {
    stackReady=false;
    itemById.clear();for(const item of collection?.items||state.spaces||[])itemById.set(item.id,item);
    composerCleanup?.();composerCleanup=null;
    world.innerHTML=visibleCards().map((card,index)=>{
      const d=dataFor(card);
      return `<article class="cv-card cv-card-${collection?'collection':presets[card.id]?card.id:'custom'} ${card.h<260?'cv-compact':''} ${card.h<330?'cv-short':''}" data-card="${esc(card.id)}" style="--card-color:${color(d.color)};--card-fill:${canvasCardFill(d.color)};--card-order:${index};width:${card.w}px;height:${card.h}px;transform:translate(${card.x}px,${card.y}px)" tabindex="0" aria-label="${esc(d.title)}，按Enter打开">
      <header class="cv-card-head"><span class="cv-space-symbol">${safeIcon(d.icon,20)}</span><span class="cv-stack-title">${esc(d.title)}</span><span class="cv-card-top-label">${collection?esc(collectionText('cardLabel',d,'内容卡片')):card.id==='ai'?'AI 收件台':presets[card.id]?'预置空间':'自建空间'}</span><button type="button" class="cv-drag" data-cv="drag" title="拖动卡片；方向键移动" aria-label="拖动${esc(d.title)}卡片，或使用方向键调整位置">${dragIcon}</button><button type="button" class="cv-card-menu" data-cv="card-menu" title="卡片设置" aria-label="设置${esc(d.title)}卡片">${icon('more',19)}</button></header>
      <div class="cv-card-body">${cardContent(card)}</div><footer class="cv-card-foot"><span>${esc(collectionText('footLabel',d,card.id==='ai'?'对话 → 确认 → 归档':card.id==='competitions'?'截止 · 清单 · 参赛档案':card.id==='calendar'?'计划 · 标注 · 注意事项':card.id==='ledger'?'按日期记录 · 按项目汇总':card.id==='timetable'?'教学周 · 单双周 · 上课地点':'拖入文件，直接收进这里'))}</span><button type="button" data-cv="enter" aria-label="进入${esc(d.title)}">${esc(collectionText('enterLabel',d,card.id==='ai'?'打开收件台':'进入空间'))}${icon('arrow-right',17)}</button></footer>
      <button class="cv-resize" type="button" data-cv="resize" title="拖动调整大小；方向键微调" aria-label="调整${esc(d.title)}卡片大小">${resizeIcon}</button><div class="cv-drop-overlay">${icon('upload',34)}<strong>松手，放入${esc(d.title)}</strong><span>文件保存在本机</span></div></article>`;
    }).join('');
    cardElements.clear();for(const element of world.querySelectorAll('[data-card]'))cardElements.set(element.dataset.card,element);
    const host=world.querySelector('[data-ai-host]');
    if(host&&ctx.mountAIComposer)composerCleanup=ctx.mountAIComposer(host);
    else if(host)host.innerHTML=`<button type="button" class="cv-ai-fallback" data-cv="ai">${icon('plus',20)}输入想法、拖入文件，交给 AI 整理${icon('arrow-right',20)}</button><p class="cv-ai-connection">AI 尚未连接，内容可以先保存。</p>`;
    viewport.querySelector('.cv-empty')?.remove();
    if(collection&&collection.emptyHTML!==false&&!visibleCards().length){
      const empty=document.createElement('div');empty.className='cv-empty';
      empty.innerHTML=collection.emptyHTML||'<strong>这里还没有卡片</strong><p>添加第一条内容，开始布置这个空间。</p>';
      viewport.append(empty);
    }
    applyView();
  }

  function applyView() {
    if(!alive)return;
    const v=canvas.view,free=presentation==='canvas',stack=presentation==='stack',grid=presentation.startsWith('grid-');
    world.style.transform=free?`translate(${v.x}px,${v.y}px) scale(${v.zoom})`:'';
    viewport.style.setProperty('--dot-size',`${32*v.zoom}px`);
    viewport.style.setProperty('--dot-x',`${v.x}px`);
    viewport.style.setProperty('--dot-y',`${v.y}px`);
    section.querySelector('.cv-zoom-number').textContent=`${Math.round(v.zoom*100)}%`;
    section.classList.toggle('is-list-mode',!free);
    section.classList.toggle('is-grid-mode',grid);
    section.classList.toggle('is-stack-mode',stack);
    viewport.classList.toggle('is-list',presentation==='list'||grid);
    viewport.classList.toggle('is-grid',grid);
    viewport.classList.toggle('is-grid-2',presentation==='grid-2');
    viewport.classList.toggle('is-grid-3',presentation==='grid-3');
    viewport.classList.toggle('is-stack',stack);
    section.querySelectorAll('.cv-zoom-controls button').forEach(button=>button.disabled=!free);
    section.querySelector('[data-cv="arrange"]').title=`排列方式：${presentationLabel(presentation)}`;
    stackRail.hidden=stackLine.hidden=stackControls.hidden=!stack;
    viewport.setAttribute('aria-label',stack?'堆叠卡片，滑动浏览；拖动左侧指针调整展开位置':free?'工作区画布，可拖动背景平移；使用下方按钮缩放':'工作区卡片网格');
    if(stack){
      if(!stackReady){
        const metrics=getStackMetrics();world.style.height=`${metrics.worldHeight}px`;
        stackScroll.scrollTop=metrics.padding+stackFocus*metrics.step-metrics.pointerY;
        stackReady=true;
      }
      paintStack();
    }else{
      world.style.height='';
      for(const card of visibleCards()){
        const el=cardEl(card.id);if(!el)continue;
        placeCard(card);el.style.zIndex='';el.style.removeProperty('--stack-open');el.classList.remove('is-stack-focused');el.removeAttribute('aria-current');
        el.setAttribute('aria-label',`${dataFor(card).title}，按Enter打开`);
        el.querySelectorAll('.cv-card-body,.cv-card-foot,.cv-card-menu').forEach(node=>node.inert=false);
      }
    }
  }
  function getStackMetrics(){return stackMetrics({width:viewport.clientWidth,height:viewport.clientHeight,count:visibleCards().length,pointer:canvas.stackPointer});}
  function requestStackPaint(){if(!alive||presentation!=='stack'||stackRaf)return;stackRaf=requestAnimationFrame(()=>{stackRaf=0;paintStack();});}
  function paintStack(){
    if(!alive||presentation!=='stack')return;
    const cards=visibleCards(),geometry=stackLayout({width:viewport.clientWidth,height:viewport.clientHeight,count:cards.length,pointer:canvas.stackPointer,scrollTop:stackScroll.scrollTop});
    stackFocus=geometry.focus;
    world.style.height=`${geometry.worldHeight}px`;
    stackPointer.style.top=`${geometry.railY}px`;stackLine.style.top=`${geometry.pointerY}px`;
    stackPointer.setAttribute('aria-valuenow',String(Math.round(canvas.stackPointer*100)));
    const title=cards[geometry.activeIndex]?dataFor(cards[geometry.activeIndex]).title:'';
    stackPointer.setAttribute('aria-valuetext',`${Math.round(canvas.stackPointer*100)}%${title?'，展开'+title:''}`);
    stackRail.querySelector('.cv-stack-readout').textContent=cards.length?`${geometry.activeIndex+1} / ${cards.length}`:'0 / 0';
    stackPointer.disabled=!cards.length;
    stackControls.querySelector('[data-cv="stack-prev"]').disabled=geometry.activeIndex<=0;
    stackControls.querySelector('[data-cv="stack-next"]').disabled=!cards.length||geometry.activeIndex>=cards.length-1;
    cards.forEach((card,index)=>{
      const el=cardEl(card.id),p=geometry.cards[index];if(!el||!p)return;
      const focused=index===geometry.activeIndex;
      el.style.width=`${geometry.cardWidth}px`;el.style.height=`${geometry.cardHeight}px`;
      el.style.transform=`translate(${p.x}px,${p.y}px) rotate(${reducedMotion.matches?0:p.rotate}deg) scale(${reducedMotion.matches?1:p.scale})`;
      el.style.zIndex=String(p.z);el.style.setProperty('--stack-open',p.openness);
      el.classList.toggle('is-stack-focused',focused);
      if(focused)el.setAttribute('aria-current','true');else el.removeAttribute('aria-current');
      el.querySelectorAll('.cv-card-body,.cv-card-foot,.cv-card-menu').forEach(node=>node.inert=!focused);
      el.setAttribute('aria-label',`${dataFor(card).title}，按Enter${focused?'打开':'展开'}`);
    });
  }
  function selectStack(index){
    if(presentation!=='stack'||!visibleCards().length)return;
    const m=getStackMetrics(),i=clamp(index,0,visibleCards().length-1);
    stackScroll.scrollTo({top:m.padding+i*m.step-m.pointerY,behavior:reducedMotion.matches?'instant':'smooth'});
    requestStackPaint();
  }
  function stackPointerValue(event){const r=stackRail.getBoundingClientRect();return normalizeStackPointer((event.clientY-r.top)/Math.max(1,r.height));}
  function finishStackPointer(event){
    if(!stackDrag||event&&event.pointerId!==stackDrag.id)return false;
    const drag=stackDrag;stackDrag=null;
    if(event?.type==='pointercancel')canvas.stackPointer=drag.original;
    else if(canvas.stackPointer!==drag.original){markCustomized();persist();}
    if(stackPointer.hasPointerCapture(drag.id))stackPointer.releasePointerCapture(drag.id);
    section.classList.remove('is-stack-adjusting');requestStackPaint();return true;
  }
  function fitAll() {
    const b=canvasBounds(visibleCards()),r=viewport.getBoundingClientRect();
    const zoom=clamp(Math.min((r.width-72)/b.w,(r.height-72)/b.h,1),.3,1.6);
    canvas.view={x:(r.width-b.w*zoom)/2-b.x*zoom,y:(r.height-b.h*zoom)/2-b.y*zoom,zoom};
    markCustomized();applyView();persist();
  }
  function homeView(initial=false) {
    const r=viewport.getBoundingClientRect();
    const zoom=clamp((r.width-64)/1280,.55,1);
    canvas.view={x:28-36*zoom,y:30-40*zoom,zoom};
    applyView();if(!initial){markCustomized();persist();}
  }
  function scaleView(factor) {
    const r=viewport.getBoundingClientRect();
    canvas.view=zoomAt(canvas.view,canvas.view.zoom*factor,{x:r.width/2,y:r.height/2});applyView();delayedSave();
  }
  function cardEl(id) {return cardElements.get(id);}
  function placeCard(card) {
    if(presentation==='stack'){requestStackPaint();return;}
    const el=cardEl(card.id);if(!el)return;
    el.style.transform=`translate(${card.x}px,${card.y}px)`;el.style.width=`${card.w}px`;el.style.height=`${card.h}px`;
    el.classList.toggle('cv-compact',card.h<260);el.classList.toggle('cv-short',card.h<330);
  }
  function announce(message) {live.textContent=message;}
  function setEditing(value) {editing=value;section.classList.toggle('is-editing',editing);section.querySelector('.cv-edit-message').hidden=!editing;}
  function cardSettings(card) {
    const d=dataFor(card),minWidth=card.id==='ai'?390:220,minHeight=card.id==='ai'?350:220;
    modal({title:`${d.title} · 卡片外观`,body:`<p class="cv-settings-hint">调节这张卡片的颜色、尺寸和摆放位置。</p><label class="field">卡片颜色<div class="cv-color-options">${COLORS.map(c=>`<button type="button" class="cv-color-swatch" data-pick-color="${c}" style="--swatch:${c}" aria-label="选择颜色 ${c}">${c===d.color?icon('check',17):''}</button>`).join('')}<input type="color" name="color" value="${color(d.color)}" aria-label="自定义卡片颜色"></div></label><div class="form-grid"><label class="field">宽度<input type="number" name="width" value="${Math.round(card.w)}" min="${minWidth}" max="1100" step="1" required></label><label class="field">高度<input type="number" name="height" value="${Math.round(card.h)}" min="${minHeight}" max="850" step="1" required></label><label class="field">横向位置<input type="number" name="x" value="${Math.round(card.x)}" min="-100000" max="100000" step="1" required></label><label class="field">纵向位置<input type="number" name="y" value="${Math.round(card.y)}" min="-100000" max="100000" step="1" required></label></div>${(collection?(collection.onEdit!==undefined?collection.onEdit:ctx.editSpace):!presets[card.id]&&ctx.editSpace)?`<button type="button" class="btn" data-manage-space>${esc(collection?.manageLabel||'编辑卡片内容')}</button>`:''}`,onSubmit:form=>{
      const previous={...card},space=(collection?.items||state.spaces).find(s=>s.id===card.id),previousSpaceColor=space?.color;
      // Collection cards are display copies. Persist their color on the real
      // record too, so its dream view and later layouts keep a manual choice.
      const record=(collection?.sourceItems||collection?.items||state.spaces).find(item=>item.id===card.id),previousRecordColor=record?.color;
      card.color=color(form.get('color'));card.w=clamp(Number(form.get('width')),minWidth,1100);card.h=clamp(Number(form.get('height')),minHeight,850);card.x=clamp(Number(form.get('x')),-100000,100000);card.y=clamp(Number(form.get('y')),-100000,100000);
      if(space)space.color=card.color;if(record)record.color=card.color;
      markCustomized();try{save();}catch(error){Object.assign(card,previous);if(space){if(previousSpaceColor===undefined)delete space.color;else space.color=previousSpaceColor;}if(record){if(previousRecordColor===undefined)delete record.color;else record.color=previousRecordColor;}throw error;}
      placeCard(card);const el=cardEl(card.id);if(el){el.style.setProperty('--card-color',card.color);el.style.setProperty('--card-fill',canvasCardFill(card.color));}announce('卡片外观已保存');
    }});
    const dialog=document.querySelector('#modal');
    dialog?.querySelectorAll('[data-pick-color]').forEach(button=>button.onclick=()=>{const input=dialog.querySelector('[name="color"]');input.value=button.dataset.pickColor;input.dispatchEvent(new Event('input',{bubbles:true}));dialog.querySelectorAll('[data-pick-color]').forEach(b=>b.innerHTML=b===button?icon('check',17):'');});
    const manage=dialog?.querySelector('[data-manage-space]');if(manage)manage.onclick=()=>{ctx.closeModal();(collection?.onEdit!==undefined?collection.onEdit:ctx.editSpace)?.(card.id);};
  }

  function onClick(event) {
    if(Date.now()<suppressClickUntil&&event.target.closest('.cv-viewport')){event.preventDefault();event.stopPropagation();return;}
    const button=event.target.closest('[data-cv]');
    const stackCard=event.target.closest('[data-card]');
    if(presentation==='stack'&&stackCard&&!stackCard.classList.contains('is-stack-focused')){selectStack(visibleCards().findIndex(c=>c.id===stackCard.dataset.card));return;}
    if(button){
      const action=button.dataset.cv,el=button.closest('[data-card]'),card=canvas.cards.find(c=>c.id===el?.dataset.card);
      if(action==='create')return ctx.createSpace?.();
      if(action==='fullscreen')return fullscreen.toggle();
      if(action==='arrange')return arrangeDialog();
      if(CARD_PRESENTATIONS.includes(action))return selectPresentation(action);
      if(action==='stack-prev'||action==='stack-next')return selectStack(Math.round(stackFocus)+(action==='stack-prev'?-1:1));
      if(action==='zoom-in')return scaleView(1.15);
      if(action==='zoom-out')return scaleView(1/1.15);
      if(action==='reset-zoom')return scaleView(1/canvas.view.zoom);
      if(action==='fit')return fitAll();
      if(action==='home')return homeView();
      if(action==='card-menu'&&card)return cardSettings(card);
      if(action==='enter'&&card)return ctx.enterCard?.(card.id,el);
      if(action==='ai')return ctx.enterCard?.('ai',cardEl('ai'))||(!ctx.enterCard&&go('ai'));
      if(action==='vocabulary')return go('english','vocabulary');
      if(action==='reading')return go('english','reading');

      return;
    }
    const el=event.target.closest('[data-card]');
    if(el&&!editing&&!event.target.closest('button,a,input,textarea,select,label,[contenteditable="true"],[data-ai-host]'))ctx.enterCard?.(el.dataset.card,el);
  }

  function begin(event) {
    if(presentation==='stack'){
      lastStackPointer=Date.now();
      if(!stackDrag&&event.isPrimary!==false&&event.button===0&&event.target.closest('.cv-stack-rail')&&visibleCards().length){
        event.preventDefault();stackPointer.focus({preventScroll:true});
        stackDrag={id:event.pointerId,original:canvas.stackPointer};stackPointer.setPointerCapture(event.pointerId);
        canvas.stackPointer=stackPointerValue(event);section.classList.add('is-stack-adjusting');requestStackPaint();
      }
      return;
    }
    if(presentation!=='canvas')return;
    if(event.button!==0&&event.button!==1)return;
    if(event.target.closest('input,textarea,select,[contenteditable="true"],[data-ai-host]')&&!spaceHeld&&event.button!==1)return;
    const el=event.target.closest('[data-card]'),action=event.target.closest('[data-cv]')?.dataset.cv;
    if(event.target.closest('button,a,label')&&!event.target.closest('[data-card-open]')&&!['drag','resize'].includes(action)&&!spaceHeld&&event.button!==1)return;
    if(event.pointerType==='touch')pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===2){
      finish(null,false);
      const points=[...pointers.values()],r=viewport.getBoundingClientRect(),middle={x:(points[0].x+points[1].x)/2-r.left,y:(points[0].y+points[1].y)/2-r.top};
      interaction={type:'pinch',distance:Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y),middle,view:{...canvas.view},moved:true};
      viewport.setPointerCapture(event.pointerId);viewport.classList.add('is-panning');event.preventDefault();return;
    }
    if(interaction)return;
    const card=canvas.cards.find(c=>c.id===el?.dataset.card),forcePan=spaceHeld||event.button===1;
    const type=forcePan?'pan':action==='resize'?'resize':action==='drag'||(editing&&card)?'move':card?'press':'pan';
    if(!type)return;
    interaction={type,id:event.pointerId,card,el,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,view:{...canvas.view},original:card?{x:card.x,y:card.y,w:card.w,h:card.h}:null,moved:false,held:false};
    viewport.setPointerCapture(event.pointerId);
    if(type!=='press')viewport.classList.add(type==='pan'?'is-panning':'is-positioning');
    if(type==='press'){
      const pending=interaction;
      el.classList.add('is-pressing');event.preventDefault();
      pending.timer=setTimeout(()=>{
        if(!alive||interaction!==pending||!el.isConnected)return;
        pending.type='move';pending.held=true;pending.x=pending.lastX;pending.y=pending.lastY;
        el.classList.remove('is-pressing');el.classList.add('is-positioned','is-longpress-lifted');
        viewport.classList.add('is-positioning');
        announce('卡片已拿起，拖动后松手保存');
      },450);
    }
    if(type==='move'||type==='resize'){el.classList.add('is-positioned');event.preventDefault();}
  }
  function move(event) {
    if(stackDrag&&stackDrag.id===event.pointerId){event.preventDefault();canvas.stackPointer=stackPointerValue(event);requestStackPaint();return;}
    if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const i=interaction;if(!i)return;
    if(i.type==='pinch'){
      if(pointers.size<2)return;
      const points=[...pointers.values()],r=viewport.getBoundingClientRect(),middle={x:(points[0].x+points[1].x)/2-r.left,y:(points[0].y+points[1].y)/2-r.top},distance=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y);
      const next=zoomAt(i.view,i.view.zoom*distance/Math.max(1,i.distance),i.middle);
      next.x+=middle.x-i.middle.x;next.y+=middle.y-i.middle.y;canvas.view=next;applyView();event.preventDefault();return;
    }
    if(i.id!==event.pointerId)return;
    const dx=event.clientX-i.x,dy=event.clientY-i.y;
    i.lastX=event.clientX;i.lastY=event.clientY;
    if(i.type==='press'){
      // An early swipe moves the viewport; a stationary hold picks up the card.
      if(Math.hypot(dx,dy)<8)return;
      clearTimeout(i.timer);i.el.classList.remove('is-pressing');i.type='pan';
      viewport.classList.add('is-panning');
    }
    if(Math.hypot(dx,dy)<4&&!i.moved)return;
    i.moved=true;suppressClickUntil=Date.now()+350;
    if(i.type==='pan'){canvas.view.x=i.view.x+dx;canvas.view.y=i.view.y+dy;applyView();}
    else if(i.type==='move'){
      const snap=value=>canvas.snap?Math.round(value/16)*16:value;
      i.card.x=clamp(snap(i.original.x+dx/canvas.view.zoom),-100000,100000);i.card.y=clamp(snap(i.original.y+dy/canvas.view.zoom),-100000,100000);placeCard(i.card);
    }else if(i.type==='resize'){
      i.card.w=clamp(Math.round(i.original.w+dx/canvas.view.zoom),i.card.id==='ai'?390:220,1100);
      i.card.h=clamp(Math.round(i.original.h+dy/canvas.view.zoom),i.card.id==='ai'?350:220,850);placeCard(i.card);
    }
    event.preventDefault();
  }
  function finish(event,clearPointers=true) {
    if(stackDrag&&finishStackPointer(event))return;
    const i=interaction;
    if(clearPointers&&event)pointers.delete(event.pointerId);
    if(!i)return;
    if(event&&i.type!=='pinch'&&i.id!==event.pointerId)return;
    if(event&&event.type!=='pointercancel'&&i.type==='pinch'&&pointers.size>=2)return;
    const cancelledPointers=event?.type==='pointercancel'?[...pointers.keys()]:[];
    if(event?.type==='pointercancel')pointers.clear();
    clearTimeout(i.timer);
    if(event?.type==='pointercancel'){
      if((i.type==='move'||i.type==='resize')&&i.original&&i.card){Object.assign(i.card,i.original);placeCard(i.card);}
      else {canvas.view={...i.view};applyView();}
    }
    else if(i.moved){
      if((i.type==='move'||i.type==='resize')&&i.card){
        const index=canvas.cards.indexOf(i.card);if(index>=0){canvas.cards.splice(index,1);canvas.cards.push(i.card);}
        if(i.el?.isConnected)world.append(i.el);
      }
      markCustomized();const saved=persist();announce(saved?(i.type==='move'?'卡片位置已保存':i.type==='resize'?'卡片大小已保存':'视野已保存'):'暂未保存，请处理保存提示');
    }
    if(i.moved||i.held||i.type==='press')suppressClickUntil=Date.now()+350;
    i.el?.classList.remove('is-positioned','is-pressing','is-longpress-lifted');viewport.classList.remove('is-panning','is-positioning');interaction=null;
    for(const id of cancelledPointers)if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id);
    // A one-finger gesture hands its capture to the pinch; releasing it here would
    // dispatch a delayed lostpointercapture and cancel the newly started pinch.
    if(clearPointers&&i.id!==undefined&&viewport.hasPointerCapture(i.id))viewport.releasePointerCapture(i.id);
    if(event&&viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
    if(event?.type==='pointerup'&&!i.moved&&i.type==='press')ctx.enterCard?.(i.card.id,i.el);
  }
  function wheel(event) {
    if(presentation!=='canvas'||event.target.closest('textarea,[data-ai-host]'))return;
    event.preventDefault();
    const r=viewport.getBoundingClientRect(),unit=event.deltaMode===1?16:event.deltaMode===2?r.height:1;
    if(event.ctrlKey||event.metaKey)canvas.view=zoomAt(canvas.view,canvas.view.zoom*Math.exp(-event.deltaY*unit*.002),{x:event.clientX-r.left,y:event.clientY-r.top});
    else{canvas.view.x-=event.shiftKey?event.deltaY*unit:event.deltaX*unit;canvas.view.y-=event.shiftKey?event.deltaX*unit:event.deltaY*unit;}
    applyView();delayedSave();
  }
  function keydown(event) {
    if(event.target.closest('input,textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]'))return;
    if(presentation==='stack'){
      if(event.target===stackPointer&&['ArrowUp','ArrowDown','Home','End'].includes(event.key)){
        event.preventDefault();canvas.stackPointer=normalizeStackPointer(event.key==='Home'?0:event.key==='End'?1:canvas.stackPointer+(event.key==='ArrowUp'?-.04:.04));markCustomized();persist();requestStackPaint();return;
      }
      if((event.target===viewport||event.target.matches('.cv-card'))&&['ArrowUp','ArrowDown','Home','End'].includes(event.key)){
        event.preventDefault();selectStack(event.key==='Home'?0:event.key==='End'?visibleCards().length-1:Math.round(stackFocus)+(event.key==='ArrowUp'?-1:1));return;
      }
      if(event.key==='Enter'&&event.target.matches('.cv-card')&&!event.target.classList.contains('is-stack-focused')){event.preventDefault();selectStack(visibleCards().findIndex(c=>c.id===event.target.dataset.card));return;}
      if(event.key==='Escape'&&stackDrag){finishStackPointer({type:'pointercancel',pointerId:stackDrag.id});return;}
    }
    if(event.code==='Space'&&section.contains(event.target)&&presentation==='canvas'){spaceHeld=true;viewport.classList.add('can-pan');event.preventDefault();}
    const target=event.target.closest('[data-card]'),card=canvas.cards.find(c=>c.id===target?.dataset.card),action=event.target.closest('[data-cv]')?.dataset.cv;
    if(card&&['drag','resize'].includes(action)&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&presentation==='canvas'){
      event.preventDefault();const step=event.shiftKey?40:8,dx=event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0,dy=event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0;
      if(action==='drag'){card.x=clamp(card.x+dx,-100000,100000);card.y=clamp(card.y+dy,-100000,100000);}else{card.w=clamp(card.w+dx,card.id==='ai'?390:220,1100);card.h=clamp(card.h+dy,card.id==='ai'?350:220,850);}
      markCustomized();placeCard(card);delayedSave();announce(action==='drag'?'卡片位置已调整':'卡片大小已调整');return;
    }
    if(event.key==='Enter'&&target===event.target){event.preventDefault();ctx.enterCard?.(card.id,target);}
    if(event.key==='Escape'){if(interaction)finish({type:'pointercancel',pointerId:interaction.id});setEditing(false);spaceHeld=false;viewport.classList.remove('can-pan');pointers.clear();}
    if(presentation==='canvas'&&event.target===viewport&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();canvas.view.x+=event.key==='ArrowRight'?-60:event.key==='ArrowLeft'?60:0;canvas.view.y+=event.key==='ArrowDown'?-60:event.key==='ArrowUp'?60:0;applyView();delayedSave();}
  }
  function keyup(event) {if(event.code==='Space'){spaceHeld=false;viewport.classList.remove('can-pan');}}
  function blur(){spaceHeld=false;viewport.classList.remove('can-pan');if(interaction)finish({type:'pointercancel',pointerId:interaction.id});if(stackDrag)finishStackPointer({type:'pointercancel',pointerId:stackDrag.id});pointers.clear();}
  function lostCapture(event){if(stackDrag?.id===event.pointerId)finishStackPointer({type:'pointercancel',pointerId:event.pointerId});if(interaction?.id===event.pointerId||interaction?.type==='pinch')finish({type:'pointercancel',pointerId:event.pointerId});}
  function stackFocusIn(event){if(presentation==='stack'&&Date.now()-lastStackPointer>600&&event.target.matches('.cv-card'))selectStack(visibleCards().findIndex(c=>c.id===event.target.dataset.card));}
  function contextMenu(event){if(presentation==='canvas'&&event.target.closest('[data-card]')&&!event.target.closest('input,textarea,select,[contenteditable="true"],[data-ai-host]'))event.preventDefault();}
  function fileDrag(event) {
    if(collection?.canDrop===false)return;
    if(![...(event.dataTransfer?.types||[])].includes('Files'))return;
    event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    const el=event.target.closest('[data-card]');
    if(!collection&&['ledger','timetable','calendar','competitions'].includes(el?.dataset.card)){if(event.dataTransfer)event.dataTransfer.dropEffect='none';return;}
    if(event.type==='dragenter'&&el){dragDepth.set(el,(dragDepth.get(el)||0)+1);el.classList.add('is-drop-target');}
    if(event.type==='dragleave'&&el){const depth=(dragDepth.get(el)||1)-1;dragDepth.set(el,depth);if(depth<=0)el.classList.remove('is-drop-target');}
  }
  async function drop(event) {
    if(collection?.canDrop===false)return;
    const files=Array.from(event.dataTransfer?.files||[]);if(!files.length)return;
    event.preventDefault();event.stopPropagation();
    world.querySelectorAll('.is-drop-target').forEach(el=>el.classList.remove('is-drop-target'));dragDepth.clear();
    const el=event.target.closest('[data-card]');
    if(!el){toast('请把文件拖到对应的空间卡片上。');return;}
    if(el.classList.contains('is-uploading')){toast('文件正在保存，请稍候。');return;}
    el.classList.add('is-uploading');
    try{await ctx.dropOnCard?.(el.dataset.card,files);}catch(error){toast(error.message||'文件未保存，请重试。');}finally{el.classList.remove('is-uploading');}
  }

  drawCards();
  if(!canvas.initialized){homeView(true);canvas.initialized=true;persist();}
  else if(addedCard&&presentation==='canvas'&&visibleCards().some(card=>card.id===addedCard.id)){
    const card=canvas.cards.find(card=>card.id===addedCard.id),bounds=viewport.getBoundingClientRect();
    canvas.view.x=(bounds.width-card.w*canvas.view.zoom)/2-card.x*canvas.view.zoom;
    canvas.view.y=(bounds.height-card.h*canvas.view.zoom)/2-card.y*canvas.view.zoom;
    applyView();persist();
  }
  const onResize=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{if(presentation==='stack')stackReady=false;applyView();});};
  const fullscreen=mountSurfaceFullscreen({element:section,label:'画布',onChange:active=>{
    blur();fullscreenButton.setAttribute('aria-pressed',String(active));fullscreenButton.setAttribute('aria-label',active?'退出画布全屏':'全屏画布');
    fullscreenButton.title=active?'退出画布全屏':'全屏画布';fullscreenButton.querySelector('span').textContent=active?'退出全屏':'全屏';
    if(alive)onResize();
  }});
  const resizeObserver=new ResizeObserver(onResize);resizeObserver.observe(viewport);
  section.addEventListener('click',onClick);
  stackScroll.addEventListener('scroll',requestStackPaint,{passive:true});section.addEventListener('focusin',stackFocusIn);
  viewport.addEventListener('pointerdown',begin);
  viewport.addEventListener('pointermove',move);
  viewport.addEventListener('pointerup',finish);
  viewport.addEventListener('pointercancel',finish);
  viewport.addEventListener('lostpointercapture',lostCapture);
  viewport.addEventListener('contextmenu',contextMenu);
  viewport.addEventListener('wheel',wheel,{passive:false});
  section.addEventListener('keydown',keydown);
  window.addEventListener('keyup',keyup);
  window.addEventListener('blur',blur);
  viewport.addEventListener('dragenter',fileDrag);viewport.addEventListener('dragover',fileDrag);viewport.addEventListener('dragleave',fileDrag);viewport.addEventListener('drop',drop);
  const dispose=()=>{
    fullscreen.destroy();
    if(stackDrag)finishStackPointer({type:'pointercancel',pointerId:stackDrag.id});
    if(interaction)finish({type:'pointercancel',pointerId:interaction.id});
    if(saveTimer){clearTimeout(saveTimer);persist();}alive=false;cancelAnimationFrame(raf);cancelAnimationFrame(stackRaf);clearTimeout(section._cvStatusTimer);resizeObserver.disconnect();composerCleanup?.();pointers.clear();
    stackScroll.removeEventListener('scroll',requestStackPaint);section.removeEventListener('focusin',stackFocusIn);
    section.removeEventListener('click',onClick);viewport.removeEventListener('pointerdown',begin);viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerup',finish);viewport.removeEventListener('pointercancel',finish);viewport.removeEventListener('wheel',wheel);section.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);
    viewport.removeEventListener('dragenter',fileDrag);viewport.removeEventListener('dragover',fileDrag);viewport.removeEventListener('dragleave',fileDrag);viewport.removeEventListener('drop',drop);
    viewport.removeEventListener('lostpointercapture',lostCapture);viewport.removeEventListener('contextmenu',contextMenu);
  };
  dispose.refreshCards=()=>{if(interaction)finish({type:'pointercancel',pointerId:interaction.id});drawCards();};
  return dispose;
}
