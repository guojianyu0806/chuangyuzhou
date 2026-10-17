import {icon} from './icons.js';
import {escapeHTML as esc,putFile,getFile,download,VERSION} from './services.js';
import {mountCourses} from './courses.js';
import {seedEnglish,mountEnglish} from './english.js';
import {validateBackup,mergeBackup} from './backup.js';
import {mountCanvas,ensureCanvas} from './canvas.js';
import {mountSpace,openSpaceDialog,saveSpaceFiles} from './spaces.js';
import {mountAI,mountAIComposer,openAIConversation} from './ai.js';
import {mountLedger} from './ledger.js';
import {mountTimetable} from './timetable.js';
import {mountCalendar} from './calendar.js';
import {mountCompetitions} from './competitions.js';
import {mountDream} from './dream.js';
import {mountInspirationWall} from './inspiration.js';
import {assignRecordColor,isRecordColor} from './creation-colors.js';
import {initializeSpaces,routeContent,undoRoute,openDestination} from './workspace-model.js';
import {bootstrapCloud,mountModelSettings} from './cloud.js';
import {WORKBENCH_MODULES,createWorkbench,getVisibleModules,getWorkbench,configureWorkbench} from './workbench-model.js';
import {mountBuilder} from './builder.js';
import {mountSpaceBuilder} from './space-builder.js';
import {createReturnNavigation,parseWorkspaceRoute,workspaceRoute,routeLabel} from './return-navigation.js';
import {getSpaceWorkbench} from './space-workbench-config.js';
import {mountWelcome} from './welcome.js';
import {createWelcomeEntryRoute} from './welcome-route.js';
import {companionButton,openCompanion} from './companion.js';
import {createSidebarNavigation} from './sidebar-navigation.js';
import {mountSidebarResize} from './sidebar-resize.js';
import {getNavigationItems} from './navigation-model.js';
import {renderSidebarNavigation} from './navigation-shell.js';
import {getCustomBlocks} from './custom-blocks-model.js';
import {customBlockEditor,mountCustomBlockPage} from './custom-blocks.js';

const cloudClient=await bootstrapCloud();
const workspaceStorage=cloudClient?.storage||globalThis.localStorage;
const returnNavigation=createReturnNavigation({storage:globalThis.sessionStorage,key:`czb-yuzhou-return-navigation-${cloudClient?.account||'local'}`});
const builderSessions=new Map();

const uid=()=>crypto.randomUUID();
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const dateLabel=value=>value?new Date(value+'T12:00:00').toLocaleDateString('zh-CN',{month:'short',day:'numeric'}):'未设日期';
const key=mode=>cloudClient?cloudClient.key(mode):`czb-yuzhou-workspace-v1-${mode}`;
// Keep the existing account/storage identity; retired example data stays untouched.
const mode='personal';
let route='home',subroute='',routeDetail='',routeItem='',filter='all',captureQuery='';
let cleanupView=null;
let sidebarResize=null;
const resolveEntryHash=createWelcomeEntryRoute();
let lastStored=workspaceStorage.getItem(key(mode));
const nav=[['home','orbit','我的工作台'],['builder','layers','搭建台'],...WORKBENCH_MODULES.map(item=>[item.id,item.icon,item.title])];
const visibleNavigation=()=>[...nav.slice(0,2),...getVisibleModules(state).map(item=>[item.id,item.icon,item.title])];
const navigationLabel=id=>id==='welcome'?'工作区入口':id==='home'?getWorkbench(state).title:visibleNavigation().find(item=>item[0]===id)?.[2]||nav.find(item=>item[0]===id)?.[2]||'偏好与连接';
function seed(){
  return {schema:1,mode,workbench:createWorkbench('blank'),profile:{name:'我',major:'',provider:'deepseek'},courses:[],english:seedEnglish(false),tasks:[],captures:[],updatedAt:new Date().toISOString()};
}
function load(){
  const raw=workspaceStorage.getItem(key(mode));
  let data;
  if(raw){try{const parsed=JSON.parse(raw);if(parsed.schema===1&&Array.isArray(parsed.courses)&&Array.isArray(parsed.tasks)&&Array.isArray(parsed.captures)&&parsed.english&&parsed.profile)data={...parsed,mode};}catch{}}
  data=initializeSpaces(data||seed());ensureCanvas(data);return data;
}
let state=cloudClient?initializeSpaces(await cloudClient.initialize(seed())):load();
if(cloudClient){state.mode='personal';ensureCanvas(state);workspaceStorage.setItem(key(mode),JSON.stringify(state));lastStored=workspaceStorage.getItem(key(mode));}
const baselines=new WeakMap([[state,lastStored]]);
function toast(message,action){
  const el=document.createElement('div');el.className='toast';
  el.innerHTML=`${icon('check-circle',18)}<span>${esc(message)}</span>${action?'<button type="button">撤销</button>':''}`;
  if(action)el.querySelector('button').onclick=()=>{action();el.remove();};
  document.querySelector('#toasts').append(el);setTimeout(()=>el.remove(),action?9000:4500);
}
function save(target=state){
  target.updatedAt=new Date().toISOString();
  const targetMode=target.mode;
  if(workspaceStorage.getItem(key(targetMode))!==baselines.get(target)){
    const recoveryKey=`${cloudClient?cloudClient.recoveryPrefix:`czb-yuzhou-recovery-${targetMode}-`}${Date.now()}-${uid()}`;
    try{workspaceStorage.setItem(recoveryKey,JSON.stringify(target));}catch{}
    modal({title:'另一个窗口有更新',body:'<p>为保留另一个窗口的新记录，本次没有覆盖保存。本窗口的改动已留在恢复副本中，可先导出，再加载最新内容。</p><div class="row" style="margin-top:20px"><button class="btn" type="button" id="export-conflict">导出本窗口改动</button><button class="btn primary" type="button" data-action="reload-latest">加载最新内容</button></div>'});
    dialog.querySelector('#export-conflict').onclick=()=>exportBackup(target);
    const error=new Error('检测到另一窗口的更新，请先加载最新内容。');error.name='StorageConflictError';throw error;
  }
  const previous=workspaceStorage.getItem(key(targetMode));
  try{
    workspaceStorage.setItem(key(targetMode),JSON.stringify(target));
    if(cloudClient)cloudClient.enqueue(target);
  }catch(error){
    if(previous===null)workspaceStorage.removeItem(key(targetMode));else workspaceStorage.setItem(key(targetMode),previous);
    toast('本机保存失败，本次未覆盖原记录。请导出备份后检查存储空间。');throw error;
  }
  const stored=workspaceStorage.getItem(key(targetMode));baselines.set(target,stored);
  if(target===state){lastStored=stored;updateModuleNavigation();if(route==='space'){const title=state.spaces.find(s=>s.id===subroute)?.title;if(title){document.title=`${title} · 宇宙`;const label=document.querySelector('#current-page');if(label)label.textContent=title;}}}
}
const dialog=document.querySelector('#modal');
function insertColoredRecord(target,list,entry){
  const previous=target.ui?.lastCreatedColor,updatedAt=target.updatedAt;
  entry.color=assignRecordColor(target,entry.color);list.unshift(entry);
  try{save(target);}catch(error){list.splice(list.indexOf(entry),1);target.updatedAt=updatedAt;if(previous===undefined)delete target.ui.lastCreatedColor;else target.ui.lastCreatedColor=previous;throw error;}
  return entry;
}
let modalReturnFocus,modalCleanup;
function closeModal(){const cleanup=modalCleanup;modalCleanup=null;cleanup?.();dialog.close();dialog.innerHTML='';modalReturnFocus?.focus?.();}
function modal({title,body,submitLabel='保存',onSubmit,onClose}){
  const cleanup=modalCleanup;modalCleanup=null;cleanup?.();
  if(dialog.open)dialog.close();
  modalCleanup=onClose;
  modalReturnFocus=document.activeElement;
  dialog.innerHTML=`<form class="modal-form"><header class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="关闭">${icon('close')}</button></header><div class="modal-body">${body}</div>${onSubmit?`<footer class="modal-foot"><span class="muted small">${cloudClient?'保存到本机工作台':'修改保存在本机'}</span><button type="button" class="btn" data-close>取消</button><button type="submit" class="btn primary">${esc(submitLabel)}</button></footer>`:''}</form>`;
  dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);
  const form=dialog.querySelector('form');
  const draftSuffix=`${mode}-${title}-${Array.from(form.elements).filter(x=>x.type!=='password').map(x=>x.value).join('|').slice(0,200)}`;
  const draftId=cloudClient?cloudClient.draftKey(draftSuffix):`czb-yuzhou-draft-${draftSuffix}`;
  if(onSubmit){
    try{const draft=JSON.parse(workspaceStorage.getItem(draftId)||'null');if(draft){for(const el of form.elements){if(el.name&&el.type!=='file'&&draft[el.name]!==undefined){if(el.type==='checkbox')el.checked=!!draft[el.name];else if(el.type==='radio')el.checked=el.value===draft[el.name];else el.value=draft[el.name];}}}}catch{}
    form.oninput=()=>{const draft={};for(const el of form.elements){if(el.name&&!['file','password'].includes(el.type)&&(el.type!=='radio'||el.checked))draft[el.name]=el.type==='checkbox'?el.checked:el.value;}try{workspaceStorage.setItem(draftId,JSON.stringify(draft));}catch{}};
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(!onSubmit)return;
    const btn=form.querySelector('button[type=submit]');btn.disabled=true;
    try{const result=await onSubmit(new FormData(form),form);if(result!==false){workspaceStorage.removeItem(draftId);if(dialog.open&&dialog.querySelector('form')===form)closeModal();}}catch(error){toast(error.message||'保存失败，请重试。');}finally{if(btn.isConnected)btn.disabled=false;}
  };
  dialog.showModal();
  const input=form.querySelector('input:not([type=file]),textarea,select');if(input)setTimeout(()=>input.focus(),50);
}
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
dialog.addEventListener('cancel',event=>{event.preventDefault();closeModal();});
const ctx={root:null,state,save,esc,icon,toast,modal,closeModal,go,uid,putFile,getFile,download,dateLabel,cloud:cloudClient};

