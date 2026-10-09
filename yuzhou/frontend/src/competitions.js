import {COMPETITION_STATUSES,initializeCompetitions,validateCompetitions,validateCompetitionItem,validateCompetitionMilestone,validateCompetitionTask,deadlineStatus,nearestCompetitionDeadline,competitionProgress,summarizeCompetitions,competitionToday,createCompetitionCalendarEvent} from './competitions-model.js';
import {initializeCalendar,validateCalendar} from './calendar-model.js';
import {createColorDraft} from './creation-colors.js';
import {openAIConversation} from './ai.js';

const views=new WeakMap();
const stamp=()=>new Date().toISOString();
const safeColor=value=>/^#[\da-f]{6}$/i.test(value||'')?value:'#AE88FF';
const safeUrl=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:'';}catch{return '';}};
const dateLabel=value=>value?`${Number(value.slice(5,7))}月${Number(value.slice(8))}日`:'';

export function mountCompetitions(ctx,id=''){
  const {root,state,esc,icon}=ctx;
  initializeCompetitions(state);
  const owner=ctx.cloud||state;
  if(!views.has(owner))views.set(owner,new Map());
  const saved=views.get(owner),key=state.mode||'personal';
  if(!saved.has(key))saved.set(key,{query:'',status:'all',sort:'deadline',archived:false,details:new Map()});
  const view=saved.get(key);
  if(id&&!view.details.has(id))view.details.set(id,{milestonesArchived:false,tasksArchived:false});
  const detailView=id?view.details.get(id):null;
  const controller=new AbortController();let mounted=true,busy=false,unbindColor;
  const data=()=>state.competitions;
  const findItem=itemId=>{const item=data().items.find(value=>value.id===itemId);if(!item)throw new Error('这项比赛已不存在，请返回比赛总览。');return item;};
  const findChild=(collection,childId)=>{const child=data()[collection].find(value=>value.id===childId&&value.competitionId===id);if(!child)throw new Error('这条记录已不存在，请刷新后重试。');return child;};
  const restoreProperty=(object,name,snapshot)=>{if(snapshot.exists)object[name]=snapshot.value;else delete object[name];};
  async function commit(change,{calendar=false}={}){
    if(!mounted)throw new Error('页面已更新，请重新打开后再保存。');
    if(busy)throw new Error('上一项修改正在保存，请稍候。');
    const snapshot={competitions:structuredClone(data()),ui:{exists:Object.hasOwn(state,'ui'),value:structuredClone(state.ui)},updatedAt:{exists:Object.hasOwn(state,'updatedAt'),value:state.updatedAt},calendar:{exists:Object.hasOwn(state,'calendar'),value:calendar?structuredClone(state.calendar):undefined}};
    busy=true;
    try{change();state.competitions=validateCompetitions(data());if(calendar)state.calendar=validateCalendar(state.calendar);await ctx.save();}
    catch(error){state.competitions=snapshot.competitions;restoreProperty(state,'ui',snapshot.ui);restoreProperty(state,'updatedAt',snapshot.updatedAt);if(calendar)restoreProperty(state,'calendar',snapshot.calendar);throw error;}
    finally{busy=false;}
  }
  function bindColor(draft){unbindColor?.();unbindColor=draft?.bind(document.querySelector('#modal form'));}
  function openItem(itemId,focusField){
    const current=itemId?findItem(itemId):null,colorDraft=current?null:createColorDraft(state);
    ctx.modal({title:current?'编辑比赛':'新建比赛',submitLabel:current?'保存修改':'创建比赛',body:`<div class="competition-form"><label class="field">比赛名称<input name="title" required maxlength="120" placeholder="输入你关注或正在准备的比赛" value="${esc(current?.title||'')}"></label><div class="competition-form-grid"><label class="field">当前进度<select name="status">${Object.entries(COMPETITION_STATUSES).map(([value,label])=>`<option value="${value}" ${value===(current?.status||'watching')?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label class="field">比赛类别<input name="category" maxlength="80" placeholder="例如：软件开发、创新创业" value="${esc(current?.category||'')}"></label></div><label class="field">主办方<input name="organizer" maxlength="120" placeholder="可选" value="${esc(current?.organizer||'')}"></label><label class="field">官方链接<input name="url" type="url" maxlength="2000" placeholder="https://…" value="${esc(current?.url||'')}"></label><label class="field">材料与参赛要求<textarea name="requirements" rows="4" maxlength="12000" placeholder="参赛条件、作品格式、提交材料等">${esc(current?.requirements||'')}</textarea></label><label class="field">团队与分工<textarea name="team" rows="3" maxlength="2000" placeholder="队友、联系方式、各自负责的内容">${esc(current?.team||'')}</textarea></label><label class="field">比赛笔记<textarea name="notes" rows="3" maxlength="12000" placeholder="想法、沟通记录或需要注意的事项">${esc(current?.notes||'')}</textarea></label><label class="field competition-color-field">卡片颜色<input type="color" name="color" value="${safeColor(current?.color||colorDraft.color)}"><small>${current?'选择这项比赛的颜色':'自动配色，也可以手动选择'}</small></label></div>`,async onSubmit(form){
      let savedId=itemId;
      await commit(()=>{
        const existing=itemId?findItem(itemId):null,now=stamp();
        const item=validateCompetitionItem({...existing,id:existing?.id||ctx.uid(),title:String(form.get('title')||'').trim(),status:String(form.get('status')||'watching'),category:String(form.get('category')||'').trim(),organizer:String(form.get('organizer')||'').trim(),url:String(form.get('url')||'').trim(),requirements:String(form.get('requirements')||'').trim(),team:String(form.get('team')||'').trim(),notes:String(form.get('notes')||'').trim(),color:existing?String(form.get('color')):colorDraft.commit(String(form.get('color'))),archived:existing?.archived||false,createdAt:existing?.createdAt||now,updatedAt:now});
        savedId=item.id;if(existing)Object.assign(existing,item);else data().items.unshift(item);
      });
      ctx.toast(current?'比赛信息已更新。':'比赛已创建，接下来可以添加关键节点和准备事项。');
      if(current)render();else ctx.go('competitions',savedId);
    }});
    bindColor(colorDraft);
    if(focusField){const field=document.querySelector(`#modal [name="${focusField}"]`);setTimeout(()=>{if(field?.isConnected){field.focus();field.scrollIntoView({block:'center'});}},70);}
  }
  function openChild(collection,childId){
    const isMilestone=collection==='milestones',current=childId?findChild(collection,childId):null;
    const label=isMilestone?'关键节点':'准备事项';
    ctx.modal({title:`${current?'编辑':'添加'}${label}`,submitLabel:current?'保存修改':`添加${label}`,body:`<div class="competition-form"><label class="field">${isMilestone?'节点名称':'要做什么'}<input name="title" required maxlength="120" value="${esc(current?.title||'')}" placeholder="${isMilestone?'例如：报名截止、作品提交、现场答辩':'输入一项具体的准备工作'}" ${isMilestone?'list="competition-node-titles"':''}></label>${isMilestone?'<datalist id="competition-node-titles"><option value="报名截止"></option><option value="作品提交截止"></option><option value="答辩"></option><option value="结果公布"></option></datalist>':''}<div class="competition-form-grid"><label class="field">${isMilestone?'截止日期':'计划完成日期 · 可不填'}<input name="date" type="date" min="1900-01-01" max="9999-12-31" ${isMilestone?'required':''} value="${esc(current?.date||(isMilestone?competitionToday():''))}"></label>${isMilestone?`<label class="field">截止时刻 · 可不填<input name="time" type="time" value="${esc(current?.time||'')}"></label>`:''}</div>${isMilestone?'<p class="competition-form-hint">按北京时间记录。未填时刻时，按这一天截止，次日才显示逾期。</p>':`<label class="field">补充说明<textarea name="notes" rows="3" maxlength="4000" placeholder="要准备的内容、负责人或注意事项">${esc(current?.notes||'')}</textarea></label>`}<label class="competition-form-check"><input type="checkbox" name="done" ${current?.done?'checked':''}>${isMilestone?'这个节点已完成':'这件事已完成'}</label></div>`,async onSubmit(form){
      await commit(()=>{
        const parent=findItem(id),existing=childId?findChild(collection,childId):null,now=stamp();
        const values={...existing,id:existing?.id||ctx.uid(),competitionId:id,title:String(form.get('title')||'').trim(),date:String(form.get('date')||''),done:form.has('done'),archived:existing?.archived||false,createdAt:existing?.createdAt||now,updatedAt:now};
        const child=isMilestone?validateCompetitionMilestone({...values,time:String(form.get('time')||'')}):validateCompetitionTask({...values,notes:String(form.get('notes')||'').trim()});
        if(existing)Object.assign(existing,child);else data()[collection].push(child);
        parent.updatedAt=now;
      });
      render();ctx.toast(`${label}已${current?'更新':'添加'}。`);
    }});
  }
  async function copyToCalendar(childId){
    const parent=findItem(id),milestone=findChild('milestones',childId),eventId=`competition-${milestone.id}`;
    if(state.calendar?.events?.some(event=>event.id===eventId)){ctx.toast('这个节点已有独立日历标注，请到日历查看。');ctx.go('calendar');return;}
    await commit(()=>{initializeCalendar(state);if(!state.calendar.events.some(event=>event.id===eventId))state.calendar.events.push(createCompetitionCalendarEvent(parent,milestone));},{calendar:true});
    render();ctx.toast('已复制为独立日历标注，后续修改不会互相影响。');
  }
  async function handToAI(){
    if(!mounted)throw new Error('页面已更新，请重新打开比赛后再试。');
    if(busy)throw new Error('上一项修改正在保存，请稍候。');
    const item=findItem(id),snapshot=Object.fromEntries(['aiDraft','aiRequests','updatedAt'].map(name=>[name,{exists:Object.hasOwn(state,name),value:structuredClone(state[name])}]));
    let saving,route;busy=true;
    try{
      // The shared helper prepares a draft synchronously. Wait for its save before navigating.
      openAIConversation({...ctx,save:()=>{saving=ctx.save();return saving;},go:(...args)=>{route=args;}},{targetId:'workspace',text:`我想讨论比赛「${item.title}」（比赛 ID：${item.id}）。请先查询这项比赛现有的报名、提交、答辩节点和准备事项，再和我对话确认需要做什么。如需修改，先列出行动方案供我审核，等我点击确认后再执行。`});
      await saving;
      if(mounted&&route)ctx.go(...route);
    }catch(error){for(const [name,previous] of Object.entries(snapshot))restoreProperty(state,name,previous);throw error;}
    finally{busy=false;}
  }
  const statusLabel=item=>COMPETITION_STATUSES[item.status]||item.status;
  function stageRail(item){
    const stages=Object.entries(COMPETITION_STATUSES),current=stages.findIndex(([value])=>value===item.status);
    return `<div class="competition-stage-rail" aria-label="当前进度：${esc(statusLabel(item))}">${stages.map(([value,label],index)=>`<span class="${index<=current?'is-reached':''} ${value===item.status?'is-current':''}"><i></i><small>${esc(label)}</small></span>`).join('')}</div>`;
  }
  function card(item){
    const deadline=nearestCompetitionDeadline(data(),item.id),timing=deadline?deadlineStatus(deadline):null,progress=competitionProgress(data(),item.id);
    return `<article class="competition-card ${item.archived?'is-archived':''}" data-competition-card="${esc(item.id)}" style="--competition-accent:${safeColor(item.color)}"><button class="competition-card-main" type="button" data-competition="open" data-id="${esc(item.id)}"><span class="competition-card-top"><span>${esc(item.category||'未分类比赛')}</span>${icon('arrow-right',17)}</span><h2>${esc(item.title)}</h2><p class="competition-organizer">${esc(item.organizer||'未填写主办方')}</p>${stageRail(item)}<span class="competition-deadline-ticket ${timing?'is-'+timing.state:'is-empty'}">${deadline?`<span class="competition-date-stub"><strong>${esc(deadline.date.slice(5).replace('-','.'))}</strong><small>${esc(deadline.time||'当日截止')}</small></span><span class="competition-next"><small>${esc(timing.label)}</small><strong>${esc(deadline.title)}</strong><time datetime="${esc(deadline.date+(deadline.time?'T'+deadline.time+':00+08:00':''))}">${esc(deadline.date.slice(0,4))} · 北京时间</time></span>`:`<span class="competition-date-stub">${icon('flag',23)}</span><span class="competition-next"><strong>还没有关键节点</strong><small>添加报名、提交或答辩时间</small></span>`}</span></button><footer class="competition-card-foot"><div class="competition-card-progress"><span>准备事项 <b>${progress.done} / ${progress.total}</b></span><div role="progressbar" aria-label="准备完成比例" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><i style="width:${progress.percent}%"></i></div></div><button type="button" class="icon-btn" data-competition="edit" data-id="${esc(item.id)}" aria-label="编辑${esc(item.title)}" title="编辑比赛">${icon('edit',16)}</button><button type="button" class="icon-btn" data-competition="archive" data-id="${esc(item.id)}" aria-label="${item.archived?'恢复':'归档'}${esc(item.title)}" title="${item.archived?'恢复':'归档'}比赛">${icon(item.archived?'refresh':'archive',16)}</button></footer></article>`;
  }
  function selectedItems(){
    const query=view.query.trim().toLocaleLowerCase();
    return data().items.filter(item=>Boolean(item.archived)===view.archived&&(view.status==='all'||item.status===view.status)&&(!query||[item.title,item.organizer,item.category,item.team,item.requirements,item.notes].some(value=>String(value||'').toLocaleLowerCase().includes(query)))).sort((a,b)=>{
      if(view.sort==='title')return a.title.localeCompare(b.title,'zh-CN');
      if(view.sort==='updated')return b.updatedAt.localeCompare(a.updatedAt);
      const nextA=nearestCompetitionDeadline(data(),a.id),nextB=nearestCompetitionDeadline(data(),b.id),timeA=nextA?deadlineStatus(nextA).sortAt:Infinity,timeB=nextB?deadlineStatus(nextB).sortAt:Infinity;
      return timeA-timeB||b.updatedAt.localeCompare(a.updatedAt);
    });
  }
  function drawCards(){
    if(!mounted)return;const grid=root.querySelector('[data-competition-grid]');if(!grid)return;
    const items=selectedItems();root.querySelector('[data-competition-count]').textContent=`${view.archived?'已归档':'比赛'} · ${items.length}`;
    grid.innerHTML=items.length?items.map(card).join(''):`<div class="competition-empty"><span>${icon(view.archived?'archive':'flag',33)}</span><h2>${view.archived?'还没有符合条件的归档比赛':view.query||view.status!=='all'?'没有找到符合条件的比赛':'从一项比赛开始'}</h2><p>${view.archived?'归档的比赛和准备记录会保留在这里。':view.query||view.status!=='all'?'试试其他关键词，或切换到全部进度。':'记下比赛信息，再安排报名、作品提交和答辩节点。'}</p>${!view.archived&&!view.query&&view.status==='all'?'<button type="button" class="btn primary" data-competition="new">新建比赛</button>':''}</div>`;
  }
  function overview(){
    const summary=summarizeCompetitions(data());
    root.innerHTML=`<section class="competitions-page"><header class="competition-heading"><div><h1>比赛<span>✦</span></h1><p>关注、准备、提交，每一步都有位置。</p></div><button type="button" class="btn primary" data-competition="new">${icon('plus',17)}新建比赛</button></header><div class="competition-pulse" aria-label="比赛概况"><span><i style="background:#AE88FF"></i>进行中 <b>${summary.active}</b></span><span><i style="background:#FFBC7C"></i>7 天内节点 <b>${summary.upcoming}</b></span><span class="${summary.overdue?'has-overdue':''}"><i style="background:#FF9CCE"></i>已逾期 <b>${summary.overdue}</b></span><span><i style="background:#63E6DC"></i>待准备 <b>${summary.unfinishedTasks}</b></span></div><div class="competition-toolbar"><label class="competition-search">${icon('search',17)}<input type="search" data-competition-filter="query" aria-label="搜索比赛" maxlength="200" placeholder="搜索比赛、团队或材料…" value="${esc(view.query)}"></label><label class="competition-filter"><span class="sr-only">筛选比赛进度</span><select data-competition-filter="status" aria-label="筛选比赛进度"><option value="all">全部进度</option>${Object.entries(COMPETITION_STATUSES).map(([value,label])=>`<option value="${value}" ${view.status===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label class="competition-filter"><span class="sr-only">比赛排序</span><select data-competition-filter="sort" aria-label="比赛排序">${[['deadline','临近截止优先'],['updated','最近更新'],['title','名称排序']].map(([value,label])=>`<option value="${value}" ${view.sort===value?'selected':''}>${label}</option>`).join('')}</select></label></div><div class="competition-list-heading"><span data-competition-count></span><button class="btn compact" type="button" data-competition="show-archived" aria-pressed="${view.archived}">${icon('archive',14)}${view.archived?'返回未归档':'已归档'}</button></div><div class="competition-grid" data-competition-grid></div></section>`;
    drawCards();
  }
  function childControls(collection,entry){return `<div class="competition-child-actions">${collection==='milestones'&&!entry.archived?`<button class="icon-btn" type="button" data-competition="calendar" data-id="${esc(entry.id)}" title="${state.calendar?.events?.some(event=>event.id===`competition-${entry.id}`)?'打开已有日历标注':'复制为独立日历标注'}" aria-label="${state.calendar?.events?.some(event=>event.id===`competition-${entry.id}`)?'打开已有日历标注':'复制为独立日历标注'}：${esc(entry.title)}">${icon('calendar',16)}</button>`:''}<button class="icon-btn" type="button" data-competition="edit-child" data-collection="${collection}" data-id="${esc(entry.id)}" title="编辑${collection==='milestones'?'节点':'事项'}" aria-label="编辑${esc(entry.title)}">${icon('edit',16)}</button><button class="icon-btn" type="button" data-competition="archive-child" data-collection="${collection}" data-id="${esc(entry.id)}" title="${entry.archived?'恢复':'归档'}" aria-label="${entry.archived?'恢复':'归档'}${esc(entry.title)}">${icon(entry.archived?'refresh':'archive',16)}</button></div>`;}
  function milestoneRow(entry){
    const timing=deadlineStatus(entry);
    return `<article class="competition-milestone ${entry.done?'is-done':''} ${entry.archived?'is-archived':''}" data-competition-milestone="${esc(entry.id)}"><div class="competition-milestone-date"><strong>${esc(dateLabel(entry.date))}</strong><time datetime="${esc(entry.date)}">${esc(entry.date.slice(0,4))}</time><span>${esc(entry.time||'当日截止')}</span></div><div class="competition-child-body"><label class="competition-check"><input type="checkbox" data-competition-toggle="milestones" data-id="${esc(entry.id)}" ${entry.done?'checked':''} ${entry.archived?'disabled':''}><strong>${esc(entry.title)}</strong></label><span class="competition-due is-${timing.state}">${entry.archived?'已归档':esc(timing.label)}</span></div>${childControls('milestones',entry)}</article>`;
  }
  function taskRow(entry){
    const overdue=!entry.done&&entry.date&&entry.date<competitionToday();
    return `<article class="competition-task ${entry.done?'is-done':''} ${entry.archived?'is-archived':''}" data-competition-task="${esc(entry.id)}"><div class="competition-child-body"><label class="competition-check"><input type="checkbox" data-competition-toggle="tasks" data-id="${esc(entry.id)}" ${entry.done?'checked':''} ${entry.archived?'disabled':''}><strong>${esc(entry.title)}</strong></label>${entry.date?`<time class="competition-task-date ${overdue?'is-overdue':''}" datetime="${esc(entry.date)}">${icon('calendar',12)}${esc(entry.date)}${overdue?' · 已逾期':''}</time>`:''}${entry.notes?`<p>${esc(entry.notes)}</p>`:''}</div>${childControls('tasks',entry)}</article>`;
  }
  function textPanel(field,title,iconName,color,empty){
    const item=findItem(id);
    return `<section class="competition-panel competition-text-panel" style="--panel-accent:${color}"><header class="competition-panel-heading"><h2>${icon(iconName,18)}${title}</h2><button class="icon-btn" type="button" data-competition="edit-text" data-field="${field}" aria-label="编辑${title}" title="编辑${title}">${icon('edit',16)}</button></header>${item[field]?`<div class="competition-text">${esc(item[field])}</div>`:`<button class="competition-text-empty" type="button" data-competition="edit-text" data-field="${field}">${icon('plus',15)}${empty}</button>`}</section>`;
  }
  function detail(){
    const item=findItem(id),progress=competitionProgress(data(),id),milestones=data().milestones.filter(entry=>entry.competitionId===id&&Boolean(entry.archived)===detailView.milestonesArchived).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'23:59').localeCompare(b.time||'23:59')),tasks=data().tasks.filter(entry=>entry.competitionId===id&&Boolean(entry.archived)===detailView.tasksArchived).sort((a,b)=>Number(a.done)-Number(b.done)||(a.date||'9999-12-31').localeCompare(b.date||'9999-12-31')||a.createdAt.localeCompare(b.createdAt)),url=safeUrl(item.url);
    root.innerHTML=`<section class="competitions-page competition-detail" style="--competition-accent:${safeColor(item.color)}"><div class="competition-back-row"><button type="button" class="competition-back" data-competition="back">${icon('arrow-left',16)}全部比赛</button><span>${item.archived?'已归档 · 记录仍保留':'比赛工作区'}</span></div><header class="competition-detail-heading"><div class="competition-detail-name"><span class="competition-detail-mark">${icon('flag',25)}</span><div><span class="competition-category">${esc(item.category||'未分类比赛')}</span><h1>${esc(item.title)}</h1><p>${esc(item.organizer||'主办方待补充')}${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('link',13)}官方链接</a>`:''}</p></div></div><div class="competition-detail-actions"><label><span class="sr-only">当前比赛进度</span><select data-competition-status aria-label="当前比赛进度">${Object.entries(COMPETITION_STATUSES).map(([value,label])=>`<option value="${value}" ${item.status===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label><button type="button" class="btn compact competition-ai-entry" data-competition="ai">${icon('sparkles',14)}交给 AI</button><button type="button" class="icon-btn" data-competition="edit" data-id="${esc(id)}" aria-label="编辑比赛" title="编辑比赛">${icon('edit',17)}</button><button type="button" class="icon-btn" data-competition="archive" data-id="${esc(id)}" aria-label="${item.archived?'恢复':'归档'}比赛" title="${item.archived?'恢复':'归档'}比赛">${icon(item.archived?'refresh':'archive',17)}</button></div></header><div class="competition-detail-layout"><section class="competition-panel competition-milestones-panel" style="--panel-accent:#AE88FF"><header class="competition-panel-heading"><h2>${icon('flag',18)}关键节点 <small>${milestones.length}</small></h2><button type="button" class="btn compact" data-competition="new-child" data-collection="milestones">${icon('plus',14)}添加节点</button></header><div class="competition-panel-subhead"><span>北京时间 · ${detailView.milestonesArchived?'已归档节点':'按截止日期排列'}</span><button type="button" data-competition="show-children-archived" data-collection="milestones" aria-pressed="${detailView.milestonesArchived}">${detailView.milestonesArchived?'返回正常':'已归档'}</button></div><div class="competition-milestone-list">${milestones.length?milestones.map(milestoneRow).join(''):`<div class="competition-section-empty">${detailView.milestonesArchived?'没有已归档的节点。':'报名、作品提交、答辩，分别添加一个截止节点。'}</div>`}</div><p class="competition-calendar-hint">${icon('calendar',13)}带日期的节点和准备事项会自动显示在日历，并随原记录更新。右侧日历按钮可另建独立标注，后续修改互不影响。</p></section><section class="competition-panel competition-tasks-panel" style="--panel-accent:#D8F649"><header class="competition-panel-heading"><h2>${icon('check-circle',18)}准备事项 <small>${progress.done}/${progress.total}</small></h2><button type="button" class="btn compact" data-competition="new-child" data-collection="tasks">${icon('plus',14)}添加事项</button></header><div class="competition-task-progress" role="progressbar" aria-label="准备事项完成比例" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><i style="width:${progress.percent}%"></i></div><div class="competition-panel-subhead"><span>${detailView.tasksArchived?'已归档事项':`${progress.total?progress.percent:0}% 完成`}</span><button type="button" data-competition="show-children-archived" data-collection="tasks" aria-pressed="${detailView.tasksArchived}">${detailView.tasksArchived?'返回正常':'已归档'}</button></div><div class="competition-task-list">${tasks.length?tasks.map(taskRow).join(''):`<div class="competition-section-empty">${detailView.tasksArchived?'没有已归档的准备事项。':'把准备工作拆成小事，完成一件就勾选一件。'}</div>`}</div></section>${textPanel('requirements','材料与参赛要求','file','#63E6DC','补充参赛条件和提交材料')}${textPanel('team','团队与分工','users','#FF9CCE','记录队友和各自的分工')}${textPanel('notes','比赛笔记','edit','#9DC5FF','记下想法和注意事项')}</div></section>`;
  }
  function render(){
    if(!mounted)return;
    if(!id){overview();return;}
    if(!data().items.some(item=>item.id===id)){root.innerHTML=`<section class="competitions-page"><div class="competition-empty"><h1>没有找到这项比赛</h1><p>返回总览查看现有比赛或已归档的记录。</p><button class="btn" type="button" data-competition="back">返回比赛总览</button></div></section>`;return;}
    detail();
  }
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-competition]');if(!button||!root.contains(button))return;
    const action=button.dataset.competition,collection=button.dataset.collection;
    try{
      if(action==='back'){ctx.go('competitions');return;}
      if(action==='ai'){button.disabled=true;await handToAI();return;}
      if(action==='open'){ctx.go('competitions',button.dataset.id);return;}
      if(action==='new'||action==='edit'){openItem(action==='edit'?button.dataset.id:null);return;}
      if(action==='edit-text'){if(['requirements','team','notes'].includes(button.dataset.field))openItem(id,button.dataset.field);return;}
      if(action==='show-archived'){view.archived=!view.archived;render();return;}
      if(action==='show-children-archived'&&['milestones','tasks'].includes(collection)){detailView[`${collection}Archived`]=!detailView[`${collection}Archived`];render();return;}
      if((action==='new-child'||action==='edit-child')&&['milestones','tasks'].includes(collection)){openChild(collection,action==='edit-child'?button.dataset.id:null);return;}
      if(action==='calendar'){button.disabled=true;await copyToCalendar(button.dataset.id);return;}
      if(action==='archive'){
        button.disabled=true;let archived=false;
        await commit(()=>{const item=findItem(button.dataset.id);archived=!item.archived;item.archived=archived;item.updatedAt=stamp();});
        render();ctx.toast(archived?'比赛已归档，节点和准备记录会一并保留。':'比赛已恢复。');return;
      }
      if(action==='archive-child'&&['milestones','tasks'].includes(collection)){
        button.disabled=true;let archived=false;
        await commit(()=>{const entry=findChild(collection,button.dataset.id);archived=!entry.archived;entry.archived=archived;entry.updatedAt=stamp();findItem(id).updatedAt=entry.updatedAt;});
        render();ctx.toast(archived?'记录已归档。':'记录已恢复。');
      }
    }catch(error){ctx.toast(error.message||'修改未保存，请重试。');}
    finally{if(button.isConnected)button.disabled=false;}
  },{signal:controller.signal});
  root.addEventListener('input',event=>{if(event.target.matches('[data-competition-filter="query"]')){view.query=event.target.value;drawCards();}},{signal:controller.signal});
  root.addEventListener('change',async event=>{
    const input=event.target;
    if(input.matches('[data-competition-filter]')){const field=input.dataset.competitionFilter;if(field==='status'||field==='sort'){view[field]=input.value;drawCards();}return;}
    try{
      if(input.matches('[data-competition-status]')){
        input.disabled=true;
        await commit(()=>{const item=findItem(id);item.status=input.value;item.updatedAt=stamp();});render();ctx.toast('比赛进度已更新。');
      }else if(input.matches('[data-competition-toggle]')&&['milestones','tasks'].includes(input.dataset.competitionToggle)){
        const checked=input.checked;input.disabled=true;
        await commit(()=>{const entry=findChild(input.dataset.competitionToggle,input.dataset.id);entry.done=checked;entry.updatedAt=stamp();findItem(id).updatedAt=entry.updatedAt;});render();
      }
    }catch(error){render();ctx.toast(error.message||'修改未保存，请重试。');}
    finally{if(input.isConnected)input.disabled=false;}
  },{signal:controller.signal});
  render();return()=>{mounted=false;controller.abort();unbindColor?.();};
}
