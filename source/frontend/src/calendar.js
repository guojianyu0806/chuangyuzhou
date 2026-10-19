import {CALENDAR_KINDS,validateCalendar,initializeCalendar,calendarToday,monthDays,shiftMonth,shiftDate,eventsOnDate} from './calendar-model.js';
import {isValidDate} from './ledger-model.js';
import {createColorDraft} from './creation-colors.js';
import {canvasCardFill} from './canvas.js';
const views=new WeakMap(),weekdays=['一','二','三','四','五','六','日'];
export function mountCalendar(ctx){
  const {root,state,esc,icon,toast}=ctx;initializeCalendar(state);
  const owner=ctx.cloud||state;if(!views.has(owner))views.set(owner,new Map());const saved=views.get(owner),key=state.mode;
  if(!saved.has(key))saved.set(key,{selected:calendarToday(),month:calendarToday().slice(0,7),mode:'month',kind:'all',archived:false});
  const view=saved.get(key),controller=new AbortController();let alive=true;
  const options=()=>({kind:view.kind,archived:view.archived});
  const find=id=>{const event=state.calendar.events.find(e=>e.id===id);if(!event)throw new Error('这条安排已不存在，请刷新后重试。');return event;};
  const label=e=>e.allDay?'全天':`${e.startTime}–${e.endTime}${e.startDate!==e.endDate?'（跨天）':''}`;
  function commit(change){
    const previous=structuredClone(state.calendar),previousUi=structuredClone(state.ui),updatedAt=state.updatedAt;
    try{change();state.calendar=validateCalendar(state.calendar);ctx.save();}
    catch(error){state.calendar=previous;state.ui=previousUi;state.updatedAt=updatedAt;throw error;}
  }
  function selectDate(value){if(!isValidDate(value))return;view.selected=value;view.month=value.slice(0,7);draw();}
  function editEvent(id,kind='plan'){
    const current=id?find(id):null,colorDraft=current?null:createColorDraft(state);
    const e=current||{title:'',kind,startDate:view.selected,endDate:view.selected,startTime:'09:00',endTime:'10:00',allDay:true,location:'',notes:'',important:false,color:colorDraft.color};
    ctx.modal({title:current?'编辑日历安排':'添加日历安排',submitLabel:current?'保存修改':'添加到日历',body:`<label class="field">标题<input name="title" required maxlength="160" placeholder="例如：部门例会、项目截止、记得带材料" value="${esc(e.title)}"></label><div class="form-grid"><label class="field">类型<select name="kind">${Object.entries(CALENDAR_KINDS).map(([k,v])=>`<option value="${k}" ${e.kind===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="field">卡片颜色<input type="color" name="color" value="${e.color}"></label><label class="field">开始日期<input type="date" name="startDate" min="1900-01-01" max="9999-12-31" value="${e.startDate}" required></label><label class="field">结束日期<input type="date" name="endDate" min="1900-01-01" max="9999-12-31" value="${e.endDate}" required></label></div><div class="cal-form-flags"><label><input type="checkbox" name="allDay" ${e.allDay?'checked':''}>全天</label><label><input type="checkbox" name="important" ${e.important?'checked':''}>重要标记</label></div><div class="form-grid" data-cal-times><label class="field">开始时间<input type="time" name="startTime" value="${e.startTime||'09:00'}"></label><label class="field">结束时间<input type="time" name="endTime" value="${e.endTime||'10:00'}"></label></div><label class="field">地点<input name="location" maxlength="240" value="${esc(e.location)}" placeholder="可选，如教学楼、会议室或线上"></label><label class="field">备注与注意事项<textarea name="notes" rows="4" maxlength="12000" placeholder="需要准备什么、要注意什么，都记在这里。">${esc(e.notes)}</textarea></label>`,onSubmit:form=>{
      if(!alive)throw new Error('页面已切换，请重新打开这条安排。');
      const stamp=new Date().toISOString();
      commit(()=>{
        const values={id:current?.id||ctx.uid(),title:String(form.get('title')||'').trim(),kind:String(form.get('kind')),startDate:String(form.get('startDate')),endDate:String(form.get('endDate')),startTime:String(form.get('startTime')||''),endTime:String(form.get('endTime')||''),allDay:form.has('allDay'),important:form.has('important'),location:String(form.get('location')||''),notes:String(form.get('notes')||''),color:current?String(form.get('color')):colorDraft.commit(String(form.get('color'))),done:current?.done||false,archived:current?.archived||false,createdAt:current?.createdAt||stamp,updatedAt:stamp};
        validateCalendar({version:1,events:[values]});
        if(current)Object.assign(find(current.id),values);else state.calendar.events.push(values);
      });
      view.kind='all';view.archived=!!current?.archived;view.selected=String(form.get('startDate'));view.month=view.selected.slice(0,7);draw();toast(current?'日历安排已更新。':'已添加到日历。');
    }});
    const form=document.querySelector('#modal form');colorDraft?.bind(form);
    const toggle=()=>{const on=form.elements.allDay.checked;form.querySelector('[data-cal-times]').hidden=on;for(const name of ['startTime','endTime']){form.elements[name].disabled=on;form.elements[name].required=!on;}};
    form.elements.allDay.addEventListener('change',toggle,{signal:controller.signal});toggle();
    let priorStart=form.elements.startDate.value;
    form.elements.startDate.addEventListener('change',()=>{if(form.elements.endDate.value===priorStart||form.elements.endDate.value<form.elements.startDate.value)form.elements.endDate.value=form.elements.startDate.value;priorStart=form.elements.startDate.value;},{signal:controller.signal});
  }
  function showEvent(id){
    const e=find(id);
    ctx.modal({title:e.title,body:`<div class="cal-detail" style="--event-color:${e.color};--event-fill:${canvasCardFill(e.color)}"><span class="cal-kind">${CALENDAR_KINDS[e.kind]}${e.important?' · 重要':''}${e.done?' · 已完成':''}${e.archived?' · 已归档':''}</span><p><strong>${e.startDate}${e.endDate!==e.startDate?' 至 '+e.endDate:''}</strong></p><p>${esc(label(e))}${e.location?' · '+esc(e.location):''}</p><div class="cal-notes">${esc(e.notes||'还没有补充说明。')}</div><div class="cal-detail-actions"><button class="btn primary" data-cal-detail="edit">${icon('edit',16)}编辑</button><button class="btn" data-cal-detail="done">${icon(e.done?'refresh':'check-circle',16)}${e.done?'恢复未完成':'标记完成'}</button><button class="btn" data-cal-detail="archive">${icon(e.archived?'refresh':'archive',16)}${e.archived?'恢复安排':'归档'}</button></div></div>`});
    const detail=document.querySelector('#modal .cal-detail');detail.addEventListener('click',event=>{
      const action=event.target.closest('[data-cal-detail]')?.dataset.calDetail;if(!action)return;
      try{if(action==='edit'){editEvent(id);return;}commit(()=>{const item=find(id);if(action==='done')item.done=!item.done;else item.archived=!item.archived;item.updatedAt=new Date().toISOString();});ctx.closeModal();draw();}
      catch(error){toast(error.message);}
    },{signal:controller.signal});
  }
  const eventCard=e=>`<button class="cal-event ${e.done?'is-done':''}" data-cal="event" data-id="${esc(e.id)}" style="--event-color:${e.color};--event-fill:${canvasCardFill(e.color)}"><span class="cal-event-meta">${CALENDAR_KINDS[e.kind]}${e.important?' · ★ 重要':''}${e.done?' · 已完成':''}</span><strong>${esc(e.title)}</strong><span>${esc(label(e))}${e.location?' · '+esc(e.location):''}</span>${e.startDate!==e.endDate?`<small>${e.startDate} 至 ${e.endDate}</small>`:''}${e.notes?`<p>${esc(e.notes)}</p>`:''}</button>`;
  function draw(){
    if(!alive)return;
    const today=calendarToday(),days=monthDays(view.month),selected=eventsOnDate(state.calendar,view.selected,options());
    const monthEvents=state.calendar.events.filter(e=>e.archived===view.archived&&(view.kind==='all'||e.kind===view.kind)&&e.startDate<=view.month+'-31'&&e.endDate>=view.month+'-01').sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.startTime.localeCompare(b.startTime));
    root.innerHTML=`<section class="cal-page"><header class="cal-heading"><div><h1>日历<span>.</span></h1><p>为重要的事，留一个位置。</p></div><button class="btn primary" data-cal="new">${icon('plus',18)}新建安排</button></header><div class="cal-toolbar"><div class="cal-month-control"><button class="icon-btn" data-cal="prev" aria-label="上个月">${icon('arrow-left',19)}</button><label><span class="sr-only">选择月份</span><input type="month" min="1900-01" max="9999-12" data-calendar-filter data-cal-month value="${view.month}"></label><button class="icon-btn" data-cal="next" aria-label="下个月">${icon('chevron-right',19)}</button><button class="btn compact" data-cal="today">今天</button></div><div class="cal-view-switch" role="group" aria-label="日历视图"><button data-cal="month" aria-pressed="${view.mode==='month'}">${icon('calendar',16)}月历</button><button data-cal="agenda" aria-pressed="${view.mode==='agenda'}">${icon('list',16)}日程</button></div></div><div class="cal-filters"><div role="group" aria-label="安排类型">${[['all','全部'],...Object.entries(CALENDAR_KINDS)].map(([k,v])=>`<button data-cal="filter" data-kind="${k}" aria-pressed="${view.kind===k}">${v}</button>`).join('')}</div><button data-cal="archived" aria-pressed="${view.archived}">${icon('archive',15)}已归档</button></div><div class="cal-layout ${view.mode==='agenda'?'is-agenda':''}"><section class="cal-month-panel" aria-label="${view.month}的安排">${view.mode==='month'?`<div class="cal-weekdays">${weekdays.map(d=>`<span>周${d}</span>`).join('')}</div><div class="cal-month-days" role="group" aria-label="点击日期查看或添加安排">${days.map(d=>{
      const events=eventsOnDate(state.calendar,d,options()),isToday=d===today;
      return `<button type="button" class="cal-day ${d.slice(0,7)!==view.month?'outside':''} ${isToday?'today':''}" data-cal="day" data-date="${d}" ${!isValidDate(d)?'disabled':''} aria-pressed="${d===view.selected}" ${isToday?'aria-current="date"':''} aria-label="${d}${isToday?' 今天':''}，${events.length} 条安排"><span class="cal-day-number">${Number(d.slice(8))}</span><span class="cal-day-events">${events.slice(0,2).map(e=>`<span class="cal-day-chip ${e.done?'is-done':''}" style="--event-color:${e.color};--event-fill:${canvasCardFill(e.color)}">${e.important?'★ ':''}${esc(e.title)}</span>`).join('')}${events.length>2?`<small>+${events.length-2} 条</small>`:''}</span><span class="cal-day-dots" aria-hidden="true">${events.slice(0,3).map(e=>`<i style="background:${e.color}"></i>`).join('')}${events.length>3?'<small>+</small>':''}</span></button>`;
    }).join('')}</div>`:`<div class="cal-agenda-head"><h2>${view.month.replace('-',' 年 ')} 月</h2><span>${monthEvents.length} 条安排</span></div><div class="cal-agenda">${monthEvents.length?monthEvents.map(e=>`<section><span class="cal-agenda-date">${e.startDate}${e.endDate!==e.startDate?' → '+e.endDate:''}</span>${eventCard(e)}</section>`).join(''):'<div class="cal-empty">本月还没有安排，点「新建安排」记下第一件事。</div>'}</div>`}</section><aside class="cal-day-panel"><header><div><span>${view.selected===today?'今天':`周${weekdays[(new Date(view.selected+'T00:00:00Z').getUTCDay()+6)%7]}`}</span><h2>${Number(view.selected.slice(5,7))}月${Number(view.selected.slice(8))}日</h2></div><span class="cal-day-count">${selected.length} 条</span></header><div class="cal-quick-add">${Object.entries(CALENDAR_KINDS).map(([k,v])=>`<button data-cal="new-kind" data-kind="${k}">${icon('plus',14)}${v}</button>`).join('')}</div><div class="cal-selected-events">${selected.length?selected.map(eventCard).join(''):'<div class="cal-empty">这一天还没有'+(view.archived?'归档记录':'安排')+'。<br>写下计划，或留一句提醒给自己。</div>'}</div></aside></div></section>`;
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-cal]');if(!button)return;
    try{const a=button.dataset.cal;if(a==='new'||a==='new-kind')return editEvent(null,button.dataset.kind||'plan');if(a==='event')return showEvent(button.dataset.id);if(a==='day')return selectDate(button.dataset.date);if(a==='prev'||a==='next'){view.month=shiftMonth(view.month,a==='prev'?-1:1);view.selected=view.month+'-01';}if(a==='today'){view.selected=calendarToday();view.month=view.selected.slice(0,7);}if(a==='month'||a==='agenda')view.mode=a;if(a==='filter')view.kind=button.dataset.kind;if(a==='archived')view.archived=!view.archived;draw();}
    catch(error){toast(error.message);}
  },{signal:controller.signal});
  root.addEventListener('change',event=>{if(event.target.matches('[data-cal-month]')&&isValidDate(event.target.value+'-01')){view.month=event.target.value;view.selected=view.month+'-01';draw();}},{signal:controller.signal});
  root.addEventListener('keydown',event=>{const day=event.target.closest('[data-cal="day"]');if(!day)return;const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(offset===undefined)return;event.preventDefault();const next=shiftDate(day.dataset.date,offset);if(isValidDate(next)){selectDate(next);root.querySelector(`[data-date="${next}"]`)?.focus();}},{signal:controller.signal});
  draw();return ()=>{alive=false;controller.abort();};
}