// Keep async work attached to the workspace in which it started.
function makeContext(){
  const viewState=state, viewRoot=ctx.root;
  const local={...ctx,state:viewState,root:viewRoot,save:()=>save(viewState),
    refresh:()=>{if(state===viewState){updateModuleNavigation();render();}}};
  local.isCurrent=()=>state===viewState;
  local.spaceId=route==='space'||route==='builder'&&subroute?subroute:route==='block'?getCustomBlocks(viewState).items.find(block=>block.id===subroute)?.spaceId:undefined;
  local.routeDetail=routeDetail;local.routeItem=routeItem;
  if(route==='builder'){const sessionId=local.spaceId||'root';if(!builderSessions.has(sessionId))builderSessions.set(sessionId,{});local.builderSession=builderSessions.get(sessionId);}
  local.ensureCustomBlockLayout=()=>{if(!local.spaceId)ensureCanvas(viewState);};
  local.openCustomBlockEditor=(input,options)=>customBlockEditor(local,input,options);
  local.openBuilder=()=>go('builder',local.spaceId||'');
  local.askAssistant=prompt=>openAIConversation(local,{text:prompt,targetId:local.spaceId?`space:${local.spaceId}`:'workspace'});
  local.askSpaceAI=()=>openAIConversation(local,{targetId:`space:${local.spaceId}`,text:`请结合「${viewState.spaces.find(space=>space.id===local.spaceId)?.title||'当前空间'}」的用途整理内容，先给出方案，确认后再执行。`});
  local.createChildSpace=()=>openSpaceDialog({...local,parentSpaceId:local.spaceId});
  local.createSpace=()=>openSpaceDialog(local);
  local.editSpace=id=>openSpaceDialog(local,viewState.spaces.find(s=>s.id===id));
  local.routeContent=payload=>routeContent(local,payload);
  local.undoRoute=(receipt,id)=>undoRoute(local,receipt,id);
  local.confirmAI=async jobId=>{
    const editTick=cloudEditTick;
    return cloudClient.runWorkspaceMutation(
      ()=>cloudClient.request(`/api/ai/jobs/${encodeURIComponent(jobId)}/confirm`,{method:'POST',body:{}}),
      {canApply:()=>state===viewState&&cloudEditTick===editTick&&!dialog.open&&!hasUnsavedCloudFields(),apply:adoptCloudState}
    );
  };
  local.openDestination=id=>openDestination(local,id);
  local.openTask=id=>{
    if(state!==viewState)return;
    if(!viewState.tasks.some(task=>task.id===id)){toast('这条待办已不存在，请刷新后重试。');return;}
    taskDialog(id);
  };
  local.mountAIComposer=host=>mountAIComposer(local,host);
  local.dropOnCard=(id,files)=>dropOnCard(local,id,files);
  local.enterCard=async(id,element)=>{
    const currentHash=location.hash;
    if(getCustomBlocks(viewState).items.some(block=>block.id===id)){if(state===viewState)go('block',id);return;}
    if(element&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const stage=element.closest('.cv-viewport')||viewRoot;
      const from=element.getBoundingClientRect(),to=stage.getBoundingClientRect();
      const overlay=element.cloneNode(true);overlay.classList.add('space-transit');overlay.setAttribute('aria-hidden','true');overlay.inert=true;
      Object.assign(overlay.style,{position:'fixed',left:from.left+'px',top:from.top+'px',width:from.width+'px',height:from.height+'px',margin:'0',transform:'none',zIndex:'90',pointerEvents:'none'});
      document.body.append(overlay);
      try{await overlay.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${to.left-from.left}px,${to.top-from.top}px) scale(1.18)`,opacity:0}],{duration:330,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'}).finished;}finally{overlay.remove();}
    }
    if(state!==viewState||location.hash!==currentHash)return;
    if(viewState.spaces.some(s=>s.id===id))go('space',id);
    else if(viewState.courses.some(c=>c.id===id))go('courses',id);
    else go(id);
  };
  return local;
}
async function dropOnCard(local,id,input){
  const files=Array.from(input||[]),space=local.state.spaces.find(s=>s.id===id);
  if(id.startsWith('block:')){toast('自定义方块不接收文件；可将资料保存到工作区或收集箱。');return {saved:0,rejected:files.length};}
  if(id==='ledger'){toast('打开记账，点「记一笔」录入金额、日期和项目。');return {saved:0,rejected:files.length};}
  if(id==='calendar'){toast('打开日历，选择日期即可添加计划、标注和注意事项。');return {saved:0,rejected:files.length};}
  if(id==='timetable'){toast('打开学期课表，可查看每周安排并新增或修改课程。');return {saved:0,rejected:files.length};}
  if(id==='competitions'){toast('请打开比赛记录要求与准备清单；附件可先交给 AI 讨论整理。');return {saved:0,rejected:files.length};}
  if(space){
    const result=await saveSpaceFiles(local,space,files);
    toast(`已保存 ${result.saved} 份文件到「${space.title}」${result.rejected?`，${result.rejected} 份未保存（单文件上限 40 MB）`:''}。`);
    if(state===local.state&&route==='home')local.refresh();
    return result;
  }
  const stored=[],rejected=[];
  for(const file of files){try{const blobId=await local.putFile(file);stored.push({id:uid(),blobId,name:file.name,size:file.size,type:file.type,createdAt:new Date().toISOString()});}catch(error){rejected.push({name:file.name,message:error.message});}}
  if(rejected.length)toast(`${rejected.length} 份文件未保存：${rejected[0].message}`);
  if(!stored.length)return {saved:0,rejected:rejected.length};
  if(id==='ai'||id==='courses'){
    local.state.aiDraft.files.push(...stored);local.save();
    if(id==='courses')toast('文件已放入 AI 收件台草稿，可选择具体课程后直接归档。');
    else toast(`已将 ${stored.length} 份文件加入 AI 草稿。`);
    if(state===local.state)go('ai');
  }else{
    const targetId=['english','inbox','tasks'].includes(id)?id:'inbox';
    const request={id:uid(),text:'',originalText:'',files:stored,targetId,status:'waiting_model',createdAt:new Date().toISOString()};
    local.state.aiRequests.unshift(request);local.save();
    request.receipt=await local.routeContent({text:'',files:stored,targetId,requestId:request.id});request.status='filed';local.save();
    toast(`已保存 ${stored.length} 份原文件到${request.receipt.destinationLabel}。`);
  }
  if(state===local.state&&route==='home')local.refresh();
  return {saved:stored.length,rejected:rejected.length};
}

function shell(){
  sidebarResize?.destroy();
  document.body.classList.add('space-shell');
  document.querySelector('#app').innerHTML=`
  <button class="rail-scrim" data-action="close-nav" aria-label="关闭导航" hidden></button>
  <aside class="sidebar ${state.ui.sidebarPinned?'rail-pinned':''}" aria-label="空间导航"><a href="#/welcome" class="brand" aria-label="返回宇宙工作区入口"><img src="./icon.svg" alt="" width="39" height="39"><span>宇宙<small>自由搭建，随心记录</small></span></a>
  <button class="rail-pin" data-action="pin-nav" aria-label="${state.ui.sidebarPinned?'收起侧边栏':'展开侧边栏'}" aria-pressed="${!!state.ui.sidebarPinned}">${icon('pin',17)}<span>${state.ui.sidebarPinned?'收起侧边栏':'展开侧边栏'}</span></button>
  <div class="workspace-switch"><span class="workspace-avatar">我</span><span><strong data-workbench-title>${esc(getWorkbench(state).title)}</strong><small>按你的方式搭建</small></span></div>
  <div class="rail-scroll"><div class="rail-navigation"></div></div>
  <div class="sidebar-bottom"><button class="settings-link rail-update" data-action="check-update" aria-label="检查更新" title="检查更新">${icon('refresh')}<span>检查更新</span></button><button class="rail-new" data-action="new-space" aria-label="新建工作区">${icon('plus',20)}<span>新建工作区</span></button><a class="settings-link" href="#/settings" aria-label="偏好与连接" title="偏好与连接">${icon('settings')}<span>偏好与连接</span></a><button class="profile" data-go="settings" aria-label="个人设置"><span class="avatar">${esc(state.profile.name.slice(0,1))}</span><span><strong>${esc(state.profile.name)}</strong><small>项目工作台</small></span></button></div></aside>
  <div class="app-main"><header class="topbar"><div class="breadcrumb"><button class="mobile-menu icon-btn" data-action="toggle-nav" aria-label="展开导航">${icon('menu')}</button><a href="#/home" class="desktop-label">工作台</a><span class="slash desktop-label">/</span><strong id="current-page">空间主页</strong></div><button class="search-trigger" data-action="search" aria-label="搜索所有空间">${icon('search',17)}<span>搜索所有空间…</span><kbd>Ctrl K</kbd></button><div class="topbar-actions"><button class="app-update-trigger" data-action="check-update" aria-label="检查界面更新" title="检查界面更新">${icon('refresh',16)}<span>更新</span></button><button class="sync-indicator" data-go="settings"><span class="status-dot"></span><span>本机已就绪</span></button><button class="icon-btn" data-action="notifications" aria-label="通知">${icon('bell')}</button><button class="avatar small-avatar" data-go="settings" aria-label="个人设置">${esc(state.profile.name.slice(0,1))}</button></div></header>
  <div class="mode-banner personal-banner">${icon('shield',15)}<span>${cloudClient?'工作台数据保存在本机工作台。':'工作台数据保存在当前浏览器。'}</span></div>
  <main id="main" tabindex="-1"></main><footer class="page-footer"><span>一点一滴，都是你的积累。</span><span>宇宙 · 基于 v${VERSION}</span></footer></div>
  <nav class="bottom-nav" aria-label="移动导航">${[['home','orbit','工作台'],['builder','layers','搭建'],['ai','sparkles','AI伙伴']].map(([id,i,label])=>`<a href="#/${id}" data-nav="${id}">${icon(i,21)}<span>${label}</span></a>`).join('')}<button data-action="toggle-nav">${icon('menu',21)}<span>更多</span></button></nav>
  ${companionButton()}`;
  ctx.root=document.querySelector('#main');
  const sidebar=document.querySelector('.sidebar'),handle=document.createElement('div');
  handle.className='rail-resize';handle.tabIndex=0;handle.setAttribute('role','separator');
  sidebar.id='workspace-sidebar';handle.setAttribute('aria-label','调整侧边栏宽度');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-valuemin','80');handle.setAttribute('aria-controls','workspace-sidebar');
  handle.title='拖动调节宽度，双击恢复默认；也可用左右方向键调节';sidebar.append(handle);
  sidebarResize=mountSidebarResize({body:document.body,sidebar,handle,pinButton:document.querySelector('[data-action="pin-nav"]'),readExpanded:()=>state.ui.sidebarPinned,writeExpanded:setSidebarExpanded,readWidth:()=>workspaceStorage.getItem(`${key(mode)}:sidebar-width`),writeWidth:width=>workspaceStorage.setItem(`${key(mode)}:sidebar-width`,String(width)),onError:error=>toast(error.message)});
  updateModuleNavigation();
  syncNavigationState();
  if(cloudClient)updateCloudShell();
}
function updateModuleNavigation(){
  renderSidebarNavigation(document.querySelector('.rail-navigation'),getNavigationItems(state),{route,subroute});
  const title=document.querySelector('[data-workbench-title]');
  if(title)title.textContent=getWorkbench(state).title;
  document.querySelectorAll('[data-nav]').forEach(a=>{a.classList.toggle('active',a.dataset.nav===route);if(a.dataset.nav===route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  updateShellCounts();
}
function updateShellCounts(){
  for(const [id,count] of [['inbox',state.captures.filter(x=>!x.archived).length],['tasks',state.tasks.filter(x=>!x.done&&!x.archived).length]]){
    const el=document.querySelector(`[data-count="${id}"]`);if(el)el.textContent=count||'';
  }
}
function go(page,id='',detail='',item=''){const hash=workspaceRoute(page,id,detail,item);if(location.hash===hash)render();else location.hash=hash;}
function pageHead(title,description,action=''){return `<div class="page-head"><div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;}
function empty(title,description,action=''){return `<div class="empty-state"><span class="empty-symbol">${icon('layers',30)}</span><h3>${title}</h3><p>${description}</p>${action}</div>`;}
const button=(label,action,i='plus',primary=false)=>`<button class="btn ${primary?'primary':''}" data-action="${action}">${icon(i,17)}${label}</button>`;
const taskSource=t=>(state.spaces||[]).find(space=>space.id===t.spaceId)?.title||t.source||'手动记录';
function taskRow(t){return `<div class="task-row ${t.done?'is-done':''}"><button class="task-check" data-action="toggle-task" data-id="${esc(t.id)}" aria-label="${t.done?'取消完成':'完成'}：${esc(t.title)}" aria-pressed="${t.done}">${t.done?icon('check',15):''}</button><button class="task-text" data-action="edit-task" data-id="${esc(t.id)}"><strong>${esc(t.title)}</strong><span>${esc(taskSource(t))}${t.date?`<i>·</i>${dateLabel(t.date)}`:''}</span></button><span class="task-category ${t.category==='英语'?'pink':t.category==='课程'?'violet':'cyan'}">${esc(t.category||'个人')}</span>${t.priority==='high'?'<span class="priority-dot" title="优先处理"></span>':''}<button class="icon-btn row-edit" data-action="edit-task" data-id="${esc(t.id)}" aria-label="编辑待办">${icon('more',18)}</button></div>`;}
function renderHome(){
  const pending=state.tasks.filter(x=>!x.done&&!x.archived);
  const todays=state.tasks.filter(x=>!x.archived&&x.date===today());
  const completed=todays.filter(x=>x.done).length;
  const visibleCourses=state.courses.filter(course=>!course.archived),current=visibleCourses[0];const totalNotes=visibleCourses.reduce((a,c)=>a+(c.notes||[]).filter(note=>!note.archived).length,0);
  const weekdays=['日','一','二','三','四','五','六'];
  ctx.root.innerHTML=`
  ${pageHead(`准备好，拾起今天的灵感。<span class="greeting-spark">✳</span>`,`把学习与生活放在一起，一件一件，慢慢做好。`,`<button class="btn primary" data-action="add-task">${icon('plus',18)} 新建待办</button>`)}
  <div class="home-meta"><span>${new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</span><span class="divider-dot"></span><span>${esc(state.profile.major)}</span><span class="pill subtle">${esc(getWorkbench(state).title)}</span></div>
  <div class="dashboard-grid"><div class="dashboard-left">
    <section class="continue-card"><div class="continue-copy"><span class="eyebrow">${icon('book',15)} ${current?'继续探索你的课程':'属于你的学习空间'}</span><h2>${current?esc(current.title):'让知识，<br>在这里连接。'}</h2><p>${current?'从一个概念出发，把知识点串成自己的理解。':'放进第一份课件，为每门课留一个专属位置。'}</p><button class="btn ink" data-go="courses" ${current?`data-sub="${esc(current.id)}"`:''}>${current?'进入课程空间':'创建第一门课程'} ${icon('arrow-right',17)}</button></div><div class="knowledge-art" aria-hidden="true"><span class="orbit orbit-one"></span><span class="orbit orbit-two"></span><div class="art-note back-note"><i></i><i></i><i></i></div><div class="art-note front-note"><span>${icon('code',25)}</span><b>ideas<br>into knowledge.</b><i></i><i></i></div><span class="art-plus">+</span><span class="art-dot"></span></div><div class="continue-footer"><span>${visibleCourses.length} 门课程</span><span>${totalNotes} 篇笔记</span><span>保持好奇，持续生长 ${icon('arrow-right',14)}</span></div></section>
    <section class="panel today-panel"><div class="section-head"><div><h2>今天，专注这几件事 <span class="count">${todays.length}</span></h2><p>${todays.length?`已完成 ${completed} / ${todays.length} 件，按自己的节奏来。`:'从一件小事开始，也很好。'}</p></div><button class="text-btn" data-go="tasks">全部待办 ${icon('arrow-right',16)}</button></div><div class="week-strip">${Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-((d.getDay()+6)%7)+i);const selected=d.toDateString()===new Date().toDateString();return `<div class="week-day ${selected?'current':''}"><span>周${weekdays[d.getDay()]}</span><b>${d.getDate()}</b><i></i></div>`;}).join('')}</div><div class="task-list">${todays.length?todays.slice(0,4).map(taskRow).join(''):empty('今天还没有安排','留一点空间给新的想法，也可以先记下待办。',button('记一件事','add-task'))}</div><button class="add-line" data-action="add-task">${icon('plus',17)} 添加一个小目标</button></section>
  </div><div class="dashboard-right">
    <section class="quick-card"><div class="section-head"><h2>${icon('bolt',19)} 灵感速记</h2><span>先记下来，再慢慢整理</span></div><form id="quick-form"><label class="sr-only" for="quick-text">灵感速记</label><textarea id="quick-text" name="text" maxlength="12000" placeholder="脑海里闪过的念头、课堂上的疑问，或者一件怕忘记的小事…">${esc(workspaceStorage.getItem(cloudClient?cloudClient.draftKey(`quick-${mode}`):`czb-yuzhou-quick-${mode}`)||'')}</textarea><div class="quick-bottom"><button type="button" class="icon-btn" data-action="capture-file" aria-label="添加附件">${icon('plus',19)}</button><span>保存在收集箱</span><button class="btn compact ink" type="submit">收好 ${icon('arrow-right',15)}</button></div></form></section>
    <section class="english-home"><div class="english-label"><span class="pill">ENGLISH</span>${icon('graduation',27)}</div><h2>每天一点，<br>离目标更近一点。</h2><p>${state.english.plan?.dailyMinutes?`你的每日计划 · ${esc(state.english.plan.dailyMinutes)} 分钟`:'你的英语计划，按自己的节奏开始。'}</p><div class="english-home-links"><button data-go="english" data-sub="vocabulary">${icon('book',17)} 词汇练习</button><button data-go="english" data-sub="reading">${icon('file',17)} 阅读训练</button></div><button class="text-btn" data-go="english">进入英语空间 ${icon('arrow-right',17)}</button></section>
    <section class="inbox-peek panel"><div class="section-head"><h2>待整理的碎片</h2><button class="icon-btn" data-go="inbox" aria-label="查看收集箱">${icon('arrow-right',17)}</button></div>${state.captures.filter(x=>!x.archived).slice(0,2).map(c=>`<button class="peek-row" data-action="edit-capture" data-id="${esc(c.id)}"><span class="peek-icon">${icon('file',17)}</span><span><strong>${esc(c.text.slice(0,38)||c.fileName||'附件')}</strong><small>${esc(c.tags||c.category)} · 待整理</small></span></button>`).join('')||'<p class="muted">随手记下的想法，会出现在这里。</p>'}</section>
  </div></div>
  <section class="home-courses"><div class="section-head"><div><h2>我的课程空间</h2><p>每门课，都有一片独立的知识天地。</p></div><button class="text-btn" data-go="courses">查看全部 ${icon('arrow-right',17)}</button></div><div class="home-course-grid">${visibleCourses.slice(0,3).map((c,i)=>`<button class="mini-course" data-go="courses" data-sub="${esc(c.id)}"><span class="course-symbol ${['violet','cyan','pink'][i%3]}">${icon(['code','layers','cloud'][i%3],25)}</span><span><strong>${esc(c.title)}</strong><small>${(c.files||[]).filter(file=>!file.archived).length} 份资料 · ${(c.notes||[]).filter(note=>!note.archived).length} 篇笔记</small></span>${icon('arrow-right',18)}</button>`).join('')||`<button class="mini-course add-course" data-go="courses">${icon('plus',24)}<span><strong>创建第一门课程</strong><small>课件、笔记与知识点，放在一起</small></span></button>`}</div></section>`;
  ctx.root.querySelector('#quick-form').onsubmit=e=>{e.preventDefault();const input=e.target.elements.text;if(!input.value.trim()){input.focus();toast('先写下一点内容吧。');return;}addCapture(input.value.trim());workspaceStorage.removeItem(cloudClient?cloudClient.draftKey(`quick-${mode}`):`czb-yuzhou-quick-${mode}`);render();};
  ctx.root.querySelector('#quick-text').oninput=e=>{workspaceStorage.setItem(cloudClient?cloudClient.draftKey(`quick-${mode}`):`czb-yuzhou-quick-${mode}`,e.target.value);};
  ctx.root.onclick=handleMain;
}

function taskDialog(id){
  const task=state.tasks.find(x=>x.id===id);
  const parent=(state.spaces||[]).find(space=>space.id===task?.spaceId&&!space.archived);
  modal({title:task?'编辑待办':'记下一件事',body:`<label class="field">要做什么<input name="title" required maxlength="160" placeholder="例如：复习二叉树的遍历" value="${esc(task?.title||'')}"></label><div class="form-grid"><label class="field">安排日期<input name="date" type="date" value="${esc(task?.date??today())}"></label><label class="field">分类<select name="category">${['个人','课程','英语'].map(c=>`<option ${task?.category===c?'selected':''}>${c}</option>`).join('')}</select></label></div><label class="field">优先级<select name="priority"><option value="normal">按计划进行</option><option value="high" ${task?.priority==='high'?'selected':''}>优先处理</option></select></label><label class="field">补充说明<textarea name="description" rows="3" maxlength="5000" placeholder="保留一点上下文…">${esc(task?.description||'')}</textarea></label>${task?`<p class="muted small">来源：${esc(taskSource(task))}</p>${parent?'<button class="btn" type="button" data-task-space>打开所属空间</button>':''}<button class="btn danger" type="button" data-archive-task="${esc(task.id)}">${icon('archive',16)} 归档此项</button>`:''}`,onSubmit:data=>{const values={title:data.get('title').trim(),date:data.get('date'),category:data.get('category'),priority:data.get('priority'),description:data.get('description').trim()};if(!values.title){toast('请填写待办内容。');return false;}if(task){Object.assign(task,values);save();}else insertColoredRecord(state,state.tasks,{id:uid(),...values,done:false,source:'手动记录',createdAt:new Date().toISOString()});render();toast(task?'待办已更新':'已经记下，按自己的节奏来。');}});
  const source=dialog.querySelector('[data-task-space]');if(source)source.onclick=()=>{closeModal();go('space',parent.id);};
  const archive=dialog.querySelector('[data-archive-task]');if(archive)archive.onclick=()=>{task.archived=true;save();closeModal();render();toast('待办已归档',()=>{task.archived=false;save();render();});};
}
function renderTasks(){
  const tasks=state.tasks.filter(t=>filter==='archived'?t.archived:!t.archived&&(filter==='all'||filter==='today'&&t.date===today()||filter==='pending'&&!t.done||filter==='done'&&t.done));
  const all=state.tasks.filter(t=>!t.archived),pending=all.filter(t=>!t.done),done=all.filter(t=>t.done);
  ctx.root.innerHTML=pageHead('给每件事，一个着落。','一件事，一张卡片。长按拾起，按自己的节奏摆放。',button('新建待办','add-task','plus',true))+
    `<section class="interior-page task-desktop"><div class="task-summary"><div><span class="summary-icon violet">${icon('list',23)}</span><span><b>${pending.length}</b><small>等待完成</small></span></div><div><span class="summary-icon cyan">${icon('sun',23)}</span><span><b>${all.filter(t=>t.date===today()&&!t.done).length}</b><small>今日安排</small></span></div><div><span class="summary-icon pink">${icon('check-circle',23)}</span><span><b>${done.length}</b><small>已经完成</small></span></div></div><div class="toolbar interior-filter"><div class="tabs">${[['all','全部'],['today','今天'],['pending','待完成'],['done','已完成'],['archived','已归档']].map(([f,l])=>`<button class="tab ${filter===f?'active':''}" data-action="filter" data-filter="${f}">${l}</button>`).join('')}</div><span class="muted small">${tasks.length} 件事项</span></div><div data-task-board></div></section>`;
  const palette={个人:'#63E6DC',课程:'#AE88FF',英语:'#D8F649'};
  state.boards||={};state.boards.tasks||={};
  cleanupView=mountCanvas({...makeContext(),root:ctx.root.querySelector('[data-task-board]'),createSpace:()=>taskDialog(),editSpace:id=>taskDialog(id),enterCard:id=>taskDialog(id)}, {
    layout:state.boards.tasks,sourceItems:state.tasks,items:state.tasks.map(t=>({...t,subtitle:taskSource(t),color:isRecordColor(t.color)?t.color:palette[t.category]||'#FFBC7C',icon:t.done?'check-circle':'list'})),matches:t=>tasks.some(x=>x.id===t.id),title:'待办卡片',hideHeader:true,createLabel:false,cardLabel:t=>t.archived?'已归档':t.done?'已经完成':t.priority==='high'?'优先处理':'待办事项',footLabel:t=>t.date?dateLabel(t.date):'还没有安排日期',enterLabel:'查看事项',canDrop:false,manageLabel:'编辑待办',emptyHTML:empty('这里暂时没有事项','记下一件事，就能从容地开始。',button('添加待办','add-task')),
    renderCard:(geometry,t)=>`<div class="task-row task-board-item ${t.done?'is-done':''}"><div class="task-card-status">${t.archived?`<button class="btn compact" data-action="restore-task" data-id="${esc(t.id)}">恢复事项</button>`:`<button class="task-check" data-action="toggle-task" data-id="${esc(t.id)}" aria-label="${t.done?'取消完成':'完成'}：${esc(t.title)}" aria-pressed="${t.done}">${t.done?icon('check',17):''}</button><span>${t.done?'已完成':'待完成'}</span>`}<span class="task-category">${esc(t.category||'个人')}</span></div><button type="button" data-card-open class="task-text" data-action="edit-task" data-id="${esc(t.id)}"><strong>${esc(t.title)}</strong></button><p class="interior-card-excerpt">${esc(t.description||'点击补充这件事的细节与安排。')}</p><small class="interior-card-source">${esc(taskSource(t))}</small></div>`
  });
  ctx.root.onclick=handleMain;
}

function addCapture(text,extra={}){insertColoredRecord(state,state.captures,{id:uid(),text,category:'备忘',tags:'',archived:false,createdAt:new Date().toISOString(),...extra});toast('已经放进收集箱。');}
function captureDialog(id){
  const c=state.captures.find(x=>x.id===id);
  modal({title:c?'编辑碎片':'收集一个想法',body:`<label class="field">内容<textarea name="text" rows="6" required maxlength="12000" placeholder="文字、链接，或一段聊天里需要记住的事…">${esc(c?.text||'')}</textarea></label><div class="form-grid"><label class="field">分类<select name="category">${['备忘','学习灵感','英语','链接','消息摘录'].map(k=>`<option ${c?.category===k?'selected':''}>${k}</option>`).join('')}</select></label><label class="field">标签<input name="tags" maxlength="60" placeholder="例如：数据结构" value="${esc(c?.tags||'')}"></label></div>${c?.fileName?`<p class="muted">附件：${esc(c.fileName)}（${cloudClient?'随工作区同步':'仅本机保存'}）</p>`:''}`,onSubmit:data=>{const values={text:data.get('text').trim(),category:data.get('category'),tags:data.get('tags').trim()};if(!values.text){toast('请先填写内容。');return false;}if(c){Object.assign(c,values);save();toast('内容已更新。');}else addCapture(values.text,values);render();}});
}
function setInboxView(value){
  const previous=state.ui.inboxView;
  try{state.ui.inboxView=value;save();render();}
  catch(error){if(previous===undefined)delete state.ui.inboxView;else state.ui.inboxView=previous;toast(error.message);}
}
function renderInbox(){
  if(state.ui.inboxView==='dream'){
    ctx.root.innerHTML='';
    cleanupView=mountDream(makeContext(),{
      items:state.captures.filter(c=>!c.archived),onExit:()=>setInboxView('cards'),onCreate:()=>captureDialog(),onEdit:id=>captureDialog(id),
      onArchive:id=>{
        const capture=state.captures.find(c=>c.id===id);if(!capture)return;
        const previous=capture.archived;
        try{capture.archived=true;save();render();toast('灵感已归档，可在灵感墙的「已归档」中恢复。');}
        catch(error){capture.archived=previous;toast(error.message);}
      },
      onDownload:async id=>{
        try{const capture=state.captures.find(c=>c.id===id);if(!capture?.blobId)throw new Error('没有可下载的附件。');const blob=await getFile(capture.blobId);if(!blob)throw new Error('附件暂时不可用。');download(blob,capture.fileName||'灵感附件');}
        catch(error){toast(error.message);}
      }
    });
    return;
  }
  if(state.ui.inboxView!=='canvas'){
    cleanupView=mountInspirationWall(makeContext(),{filter,query:captureQuery,onQuery:value=>{captureQuery=value;}});
    bindCaptureDrop();ctx.root.onclick=handleMain;return;
  }
  const captures=state.captures.filter(c=>filter==='archived'?c.archived:!c.archived&&(filter==='all'||c.category===filter));
  ctx.root.innerHTML=pageHead('灵感，先放在这里。','每条碎片都有一张卡。拖入文件，或记下刚刚的想法。',`<div class="row">${button('添加附件','capture-file','upload')}${button('随手记','add-capture','plus',true)}</div>`)+`<section class="interior-page capture-desktop"><div class="inbox-notice">${icon('sparkles',21)}<div><strong>先收集，再连接。</strong><span>和 AI 讨论想法、分类和下一步，核对行动方案后再确认保存。</span></div><button class="text-btn" data-action="inspiration-ai">交给 AI ${icon('arrow-right',16)}</button></div><div class="toolbar interior-filter"><div class="tabs">${[['all','全部碎片'],['学习灵感','学习灵感'],['英语','英语'],['备忘','备忘'],['链接','链接'],['消息摘录','摘录'],['archived','已归档']].map(([f,l])=>`<button class="tab ${filter===f?'active':''}" data-action="filter" data-filter="${f}">${l}</button>`).join('')}</div><span class="muted small">${captures.length} 条记录</span></div><div data-capture-board></div></section>`;
  const palette={'备忘':'#FF9CCE','学习灵感':'#AE88FF','英语':'#D8F649','链接':'#9DC5FF','消息摘录':'#63E6DC'};
  const dreamButton=document.createElement('button');dreamButton.type='button';dreamButton.className='btn dream-entry';dreamButton.dataset.action='dream-mode';dreamButton.innerHTML=`${icon('cloud',18)}梦境模式`;
  const wallButton=document.createElement('button');wallButton.type='button';wallButton.className='btn';wallButton.dataset.action='inspiration-wall';wallButton.textContent='灵感墙';
  ctx.root.querySelector('.page-head .row')?.prepend(wallButton,dreamButton);
  if(!dreamButton.isConnected)ctx.root.querySelector('.capture-desktop').prepend(dreamButton);
  state.boards||={};state.boards.inbox||={};
  cleanupView=mountCanvas({...makeContext(),root:ctx.root.querySelector('[data-capture-board]'),createSpace:()=>captureDialog(),editSpace:id=>captureDialog(id),enterCard:id=>captureDialog(id)}, {
    layout:state.boards.inbox,sourceItems:state.captures,items:state.captures.map(c=>({...c,title:c.text.slice(0,50)||c.fileName||'未命名碎片',subtitle:c.category,color:isRecordColor(c.color)?c.color:palette[c.category]||'#FFBC7C',icon:c.fileName?'file':c.category==='链接'?'link':'bolt'})),matches:c=>captures.some(x=>x.id===c.id),title:'灵感卡片',hideHeader:true,createLabel:false,cardLabel:c=>c.archived?'已归档':c.category,footLabel:c=>new Date(c.createdAt).toLocaleDateString('zh-CN',{month:'short',day:'numeric'}),enterLabel:'展开内容',canDrop:false,manageLabel:'编辑碎片',emptyHTML:empty('为下一次灵感，留一个位置。','写点什么，或拖入一份资料。',button('记下第一个想法','add-capture')),
    renderCard:(geometry,c)=>`<article class="capture-card capture-board-item"><button class="capture-card-copy" type="button" data-card-open data-action="edit-capture" data-id="${esc(c.id)}"><p>${esc(c.text)}</p></button>${c.fileName?`<button class="attachment" data-action="download-capture" data-id="${esc(c.id)}">${icon('file',17)}<span>${esc(c.fileName)}</span> ${icon('download',15)}</button>`:''}${c.tags?`<span class="capture-tag"># ${esc(c.tags)}</span>`:''}<footer><button class="text-btn" data-action="capture-task" data-id="${esc(c.id)}">转为待办</button><button class="icon-btn" data-action="archive-capture" data-id="${esc(c.id)}" aria-label="${c.archived?'恢复':'归档'}碎片">${icon(c.archived?'refresh':'archive',17)}</button></footer></article>`
  });
  bindCaptureDrop();ctx.root.onclick=handleMain;
}
function bindCaptureDrop(){
  const view=makeContext();
  ctx.root.ondragover=e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}};
  ctx.root.ondrop=async e=>{const files=Array.from(e.dataTransfer?.files||[]);if(!files.length)return;e.preventDefault();let count=0;for(const file of files){try{const blobId=await putFile(file);insertColoredRecord(view.state,view.state.captures,{id:uid(),text:file.name,category:'备忘',tags:'',archived:false,createdAt:new Date().toISOString(),blobId,fileName:file.name,fileType:file.type});count++;}catch(error){toast(error.message);break;}}if(count){view.refresh();toast(`已收下 ${count} 份附件。`);}};

}

