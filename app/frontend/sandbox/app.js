
import {createRenderers,getTodayRecords} from '../renderers.js';
import {createForms} from '../forms.js';
import {createReviewRenderer} from '../review.js';
import {icon as originalIcon} from '../src/icons.js';
import {mountCanvas} from '../src/canvas.js';
const root=document.querySelector('#app'),dialog=document.querySelector('#modal');
let canvasCleanup=null;
const storagePrefix='cu_original_workbench:';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const aliases={spark:'sparkles',text:'file',board:'columns',resources:'folder',template:'layers',chevron:'chevron-right',arrow:'arrow-right',grip:'move',history:'clock',eye:'eye',logout:'log-out',send:'arrow-right',expand:'maximize',warning:'alert-circle'};
const icon=(name,extra='')=>originalIcon(aliases[name]||name,typeof extra==='number'?extra:18).replace('<svg ', '<svg class="icon '+(typeof extra==='string'?extra:'')+'" ');
const typeLabels={text:'文本笔记',list:'记录列表',board:'看板',calendar:'日历',resources:'资料链接'};
const typeLabel=type=>typeLabels[type]||type;
let auth={},state={revision:0,workspaces:[],components:[],collections:[],records:[],assets:[]},meta={catalog:{components:[]},templates:[],history:[],model:{configured:false},officeStarter:{installed:false}},drag=null,resize=null;
const ui={route:'home',sidebarPinned:false,navOpen:false,workspaceId:'',pageId:'',arrange:false,selected:'',partner:false,preview:false,proposal:null,proposalDirty:false,message:'',messages:[],busy:'',error:'',lastReceipt:null,months:new Map(),warnings:[],previewReturn:null,historyWorkspace:'',historyStatus:''};
try{const saved=JSON.parse(localStorage.getItem(storagePrefix+'selection')||'null');if(saved){ui.workspaceId=saved.workspaceId||'';ui.pageId=saved.pageId||'';ui.route=saved.route==='workspace'?'workspace':'home';}ui.sidebarPinned=localStorage.getItem(storagePrefix+'sidebar-pinned')==='true';}catch{}
const shownState=()=>ui.preview&&ui.proposal?.previewState?ui.proposal.previewState:state;
const workspace=()=>shownState().workspaces.find(w=>w.id===ui.workspaceId&&!w.archived)||shownState().workspaces.find(w=>!w.archived);
const liveWorkspace=()=>state.workspaces.find(w=>w.id===ui.workspaceId&&!w.archived)||state.workspaces.find(w=>!w.archived);
const page=()=>workspace()?.pages.find(p=>p.id===ui.pageId)||workspace()?.pages[0];
const components=()=>shownState().components.filter(c=>c.workspaceId===workspace()?.id&&c.pageId===page()?.id&&!c.archived);
const month=id=>{if(!ui.months.has(id)){const d=new Date();ui.months.set(id,d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));}return ui.months.get(id);};
const renderers=createRenderers({esc,icon,state:shownState,preview:()=>ui.preview,month});
const reviewRenderer=createReviewRenderer({esc,icon,state:()=>state});
const forms=createForms({esc,icon,root,dialog,openDialog,toast,state:()=>state,workspace:liveWorkspace,pageId:()=>page()?.id,meta:()=>meta,typeLabel,recordLabel:renderers.label,arrange:()=>ui.arrange,run:runActions,preview:previewActions,openWorkspace,openPage});
function persistSelection(){if(ui.preview)return;try{localStorage.setItem(storagePrefix+'selection',JSON.stringify({workspaceId:ui.workspaceId,pageId:ui.pageId,route:ui.route}));}catch{}}
function openWorkspace(id){ui.route='workspace';ui.navOpen=false;ui.workspaceId=id||'';ui.pageId='';ui.selected='';persistSelection();render();}
function openPage(id){ui.route='workspace';ui.pageId=id||'';ui.selected='';persistSelection();render();}
function toast(message,bad=false){const el=document.createElement('div');el.className='toast'+(bad?' bad':'');el.textContent=message;document.querySelector('#toasts').replaceChildren(el);setTimeout(()=>el.remove(),4500);}
function openDialog(title,body){if(dialog.open)dialog.close();dialog.innerHTML=`<div class="dialog-head modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" data-action="dialog-close" aria-label="关闭">${icon('close')}</button></div><div class="dialog-body modal-body">${body}</div>`;dialog.showModal();}
async function request(path,{method='GET',body}={}){
 const res=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{...(method!=='GET'?{'X-CSRF-Token':auth.csrfToken||''}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 let result;try{result=await res.json();}catch{throw Error('工作台没有返回可读取的结果，请检查独立服务是否正在运行。');}
 if(!res.ok){const e=Error(result.error?.message||result.message||'操作未完成，请重试。');e.code=result.error?.code||result.error;e.status=res.status;if(res.status===401&&auth.authenticated)expireAuthentication();throw e;}return result;
}
function expireAuthentication(){auth={authenticated:false};state={revision:0,workspaces:[],components:[],collections:[],records:[],assets:[]};ui.proposal=null;ui.preview=false;ui.previewReturn=null;ui.selected='';ui.message='';ui.messages=[];loginView('登录已过期，请重新输入独立工作台密码。');}
function apply(result){if(result.state)state=result.state;if(result.warnings)ui.warnings=result.warnings;if(result.officeStarter)meta.officeStarter=result.officeStarter;if(result.receipt){ui.lastReceipt=result.receipt;meta.history=[result.receipt,...meta.history.filter(h=>h.id!==result.receipt.id)];}if(result.history)meta.history=result.history;if(ui.proposal&&ui.proposal.baseRevision!==state.revision)setPreview(false);}
async function refresh(){const result=await request('/api/state');state=result.state;ui.warnings=result.warnings||[];meta={catalog:result.catalog||meta.catalog,templates:result.templates||[],history:result.history||[],model:result.model||meta.model,officeStarter:result.officeStarter||{installed:false}};}
async function runActions(actions,{baseRevision=state.revision,success='已保存。',workspaceId=liveWorkspace()?.id}={}){
 if(ui.preview)throw Error('当前正在预览待核对的方案。请先返回当前画布，再手动编辑。');
 if(ui.busy)throw Error('还有一项操作正在处理，请稍候。');
 if(['workspace.create','template.import','backup.import'].includes(actions[0]?.op))workspaceId=undefined;
 if(actions[0]?.op==='workspace.archive')workspaceId=actions[0].id;
 ui.busy='save';ui.error='';render();
 try{const result=await request('/api/actions',{method:'POST',body:{baseRevision,requestId:crypto.randomUUID(),...(workspaceId?{workspaceId}:{}),actions}});apply(result);toast(success);return result;}
 catch(e){ui.error=e.message;if(['revision_conflict','stale_revision','stale_proposal'].includes(e.code)){try{await refresh();}catch{}}throw e;}
 finally{ui.busy='';render();}
}
async function operation(name,fn){if(ui.busy)return;ui.busy=name;ui.error='';render();try{await fn();}catch(e){ui.error=e.message;toast(e.message,true);if(['revision_conflict','stale_revision','stale_proposal','proposal_stale'].includes(e.code)){setPreview(false);if(ui.proposal)ui.proposalDirty=true;try{await refresh();}catch{}}if(e.status===401){auth={};loginView();}}finally{ui.busy='';if(auth.authenticated)render();}}
async function previewActions(actions,{baseRevision=state.revision,workspaceId=liveWorkspace()?.id}={}){
 if(ui.busy)throw Error('还有一项操作正在处理，请稍候。');
 if(['workspace.create','template.import','backup.import'].includes(actions[0]?.op))workspaceId=undefined;
 setPreview(false);ui.busy='preview';ui.error='';render();
 try{
  const result=await request('/api/actions/preview',{method:'POST',body:{baseRevision,requestId:crypto.randomUUID(),...(workspaceId?{workspaceId}:{}),actions}});
  if(!result.proposal?.previewState)throw Error('未取得可核对的草稿，请重新打开后再试。');
  ui.proposal={...result.proposal,origin:'manual'};ui.proposalDirty=false;ui.message='';ui.partner=true;
  meta.history=result.history||[{...ui.proposal,kind:'proposal'},...meta.history.filter(h=>h.id!==ui.proposal.id)];
  dialog.close();setPreview(true);return result;
 }catch(error){if(['stale_revision','revision_conflict'].includes(error.code)){try{await refresh();}catch{}}throw error;}
 finally{ui.busy='';render();}
}
function setPreview(value){
 if(value&&!ui.preview){ui.previewReturn={workspaceId:ui.workspaceId,pageId:ui.pageId,route:ui.route};ui.route='workspace';ui.workspaceId=ui.proposal?.workspaceId||ui.workspaceId;ui.pageId='';}
 if(!value&&ui.previewReturn){ui.workspaceId=ui.previewReturn.workspaceId;ui.pageId=ui.previewReturn.pageId;ui.route=ui.previewReturn.route;ui.previewReturn=null;}
 ui.preview=value;
 if(!value)persistSelection();
}
function workspaceSignals(w){
 const s=shownState();let today;try{today=new Intl.DateTimeFormat('sv-SE',{timeZone:w.timezone||'Asia/Shanghai'}).format(new Date());}catch{today=new Date().toLocaleDateString('sv-SE');}
 const due=getTodayRecords(s,w.id,today);
 const pending=meta.history.filter(h=>h.kind==='proposal'&&h.status==='pending'&&h.baseRevision===state.revision&&(!h.workspaceId||h.workspaceId===w.id));
 return `<div class="workspace-signals"><span>${icon('calendar')}今天 <strong>${due.length}</strong> 条事项</span><button class="text-button" data-action="history">${icon('history')}<strong>${pending.length}</strong> 份待核对</button><small>仅统计设定了状态与完成规则的记录</small></div>${warningsView(w.id)}`;
}
function warningsView(workspaceId){
 const warnings=(ui.preview?ui.proposal?.warnings||[]:ui.warnings).filter(w=>w.workspaceId===workspaceId);
 return warnings.length?`<details class="schedule-warnings"><summary>${icon('warning')}${warnings.length} 条时间安排提示<span>展开查看，不会自动改期</span></summary><div>${warnings.map(w=>`<p><span>${esc(w.message)}</span><button class="text-button" data-action="${ui.preview?'preview-record':'record-edit'}" data-id="${esc(w.recordId)}">查看记录</button></p>`).join('')}</div></details>`:'';
}
function previewRecord(id){
 const s=shownState(),r=s.records.find(r=>r.id===id),c=s.collections.find(c=>c.id===r?.collectionId);if(!r||!c)return;
 openDialog('预览中的记录',`<p class="dialog-intro">以下内容属于待核对方案，还没有写入。</p><dl class="record-preview">${c.fields.map(f=>`<div><dt>${esc(f.name)}</dt><dd>${esc(renderers.valueText(r.values[f.id],f))}</dd></div>`).join('')}</dl>${reviewRenderer.recordEvidence(r,s)}`);
}
function proposalDiff(p){return reviewRenderer.changes(p);}
// The personal workbench shell, canvas and interaction classes are retained.
// Only domain data and commands use the isolated competition instance.
const homePalette=['#AE88FF','#63E6DC','#D8F649','#FF9CCE','#9DC5FF','#FFBC7C'];
function shell(){
 const s=shownState(),w=workspace(),p=page(),inSpace=ui.route==='workspace'&&!!w;
 const nav=[['home','orbit','空间主页'],['partner-focus','sparkles','AI 伙伴'],['templates','layers','起始模板'],['module-library','columns','模块库']];
 return `<button class="rail-scrim" data-action="close-nav" aria-label="关闭导航" hidden></button>
 <aside class="sidebar ${ui.sidebarPinned?'rail-pinned':''}" aria-label="空间导航"><a href="#/home" class="brand" data-action="home" aria-label="创宇宙空间主页"><img src="./icon.svg" alt="" width="39" height="39"><span>创宇宙<small>YOUR OWN UNIVERSE</small></span></a>
 <button class="rail-pin" data-action="pin-nav" aria-label="${ui.sidebarPinned?'收起侧边栏':'展开侧边栏'}" aria-pressed="${ui.sidebarPinned}">${icon('pin',17)}<span>${ui.sidebarPinned?'收起侧边栏':'展开侧边栏'}</span></button>
 <button class="workspace-switch" data-action="home" aria-label="返回工作台主页"><span class="workspace-avatar">创</span><span><strong>我的创宇宙</strong><small>所有想法，都在这里</small></span>${icon('chevron-down',16)}</button>
 <nav class="primary-nav" aria-label="主导航">${nav.map(([action,i,label])=>`<a href="#/${action}" data-action="${action}" class="${action==='home'&&!inSpace?'active':''}" aria-label="${label}" title="${label}">${icon(i)}<span>${label}</span><b>${action==='module-library'?'5':''}</b></a>`).join('')}</nav>
 <div class="rail-spaces"><div class="rail-section-title"><span>我的工作区</span><button class="icon-btn" data-action="workspace-new" aria-label="新建工作区">${icon('plus',15)}</button></div><div id="rail-space-links">${s.workspaces.filter(item=>!item.archived).map((item,i)=>`<a href="#/space/${encodeURIComponent(item.id)}" data-action="workspace" data-id="${esc(item.id)}" class="${inSpace&&w.id===item.id?'active':''}" title="${esc(item.name)}"><span class="rail-space-dot" style="--space-color:${esc(item.preferences?.accent||homePalette[i%homePalette.length])}"></span><span>${esc(item.name)}</span></a>`).join('')}</div></div>
 <div class="sidebar-bottom"><button class="rail-new" data-action="workspace-new" aria-label="新建工作区">${icon('plus',20)}<span>新建工作区</span></button><button class="settings-link" data-action="history" aria-label="修改记录" title="修改记录">${icon('history')}<span>修改记录</span></button><a class="settings-link" href="#/settings" data-action="settings" aria-label="偏好与连接" title="偏好与连接">${icon('settings')}<span>偏好与连接</span></a><button class="profile" data-action="settings" aria-label="独立工作台设置"><span class="avatar">我</span><span><strong>我的工作台</strong><small>自由搭建 · 由你掌控</small></span></button></div></aside>
 <div class="app-main"><header class="topbar"><div class="breadcrumb"><button class="mobile-menu icon-btn" data-action="toggle-nav" aria-label="展开导航">${icon('menu')}</button><a href="#/home" data-action="home" class="desktop-label">我的创宇宙</a><span class="slash desktop-label">/</span><strong id="current-page">${inSpace?esc(w.name):'空间主页'}</strong></div><button class="search-trigger" data-action="search" aria-label="搜索所有空间">${icon('search',17)}<span>搜索所有空间…</span><kbd>Ctrl K</kbd></button><div class="topbar-actions"><button class="sync-indicator" data-action="settings"><span class="status-dot"></span><span>独立工作台已就绪</span></button><button class="icon-btn" data-action="history" aria-label="修改记录">${icon('history')}</button><button class="icon-btn" data-action="partner" aria-label="${ui.partner?'收起AI伙伴':'打开AI伙伴'}">${icon('sparkles')}</button><button class="avatar small-avatar" data-action="settings" aria-label="偏好与连接">我</button></div></header>
 <div class="mode-banner personal-banner">${icon(ui.preview?'eye':'shield',15)}<span>${ui.preview?'方案预览 · 还没有保存，确认后才会改变空间。':'创宇宙 · 在熟悉的工作台里，自由搭建属于自己的空间。'}</span><button data-action="${ui.preview?'preview-off':'workspace-new'}">${ui.preview?'返回当前内容':'新建空间'} ${icon('arrow-right',14)}</button></div>
 ${ui.error?`<div class="error-banner" role="alert">${icon('warning')}<span>${esc(ui.error)}</span><button class="icon-button" data-action="dismiss-error" aria-label="关闭提示">${icon('close')}</button></div>`:''}
 <main id="main" tabindex="-1">${inSpace?spaceView(w,p):'<div id="home-canvas"></div>'}</main><footer class="page-footer"><span>一点一滴，都是你的积累。</span><span>创宇宙 v0.2.1 · 智能沙盒工作台</span></footer></div>
 <nav class="bottom-nav" aria-label="移动导航">${[['partner-focus','sparkles','AI'],['templates','layers','模板'],['home','orbit','空间'],['history','clock','记录']].map(([action,i,label])=>`<a href="#/${action}" data-action="${action}" class="${action==='home'&&!inSpace?'active':''}">${icon(i,21)}<span>${label}</span></a>`).join('')}<button data-action="toggle-nav">${icon('menu',21)}<span>更多</span></button></nav>
 <button class="assistant-fab" data-action="partner-focus" aria-label="打开AI伙伴">${icon('sparkles',22)}<span>交给 AI</span></button>${ui.partner?partnerView():''}`;
}
function render(){
 if(!auth.authenticated)return;
 canvasCleanup?.();canvasCleanup=null;
 const w=workspace(),inSpace=ui.route==='workspace'&&!!w;
 document.body.classList.add('space-shell');document.body.classList.toggle('on-canvas',!inSpace);
 document.body.classList.toggle('cu-partner-open',ui.partner);
 document.body.classList.toggle('theme-dark',inSpace&&w.preferences?.theme==='dark');
 document.body.classList.toggle('density-compact',inSpace&&w.preferences?.density==='compact');
 document.body.style.setProperty('--workspace-accent',w?.preferences?.accent||'#7950f2');
 root.innerHTML=shell();
 if(inSpace)wireCanvas();else mountOriginalHome();
 syncNavigationState();
}
function spaceView(w,p){
 const s=shownState(),selected=s.components.find(c=>c.id===ui.selected);
 return `<section class="sp-page cu-space-page"><div class="sp-back-row"><button class="sp-back" data-action="home">${icon('arrow-left',17)}空间主页</button><span>${esc(w.name)}</span></div>
 <header class="cv-pagehead"><div class="cv-heading"><h1>${esc(p?.name||w.name)}<span class="cv-title-dot">.</span></h1><p>${ui.preview?'核对这些变化，再决定是否保存。':ui.arrange?'拖动卡片调整位置，或用方向按钮移动。':'把想做的事，安放在自己的节奏里。'}</p></div><div class="cv-head-actions"><button class="cv-button" data-action="workspace-edit">${icon('settings')}空间设置</button><button class="cv-button" data-action="mode" data-value="${ui.arrange?'use':'arrange'}" aria-pressed="${ui.arrange}" ${ui.preview?'disabled':''}>${icon('move')}${ui.arrange?'完成布置':'布置'}</button><button class="cv-button cv-create" data-action="module-library" ${ui.preview?'disabled':''}>${icon('plus')}添加模块</button></div></header>
 <nav class="sp-tabs cu-page-tabs" aria-label="空间页面">${w.pages.map(item=>`<button data-action="page" data-id="${esc(item.id)}" class="${item.id===p?.id?'active':''}">${icon('file')}${esc(item.name)}</button>`).join('')}<button data-action="page-new" aria-label="添加页面">${icon('plus')}</button><button data-action="page-edit" aria-label="重命名当前页面">${icon('more')}</button></nav>
 ${w.id===meta.officeStarter?.workspaceId?'<p class="cu-role-note"><span class="cu-example-badge">虚构示例</span>事务、人物与资料用于体验，你可以自由修改。</p>':''}
 ${ui.preview?`<div class="preview-strip">${icon('eye')}方案预览 · ${ui.proposal.diff?.length||0} 处变化<button class="text-button" data-action="preview-off">返回当前画布</button></div>`:''}
 ${workspaceSignals(w)}${selected&&ui.arrange&&!ui.preview?layoutToolbar(selected):''}
 <div class="module-grid ${ui.arrange?'is-arranging':''} ${ui.preview?'is-preview':''}" data-canvas>${components().map(componentCard).join('')}</div>
 ${!components().length?`<div class="sp-empty cu-empty-space">${icon('layers',40)}<h3>先放下第一块模块。</h3><p>笔记、列表、看板、日历和资料可以自由组合。</p><button class="btn primary" data-action="module-library">${icon('plus')}添加第一个模块</button><button class="text-btn" data-action="partner-focus">和伙伴一起搭建 ${icon('arrow')}</button></div>`:''}
 <div class="canvas-footer"><span>${components().length} 个模块 · ${ui.preview?'尚未保存的预览':'改动保存在当前独立空间'}</span><button class="text-button" data-action="workspace-edit">空间设置</button></div></section>`;
}
function originalModal({title,body,submitLabel='保存',onSubmit}){
 openDialog(title,onSubmit?`<form id="original-canvas-form">${body}<div class="modal-actions"><button class="btn" type="button" data-action="dialog-close">取消</button><button class="btn primary" type="submit">${esc(submitLabel)}</button></div></form>`:body);
 if(onSubmit){const form=dialog.querySelector('form');form.onsubmit=async event=>{event.preventDefault();try{if(await onSubmit(new FormData(form),form)!==false)dialog.close();}catch(error){toast(error.message,true);}};}
}
const officeWorkspace=()=>shownState().workspaces.find(w=>w.id===meta.officeStarter?.workspaceId);
function homeSummary(w,p){
 const s=shownState(),bindings=p?new Set(s.components.filter(c=>c.workspaceId===w.id&&c.pageId===p.id&&!c.archived).map(c=>c.binding?.collectionId).filter(Boolean)):null;
 const collections=s.collections.filter(c=>c.workspaceId===w.id&&(!bindings||bindings.has(c.id))),byId=new Map(collections.map(c=>[c.id,c]));
 const rows=s.records.filter(r=>!r.archived&&byId.has(r.collectionId)).map(record=>{const collection=byId.get(record.collectionId),binding=collection.semanticBindings||{},status=collection.fields.find(f=>f.id===binding.status);return {record,collection,title:renderers.label(record,collection),status:status?renderers.valueText(record.values[status.id],status):'',date:String(record.values[binding.dueDate||binding.start]||''),completed:!!binding.status&&!!binding.doneOptions?.length&&binding.doneOptions.includes(record.values[binding.status])};});
 const pending=rows.filter(r=>!r.completed).sort((a,b)=>a.date&&b.date?a.date.localeCompare(b.date):a.date?-1:b.date?1:0);
 return {rows,pending,modules:s.components.filter(c=>c.workspaceId===w.id&&(!p||c.pageId===p.id)&&!c.archived).length};
}
function homeItems(){
 const s=shownState(),starter=officeWorkspace(),office=starter&&!starter.archived?starter:null,spaces=s.workspaces.filter(w=>!w.archived);
 const own=spaces.map((w,i)=>({id:w.id,title:w.name,subtitle:w.pages.length+' 个页面 · '+s.components.filter(c=>c.workspaceId===w.id&&!c.archived).length+' 个模块',icon:'folder',color:w.preferences?.accent||homePalette[i%homePalette.length],workspace:w,summary:homeSummary(w)}));
 const officePages=office?office.pages.map((p,i)=>({id:'cu-office-page-'+p.id,title:p.name,subtitle:i===0?'工作待办、会议和本月进度':i===1?'分工、采购和筹备时间':'预约、运动和生活计划',icon:['check-circle','layers','coffee'][i]||'file',color:['#63E6DC','#AE88FF','#FF9CCE'][i]||'#9DC5FF',workspace:office,page:p,summary:homeSummary(office,p)})):[];
 const templates=meta.templates.filter(t=>t.id!=='office'||!starter).map((t,i)=>({id:'cu-template-'+t.id,title:t.name,subtitle:t.description,icon:t.id==='office'?'columns':t.id==='study'?'book':'layers',color:t.id==='office'?'#63E6DC':i?'#D8F649':'#AE88FF',template:t}));
 return [{id:'ai',title:'AI 伙伴',subtitle:'先聊清楚，再整理到你的空间。',icon:'sparkles',color:'#B3A0FF'},...officePages,...own,{id:'cu-create',title:'搭建新空间',subtitle:'一个名字，几块模块。由你决定工作台的样子。',icon:'plus',color:'#63E6DC'},...templates];
}
function homeShortcuts(){
 const office=officeWorkspace();
 if(!office)return meta.templates.some(t=>t.id==='office')?`<div class="cu-office-invitation"><span>${icon('columns',18)}<strong>从普通上班族开始</strong><small>工作、项目和生活 · 含虚构示例</small></span><button class="cv-button" data-action="template-create" data-id="office">预览示例工作台 ${icon('arrow-right',15)}</button></div>`:'';
 if(office.archived)return `<div class="cu-office-invitation"><span>${icon('archive',18)}<strong>普通上班族示例已归档</strong><small>原有事务和资料保留在归档中。</small></span><button class="cv-button" data-action="office-starter-open">恢复示例工作台 ${icon('undo',15)}</button></div>`;
 return `<nav class="cu-home-shortcuts" aria-label="示例工作台页面"><div><span class="cu-example-badge">虚构示例</span><strong>${esc(office.name)}</strong></div><div class="cu-shortcut-pages">${office.pages.map((p,i)=>`<button class="cv-button" data-action="home-page" data-workspace="${esc(office.id)}" data-id="${esc(p.id)}">${icon(['check-circle','layers','coffee'][i]||'file',17)}${esc(p.name)}</button>`).join('')}</div></nav>`;
}
function enterHomeCard(id){
 if(id==='ai')return document.querySelector('#home-ai-message')?.focus();
 if(id==='cu-create')return forms.workspaceCreate();
 if(id.startsWith('cu-template-'))return forms.workspaceCreate(id.slice('cu-template-'.length));
 const item=homeItems().find(item=>item.id===id);if(item?.page){ui.workspaceId=item.workspace.id;return openPage(item.page.id);}
 openWorkspace(id);
}
function mountOriginalHome(){
 let layout;try{layout=JSON.parse(localStorage.getItem(storagePrefix+'home-layout')||'null');}catch{}
 if(!layout||typeof layout!=='object')layout={};
 const items=homeItems();
 if(!Array.isArray(layout.cards)||!layout.cards.length)layout.cards=items.map((item,i)=>({id:item.id,...(i===0?{x:36,y:40,w:540,h:380}:i===1?{x:36,y:456,w:310,h:272}:i===2?{x:612,y:40,w:310,h:272}:i===3?{x:958,y:76,w:320,h:344}:{x:612+((i-4)%2)*346,y:((i-4)%2?456:348)+Math.floor((i-4)/2)*306,w:310,h:272}),color:item.color}));
 const save=()=>{try{localStorage.setItem(storagePrefix+'home-layout',JSON.stringify(layout));}catch{toast('主页排列暂时无法保存，请检查浏览器空间。',true);throw Error('主页排列保存失败');}};
 canvasCleanup=mountCanvas({root:root.querySelector('#home-canvas'),state:{spaces:[]},save,icon,esc,toast,modal:originalModal,closeModal:()=>dialog.close(),go:()=>{},createSpace:()=>forms.workspaceCreate(),enterCard:enterHomeCard,
  mountAIComposer:host=>{host.innerHTML=homeComposer();return ()=>{};}},
 {layout,items,sourceItems:items,title:'我的空间',toolbar:homeShortcuts(),createLabel:'新建空间',cardLabel:item=>item.page?'页面快捷入口':item.workspace?'我的工作区':item.id==='ai'?'AI 伙伴':item.template?'起始模板':'创建指引',footLabel:item=>item.workspace?.id===meta.officeStarter?.workspaceId?'虚构示例 · 可自由修改':item.workspace?'进入后自由搭建与调整':item.id==='ai'?'对话 → 预览 → 确认':'独立空间 · 内容由你创建',enterLabel:item=>item.id==='ai'?'写下想法':item.template?'预览模板':item.page?'进入页面':item.workspace?'进入空间':'开始搭建',
  renderCard:(_,item)=>homeCard(item),onEdit:id=>{if(shownState().workspaces.some(w=>w.id===id)){openWorkspace(id);forms.workspaceEdit();}else enterHomeCard(id);},manageLabel:'编辑空间内容'});
 root.querySelector('[data-card="ai"]')?.classList.add('cv-card-ai');
 root.querySelectorAll('[data-card]').forEach(element=>{const item=items.find(item=>item.id===element.dataset.card);element.classList.toggle('cu-content-card',!!item?.workspace);});
 save();
}
function homeCard(item){
 if(item.id==='ai')return `<div class="cv-ai-title"><span class="cv-ai-orbit" aria-hidden="true">${icon('sparkles',29)}</span><div><h2>有什么事，交给我。</h2><p>先看方案，再改变你的空间。</p></div></div><div class="cv-ai-host" data-ai-host></div>`;
 if(item.id==='cu-create')return `<div class="cv-card-copy"><span class="cv-card-kicker">YOUR OWN WORKBENCH</span><h2>工作台的样子，<br>由你决定。</h2><p>${esc(item.subtitle)}</p></div><div class="cv-custom-art" aria-hidden="true">${icon('plus',72)}</div><div class="cv-space-counts"><span>空白起步</span><span>自由组合</span></div>`;
 if(item.template)return `<div class="cv-card-copy"><span class="cv-card-kicker">${item.template.id==='office'?'含虚构示例 · 普通上班族':'START WITH A TEMPLATE'}</span><h2>${esc(item.title)}</h2><p>${esc(item.subtitle)}</p></div><div class="cv-space-counts">${item.template.components.map(type=>`<span>${icon(type,15)} ${esc(typeLabel(type))}</span>`).join('')}</div><div class="cv-custom-art" aria-hidden="true">${icon(item.icon,72)}</div>`;
 const summary=item.summary;
 return `<div class="cv-card-copy cu-home-content-copy"><span class="cv-card-kicker">${item.page?'页面快捷入口':item.workspace.id===meta.officeStarter?.workspaceId?'普通上班族 · 虚构示例':'MY OWN SPACE'}</span><h2>${esc(item.title)}</h2><p>${esc(item.subtitle)}</p></div>${summary?.pending.length?`<ul class="cu-home-records">${summary.pending.slice(0,item.page?3:2).map(row=>`<li><span>${esc(row.title)}</span><small>${esc(row.date?row.date.slice(5,10):row.status||'未定日期')}</small></li>`).join('')}</ul>`:`<p class="cu-home-record-empty">${summary?.rows.length?'这一页的事项已完成。':'进入空间，放下你的第一件事。'}</p>`}<div class="cv-space-counts cu-home-record-counts"><span>${summary?.rows.length||0} 条记录</span><span>${summary?.pending.length||0} 条待处理</span></div>`;
}
function homeComposer(){return `<form id="home-ai-form" class="ai-composer cu-home-composer"><label class="sr-only" for="home-ai-message">告诉伙伴你的想法</label><textarea id="home-ai-message" name="message" rows="3" maxlength="12000" placeholder="想搭建什么样的空间？也可以告诉我，哪些东西需要重新整理。">${esc(ui.message)}</textarea><div class="ai-compose-footer"><span>${meta.model.configured?'修改前先核对方案':'配置模型后即可一起搭建'}</span><button class="btn primary ai-send" type="submit" ${ui.busy?'disabled':''}>${icon('sparkles',15)}交给伙伴</button></div></form>${!meta.model.configured?'<button class="text-btn cu-home-connect" data-action="settings">连接创宇宙专用模型 →</button>':''}`;}
function syncNavigationState(){
 const mobile=matchMedia('(max-width:760px)').matches,open=mobile&&ui.navOpen;
 document.body.classList.toggle('rail-open',open);
 const sidebar=root.querySelector('.sidebar');if(sidebar)sidebar.inert=mobile&&!open;
 for(const selector of ['.app-main','.bottom-nav','.assistant-fab']){const element=root.querySelector(selector);if(element)element.inert=open;}
 const scrim=root.querySelector('.rail-scrim');if(scrim)scrim.hidden=!open;
 root.querySelectorAll('[data-action=toggle-nav]').forEach(button=>button.setAttribute('aria-expanded',String(open)));
}
function searchView(){
 const s=shownState(),spaces=s.workspaces.filter(w=>!w.archived);
 openDialog('搜索所有空间',`<label class="field">空间或模块<input id="workspace-search" type="search" placeholder="输入一个名字" autocomplete="off"></label><div id="workspace-search-results"></div>`);
 const input=dialog.querySelector('#workspace-search'),holder=dialog.querySelector('#workspace-search-results');
 const draw=()=>{const q=input.value.trim().toLowerCase();holder.innerHTML=spaces.filter(w=>!q||w.name.toLowerCase().includes(q)||s.components.some(c=>c.workspaceId===w.id&&!c.archived&&c.title.toLowerCase().includes(q))).map(w=>`<button class="search-result" data-action="search-space" data-id="${esc(w.id)}"><span class="search-result-icon">${icon('folder')}</span><span><strong>${esc(w.name)}</strong><small>${w.pages.length} 个页面</small></span>${icon('arrow')}</button>`).join('')||'<p class="muted">没有找到相符的空间。</p>';};input.oninput=draw;draw();input.focus();
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-action=search-space]');if(button){dialog.close();openWorkspace(button.dataset.id);}});
function componentCard(c){
 const col=shownState().collections.find(col=>col.id===c.binding?.collectionId),count=col?shownState().records.filter(r=>r.collectionId===col.id&&!r.archived).length:null;
 return `<section class="component cu-paper-module type-${esc(c.type)} ${ui.selected===c.id?'is-selected':''}" data-component="${esc(c.id)}" style="grid-column:${c.layout.x+1} / span ${c.layout.w};grid-row:${c.layout.y+1} / span ${c.layout.h};${c.props?.color?'--module-color:'+esc(c.props.color):''}"><header class="component-head"><button class="module-mark" data-action="select" data-id="${esc(c.id)}" aria-label="选中${esc(c.title)}">${icon(c.type)}</button><h2>${esc(c.title)}</h2>${count!==null?`<span class="record-count">${count}</span>`:''}<div class="component-tools">${ui.arrange?`<button class="icon-button drag-handle" draggable="true" data-drag-component="${esc(c.id)}" aria-label="拖动${esc(c.title)}">${icon('grip')}</button>`:''}<button class="icon-button" data-action="component-edit" data-id="${esc(c.id)}" aria-label="设置${esc(c.title)}" title="模块设置">${icon('more')}</button></div></header><div class="component-body">${renderers.body(c)}</div><footer class="component-foot"><span>${col?esc(col.name):c.type==='text'?'给想法一个落点':'随时回看的线索'}</span><div>${col?`<button class="text-button" data-action="collection-edit" data-id="${esc(col.id)}">字段</button><button class="text-button" data-action="record-new" data-id="${esc(c.id)}">${icon('plus')}记录</button>`:c.type==='resources'?`<button class="text-button" data-action="asset-new" data-id="${esc(c.id)}">${icon('plus')}资料</button>`:`<button class="text-button" data-action="note-edit" data-id="${esc(c.id)}">编辑笔记</button>`}</div></footer>${ui.arrange&&!ui.preview?`<button class="resize-handle" data-resize="${esc(c.id)}" aria-label="调整模块尺寸"></button>`:''}</section>`;
}
function layoutToolbar(c){return `<div class="selection-toolbar"><strong>${esc(c.title)}</strong><span>${c.layout.w} × ${c.layout.h}</span><div>${[['left','←'],['up','↑'],['down','↓'],['right','→']].map(([d,label])=>`<button class="icon-button" data-action="nudge" data-direction="${d}" data-id="${esc(c.id)}" aria-label="${{left:'左移',right:'右移',up:'上移',down:'下移'}[d]}">${label}</button>`).join('')}</div><button class="text-button" data-action="component-edit" data-id="${esc(c.id)}">位置与尺寸</button><button class="icon-button" data-action="deselect" aria-label="取消选择">${icon('close')}</button></div>`;}
function proposalFresh(){return ui.proposal&&ui.proposal.status!=='stale'&&ui.proposal.baseRevision===state.revision&&!ui.proposalDirty;}
function partnerView(){
 const p=ui.proposal,selected=state.components.find(c=>c.id===ui.selected),fresh=proposalFresh();
 return `<aside class="partner-panel" aria-label="AI伙伴"><header class="partner-head"><span class="partner-star">${icon('spark')}</span><div><strong>${p?.origin==='manual'?'变更核对':'宇宙伙伴'}</strong><small>${ui.busy==='ai'?'正在理解你的想法…':p?'有一份方案待你核对':meta.model.configured?'已配置 · '+esc(meta.model.model):'AI 尚未连接'}</small></div><button class="icon-button" data-action="partner" aria-label="收起AI伙伴">${icon('close')}</button></header><div class="partner-scroll"><div class="partner-intro"><img src="./icon.svg" width="140" height="130" alt=""><h2>一起把想法，搭起来。</h2><p>描述你想改变什么。先看预览，<br>再决定让它发生。</p></div>
 ${!meta.model.configured&&p?.origin!=='manual'?`<div class="connection-note"><span class="status-light"></span><p>还没有配置模型。你可以先手动搭建，或设置创宇宙专用连接。</p><button class="text-button" data-action="settings">配置模型 ${icon('arrow')}</button></div>`:''}
 ${ui.messages.length?`<div class="chat-messages">${ui.messages.map(m=>`<div class="chat-message ${m.role}"><span>${m.role==='user'?'你':'伙伴'}</span><p>${esc(m.text)}</p></div>`).join('')}</div>`:`<div class="prompt-starters"><button data-action="prompt-fill" data-value="帮我建立一个个人项目空间，放上目标笔记、任务看板和日历。">${icon('template')}帮我搭一个项目空间</button><button data-action="prompt-fill" data-value="根据当前空间，建议怎样安排这些模块更清楚。">${icon('move')}一起调整这个空间</button></div>`}
 ${ui.busy==='ai'?'<div class="ai-working" role="status"><span class="spinner"></span>正在读取当前空间并整理方案…</div>':''}
 ${p?`<section class="proposal-card"><div class="proposal-heading"><span>${p.origin==='manual'?'手动创建的草稿':'待核对方案'}</span><strong>${p.diff?.length||0} 处变化</strong></div>${p.explanation?`<p>${esc(p.explanation)}</p>`:''}${p.steps?.length?`<ol class="proposal-steps">${p.steps.map(step=>`<li>${esc(typeof step==='string'?step:step.description||step.title||'执行步骤')}</li>`).join('')}</ol>`:''}<div class="proposal-diff">${proposalDiff(p)}</div>${reviewRenderer.evidence(p)}${reviewRenderer.preferences(p)}${p.measurement?.executionMode==='offline_fixture'?'<p class="test-label">工程测试方案，未调用真实模型。</p>':''}${!fresh?'<p class="stale-note">空间或请求已变化，请重新生成方案后再确认。</p>':''}<button class="button secondary full" data-action="preview-toggle"${!p.previewState?' disabled':''}>${icon('eye')}${ui.preview?'返回当前画布':'在画布上预览'}</button><div class="proposal-actions"><button class="button primary" data-action="proposal-confirm"${!fresh||ui.busy?' disabled':''}>${icon('check')}确认执行</button><button class="button quiet" data-action="proposal-cancel"${ui.busy?' disabled':''}>取消</button></div></section>`:''}
 ${ui.lastReceipt?`<div class="last-receipt"><span>${icon('check')}${ui.lastReceipt.status==='undone'?'已撤销这次修改':'最近一次修改已保存'}</span>${ui.lastReceipt.status!=='undone'?`<button class="text-button" data-action="undo" data-id="${esc(ui.lastReceipt.id)}">${icon('undo')}撤销</button>`:''}</div>`:''}</div>
 <form id="ai-form" class="partner-composer">${selected?`<div class="selected-context">${icon(selected.type)}正在看「${esc(selected.title)}」<button type="button" class="icon-button" data-action="deselect" aria-label="清除选中对象">${icon('close')}</button></div>`:''}<label class="sr-only" for="ai-message">告诉伙伴你的想法</label><textarea id="ai-message" name="message" rows="3" maxlength="12000" placeholder="想在这个空间里做些什么？">${esc(ui.message)}</textarea><div><span>${meta.model.configured?'每次修改由你确认':'配置模型后即可一起搭建'}</span><button class="send-button" type="submit" aria-label="发送请求"${ui.busy?' disabled':''}>${icon('send')}</button></div></form></aside>`;
}
function loginView(error=''){if(dialog.open)dialog.close();canvasCleanup?.();canvasCleanup=null;document.body.className='space-shell';root.innerHTML=`<main id="main" class="auth-layout original-auth"><section class="auth-brand"><a class="brand" href="#"><img src="./icon.svg" width="45" height="45" alt=""><span>创宇宙<small>MAKE ROOM FOR YOU</small></span></a><div><span class="eyebrow">YOUR SPACE. YOUR WAY.</span><h1>给你的想法，<br>留一整个宇宙。</h1><p>自由组合模块，与 AI 伙伴一起，<br>搭建更适合自己的工作台。</p><img src="./icon.svg" width="200" height="190" alt=""></div><span class="auth-caption">创宇宙 · 更加个性化的智能沙盒工作台</span></section><section class="auth-form"><div><span class="eyebrow">${auth.setupRequired?'FIRST CONTACT':'WELCOME BACK'}</span><h2>${auth.setupRequired?'开启你的创宇宙':'回到自己的空间'}</h2><p>${auth.setupRequired?'为这个独立工作台设置一个密码。':'输入密码，继续你上次的想法。'}</p><form id="auth-form">${auth.setupRequired?'<label class="field">初始化口令<input type="password" name="setupCode" required autocomplete="off"><span class="small-note">请在当前创宇宙目录打开 .cu-runtime/data/setup-code.txt，复制其中口令。</span></label>':''}<label class="field">密码<input name="password" type="password" required minlength="${auth.setupRequired?'10':'1'}" autocomplete="${auth.setupRequired?'new-password':'current-password'}">${auth.setupRequired?'<span class="small-note">至少 10 位字符</span>':''}</label><p class="form-error" role="alert">${esc(error)}</p><button class="button dark full" type="submit">${auth.setupRequired?'建立工作台':'进入工作台'}${icon('arrow')}</button></form><p class="auth-note">专属于这个实例的账号、资料与模型连接。</p></div></section></main>`;}
function connectionStatus(){
 const check=meta.model.connectionCheck;
 if(!meta.model.configured)return '模型尚未配置';
 if(!check)return '已配置，尚未测试连接';
 const time=new Date(check.checkedAt).toLocaleString('zh-CN');
 return `上次测试${check.status==='passed'?'通过':'失败'} · ${check.model} · ${time}${check.measurement?.executionMode==='offline_fixture'?' · 工程注入测试，未调用真实模型':''}`;
}
function settings(){
 openDialog('连接与设置',`<div class="settings-status"><span class="status-light ${meta.model.connectionCheck?.status==='passed'?'online':''}"></span><span>${esc(connectionStatus())}</span></div><p class="dialog-intro">使用创宇宙专用 API Key。保存配置与测试连接分开；连接通过也不代表 AI 任务效果已验证。</p><form id="model-form"><label class="field">模型<select name="model">${(meta.model.models||['deepseek-flash','deepseek-v4-pro']).map(m=>`<option value="${esc(m)}"${m===meta.model.model?' selected':''}>${esc(m)}</option>`).join('')}</select></label><label class="field">API Key<input name="apiKey" type="password" ${meta.model.configured?'':'required'} autocomplete="new-password" spellcheck="false" placeholder="${meta.model.configured?'留空保留已保存的专用 Key':'输入创宇宙专用 Key'}"></label><p class="small-note">密钥只提交至当前工作台后端，不写入浏览器存储。</p><p class="form-error" role="alert"></p><button class="button primary full" type="submit">保存模型配置</button></form><div class="connection-test"><button class="button secondary full" data-action="model-test" ${!meta.model.configured?'disabled':''}>测试已保存的连接</button><p class="small-note">点击才会发送一次很小的模型请求，可能产生少量费用。不会发送你的空间内容。</p><p id="connection-test-result" role="status"></p></div><div class="dialog-divider"></div><h3 class="settings-section-title">数据与模板</h3><p class="small-note">完整备份包含空间、记录和原文资料，不含账号、会话与 API Key。恢复时选择一个源空间，另存为新空间并先核对草稿。</p><div class="settings-links"><button class="text-button" data-action="backup-export">${icon('download')}下载完整数据备份</button><button class="text-button" data-action="backup-import">${icon('upload')}从备份恢复空间</button><button class="text-button" data-action="export" ${!liveWorkspace()?'disabled':''}>导出当前空间模板</button><button class="text-button" data-action="import">导入结构模板</button></div><div class="dialog-divider"></div><div class="settings-links">${liveWorkspace()?`<button class="text-button" data-action="page-new">${icon('plus')}添加页面</button><button class="text-button" data-action="workspace-edit">${icon('settings')}空间偏好</button>`:''}<button class="text-button" data-action="archives">${icon('archive')}已归档内容</button></div><div class="dialog-divider"></div><button class="text-button" data-action="logout">${icon('logout')}退出当前工作台</button>`);
}
async function testConnection(button){
 button.disabled=true;button.textContent='正在测试已保存的连接…';
 const resultArea=dialog.querySelector('#connection-test-result');
 try{const result=await request('/api/model/test',{method:'POST',body:{}});meta.model=result.model;if(dialog.open&&resultArea?.isConnected){dialog.querySelector('.settings-status>span:last-child').textContent=connectionStatus();resultArea.textContent=result.check.status==='passed'?'连接请求已通过，尚未验证 AI 任务效果。':'连接测试失败，请检查配置。';}}
 catch(error){try{meta.model=await request('/api/model');}catch{}if(resultArea?.isConnected){resultArea.textContent=error.message;resultArea.className='form-error';dialog.querySelector('.settings-status>span:last-child').textContent=connectionStatus();}else toast(error.message,true);}
 finally{button.disabled=false;button.textContent='测试已保存的连接';render();}
}
function historyStatus(h){return h.kind==='proposal'?(h.status==='stale'||h.baseRevision!==state.revision?'stale':'pending'):h.status;}
function historyBody(){
 const statusNames={pending:'方案待核对',stale:'方案已过期',applied:'已保存的修改',undone:'已撤销'};
 const workspaces=new Map(state.workspaces.map(w=>[w.id,w.name]));
 for(const h of meta.history)for(const d of h.diff||h.changes||[])if(d.entity==='workspaces'&&(d.after||d.before))workspaces.set(d.id,d.after?.name||d.before?.name||'空间');
 const rows=meta.history.filter(h=>(!ui.historyWorkspace||h.workspaceId===ui.historyWorkspace)&&(!ui.historyStatus||historyStatus(h)===ui.historyStatus));
 return `<p class="dialog-intro">手动与 AI 的方案和回执按时间排列。展开每项可核对字段变化与原文依据。</p><div class="field-pair history-filters"><label class="field">空间<select id="history-workspace"><option value="">全部空间</option>${[...workspaces].map(([id,name])=>`<option value="${esc(id)}"${ui.historyWorkspace===id?' selected':''}>${esc(name)}</option>`).join('')}</select></label><label class="field">状态<select id="history-status"><option value="">全部状态</option>${Object.entries(statusNames).map(([id,label])=>`<option value="${id}"${ui.historyStatus===id?' selected':''}>${label}</option>`).join('')}</select></label></div><div class="history-list">${rows.map(h=>{const proposal=h.kind==='proposal',status=historyStatus(h);return `<article data-history-id="${esc(h.id)}"><header><strong>${statusNames[status]||status}</strong><time>${esc(new Date(h.createdAt).toLocaleString('zh-CN'))}</time></header><p class="history-context">${esc(workspaces.get(h.workspaceId)||'空间变更')} · ${h.origin==='manual'?'手动操作':h.measurement?'AI 方案':'手动操作'}</p>${h.message?`<p class="history-message">${esc(h.message)}</p>`:''}<details class="history-change-detail"><summary>查看 ${(h.changes||h.diff||[]).length} 处完整变化</summary>${reviewRenderer.changes(h)}${reviewRenderer.evidence(h)}${reviewRenderer.preferences(h)}</details>${proposal?`<button class="text-button" data-action="proposal-open" data-id="${esc(h.id)}">${icon('eye')}${status==='stale'?'查看过期方案':'继续核对'}</button>`:h.status==='applied'?`<button class="text-button" data-action="undo" data-id="${esc(h.id)}">${icon('undo')}撤销这次修改</button>`:''}</article>`;}).join('')||'<div class="dialog-empty">当前筛选条件下没有修改记录。</div>'}</div>`;
}
async function historyView(){
 try{const result=await request('/api/history');meta.history=result.history||[];openDialog('修改记录',historyBody());}catch(error){toast(error.message,true);}
}
const backupFiles=new WeakMap();
function importBackup(){
 openDialog('从备份恢复一个新空间',`<p class="dialog-intro">选择创宇宙的完整数据备份。系统会为副本重新分配对象 ID，原空间保留。确认前可以核对内容、引用和布局。</p><form id="backup-import-form" data-revision="${state.revision}"><label class="field">完整备份 JSON（最多 16 MiB）<input type="file" name="file" accept=".json,application/json" required></label><label class="field">要恢复的源空间<select name="sourceWorkspaceId" required disabled><option value="">请先选择文件</option></select></label><label class="field">新空间名称<input name="name" maxlength="120" required placeholder="为恢复的副本起一个名字"></label><p class="small-note" id="backup-file-summary"></p><p class="form-error" role="alert"></p><button class="button primary full" type="submit" disabled>生成恢复草稿</button></form>`);
}
async function readBackupFile(form){
 const file=form.elements.file.files[0],error=form.querySelector('.form-error'),select=form.elements.sourceWorkspaceId,button=form.querySelector('[type=submit]');
 backupFiles.delete(form);select.disabled=true;button.disabled=true;error.textContent='';
 try{if(!file||file.size>16*1024*1024)throw Error('请选择 16 MiB 以内的完整备份 JSON。');const backup=JSON.parse(await file.text());if(backup.format!=='chuang-universe-export'||backup.version!==1||!Array.isArray(backup.state?.workspaces)||!backup.state.workspaces.length)throw Error('这个文件不是包含空间的创宇宙完整备份。');
  backupFiles.set(form,backup);select.innerHTML=backup.state.workspaces.map(w=>`<option value="${esc(w.id)}">${esc(w.name)}${w.archived?'（已归档）':''}</option>`).join('');select.disabled=false;button.disabled=false;form.elements.name.value=(backup.state.workspaces[0].name+' · 恢复副本').slice(0,120);form.querySelector('#backup-file-summary').textContent=`文件包含 ${backup.state.workspaces.length} 个空间；本次只恢复你选择的一个。`;
 }catch(e){select.innerHTML='<option value="">请重新选择有效文件</option>';form.querySelector('#backup-file-summary').textContent='';error.textContent=e instanceof SyntaxError?'文件不是有效的 JSON。':e.message;}
}

function exportJson(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function importTemplate(){
 openDialog('导入空间模板',`<p class="dialog-intro">导入会先生成新空间草稿，核对后才保存，当前空间保持原样。请选择创宇宙导出的 JSON 模板。</p><form id="template-import-form"><label class="field">模板文件<input type="file" name="file" accept=".json,application/json" required></label><label class="field">新空间名称（选填）<input name="name" maxlength="120"></label><p class="form-error" role="alert"></p><button class="button primary full" type="submit">生成模板草稿</button></form>`);
}
async function simpleForm(form,fn){const b=form.querySelector('[type=submit]'),normal=b.innerHTML;b.disabled=true;b.textContent='正在处理…';form.querySelector('.form-error').textContent='';try{await fn();}catch(e){form.querySelector('.form-error').textContent=e.message;}finally{b.disabled=false;b.innerHTML=normal;}}
document.addEventListener('submit',event=>{
 const form=event.target;if(!['auth-form','model-form','ai-form','home-ai-form','template-import-form','backup-import-form'].includes(form.id))return;event.preventDefault();
 const values=Object.fromEntries(new FormData(form));
 if(form.id==='auth-form')return simpleForm(form,async()=>{auth=await request(auth.setupRequired?'/api/setup':'/api/login',{method:'POST',body:values});await refresh();render();});
 if(form.id==='model-form')return simpleForm(form,async()=>{if(!values.apiKey)delete values.apiKey;meta.model=await request('/api/model',{method:'POST',body:values});form.elements.apiKey.value='';render();settings();toast('模型配置已保存，尚未测试连接。');});
 if(form.id==='template-import-form')return simpleForm(form,async()=>{const f=form.elements.file.files[0];if(!f||f.size>4*1024*1024)throw Error('请选择 4 MiB 以内的创宇宙 JSON 模板。');let template;try{template=JSON.parse(await f.text());}catch{throw Error('文件不是有效的 JSON 模板。');}await previewActions([{op:'template.import',template,...(values.name?{name:values.name}:{})}]);});
 if(form.id==='backup-import-form')return simpleForm(form,async()=>{const backup=backupFiles.get(form);if(!backup)throw Error('请先选择有效的完整备份。');await previewActions([{op:'backup.import',backup,sourceWorkspaceId:values.sourceWorkspaceId,name:values.name}],{baseRevision:Number(form.dataset.revision)});});
 if(form.id==='ai-form'||form.id==='home-ai-form'){ui.partner=true;
  const message=values.message.trim();if(!message)return;
  if(!meta.model.configured){toast('请先配置创宇宙专用模型连接。',true);settings();return;}
  return operation('ai',async()=>{if(ui.proposal){await request('/api/proposals/cancel',{method:'POST',body:{proposalId:ui.proposal.id}});meta.history=meta.history.filter(h=>h.id!==ui.proposal.id);}setPreview(false);ui.proposal=null;ui.messages.push({role:'user',text:message});ui.message='';ui.proposalDirty=false;const result=await request('/api/ai/plan',{method:'POST',body:{baseRevision:state.revision,workspaceId:liveWorkspace()?.id,message,...(ui.selected?{selectedComponentId:ui.selected}:{})}});ui.proposal=result.proposal||null;if(ui.proposal){if(result.measurement)ui.proposal.measurement=result.measurement;meta.history=[{...ui.proposal,kind:'proposal'},...meta.history.filter(h=>h.id!==ui.proposal.id)];}ui.messages.push({role:'assistant',text:result.message||result.clarification||'已准备好方案，请先核对变化。'});});
 }
});
dialog.addEventListener('change',event=>{const target=event.target;if(target.id==='history-workspace'||target.id==='history-status'){if(target.id==='history-workspace')ui.historyWorkspace=target.value;else ui.historyStatus=target.value;dialog.querySelector('.dialog-body').innerHTML=historyBody();dialog.querySelector('#'+target.id)?.focus();}else if(target.form?.id==='backup-import-form'){if(target.name==='file')readBackupFile(target.form);if(target.name==='sourceWorkspaceId'){const backup=backupFiles.get(target.form),source=backup?.state.workspaces.find(w=>w.id===target.value);if(source)target.form.elements.name.value=(source.name+' · 恢复副本').slice(0,120);}}});
root.addEventListener('input',event=>{if(['ai-message','home-ai-message'].includes(event.target.id)){ui.message=event.target.value;if(ui.proposal&&ui.proposal.origin!=='manual'){ui.proposalDirty=true;const b=root.querySelector('[data-action=proposal-confirm]');if(b)b.disabled=true;}}});
const editingActions=new Set(['workspace-new','page-new','page-edit','workspace-edit','module-library','component-edit','note-edit','record-new','record-edit','asset-new','asset-edit','collection-edit','nudge','template-create','archives','backup-import','import','office-starter-open']);
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-action]');if(!b||b.disabled)return;event.preventDefault();const action=b.dataset.action;
 if(action==='dialog-close'){dialog.close();return;}
 if(ui.preview&&editingActions.has(action)){toast('先返回当前画布，再进行手动编辑。');return;}
 if(action==='home'){setPreview(false);ui.route='home';ui.navOpen=false;ui.selected='';persistSelection();render();}
 else if(action==='pin-nav'){ui.sidebarPinned=!ui.sidebarPinned;localStorage.setItem(storagePrefix+'sidebar-pinned',String(ui.sidebarPinned));render();}
 else if(action==='toggle-nav'){ui.navOpen=!ui.navOpen;syncNavigationState();}
 else if(action==='close-nav'){ui.navOpen=false;syncNavigationState();}
 else if(action==='search')searchView();
 else if(action==='templates')forms.workspaceCreate();
 else if(action==='office-starter-open'){const office=officeWorkspace();if(office){try{if(office.archived)await runActions([{op:'workspace.archive',id:office.id,archived:false}],{workspaceId:office.id,success:'示例工作台已恢复。'});dialog.close();openWorkspace(office.id);}catch(error){toast(error.message,true);}}}
 else if(action==='home-page'){ui.navOpen=false;ui.workspaceId=b.dataset.workspace;openPage(b.dataset.id);}
 else if(action==='workspace')openWorkspace(b.dataset.id);
 else if(action==='page')openPage(b.dataset.id);
 else if(action==='workspace-new')forms.workspaceCreate();
 else if(action==='template-create')forms.workspaceCreate(b.dataset.id);
 else if(action==='workspace-edit')forms.workspaceEdit();
 else if(action==='page-new')forms.pageEditor();
 else if(action==='page-edit')forms.pageEditor(page()?.id);
 else if(action==='module-library'){if(!liveWorkspace())forms.workspaceCreate();else{if(ui.route==='home')openWorkspace(liveWorkspace().id);forms.moduleLibrary();}}
 else if(action==='component-edit')forms.componentEditor(b.dataset.id);
 else if(action==='note-edit')forms.noteEditor(b.dataset.id);
 else if(action==='record-new')forms.recordEditor('',b.dataset.id);
 else if(action==='record-edit')forms.recordEditor(b.dataset.id);
 else if(action==='asset-new')forms.assetEditor();
 else if(action==='asset-edit')forms.assetEditor(b.dataset.id);
 else if(action==='collection-edit')forms.collectionEditor(b.dataset.id);
 else if(action==='archives')forms.archives();
 else if(action==='select'){ui.selected=ui.selected===b.dataset.id?'':b.dataset.id;render();}
 else if(action==='deselect'){ui.selected='';render();}
 else if(action==='mode'){ui.arrange=b.dataset.value==='arrange';render();}
 else if(action==='partner'){ui.partner=!ui.partner;ui.navOpen=false;render();}
 else if(action==='partner-focus'){ui.partner=true;ui.navOpen=false;render();root.querySelector('#ai-message')?.focus();}
 else if(action==='prompt-fill'){ui.message=b.dataset.value;ui.proposalDirty=!!ui.proposal&&ui.proposal.origin!=='manual';render();root.querySelector('#ai-message')?.focus();}
 else if(action==='settings')settings();
 else if(action==='model-test')await testConnection(b);
 else if(action==='backup-import')importBackup();
 else if(action==='backup-export')await operation('backup-export',async()=>{exportJson(await request('/api/export'),'创宇宙-完整备份-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');toast('完整数据备份已下载。');});
 else if(action==='history')await historyView();
 else if(action==='preview-record')previewRecord(b.dataset.id);
 else if(action==='proposal-open')await operation('open-proposal',async()=>{setPreview(false);const result=await request('/api/proposals/'+encodeURIComponent(b.dataset.id));ui.proposal=result.proposal;ui.proposalDirty=false;ui.message='';ui.partner=true;dialog.close();});
 else if(action==='dismiss-error'){ui.error='';render();}
 else if(action==='preview-toggle'){setPreview(!ui.preview);render();}
 else if(action==='preview-off'){setPreview(false);render();}
 else if(action==='proposal-cancel')await operation('cancel',async()=>{await request('/api/proposals/cancel',{method:'POST',body:{proposalId:ui.proposal.id}});meta.history=meta.history.filter(h=>h.id!==ui.proposal.id);setPreview(false);ui.proposal=null;toast('方案已取消，内容没有变化。');});
 else if(action==='proposal-confirm'){if(!proposalFresh())return;await operation('confirm',async()=>{const result=await request('/api/proposals/confirm',{method:'POST',body:{proposalId:ui.proposal.id}});const target=ui.proposal.workspaceId,manual=ui.proposal.origin==='manual';setPreview(false);apply(result);ui.proposal=null;if(target&&target!==ui.workspaceId)openWorkspace(target);if(manual)toast('草稿已保存，可从修改记录撤销。');else ui.messages.push({role:'assistant',text:'修改已保存。你可以继续调整，也可以撤销这次修改。'});});}
 else if(action==='undo')await operation('undo',async()=>{setPreview(false);apply(await request('/api/undo',{method:'POST',body:{receiptId:b.dataset.id}}));if(dialog.open)dialog.close();toast('这次修改已撤销。');});
 else if(action==='export'&&!liveWorkspace())toast('先创建一个空间，再导出模板。');
 else if(action==='export')await operation('export',async()=>{const result=await request('/api/template?workspaceId='+encodeURIComponent(liveWorkspace().id));exportJson(result,'创宇宙-模板-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');toast('空间结构已导出，模板不包含真实记录。');});
 else if(action==='import')importTemplate();
 else if(action==='logout')await operation('logout',async()=>{await request('/api/logout',{method:'POST',body:{}});auth=await request('/api/auth');state={revision:0,workspaces:[],components:[],collections:[],records:[],assets:[]};ui.proposal=null;ui.messages=[];ui.message='';loginView();});
 else if(action==='calendar-month'){const [y,m]=month(b.dataset.id).split('-').map(Number),d=new Date(y,m-1+Number(b.dataset.offset),1);ui.months.set(b.dataset.id,d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));render();}
 else if(action==='nudge'){const c=state.components.find(c=>c.id===b.dataset.id),layout={...c.layout};layout.x+=b.dataset.direction==='left'?-1:b.dataset.direction==='right'?1:0;layout.y+=b.dataset.direction==='up'?-1:b.dataset.direction==='down'?1:0;try{await runActions([{op:'component.update',id:c.id,patch:{layout}}],{success:'模块位置已保存。'});}catch(e){toast(e.message,true);}}
});
function wireCanvas(){
 const canvas=root.querySelector('[data-canvas]');if(!canvas||ui.preview)return;
 root.querySelectorAll('[data-drag-component],[data-drag-record]').forEach(el=>el.addEventListener('dragstart',event=>{
  const id=el.dataset.dragComponent||el.dataset.dragRecord;if(ui.busy){event.preventDefault();return;}
  if(el.dataset.dragComponent){const card=el.closest('.component'),rect=card.getBoundingClientRect();drag={type:'component',id,dx:event.clientX-rect.left,dy:event.clientY-rect.top};ui.selected=id;}
  else drag={type:'record',id,collectionId:el.dataset.collection};
  event.dataTransfer.setData('text/plain',id);event.dataTransfer.effectAllowed='move';el.classList.add('dragging');
 }));
 root.querySelectorAll('[data-drop-record]').forEach(col=>{
  col.addEventListener('dragover',event=>{if(drag?.type==='record'&&drag.collectionId===col.dataset.collection){event.preventDefault();col.classList.add('drop-active');}});
  col.addEventListener('dragleave',()=>col.classList.remove('drop-active'));
  col.addEventListener('drop',async event=>{if(drag?.type!=='record'||drag.collectionId!==col.dataset.collection)return;event.preventDefault();event.stopPropagation();const current=drag;drag=null;try{await runActions([{op:'record.update',id:current.id,patch:{values:{[col.dataset.field]:col.dataset.dropRecord||null}}}],{success:'记录状态已更新。'});}catch(e){toast(e.message,true);render();}});
 });
 canvas.addEventListener('dragover',event=>{if(drag?.type==='component'&&ui.arrange)event.preventDefault();});
 canvas.addEventListener('drop',async event=>{
  if(drag?.type!=='component'||!ui.arrange)return;event.preventDefault();const current=drag;drag=null;const c=state.components.find(c=>c.id===current.id),rect=canvas.getBoundingClientRect(),unit=(rect.width+16)/12;
  const layout={...c.layout,x:Math.max(0,Math.min(12-c.layout.w,Math.round((event.clientX-current.dx-rect.left)/unit))),y:Math.max(0,Math.round((event.clientY-current.dy-rect.top)/80))};
  try{await runActions([{op:'component.update',id:c.id,patch:{layout}}],{success:'模块位置已保存。'});}catch(e){toast(e.message,true);render();}
 });
 root.querySelectorAll('[data-resize]').forEach(handle=>handle.addEventListener('pointerdown',event=>{
  if(ui.busy||!ui.arrange)return;event.preventDefault();const c=state.components.find(c=>c.id===handle.dataset.resize),rect=canvas.getBoundingClientRect();resize={id:c.id,layout:{...c.layout},startX:event.clientX,startY:event.clientY,unit:(rect.width+16)/12,element:handle.closest('.component')};handle.setPointerCapture(event.pointerId);
 }));
}
document.addEventListener('pointermove',event=>{if(!resize)return;const min=['board','calendar'].includes(state.components.find(c=>c.id===resize.id).type)?4:2;resize.next={...resize.layout,w:Math.max(min,Math.min(12-resize.layout.x,resize.layout.w+Math.round((event.clientX-resize.startX)/resize.unit))),h:Math.max(min,Math.min(24,resize.layout.h+Math.round((event.clientY-resize.startY)/80)))};resize.element.style.gridColumn=(resize.layout.x+1)+' / span '+resize.next.w;resize.element.style.gridRow=(resize.layout.y+1)+' / span '+resize.next.h;resize.element.classList.add('resizing');});
document.addEventListener('pointerup',async()=>{if(!resize)return;const r=resize;resize=null;if(!r.next){render();return;}try{await runActions([{op:'component.update',id:r.id,patch:{layout:r.next}}],{success:'模块尺寸已保存。'});}catch(e){toast(e.message,true);render();}});
document.addEventListener('pointercancel',()=>{if(resize){resize=null;render();}});
document.addEventListener('dragend',()=>{drag=null;root.querySelectorAll('.dragging,.drop-active').forEach(el=>el.classList.remove('dragging','drop-active'));});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&ui.navOpen){ui.navOpen=false;syncNavigationState();return;}
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();searchView();return;}
 if(event.key==='Escape'&&ui.selected&&!dialog.open){ui.selected='';render();}
 if(event.key==='Tab'&&!dialog.open){const link=document.querySelector('.skip-link');link.style.visibility='visible';requestAnimationFrame(()=>link.style.removeProperty('visibility'));}
});
window.addEventListener('beforeunload',event=>{if(ui.busy||ui.message.trim()){event.preventDefault();event.returnValue='';}});
let lastSidebarClick={href:'',time:0};
document.addEventListener('click',event=>{
 const link=event.target.closest('.sidebar a[href^="#/"]');
 if(!link||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||matchMedia('(max-width:760px)').matches)return;
 const href=link.getAttribute('href'),now=performance.now();
 if(event.detail===2||(event.detail>0&&lastSidebarClick.href===href&&now-lastSidebarClick.time<500)){
  ui.sidebarPinned=!ui.sidebarPinned;localStorage.setItem(storagePrefix+'sidebar-pinned',String(ui.sidebarPinned));lastSidebarClick={href:'',time:0};render();
 }else lastSidebarClick={href,time:now};
});
async function boot(){try{auth=await request('/api/auth');if(!auth.authenticated){loginView();return;}await refresh();render();}catch(e){root.innerHTML=`<main id="main" class="loading-screen"><img src="./icon.svg" width="54" height="54" alt=""><h1>暂时无法打开创宇宙</h1><p>${esc(e.message)}</p><button class="button primary" id="retry">重新连接</button></main>`;document.querySelector('#retry').onclick=boot;}}
window.addEventListener('resize',syncNavigationState);
boot();

