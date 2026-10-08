import {CALENDAR_KINDS,validateCalendar,initializeCalendar,calendarToday,monthDays,shiftMonth,shiftDate} from './calendar-model.js';
import {CALENDAR_LINK_SOURCES,projectCalendarLinks} from './calendar-links.js';
import {isValidDate} from './ledger-model.js';
import {createColorDraft} from './creation-colors.js';

const views=new WeakMap(),weekdays=['一','二','三','四','五','六','日'];
const sourceIcons={calendar:'calendar',tasks:'check-circle',competitions:'flag',english:'graduation'};
const safeColor=value=>/^#[\da-f]{6}$/i.test(value||'')?value:'#AE88FF';
const weekday=date=>weekdays[(new Date(date+'T00:00:00Z').getUTCDay()+6)%7];
const stamp=()=>new Date().toISOString();

export function mountCalendar(ctx){
  const {root,state,esc,icon,toast}=ctx;initializeCalendar(state);
  const owner=ctx.cloud||state;if(!views.has(owner))views.set(owner,new Map());
  const saved=views.get(owner),key=state.mode||'personal';
  if(!saved.has(key))saved.set(key,{selected:calendarToday(),month:calendarToday().slice(0,7),mode:'month',kind:'all',source:'all',done:'all',archived:false});
  const view=saved.get(key),controller=new AbortController();let alive=true,busy=false,unbindColor;
  const sources={calendar:'自建日历',...CALENDAR_LINK_SOURCES};
  const find=id=>{const event=state.calendar.events.find(item=>item.id===id);if(!event)throw new Error('这条安排已不存在，请刷新后重试。');return event;};
  const timeLabel=entry=>{
    if(entry.sourceType==='competitionMilestone')return `${entry.startTime?entry.startTime+' 截止':'当天截止 · 时刻未填'}${entry.timeZone==='Asia/Shanghai'?' · 北京时间':''}`;
    if(entry.allDay)return entry.readOnly?'按日期安排':'全天';
    return `${entry.startTime}${entry.endTime&&entry.endTime!==entry.startTime?'–'+entry.endTime:''}${entry.startDate!==entry.endDate?' · 跨天':''}`;
  };
  const sourceLabel=entry=>entry.source==='calendar'?CALENDAR_KINDS[entry.kind]||'日历':entry.sourceLabel||sources[entry.source]||'关联事项';
  const shortSource=entry=>entry.source==='calendar'?({plan:'计划',mark:'标注',note:'注意'}[entry.kind]||'日历'):sources[entry.source]||'关联';
  function allEntries(){
    const links=projectCalendarLinks(state),copies=new Set(links.map(entry=>entry.independentCopyId).filter(Boolean));
    return [...state.calendar.events.map(entry=>({...entry,source:'calendar',readOnly:false,sourceLabel:CALENDAR_KINDS[entry.kind],independentCopy:copies.has(entry.id)})),...links];
  }
  function filteredEntries(){
    return allEntries().filter(entry=>Boolean(entry.archived)===view.archived&&(view.source==='all'||entry.source===view.source)&&(view.kind==='all'||entry.kind===view.kind)&&(view.done==='all'||Boolean(entry.done)===(view.done==='done'))).sort((a,b)=>a.startDate.localeCompare(b.startDate)||Number(b.important)-Number(a.important)||Number(b.allDay)-Number(a.allDay)||(a.startTime||'').localeCompare(b.startTime||'')||a.title.localeCompare(b.title,'zh-CN'));
  }
  const onDate=(entries,date)=>entries.filter(entry=>entry.startDate<=date&&entry.endDate>=date);
  async function commit(change){
    if(!alive)throw new Error('页面已更新，请重新打开这条安排。');
    if(busy)throw new Error('上一项修改正在保存，请稍候。');
    const previous=structuredClone(state.calendar),hasUi=Object.hasOwn(state,'ui'),previousUi=structuredClone(state.ui),hasUpdatedAt=Object.hasOwn(state,'updatedAt'),previousUpdatedAt=state.updatedAt;
    busy=true;
    try{change();state.calendar=validateCalendar(state.calendar);await ctx.save();}
    catch(error){state.calendar=previous;if(hasUi)state.ui=previousUi;else delete state.ui;if(hasUpdatedAt)state.updatedAt=previousUpdatedAt;else delete state.updatedAt;throw error;}
    finally{busy=false;}
  }
  function selectDate(value,{scroll=false}={}){
    if(!isValidDate(value))return;view.selected=value;view.month=value.slice(0,7);draw();
    if(scroll&&matchMedia('(max-width:1100px)').matches){const panel=root.querySelector('[data-cal-day-panel]');requestAnimationFrame(()=>{if(alive&&panel?.isConnected)panel.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});});}
  }
  function editEvent(id,kind='plan'){
    const current=id?find(id):null,colorDraft=current?null:createColorDraft(state);
    const entry=current||{title:'',kind,startDate:view.selected,endDate:view.selected,startTime:'09:00',endTime:'10:00',allDay:true,location:'',notes:'',important:false,color:colorDraft.color};
    ctx.modal({title:current?'编辑日历安排':'添加日历安排',submitLabel:current?'保存修改':'添加到日历',body:`<div class="cal-form"><label class="field">标题<input name="title" required maxlength="160" placeholder="计划、重要事件或一句提醒" value="${esc(entry.title)}"></label><div class="cal-form-grid"><label class="field">类型<select name="kind">${Object.entries(CALENDAR_KINDS).map(([value,label])=>`<option value="${value}" ${entry.kind===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="field cal-color-field">卡片颜色<input type="color" name="color" value="${safeColor(entry.color)}"></label><label class="field">开始日期<input type="date" name="startDate" min="1900-01-01" max="9999-12-31" value="${entry.startDate}" required></label><label class="field">结束日期<input type="date" name="endDate" min="1900-01-01" max="9999-12-31" value="${entry.endDate}" required></label></div><div class="cal-form-flags"><label><input type="checkbox" name="allDay" ${entry.allDay?'checked':''}>全天</label><label><input type="checkbox" name="important" ${entry.important?'checked':''}>标为重要</label></div><div class="cal-form-grid" data-cal-times><label class="field">开始时间<input type="time" name="startTime" value="${entry.startTime||'09:00'}"></label><label class="field">结束时间<input type="time" name="endTime" value="${entry.endTime||'10:00'}"></label></div><label class="field">地点<input name="location" maxlength="240" value="${esc(entry.location)}" placeholder="教室、会议室或线上，可不填"></label><label class="field">备注与注意事项<textarea name="notes" rows="4" maxlength="12000" placeholder="需要准备什么、有什么注意事项">${esc(entry.notes)}</textarea></label></div>`,async onSubmit(form){
      await commit(()=>{
        const existing=id?find(id):null,now=stamp();
        const values={id:existing?.id||ctx.uid(),title:String(form.get('title')||'').trim(),kind:String(form.get('kind')),startDate:String(form.get('startDate')),endDate:String(form.get('endDate')),startTime:String(form.get('startTime')||''),endTime:String(form.get('endTime')||''),allDay:form.has('allDay'),important:form.has('important'),location:String(form.get('location')||''),notes:String(form.get('notes')||''),color:existing?String(form.get('color')):colorDraft.commit(String(form.get('color'))),done:existing?.done||false,archived:existing?.archived||false,createdAt:existing?.createdAt||now,updatedAt:now};
        validateCalendar({version:1,events:[values]});if(existing)Object.assign(existing,values);else state.calendar.events.push(values);
      });
      view.kind='all';view.source='all';view.done='all';view.archived=Boolean(current?.archived);view.selected=String(form.get('startDate'));view.month=view.selected.slice(0,7);draw();toast(current?'日历安排已更新。':'已添加到日历。');
    }});
    const form=document.querySelector('#modal form');unbindColor?.();unbindColor=colorDraft?.bind(form);
    const toggle=()=>{const on=form.elements.allDay.checked;form.querySelector('[data-cal-times]').hidden=on;for(const name of ['startTime','endTime']){form.elements[name].disabled=on;form.elements[name].required=!on;}};
    form.elements.allDay.addEventListener('change',toggle,{signal:controller.signal});toggle();
    let priorStart=form.elements.startDate.value;
    form.elements.startDate.addEventListener('change',()=>{if(form.elements.endDate.value===priorStart||form.elements.endDate.value<form.elements.startDate.value)form.elements.endDate.value=form.elements.startDate.value;priorStart=form.elements.startDate.value;},{signal:controller.signal});
  }
  function showEvent(id,source='calendar'){
    const entry=allEntries().find(value=>value.id===id&&value.source===source);if(!entry)throw new Error('这条事项已变动，请重新选择日期。');
    const isLinked=entry.readOnly,sourceButton=entry.source==='tasks'?'编辑原待办':entry.source==='competitions'?'打开比赛':entry.source==='english'?'打开六级计划':'打开原模块';
    ctx.modal({title:entry.title,body:`<div class="cal-detail" style="--event-color:${safeColor(entry.color)}"><div class="cal-detail-badges"><span>${icon(sourceIcons[entry.source]||'calendar',14)}${esc(sourceLabel(entry))}</span><span>${isLinked?'自动关联':entry.independentCopy?'独立副本':'自建日历'}</span>${entry.done?'<span>已完成</span>':''}${entry.archived?'<span>已归档</span>':''}${entry.important?'<span>★ 重要</span>':''}</div><div class="cal-detail-date"><strong>${esc(entry.startDate)}${entry.endDate!==entry.startDate?' 至 '+esc(entry.endDate):''}</strong><span>${esc(timeLabel(entry))}</span></div>${entry.parentTitle?`<p class="cal-detail-parent">${esc(entry.parentTitle)}${entry.parentStatus?' · '+esc(entry.parentStatus):''}</p>`:''}${entry.location?`<p class="cal-detail-parent">${esc(entry.location)}</p>`:''}<div class="cal-notes">${esc(entry.notes||'还没有补充说明。')}</div>${isLinked?`<p class="cal-linked-hint">${icon('link',14)}${esc(entry.sourceHint||'日期和内容来自原模块，修改后会在日历中更新。')}</p><div class="cal-detail-actions"><button type="button" class="btn primary" data-cal-detail="open-source">${icon(sourceIcons[entry.source]||'arrow-right',15)}${sourceButton}</button></div>`:`${entry.independentCopy?'<p class="cal-linked-hint">这是独立标注，修改不会影响比赛中的原节点。</p>':''}<div class="cal-detail-actions"><button type="button" class="btn primary" data-cal-detail="edit">${icon('edit',15)}编辑</button><button type="button" class="btn" data-cal-detail="done">${icon(entry.done?'refresh':'check-circle',15)}${entry.done?'恢复未完成':'标记完成'}</button><button type="button" class="btn" data-cal-detail="archive">${icon(entry.archived?'refresh':'archive',15)}${entry.archived?'恢复安排':'归档'}</button></div>`}</div>`});
    const detail=document.querySelector('#modal .cal-detail');
    detail.addEventListener('click',async event=>{
      const button=event.target.closest('[data-cal-detail]');if(!button)return;
      try{
        const action=button.dataset.calDetail;
        if(action==='open-source'&&isLinked){ctx.closeModal();if(entry.source==='tasks'&&ctx.openTask)ctx.openTask(entry.sourceId);else ctx.go(entry.route,entry.subroute||'');return;}
        if(isLinked)return;
        if(action==='edit'){editEvent(id);return;}
        if(!['done','archive'].includes(action))return;button.disabled=true;
        await commit(()=>{const item=find(id);if(action==='done')item.done=!item.done;else item.archived=!item.archived;item.updatedAt=stamp();});
        ctx.closeModal();draw();toast(action==='done'?(entry.done?'已恢复为未完成。':'安排已标记完成。'):(entry.archived?'安排已恢复。':'安排已归档。'));
      }catch(error){toast(error.message||'修改未保存，请重试。');}
      finally{if(button.isConnected)button.disabled=false;}
    },{signal:controller.signal});
  }
  function eventCard(entry){
    return `<button type="button" class="cal-event ${entry.done?'is-done':''}" data-cal="event" data-id="${esc(entry.id)}" data-source="${entry.source}" style="--event-color:${safeColor(entry.color)}"><span class="cal-event-top"><span class="cal-event-source">${icon(sourceIcons[entry.source]||'calendar',13)}${esc(sourceLabel(entry))}</span><span>${entry.readOnly?'自动关联':entry.independentCopy?'独立副本':''}${entry.important?' ★':''}</span></span><strong>${esc(entry.title)}</strong><span class="cal-event-time">${esc(timeLabel(entry))}${entry.done?' · 已完成':''}</span>${entry.parentTitle?`<span class="cal-event-parent">${esc(entry.parentTitle)}</span>`:''}${entry.notes?`<p>${esc(entry.notes)}</p>`:''}<span class="cal-event-bottom">${entry.readOnly?'查看来源':'查看安排'}${icon('arrow-right',13)}</span></button>`;
  }
  function dayCell(date,entries,today){
    const list=onDate(entries,date),isToday=date===today,valid=isValidDate(date),accent=list[0]?safeColor(list[0].color):'#AE88FF';
    return `<button type="button" class="cal-day ${date.slice(0,7)!==view.month?'outside':''} ${isToday?'today':''} ${list.length?'has-events':'is-empty'}" data-cal="day" data-date="${date}" style="--day-accent:${accent}" ${!valid?'disabled':''} aria-pressed="${date===view.selected}" ${isToday?'aria-current="date"':''} aria-label="${date}${isToday?' 今天':''}，${list.length} 项${list.length?'，点击查看':'，点击添加安排'}"><span class="cal-day-top"><span class="cal-day-number">${Number(date.slice(8))}</span><span class="cal-day-count">${list.length}<small>项</small></span></span><span class="cal-day-events">${list.slice(0,2).map(entry=>`<span class="cal-day-chip ${entry.done?'is-done':''}" style="--event-color:${safeColor(entry.color)}"><span>${esc(shortSource(entry))}</span><b>${esc(entry.title)}</b></span>`).join('')}</span><span class="cal-day-mobile-preview">${list[0]?`<span>${esc(shortSource(list[0]))}</span><b>${esc(list[0].title)}</b>`:''}</span><span class="cal-day-foot">${list.length?(list.length>2?`+${list.length-2} 项`:'查看'):icon('plus',12)+'<span>添加</span>'}</span></button>`;
  }
  function agenda(entries,days){
    return `<div class="cal-agenda">${days.filter(date=>date.slice(0,7)===view.month).map(date=>{const list=onDate(entries,date);return `<section class="cal-agenda-day ${date===view.selected?'is-selected':''}" data-cal-agenda-date="${date}"><button type="button" class="cal-agenda-date" data-cal="day" data-date="${date}" aria-label="${date}，${list.length} 项，查看当天"><strong>${Number(date.slice(8))}</strong><span>周${weekday(date)}<small>${list.length} 项</small></span>${icon('chevron-right',13)}</button><div class="cal-agenda-items">${list.length?list.map(eventCard).join(''):`<button type="button" class="cal-agenda-empty" data-cal="new-date" data-date="${date}">${icon('plus',14)}给这一天添加安排</button>`}</div></section>`;}).join('')}</div>`;
  }
  function draw(){
    if(!alive)return;
    const today=calendarToday(),days=monthDays(view.month),entries=filteredEntries(),selected=onDate(entries,view.selected),monthEntries=entries.filter(entry=>entry.startDate<=view.month+'-31'&&entry.endDate>=view.month+'-01'),linkedCount=monthEntries.filter(entry=>entry.readOnly).length;
    root.innerHTML=`<section class="cal-page"><header class="cal-heading"><div><h1>日历<span>✦</span></h1><p>把分散的安排，放回每一天。</p></div><button type="button" class="btn primary" data-cal="new">${icon('plus',17)}新建安排</button></header><div class="cal-toolbar"><div class="cal-month-control"><button type="button" class="icon-btn" data-cal="prev" aria-label="上个月">${icon('arrow-left',17)}</button><label><span class="sr-only">选择月份</span><input type="month" min="1900-01" max="9999-12" data-calendar-filter data-cal-month value="${view.month}"></label><button type="button" class="icon-btn" data-cal="next" aria-label="下个月">${icon('chevron-right',17)}</button><button type="button" class="btn compact" data-cal="today">今天</button></div><div class="cal-view-switch" role="group" aria-label="日历视图"><button type="button" data-cal="month" aria-pressed="${view.mode==='month'}">${icon('calendar',15)}月历</button><button type="button" data-cal="agenda" aria-pressed="${view.mode==='agenda'}">${icon('list',15)}日程</button></div></div><div class="cal-filters"><label><span>来源</span><select data-calendar-filter data-cal-source aria-label="事项来源"><option value="all">全部来源</option>${Object.entries(sources).map(([value,label])=>`<option value="${value}" ${view.source===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label><span>事项类型</span><select data-calendar-filter data-cal-kind aria-label="事项类型"><option value="all">全部类型</option>${Object.entries(CALENDAR_KINDS).map(([value,label])=>`<option value="${value}" ${view.kind===value?'selected':''}>${label}</option>`).join('')}</select></label><label><span>完成度</span><select data-calendar-filter data-cal-done-filter aria-label="完成状态">${[['all','全部状态'],['open','未完成'],['done','已完成']].map(([value,label])=>`<option value="${value}" ${view.done===value?'selected':''}>${label}</option>`).join('')}</select></label><button type="button" class="cal-archive-toggle" data-cal="archived" aria-pressed="${view.archived}" title="查看已归档的自建日历安排">${icon('archive',14)}${view.archived?'返回正常':'已归档'}</button></div><div class="cal-summary"><span>${view.month.replace('-',' 年 ')} 月<span class="cal-summary-dot">·</span>${monthEntries.length} 项${linkedCount?`<span class="cal-summary-linked">其中 ${linkedCount} 项自动关联</span>`:''}</span><span>${view.archived?'归档视图只展示自建日历':'点日期查看或添加'}</span></div><div class="cal-layout ${view.mode==='agenda'?'is-agenda':''}"><section class="cal-month-panel" aria-label="${view.month}的安排">${view.mode==='month'?`<div class="cal-weekdays">${weekdays.map((day,index)=>`<span class="${index>4?'is-weekend':''}">周${day}</span>`).join('')}</div><div class="cal-month-days" role="group" aria-label="每天均可查看或添加安排">${days.map(date=>dayCell(date,entries,today)).join('')}</div>`:agenda(entries,days)}</section><aside class="cal-day-panel" data-cal-day-panel aria-label="${view.selected}的事项"><header><div><span>${view.selected===today?'今天':'周'+weekday(view.selected)}<i> ${view.selected.slice(0,4)}</i></span><h2>${Number(view.selected.slice(5,7))}<small>月</small>${Number(view.selected.slice(8))}<small>日</small></h2></div><span class="cal-selected-count">${selected.length}<small>项安排</small></span></header><div class="cal-quick-add">${Object.entries(CALENDAR_KINDS).map(([value,label])=>`<button type="button" data-cal="new-kind" data-kind="${value}">${icon('plus',13)}${label}</button>`).join('')}</div><div class="cal-selected-events" tabindex="0" role="region" aria-label="当天事项列表">${selected.length?selected.map(eventCard).join(''):`<div class="cal-empty">${icon(view.archived?'archive':'sun',26)}<strong>${view.archived?'这一天没有已归档安排':'这一天，还可以自由安排'}</strong><p>${view.archived?'归档不会删除原来的日历记录。':view.source!=='all'||view.done!=='all'||view.kind!=='all'?'当前筛选下没有事项，试试切换筛选或新建安排。':'写下一个计划，或留一句提醒给自己。'}</p>${!view.archived?'<button type="button" class="btn" data-cal="new">添加安排</button>':''}</div>`}</div>${selected.length>3?`<p class="cal-scroll-hint">${icon('chevron-down',13)}向下滚动查看当天全部事项</p>`:''}<p class="cal-source-note">${icon('link',13)}待办、比赛和六级日期自动关联；课表仍单独查看。</p></aside></div></section>`;
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-cal]');if(!button||!root.contains(button))return;
    try{
      const action=button.dataset.cal;
      if(action==='new'||action==='new-kind'){editEvent(null,button.dataset.kind||'plan');return;}
      if(action==='new-date'){selectDate(button.dataset.date);editEvent(null);return;}
      if(action==='event'){showEvent(button.dataset.id,button.dataset.source||'calendar');return;}
      if(action==='day'){selectDate(button.dataset.date,{scroll:true});return;}
      if(action==='prev'||action==='next'){view.month=shiftMonth(view.month,action==='prev'?-1:1);view.selected=view.month+'-01';}
      if(action==='today'){view.selected=calendarToday();view.month=view.selected.slice(0,7);}
      if(action==='month'||action==='agenda')view.mode=action;
      if(action==='filter')view.kind=button.dataset.kind;
      if(action==='archived'){
        view.archived=!view.archived;
        if(view.archived){view.beforeArchivedSource=view.source;view.source='calendar';}
        else{view.source=view.beforeArchivedSource||'all';delete view.beforeArchivedSource;}
      }
      draw();
    }catch(error){toast(error.message||'暂时无法打开这项安排。');}
  },{signal:controller.signal});
  root.addEventListener('change',event=>{
    const input=event.target;
    if(input.matches('[data-cal-month]')&&isValidDate(input.value+'-01')){view.month=input.value;view.selected=view.month+'-01';}
    else if(input.matches('[data-cal-source]'))view.source=input.value;
    else if(input.matches('[data-cal-kind]'))view.kind=input.value;
    else if(input.matches('[data-cal-done-filter]'))view.done=input.value;
    else return;
    draw();
  },{signal:controller.signal});
  root.addEventListener('keydown',event=>{
    const day=event.target.closest('[data-cal="day"]');if(!day)return;
    const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(offset===undefined)return;
    event.preventDefault();const next=shiftDate(day.dataset.date,offset);if(isValidDate(next)){selectDate(next);root.querySelector(`[data-cal="day"][data-date="${next}"]`)?.focus();}
  },{signal:controller.signal});
  draw();return()=>{alive=false;controller.abort();unbindColor?.();};
}