function captureFile(){
  modal({title:'收集一份附件',body:`<label class="field">选择文件<input name="file" type="file" required></label><p class="muted small">${cloudClient?'原件会保存到本比赛独立服务，当前仅供本机访问。':'原件存入当前浏览器，文件内容不会上传。'}单文件最大 40 MB。</p><label class="field">补充说明<textarea name="text" rows="3" maxlength="12000" placeholder="这份资料值得记住的地方…"></textarea></label>`,submitLabel:'放入收集箱',onSubmit:async data=>{const file=data.get('file');if(!file?.size){toast('请选择非空文件。');return false;}const blobId=await putFile(file);addCapture(data.get('text').trim()||file.name,{blobId,fileName:file.name,fileType:file.type,category:'备忘'});render();}});
}
async function handleMain(event){
  const b=event.target.closest('[data-action]');if(!b)return;const id=b.dataset.id;const action=b.dataset.action;
  if(action==='assistant')assistant();
  if(action==='dream-mode')setInboxView('dream');
  if(action==='inspiration-wall')setInboxView('cards');
  if(action==='inspiration-canvas')setInboxView('canvas');
  if(action==='inspiration-ai'){try{openAIConversation(makeContext(),{targetId:'inbox',text:'请先查看我保存的灵感，和我讨论哪些想法可以归在一起、哪些值得继续展开，哪些适合变成待办。不要把猜测写成已有内容；先展示建议和行动方案，等我审核确认。'});}catch(error){toast(error.message);}}
  if(action==='add-task')taskDialog();
  if(action==='edit-task')taskDialog(id);
  if(action==='toggle-task'){const task=state.tasks.find(x=>x.id===id);task.done=!task.done;task.completedAt=task.done?new Date().toISOString():null;save();render();toast(task.done?'又完成一件事。':'已放回待办。');}
  if(action==='restore-task'){state.tasks.find(x=>x.id===id).archived=false;save();render();}
  if(action==='filter'){filter=b.dataset.filter;render();}
  if(action==='add-capture')captureDialog();
  if(action==='edit-capture')captureDialog(id);
  if(action==='capture-file')captureFile();
  if(action==='archive-capture'){const c=state.captures.find(x=>x.id===id);c.archived=!c.archived;save();render();toast(c.archived?'碎片已归档。':'碎片已恢复。',()=>{c.archived=!c.archived;save();render();});}
  if(action==='capture-task'){const c=state.captures.find(x=>x.id===id);const linked=state.tasks.find(t=>t.captureId===id&&!t.archived);if(linked){taskDialog(linked.id);return;}insertColoredRecord(state,state.tasks,{id:uid(),title:c.text.slice(0,100),description:c.text,category:c.category==='英语'?'英语':'个人',date:'',priority:'normal',done:false,source:`收集箱 · ${c.category}`,captureId:id,createdAt:new Date().toISOString()});render();toast('已转为待办，日期留待你安排。');}
  if(action==='download-capture'){try{const c=state.captures.find(x=>x.id===id);const blob=await getFile(c.blobId);if(!blob)throw new Error('附件不在这个浏览器中，请重新添加。');download(blob,c.fileName);}catch(error){toast(error.message);}}
}

function renderReview(){
  const done=state.tasks.filter(t=>t.done&&!t.archived),sessions=(state.english.sessions||[]).filter(session=>!session.archived),notes=[...state.courses,...state.spaces].filter(container=>!container.archived).reduce((n,c)=>n+(c.notes||[]).filter(note=>!note.archived).length,0);
  const containsExamples=[...done,...sessions].some(row=>row.example===true&&!row.archived);
  const minutes=sessions.reduce((n,s)=>n+Number(s.minutes||0),0);
  const events=[...done.map(t=>({date:t.completedAt||t.createdAt,title:t.title,type:t.example===true?'起始占位记录':'完成待办',icon:'check-circle'})),...sessions.map(s=>({date:s.date||s.createdAt,title:`${s.type||'英语练习'} · ${s.minutes||0} 分钟`,type:s.example===true?'起始学习记录':'学习记录',icon:'graduation'}))].sort((a,b)=>new Date(b.date)-new Date(a.date));
  ctx.root.innerHTML=pageHead('你走过的路，都算数。','回头看看，那些小小的积累正在连成线。',`<span class="badge">${cloudClient?'根据工作台记录统计':'根据本机记录统计'}${containsExamples?' · 含起始占位记录':''}</span>`)+`<div class="review-hero"><div><span class="eyebrow">YOUR EVERYDAY JOURNEY</span><h2>把注意力放在成长上。</h2><p>在这里回看待办、学习与灵感。<br>不必填满每一天，每一步都有意义。</p><button class="btn ink" data-go="tasks">看看接下来的安排 ${icon('arrow-right',17)}</button></div><div class="review-mark" aria-hidden="true">${icon('sun',104)}<span>little by little.</span></div></div><div class="review-stats">${[[done.length,'件待办已完成','check-circle','violet'],[minutes,'分钟英语学习','clock','cyan'],[notes,'篇空间笔记','book','pink'],[state.captures.filter(capture=>!capture.archived).length,'条灵感被记下','bolt','lime']].map(([n,l,i,c])=>`<div class="review-stat"><span class="summary-icon ${c}">${icon(i,22)}</span><strong>${n}</strong><span>${l}</span></div>`).join('')}</div><section class="panel"><div class="section-head"><div><h2>积累的足迹</h2><p>来自已完成待办与英语学习记录。${containsExamples?'起始占位记录不代表实际成果。':''}</p></div></div>${events.length?`<div class="activity-list">${events.slice(0,30).map(e=>`<div class="activity-row"><span class="activity-icon">${icon(e.icon,18)}</span><div><strong>${esc(e.title)}</strong><small>${esc(e.type)}</small></div><time>${new Date(e.date).toLocaleDateString('zh-CN',{month:'short',day:'numeric'})}</time></div>`).join('')}</div>`:empty('成长记录，从下一步开始','完成一个待办，或在英语空间记录一次学习。',`<button class="btn" data-go="english">开始学习 ${icon('arrow-right',17)}</button>`)}</section>`;
}

async function checkAppUpdate(){
  setMobileNav(false);
  modal({title:'界面更新',body:`<div class="update-state" role="status"><span class="update-mark">${icon('refresh',25)}</span><h3>正在检查新版本…</h3><p>当前界面 v${VERSION}</p></div>`});
  const currentForm=dialog.querySelector('form'),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(`./version.json?check=${Date.now()}`,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('version_unavailable');
    const info=await response.json();
    if(typeof info.version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(info.version))throw new Error('invalid_version');
    if(!dialog.open||dialog.querySelector('form')!==currentForm)return;
    if(info.version===VERSION){
      modal({title:'界面更新',body:`<div class="update-state" role="status"><span class="update-mark">${icon('check-circle',27)}</span><h3>已经是最新界面</h3><p>当前版本 v${VERSION}</p><p class="muted small">电脑、手机和平板共用服务器上的界面。无需重新安装 App。</p></div>`});
    }else{
      modal({title:'发现新版本',body:`<div class="update-state"><span class="update-mark">${icon('sparkles',27)}</span><h3>v${esc(info.version)} 已准备好</h3><p>当前界面 v${VERSION}</p><p>更新前会保存并同步当前资料，然后重新打开当前页面。</p></div>`,submitLabel:'保存并更新',onSubmit:async()=>{
        save();if(cloudClient)await cloudClient.flush();
        const next=new URL(location.href);next.searchParams.set('v',info.version);location.replace(next.href);
      }});
    }
  }catch{
    if(dialog.open&&dialog.querySelector('form')===currentForm)modal({title:'界面更新',body:`<div class="update-state" role="status"><span class="update-mark">${icon('cloud-off',27)}</span><h3>暂时无法检查更新</h3><p>请检查网络连接后重试。你的资料不会受到影响。</p><button type="button" class="btn primary" data-action="check-update">${icon('refresh',17)} 重新检查</button></div>`});
  }finally{clearTimeout(timer);}
}
function renderSettings(){
  ctx.root.innerHTML=pageHead('让这里，更像你。','设置个人偏好，查看模型与设备的连接状态。')+`<section class="app-version-card"><div><span>界面更新</span><strong>宇宙</strong><p>基于宇宙 v${VERSION}；仅检查本机工作台，已保存的资料会保留。</p></div><button class="btn" data-action="check-update">${icon('refresh',17)} 检查更新</button></section><div class="settings-layout"><div class="stack"><section class="panel"><div class="section-head"><h2>个人资料</h2><span class="badge">当前工作台</span></div><form id="profile-form"><div class="form-grid"><label class="field">怎么称呼你<input name="name" required maxlength="20" value="${esc(state.profile.name)}"></label><label class="field">角色或关注领域（可选）<input name="major" maxlength="40" value="${esc(state.profile.major)}"></label></div><div class="form-end"><button class="btn primary" type="submit">保存资料</button></div></form></section><section class="panel"><div class="section-head"><h2>大模型连接</h2><span class="badge status-off">尚未接入</span></div><p class="muted">配置 AI 引擎与 API 密钥后即可使用。课程整理、碎片分类与学习助手共用本机工作台的模型。</p><label class="field">偏好的模型服务<select id="provider"><option value="deepseek" ${state.profile.provider==='deepseek'?'selected':''}>DeepSeek</option><option value="doubao" ${state.profile.provider==='doubao'?'selected':''}>豆包 · 火山方舟</option><option value="other" ${state.profile.provider==='other'?'selected':''}>其他兼容服务</option></select></label><div class="setting-info">${icon('shield',19)}<span>这里不收集 API 密钥。当前选择只保存服务偏好，未建立模型连接。</span></div><div class="integration-list"><div>${icon('book',20)}<span>课程资料整理</span><small>等待连接</small></div><div>${icon('inbox',20)}<span>碎片分类与待办提取</span><small>等待连接</small></div><div>${icon('graduation',20)}<span>英语批改与计划建议</span><small>等待连接</small></div></div></section><section class="panel"><div class="section-head"><h2>消息来源</h2><span class="badge status-off">未连接</span></div><div class="message-integrations"><div><span class="integration-letter cyan">微</span><div><strong>微信消息</strong><p>可先把要整理的文字粘贴到收集箱。</p></div></div><div><span class="integration-letter violet">QQ</span><div><strong>QQ 消息</strong><p>后续评估可用接入方式，限定读取与汇总。</p></div></div></div><button class="btn" data-action="paste-message">${icon('plus',17)} 添加消息摘录</button><p class="muted small">此界面不会自动读取聊天记录，也不具备发送消息或自动回复功能。</p></section></div><div class="stack"><section class="panel connection-panel"><span class="connection-symbol">${icon('cloud',36)}</span><h2>你的空间，等待云端就绪。</h2><p>现在的修改保存在当前浏览器。部署后，两台电脑、手机与平板可访问同一份内容。</p><div class="connection-status"><span class="status-dot"></span> 本机保存已启用</div><div class="connection-status muted">${icon('cloud-off',14)} 云端同步未连接</div><div class="device-list"><span>本机浏览器</span><span>个人资料</span><span>远程同步待部署</span></div></section><section class="panel"><div class="section-head"><h2>数据与备份</h2>${icon('download',20)}</div><p class="muted">导出当前空间的笔记、待办、账目、学习记录和附件，用于本地备份。</p><button class="btn full" data-action="export">${icon('download',17)} 导出完整备份</button><button class="btn full" data-action="import">${icon('upload',17)} 导入备份</button><p class="small muted">导入只补充缺少的记录，不覆盖已有内容。清除浏览器数据会同时清除本地资料。</p></section></div></div>`;
  const recoveryKeys=cloudClient?[]:Object.keys(workspaceStorage).filter(k=>k.startsWith(`czb-yuzhou-recovery-${mode}-`));
  if(recoveryKeys.length){const recoveryButton=document.createElement('button');recoveryButton.className='btn full';recoveryButton.textContent=`查看窗口冲突恢复副本（${recoveryKeys.length}）`;ctx.root.querySelector('[data-action=import]').after(recoveryButton);recoveryButton.onclick=()=>{modal({title:'窗口改动恢复副本',body:'<p class="muted">这些记录因另一窗口有新内容而未覆盖保存。可以导出后，通过导入功能补充到当前空间。</p><div id="recovery-list" class="stack" style="margin-top:20px"></div>'});const list=dialog.querySelector('#recovery-list');for(const key of recoveryKeys){try{const data=JSON.parse(workspaceStorage.getItem(key));const b=document.createElement('button');b.className='btn';b.textContent=`导出 ${new Date(data.updatedAt).toLocaleString('zh-CN')} 的副本`;b.onclick=()=>exportBackup(data);list.append(b);}catch{}}};}
  ctx.root.querySelector('#profile-form').onsubmit=e=>{e.preventDefault();const data=new FormData(e.target);const name=data.get('name').trim(),major=data.get('major').trim();if(!name){toast('请填写称呼。');return;}state.profile.name=name;state.profile.major=major;save();shell();render();toast('个人资料已保存。');};
  ctx.root.querySelector('#provider').onchange=e=>{state.profile.provider=e.target.value;save();toast('模型偏好已保存，等待服务端连接。');};
  if(cloudClient)renderCloudSettings();
  ctx.root.onclick=async e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;if(a==='export')await exportBackup();if(a==='import')importBackup();if(a==='paste-message'){captureDialog();dialog.querySelector('[name=category]').value='消息摘录';}};
}
async function exportBackup(dataState=state){
  try{
    toast('正在打包当前空间与附件…');
    const fileIds=new Set();function scan(value){if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value)){if(typeof v==='string'&&/blobId|fileId|audioId/i.test(k))fileIds.add(v);else if(typeof v==='object')scan(v);}}}scan(dataState);
    const files=[];for(const id of fileIds){const blob=await getFile(id);if(!blob)throw new Error('有附件在本机存储中缺失，请重新添加原件后再导出完整备份。');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});files.push({id,type:blob.type,data});}
    const backupBlob=new Blob([JSON.stringify({format:'lumi-backup',version:1,exportedAt:new Date().toISOString(),state:dataState,files},null,2)],{type:'application/json'});
    if(backupBlob.size>512*1024*1024)throw new Error('完整备份超过本地界面版 512 MB 上限，请先逐份下载附件，并在服务器接入后使用云端备份。');
    download(backupBlob,`宇宙-工作台-备份-${today()}.json`);toast('备份已导出，附件已一并打包。');
  }catch(error){toast(`导出失败：${error.message}`);}
}
function importBackup(){
  modal({title:'导入宇宙备份',body:'<p class="muted">导入到当前空间，补充缺少的课程、笔记、记录与未设置的计划。已有文字会保留，内容不同的英语草稿会另存到收集箱。单份备份上限 512 MB。</p><label class="field">备份文件<input type="file" name="file" accept=".json,application/json" required></label>',submitLabel:'导入数据',onSubmit:async data=>{
    const file=data.get('file');if(!file?.size||file.size>512*1024*1024)throw new Error('请选择小于 512 MB 的宇宙 JSON 备份。');
    let backup;try{backup=JSON.parse(await file.text());}catch{throw new Error('文件不是有效的 JSON 备份。');}
    backup=validateBackup(backup);
    const refs=new Set();function collect(value){if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){if(typeof v==='string'&&/blobId|fileId|audioId/i.test(k))refs.add(v);else if(typeof v==='object')collect(v);}}collect(backup.state);
    const available=new Set(backup.files.map(f=>f.id));for(const id of refs)if(!available.has(id)&&!await getFile(id))throw new Error('备份缺少附件原件，无法完整恢复，请选择完整备份。');
    for(const file of backup.files){if(!await getFile(file.id)){const raw=atob(file.data.slice(file.data.indexOf(',')+1));await putFile(new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:file.type}),file.id);}}
    const merged=mergeBackup(state,backup);Object.assign(state,merged.state);
    save();render();toast(`已补充 ${merged.count} 条记录，已有内容保持原样。`);
  }});
}

function searchDialog(){
  modal({title:'搜索你的空间',body:`<label class="search-field">${icon('search',20)}<input type="search" id="global-search" autocomplete="off" placeholder="试试课程名、笔记里的词，或一件待办…" aria-label="搜索内容"></label><div id="search-results"><p class="search-hint">输入关键词，找到散落在各处的积累。</p></div>`});
  const input=dialog.querySelector('#global-search');
  const items=[...state.spaces.filter(s=>!s.archived).flatMap(s=>[{title:s.title,desc:'工作区',text:s.description,route:'space',id:s.id},...s.notes.filter(n=>!n.archived).map(n=>({title:n.title,desc:s.title,text:n.content,route:'space',id:s.id}))]),...state.courses.filter(c=>!c.archived).map(c=>({title:c.title,desc:'课程空间',route:'courses',id:c.id})),...state.courses.filter(c=>!c.archived).flatMap(c=>(c.notes||[]).filter(n=>!n.archived).map(n=>({title:n.title||'课程笔记',desc:c.title,text:n.content||n.body||'',route:'courses',id:c.id}))),...state.tasks.filter(t=>!t.archived).map(t=>({title:t.title,desc:'备忘与待办',route:'tasks',taskId:t.id})),...state.captures.filter(c=>!c.archived).map(c=>({title:c.text.slice(0,120),desc:'收集箱',route:'inbox',captureId:c.id}))];
  items.push(...(state.competitions?.items||[]).filter(c=>!c.archived).map(c=>({title:c.title,desc:'比赛',text:[c.organizer,c.category,c.team,c.requirements,c.notes].join(' '),route:'competitions',id:c.id})));
  input.oninput=()=>{const q=input.value.trim().toLocaleLowerCase();const results=q?items.filter(x=>(x.title+' '+x.text+' '+x.desc).toLocaleLowerCase().includes(q)).slice(0,30):[];dialog.querySelector('#search-results').innerHTML=results.length?results.map((x,i)=>`<button class="search-result" data-result="${i}"><span class="search-result-icon">${icon(x.route==='courses'?'book':x.route==='tasks'?'check-circle':'inbox',19)}</span><span><strong>${esc(x.title)}</strong><small>${esc(x.desc)}</small></span>${icon('arrow-right',17)}</button>`).join(''):`<p class="search-hint">${q?'没有找到匹配内容，试试另一个关键词。':'输入关键词，找到散落在各处的积累。'}</p>`;dialog.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>{const x=results[+b.dataset.result];closeModal();if(x.taskId)taskDialog(x.taskId);else if(x.captureId)captureDialog(x.captureId);else go(x.route,x.id);});};
}
function closeAssistant(){document.querySelector('#ai-drawer').hidden=true;document.querySelector('#app').inert=false;}
function assistant(){openCompanion(makeContext(),{pageLabel:route==='space'?state.spaces.find(s=>s.id===subroute)?.title||'自建空间':navigationLabel(route)});}
function moreMenu(){modal({title:'我的空间',body:`<div class="more-menu">${[...visibleNavigation(),['settings','settings','偏好与连接']].map(([id,i,l])=>`<button data-go="${id}">${icon(i,23)}<span>${esc(l)}</span>${icon('chevron-right',18)}</button>`).join('')}</div>`});}
function notifications(){modal({title:'通知与动态',body:`<div class="notification-item"><span class="summary-icon violet">${icon('sparkles',23)}</span><div><strong>欢迎来到宇宙</strong><p>${cloudClient?'个人空间已连接，当前仅供本机访问。':'完整界面已就绪，可以开始记录与整理。当前内容仅保存在本机；AI 需独立配置。'}</p><small>界面版本 ${VERSION}</small></div></div><div class="notification-item"><span class="summary-icon cyan">${icon('cloud',23)}</span><div><strong>${cloudClient?esc(cloudClient.label):'云端连接待完成'}</strong><p>${cloudClient?'在偏好与连接中管理 DeepSeek、查看同步状态与导出备份。':'服务器部署后，可启用跨设备同步、模型任务和版本更新通知。'}</p><button class="text-btn" data-go="settings">查看连接状态 ${icon('arrow-right',16)}</button></div></div>`});}
function renderReturnNavigation(){
  document.querySelector('[data-return-navigation]')?.remove();
  if(route==='welcome')return;
  const target=returnNavigation.target(state,location.hash);if(target===location.hash)return;
  const navigation=document.createElement('nav');navigation.className='workspace-return';navigation.dataset.returnNavigation='';navigation.setAttribute('aria-label','返回与当前位置');
  navigation.innerHTML=`<button class="btn" type="button" data-return-source>${icon('arrow-left',17)} 返回${esc(routeLabel(state,target))}</button><span>${esc(routeLabel(state,location.hash))}</span>`;
  navigation.querySelector('button').onclick=()=>{const next=returnNavigation.back(state,location.hash);if(next===location.hash)render();else location.hash=next;};ctx.root.before(navigation);
}
function render(){
  if(!ctx.root)return;
  sidebarResize?.sync();
  cleanupView?.();cleanupView=null;
  const entryHash=resolveEntryHash(location.hash);
  if(entryHash!==location.hash)history.replaceState(history.state,'',entryHash);
  const parsedRoute=parseWorkspaceRoute(location.hash)||{page:'home',id:'',detail:'',item:''};
  const {page,id}=parsedRoute;routeDetail=parsedRoute.detail;routeItem=parsedRoute.item;
  route=nav.some(n=>n[0]===page)||['welcome','settings','space','block'].includes(page)?page:'home';
  subroute=id||'';
  ctx.root.onclick=null;ctx.root.onchange=null;ctx.root.oninput=null;ctx.root.ondragover=null;ctx.root.ondragleave=null;ctx.root.ondrop=null;
  if(route==='home'&&!getWorkbench(state).onboardingComplete){route='builder';history.replaceState(null,'','#/builder');}
  returnNavigation.visit(location.hash);
  const label=route==='space'?(state.spaces.find(s=>s.id===subroute)?.title||'工作区'):route==='block'?(getCustomBlocks(state).items.find(block=>block.id===subroute)?.title||'自定义方块'):navigationLabel(route);
  document.title=label+' · 宇宙';document.querySelector('#current-page').textContent=label;
  document.body.classList.toggle('on-canvas',route==='home');document.body.classList.toggle('on-ai',route==='ai');document.body.classList.toggle('on-welcome',route==='welcome');
  document.querySelectorAll('[data-nav]').forEach(a=>{a.classList.toggle('active',a.dataset.nav===route);if(a.dataset.nav===route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  ctx.state=state;const view=makeContext();ctx.save=view.save;
  renderReturnNavigation();
  updateModuleNavigation();
  const sourceRoute=parseWorkspaceRoute(returnNavigation.target(state,location.hash)),sourceSpace=sourceRoute&&['space','builder'].includes(sourceRoute.page)?state.spaces.find(space=>space.id===sourceRoute.id):null;
  const sharedModule=sourceSpace&&getSpaceWorkbench(sourceSpace).modules.includes(route);
  const hiddenModule=WORKBENCH_MODULES.find(item=>item.id===route)&&!getVisibleModules(state).some(item=>item.id===route)&&!sharedModule;
  if(hiddenModule){
    ctx.root.innerHTML=empty('这个模块已收起','已有资料完整保留。重新加入工作台后可继续使用。','<button class="btn primary" data-enable-hidden>重新加入工作台</button><button class="btn" data-go="builder">选择其他模块</button>');
    ctx.root.querySelector('[data-enable-hidden]').onclick=()=>{
      const previous=state.workbench;try{configureWorkbench(state,{moduleId:route,enabled:true});save();render();}catch(error){state.workbench=previous;toast(error.message);}
    };
    cloudEditing=false;cloudDirtyFields.clear();if(cloudClient)updateCloudShell();return;
  }
  if(route==='welcome')cleanupView=mountWelcome(view);
  if(route==='builder')cleanupView=subroute?mountSpaceBuilder(view,subroute):mountBuilder(view);
  if(route==='home'){ensureCanvas(state);cleanupView=mountCanvas({...view,fitOnMount:subroute==='layout'});if(subroute==='layout')history.replaceState(null,'','#/home');}
  if(route==='ai')cleanupView=mountAI(view,state.spaces.some(s=>s.id===subroute)?`space:${subroute}`:subroute);
  if(route==='space')cleanupView=mountSpace(view,subroute);
  if(route==='block')cleanupView=mountCustomBlockPage(view,subroute);
  if(route==='courses')cleanupView=mountCourses(view,subroute);
  if(route==='english')cleanupView=mountEnglish(view,subroute);
  if(route==='ledger')cleanupView=mountLedger(view,subroute);
  if(route==='calendar')cleanupView=mountCalendar(view);
  if(route==='timetable')cleanupView=mountTimetable(view);
  if(route==='competitions')cleanupView=mountCompetitions(view,subroute);
  if(route==='tasks')renderTasks();if(route==='inbox')renderInbox();if(route==='review')renderReview();if(route==='settings')renderSettings();
  if(!['welcome','home','builder'].includes(route)&&!matchMedia('(prefers-reduced-motion: reduce)').matches)ctx.root.animate([{opacity:0,transform:'translateY(15px) scale(.985)'},{opacity:1,transform:'none'}],{duration:350,easing:'cubic-bezier(.22,1,.36,1)'});
  cloudEditing=false;cloudDirtyFields.clear();
  if(cloudClient)updateCloudShell();
}
function setSidebarExpanded(expanded){
  const previous=state.ui.sidebarPinned,updatedAt=state.updatedAt;state.ui.sidebarPinned=expanded;
  try{save();}catch(error){state.ui.sidebarPinned=previous;state.updatedAt=updatedAt;sidebarResize?.sync();throw error;}
  sidebarResize?.sync({animate:true});
}
document.addEventListener('click',createSidebarNavigation({
  navigate:href=>{closeAssistant();setMobileNav(false);if(location.hash===href)render();else location.hash=href;},
  togglePinned:()=>setSidebarExpanded(!state.ui.sidebarPinned),
  isMobile:()=>matchMedia('(max-width:760px)').matches,
}));
function setMobileNav(open){
  const wasOpen=document.body.classList.contains('rail-open');
  document.body.classList.toggle('rail-open',open);document.querySelector('.rail-scrim').hidden=!open;
  document.querySelectorAll('[data-action=toggle-nav]').forEach(b=>b.setAttribute('aria-expanded',String(open)));
  syncNavigationState();
  if(open)document.querySelector('.sidebar .brand')?.focus();
  else if(wasOpen)document.querySelector('.mobile-menu')?.focus();
}
function syncNavigationState(){
  const mobile=matchMedia('(max-width:760px)').matches,open=mobile&&document.body.classList.contains('rail-open');
  const sidebar=document.querySelector('.sidebar');if(sidebar)sidebar.inert=mobile&&!open;
  for(const selector of ['.app-main','.bottom-nav','.assistant-fab']){const element=document.querySelector(selector);if(element)element.inert=open;}
  const scrim=document.querySelector('.rail-scrim');if(scrim)scrim.hidden=!open;
}
matchMedia('(max-width:760px)').addEventListener('change',()=>{document.body.classList.remove('rail-open');syncNavigationState();});
document.addEventListener('keydown',event=>{
  if(event.key!=='Tab'||!document.body.classList.contains('rail-open')||dialog.open)return;
  const buttons=[...document.querySelector('.sidebar').querySelectorAll('a,button')].filter(el=>!el.disabled&&el.getBoundingClientRect().height>0);
  const first=buttons[0],last=buttons.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
});
document.addEventListener('click',e=>{
  if(e.target.closest('.skip-link')){e.preventDefault();ctx.root.focus();return;}
  const goButton=e.target.closest('[data-go]');if(goButton){if(dialog.open)closeModal();closeAssistant();go(goButton.dataset.go,goButton.dataset.sub||'');return;}
  const button=e.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action;
  if(action==='check-update')checkAppUpdate();
  if(action==='new-space')openSpaceDialog(makeContext());
  if(action==='pin-nav')setSidebarExpanded(!state.ui.sidebarPinned);
  if(action==='toggle-nav')setMobileNav(!document.body.classList.contains('rail-open'));
  if(action==='close-nav')setMobileNav(false);
  if(action==='reload-latest'){closeModal();state=load();lastStored=workspaceStorage.getItem(key(mode));baselines.set(state,lastStored);ctx.state=state;shell();render();toast('已加载最新记录，未提交的表单草稿仍然保留。');}
  if(action==='search')searchDialog();
  if(action==='notifications')notifications();
  if(action==='more')moreMenu();
  if(action==='assistant')assistant();
  if(action==='close-assistant'){closeAssistant();document.querySelector('.assistant-fab').focus();}
  if(action==='assistant-note'){closeAssistant();captureDialog();}
});
document.addEventListener('keydown',e=>{if(e.defaultPrevented)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(document.querySelector('dialog[open]'))return;closeAssistant();searchDialog();}if(e.key==='Escape'){if(dialog.open||document.querySelector('[data-dream-detail-open],.surface-is-fullscreen'))return;closeAssistant();setMobileNav(false);}const drawer=document.querySelector('#ai-drawer');if(e.key==='Tab'&&!drawer.hidden){const items=[...drawer.querySelectorAll('button,a,input,textarea,select')].filter(el=>!el.disabled);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
window.addEventListener('hashchange',()=>{filter='all';closeAssistant();setMobileNav(false);render();window.scrollTo({top:0,behavior:'instant'});});
window.addEventListener('storage',event=>{if(event.key===key(mode)){const banner=document.querySelector('.mode-banner');if(banner)banner.innerHTML=`${icon('refresh',15)}<span>另一个窗口已更新此空间。</span><button data-action="reload-latest">加载最新内容 ${icon('arrow-right',14)}</button>`;}});
window.addEventListener('unhandledrejection',event=>{if(event.reason?.name==='StorageConflictError')event.preventDefault();});
window.addEventListener('error',e=>{if(e.error?.name==='StorageConflictError')e.preventDefault();else console.error(e.error);});
let cloudEditing=false,cloudPointer=false,cloudActivity=0,cloudEditTick=0;
const cloudDirtyFields=new Set();
function updateCloudShell(){
  if(!cloudClient)return;
  const indicator=document.querySelector('.sync-indicator');
  if(indicator){indicator.dataset.status=cloudClient.status;indicator.innerHTML=`<span class="status-dot"></span><span>${esc(cloudClient.label)}</span>`;indicator.title=cloudClient.error||cloudClient.label;}
  const modeText=document.querySelector('.mode-banner>span');
  if(modeText)modeText.textContent='你的内容已连接本机工作台。';
  const footer=document.querySelector('.page-footer>span:last-child');if(footer)footer.textContent=`宇宙 · 基于 v${VERSION}`;
  let banner=document.querySelector('.cloud-sync-banner');
  if(!banner){banner=document.createElement('div');banner.className='cloud-sync-banner';banner.setAttribute('role','status');document.querySelector('#main')?.before(banner);}
  const status=cloudClient.status;banner.dataset.status=status;
  banner.hidden=!['remote','conflict','result','offline','storage','auth'].includes(status);
  const message=status==='remote'?'其他设备有新内容，当前输入会保留，准备好后可以加载。':cloudClient.error||'连接暂时中断，改动将留在此设备，连接恢复后继续同步。';
  banner.innerHTML=`<p>${esc(message)}</p>${['conflict','result','storage'].includes(status)?'<button type="button" data-cloud-export>导出本设备改动</button>':''}${['remote','conflict','result'].includes(status)?`<button type="button" data-cloud-load>${status==='result'?'加载本次操作结果':'加载云端内容'}</button>`:''}${status==='auth'?'<button type="button" data-cloud-login>重新登录</button>':''}${['offline','storage'].includes(status)?`<button type="button" data-cloud-retry>${status==='storage'?'重试本机保存':'重试连接'}</button>`:''}`;
  banner.querySelector('[data-cloud-export]')?.addEventListener('click',()=>exportBackup(cloudClient.pending?.state||state));
  banner.querySelector('[data-cloud-load]')?.addEventListener('click',()=>loadCloudUpdate(true));
  banner.querySelector('[data-cloud-login]')?.addEventListener('click',()=>location.reload());
  banner.querySelector('[data-cloud-retry]')?.addEventListener('click',async()=>{try{await cloudClient.storage?.retry();if(cloudClient.pending)await cloudClient.flush();else await cloudClient.poll();}catch(error){toast(error.message);}});
  const label=document.querySelector('[data-cloud-status]');if(label)label.textContent=cloudClient.label;
}
const immersiveBusy=()=>!!document.querySelector('[data-dream-detail-open],.surface-is-fullscreen');
function hasUnsavedCloudFields(){
  for(const field of cloudDirtyFields)if(!field.isConnected)cloudDirtyFields.delete(field);
  cloudEditing=cloudDirtyFields.size>0;
  return cloudEditing;
}
async function loadCloudUpdate(explicit=false){
  if(!cloudClient)return;
  if(!explicit&&immersiveBusy())return;
  if(explicit&&(hasUnsavedCloudFields()||dialog.open||['conflict','result'].includes(cloudClient.status))){
    modal({title:'加载云端最新内容',body:'<p>云端内容将替换当前显示。本设备已保存的改动会保留为恢复副本；未提交的表单请先保存，或关闭此弹窗后继续编辑。</p>',submitLabel:'保留副本并加载',onSubmit:()=>applyCloudUpdate(true)});return;
  }
  try{await applyCloudUpdate(explicit);}catch(error){toast(error.message);}
}
async function applyCloudUpdate(allowImmersive=false){
  const source=state,editTick=cloudEditTick,modalForm=dialog.open?dialog.querySelector('form'):null;
  const remote=await cloudClient.acceptRemote(()=>{
    if(state!==source||cloudEditTick!==editTick)return false;
    // The request may finish after an editor opens. Keep its captured record
    // attached to the current state until the user has finished with it.
    if(allowImmersive)return !dialog.open||dialog.querySelector('form')===modalForm;
    const focused=document.activeElement?.matches('input,textarea,select,[contenteditable]');
    return !dialog.open&&!cloudEditing&&!cloudPointer&&!focused&&!immersiveBusy();
  });
  adoptCloudState(remote);
}
function adoptCloudState(remote){
  state=initializeSpaces(remote||seed());state.mode='personal';ensureCanvas(state);
  workspaceStorage.setItem(key(mode),JSON.stringify(state));lastStored=workspaceStorage.getItem(key(mode));baselines.set(state,lastStored);ctx.state=state;
  shell();render();
}
function renderCloudSettings(){
  const modelPanel=ctx.root.querySelector('#provider').closest('.panel');
  mountModelSettings(modelPanel,cloudClient,toast);
  const panel=ctx.root.querySelector('.connection-panel');panel.classList.add('cloud-account-panel');
  panel.innerHTML=`<span class="connection-symbol">${icon('cloud',36)}</span><h2>账号与数据空间</h2><p class="cloud-account-user">账号：${esc(cloudClient.session.username)}</p><div class="connection-status"><span class="status-dot"></span><span data-cloud-status>${esc(cloudClient.label)}</span></div><p class="small muted">修改先保存在此设备，再保存到本机工作台。当前仅监听本机；未发布跨设备服务。发生冲突时，会保留本设备副本供你导出。</p><div class="device-list"><span>本机浏览器</span><span>个人资料</span><span>远程同步待部署</span></div><div class="cloud-account-actions"><button class="btn" type="button" data-cloud-sync>立即同步</button><button class="btn" type="button" data-cloud-logout>退出登录</button></div><div class="cloud-recovery-list"></div>`;
  panel.querySelector('[data-cloud-sync]').onclick=()=>cloudClient.flush().then(()=>toast('当前改动已同步。')).catch(error=>toast(error.message));
  panel.querySelector('[data-cloud-logout]').onclick=()=>cloudClient.logout().catch(error=>toast(`暂未退出：${error.message}`));
  const recoveries=cloudClient.recoveryCopies(),recoveryList=panel.querySelector('.cloud-recovery-list');
  const storageNote=document.createElement('p');storageNote.className='small muted';storageNote.textContent=`工作数据已改用大容量本地存储；${recoveries.length?`保留 ${recoveries.length} 份不同的未同步或恢复内容，可分别导出。`:'目前没有待处理的恢复副本。'}不同内容不会自动覆盖。`;recoveryList.append(storageNote);
  for(const entry of recoveries){const snapshot=entry.state,b=document.createElement('button');b.className='btn compact';b.textContent=`导出${entry.label} · ${new Date(snapshot.updatedAt).toLocaleString('zh-CN')}`;b.onclick=()=>exportBackup(snapshot);recoveryList.append(b);}
  const backupNote=ctx.root.querySelector('[data-action=import]')?.nextElementSibling;if(backupNote)backupNote.textContent='如需迁移，可导出完整备份，再在目标工作台导入。导入补充缺少的记录，并保存到本机工作台。';
  const updateNote=ctx.root.querySelector('[data-action=check-update]')?.nextElementSibling;if(updateNote)updateNote.textContent='检查服务器上的界面版本。更新后，你的云端资料会保留。';
}
if(cloudClient){
  cloudClient.subscribe(updateCloudShell);
  document.addEventListener('input',event=>{if(event.target.matches('input,textarea,select,[contenteditable]')&&!event.target.closest('[data-local-ai-draft]')&&!event.target.matches('[data-ledger-filter],[data-calendar-filter],[data-timetable-view],[data-dream-view],[data-inspiration-view],[data-fitness-date],[data-competition-filter]')){cloudDirtyFields.add(event.target);cloudEditing=true;cloudEditTick++;}});
  document.addEventListener('ai-request-added',event=>{
    const host=event.target;
    // A successful composer submission saves and clears only its own draft.
    // Other open editors, and anything typed after this event, remain protected.
    if(!host.matches?.('.ai-composer-host')||!ctx.root.contains(host)||!state.aiRequests.some(request=>request.id===event.detail?.id))return;
    if(host.querySelector('[name=instruction]')?.value)return;
    for(const field of cloudDirtyFields)if(!field.isConnected||host.contains(field))cloudDirtyFields.delete(field);
    cloudEditing=cloudDirtyFields.size>0;
  });
  document.addEventListener('pointerdown',()=>{cloudPointer=true;cloudActivity=Date.now();});
  document.addEventListener('pointerup',()=>{cloudPointer=false;cloudActivity=Date.now();});
  document.addEventListener('pointercancel',()=>{cloudPointer=false;cloudActivity=Date.now();});
  cloudClient.start(()=>{
    const focused=document.activeElement?.matches('input,textarea,select,[contenteditable]');
    if(!dialog.open&&!cloudEditing&&!cloudPointer&&!focused&&!immersiveBusy()&&Date.now()-cloudActivity>1500)loadCloudUpdate();
  });
}
shell();render();



