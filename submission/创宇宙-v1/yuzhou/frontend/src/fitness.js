import {initializeFitness,validateFitnessEntry,fitnessRange,shiftFitnessDate,summarizeFitness,fitnessSeries,selectFitnessEntries,fitnessToday} from './fitness-model.js';
import {createColorDraft} from './creation-colors.js';

const views=new WeakMap();
const metrics={minutes:{label:'运动时长',unit:'分钟',color:'#63E6DC',digits:2},caloriesKcal:{label:'记录消耗',unit:'千卡',color:'#FFBC7C',digits:2},distanceKm:{label:'运动里程',unit:'公里',color:'#AE88FF',digits:3}};
const periods={day:'日',week:'周',month:'月'};
const activities=['跑步','步行','骑行','力量训练','游泳','球类运动','瑜伽','其他运动'];
const stamp=()=>new Date().toISOString();
const number=(value,digits=2)=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:digits});
const safeColor=value=>/^#[\da-f]{6}$/i.test(value||'')?value:'#63E6DC';
const sourceLabel=value=>value==='device'?'设备 / App 抄录':'手动记录';

export function mountFitness(ctx,space){
  const {root,state,esc,icon}=ctx;
  initializeFitness(state);
  const owner=ctx.cloud||state;if(!views.has(owner))views.set(owner,new Map());
  const key=`${state.mode||'personal'}:${space.id}`,ownerViews=views.get(owner);
  if(!ownerViews.has(key))ownerViews.set(key,{date:fitnessToday(),period:'week',metric:'minutes',archived:false,limit:60});
  const view=ownerViews.get(key),controller=new AbortController();let mounted=true,busy=false,unbindColor;
  const range=()=>fitnessRange(view.date,view.period);
  const selected=(archived=view.archived)=>selectFitnessEntries(state.fitness,{spaceId:space.id,...range(),archived}).slice().sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  const find=id=>state.fitness.entries.find(item=>item.id===id&&item.spaceId===space.id);
  async function commit(change){
    if(!mounted)throw new Error('页面已更新，请重新打开这条运动记录。');
    if(busy)throw new Error('上一项修改正在保存，请稍候。');
    const previous=structuredClone(state.fitness),previousUpdatedAt=state.updatedAt,previousColor=state.ui?.lastCreatedColor;
    busy=true;
    try{change();await ctx.save();}
    catch(error){state.fitness=previous;state.updatedAt=previousUpdatedAt;if(state.ui){if(previousColor===undefined)delete state.ui.lastCreatedColor;else state.ui.lastCreatedColor=previousColor;}throw error;}
    finally{busy=false;}
  }
  const numeric=(data,name,label,optional=false)=>{
    const value=String(data.get(name)||'').trim();if(!value&&optional)return null;
    if(!/^\d+(?:\.\d+)?$/.test(value))throw new Error(`请填写有效的${label}。`);
    return Number(value);
  };
  function openEntry(id){
    const entry=id?find(id):null;if(id&&!entry)throw new Error('这条记录已不存在，请刷新后重试。');
    const colorDraft=entry?null:createColorDraft(state);unbindColor?.();
    ctx.modal({title:entry?'编辑运动记录':'记一次运动',submitLabel:entry?'保存修改':'保存运动记录',body:`<div class="fitness-form"><div class="fitness-form-grid"><label class="field">日期<input type="date" name="date" required min="1900-01-01" max="${fitnessToday()}" value="${esc(entry?.date|| (view.date>fitnessToday()?fitnessToday():view.date))}"></label><label class="field">运动项目<input name="activity" list="fitness-activities" required maxlength="80" value="${esc(entry?.activity||'')}" placeholder="选择或输入运动项目"><datalist id="fitness-activities">${activities.map(value=>`<option value="${value}"></option>`).join('')}</datalist></label></div><label class="field">运动时长 · 分钟<input name="minutes" type="text" inputmode="decimal" required maxlength="12" value="${entry?esc(entry.minutes):''}" placeholder="填写实际运动时长"></label><div class="fitness-form-grid"><label class="field">里程 · 公里 <small>可不填</small><input name="distanceKm" type="text" inputmode="decimal" maxlength="14" value="${entry?.distanceKm===null||entry?.distanceKm===undefined?'':esc(entry.distanceKm)}" placeholder="未记录"></label><label class="field">消耗 · 千卡 <small>可不填</small><input name="caloriesKcal" type="text" inputmode="decimal" maxlength="12" value="${entry?.caloriesKcal===null||entry?.caloriesKcal===undefined?'':esc(entry.caloriesKcal)}" placeholder="未记录"></label></div><p class="fitness-form-hint">只填已有记录中的数值。留空表示未记录，明确记录为 0 时可填 0。</p><label class="field">数据来源<select name="source"><option value="manual" ${entry?.source!=='device'?'selected':''}>手动记录</option><option value="device" ${entry?.source==='device'?'selected':''}>抄录手表 / 运动 App</option></select><small data-fitness-source-hint>${entry?.source==='device'?'请照设备或 App 中显示的数值填写；这里不会自动同步设备。':'由你填写本次运动的实际记录。'}</small></label><label class="field">备注<textarea name="note" rows="2" maxlength="2000" placeholder="例如路线、训练内容，或数据来自哪款 App">${esc(entry?.note||'')}</textarea></label><label class="field fitness-color-field">记录颜色<input type="color" name="color" value="${safeColor(entry?.color||colorDraft?.color)}"><small>${entry?'选择这条记录的颜色':'自动配色，也可以手动选择'}</small></label></div>`,async onSubmit(data){
      const date=String(data.get('date')||'');if(date>fitnessToday())throw new Error('运动记录只能填写今天或之前的实际运动，未来计划请放入待办或日历。');
      const values={date,activity:String(data.get('activity')||'').trim(),minutes:numeric(data,'minutes','运动时长'),distanceKm:numeric(data,'distanceKm','里程',true),caloriesKcal:numeric(data,'caloriesKcal','消耗',true),note:String(data.get('note')||'').trim(),source:String(data.get('source')||'manual')};
      await commit(()=>{
        const current=id?find(id):null;if(id&&!current)throw new Error('这条记录已不存在，请刷新后重试。');
        const now=stamp(),record=validateFitnessEntry({id:current?.id||ctx.uid(),spaceId:space.id,...values,archived:current?.archived||false,color:current?String(data.get('color')):colorDraft.commit(String(data.get('color'))),createdAt:current?.createdAt||now,updatedAt:now});
        if(current)Object.assign(current,record);else state.fitness.entries.unshift(record);
      });
      view.date=date;view.archived=entry?.archived||false;view.limit=60;render();ctx.toast(entry?'运动记录已更新。':'运动记录已保存。');
    }});
    const form=document.querySelector('#modal form');unbindColor=colorDraft?.bind(form);
    form?.querySelector('[name=source]')?.addEventListener('change',event=>{const hint=form.querySelector('[data-fitness-source-hint]');hint.textContent=event.target.value==='device'?'请照设备或 App 中显示的数值填写；这里不会自动同步设备。':'由你填写本次运动的实际记录。';},{signal:controller.signal});
  }
  function metricCard(key,total,count,totalCount=count){
    const metric=metrics[key],missing=total===null||total===undefined;
    return `<button type="button" class="fitness-stat ${view.metric===key?'is-selected':''}" data-fitness="metric" data-metric="${key}" aria-pressed="${view.metric===key}" style="--fitness-accent:${metric.color}"><span>${metric.label}</span><strong data-fitness-total="${key}">${missing?'—':number(total,metric.digits)}<small>${metric.unit}</small></strong><small>${missing?'未记录':key==='minutes'?`${count} 次运动`:`已填写 ${count} / ${totalCount} 次`}</small></button>`;
  }
  function chart(entries){
    const metric=metrics[view.metric],allPoints=fitnessSeries(entries,{date:view.date,period:view.period,metric:view.metric}),points=view.period==='day'?allPoints.slice(-40):allPoints;
    const hasValues=points.some(point=>point.value!==null&&point.value!==undefined&&point.count>0),max=Math.max(1,...points.map(point=>Number(point.value)||0));
    return `<section class="fitness-trend fitness-panel" style="--fitness-accent:${metric.color}" aria-label="${metric.label}趋势"><header class="fitness-panel-head"><div><h3>${view.period==='day'?'本日运动':view.period==='week'?'本周节奏':'本月轨迹'}</h3><p>${view.period==='day'?'每条记录分别展示':'按天汇总，点柱查看'}</p></div><div class="fitness-metrics" role="group" aria-label="趋势指标">${Object.entries(metrics).map(([key,m])=>`<button type="button" data-fitness="metric" data-metric="${key}" aria-pressed="${view.metric===key}">${m.unit}</button>`).join('')}</div></header>${hasValues?`<div class="fitness-plot"><div class="fitness-scale" aria-hidden="true"><span>${number(max,metric.digits)}</span><span>0</span></div><div class="fitness-bars ${view.period==='month'?'is-month':''}" style="--fitness-points:${points.length}">${points.map((point,index)=>{
      const missing=point.value===null||point.value===undefined,title=`${point.date} ${point.label||''}：${missing?'未记录':number(point.value,metric.digits)+' '+metric.unit}${point.missingCount?'；'+point.missingCount+' 次未填写':''}`;
      const label=point.label|| (view.period==='week'?['周日','周一','周二','周三','周四','周五','周六'][new Date(point.date+'T12:00:00').getDay()]:String(Number(point.date.slice(8))));
      const showLabel=view.period!=='month'||index===0||index===points.length-1||Number(point.date.slice(8))%5===0;
      return `<button type="button" class="fitness-bar ${missing?'is-missing':point.value===0?'is-zero':''}" data-fitness="day" data-date="${esc(point.date)}" title="${esc(title)}" aria-label="${esc(title)}"><span class="fitness-bar-track"><i style="height:${missing?0:Number(point.value)/max*100}%"></i>${view.period==='week'&&!missing?`<b>${number(point.value,metric.digits)}</b>`:''}</span><span class="fitness-bar-label">${showLabel?esc(label):''}</span></button>`;
    }).join('')}</div></div>`:`<div class="fitness-chart-empty"><span>${icon('chart',29)}</span><strong>${entries.length?`这段时间还没有${view.metric==='caloriesKcal'?'消耗':view.metric==='distanceKm'?'里程':'时长'}数据`:'这段时间还没有运动记录'}</strong><p>${entries.length?'编辑记录，补充设备或 App 中已有的数值。':'完成一次运动后，记下项目和实际时长。'}</p>${!entries.length?'<button class="btn" type="button" data-fitness="new">记一次运动</button>':''}</div>`}<footer class="fitness-chart-foot">${view.metric==='minutes'?'时长来自已保存的运动记录。':'空白表示未填写；累计只包含已填写的数值。'}${allPoints.length>points.length?' 日视图仅展示最近 40 条记录。':''}</footer></section>`;
  }
  const amount=(value,unit,digits=2)=>value===null||value===undefined?'<span class="fitness-not-recorded">未记录</span>':`<strong>${number(value,digits)}</strong><small>${unit}</small>`;
  function recordRow(entry){return `<article class="fitness-record" data-fitness-record="${esc(entry.id)}" style="--fitness-record-color:${safeColor(entry.color)}"><div class="fitness-record-title"><span class="fitness-record-dot" aria-hidden="true"></span><div><h4>${esc(entry.activity)}</h4><time datetime="${esc(entry.date)}">${esc(entry.date)}</time></div></div><div class="fitness-record-value"><span>时长</span>${amount(entry.minutes,'分钟')}</div><div class="fitness-record-value"><span>里程</span>${amount(entry.distanceKm,'公里',3)}</div><div class="fitness-record-value"><span>消耗</span>${amount(entry.caloriesKcal,'千卡')}</div><div class="fitness-record-source">${esc(sourceLabel(entry.source))}${entry.note?`<p>${esc(entry.note)}</p>`:''}</div><div class="fitness-record-actions"><button class="icon-btn" type="button" data-fitness="edit" data-id="${esc(entry.id)}" title="编辑记录" aria-label="编辑${esc(entry.activity)}记录">${icon('edit',17)}</button><button class="icon-btn" type="button" data-fitness="archive" data-id="${esc(entry.id)}" title="${entry.archived?'恢复':'归档'}记录" aria-label="${entry.archived?'恢复':'归档'}${esc(entry.activity)}记录">${icon(entry.archived?'refresh':'archive',17)}</button></div></article>`;}
  function render(){
    if(!mounted)return;
    const span=range(),entries=selected(false),summary=summarizeFitness(entries),rows=selected(),label=span.label|| (span.start===span.end?span.start:`${span.start} — ${span.end}`);
    root.innerHTML=`<section class="fitness-page" aria-label="运动统计"><header class="fitness-heading"><div><h2>运动统计<span>✦</span></h2><p>记下每一次实际运动</p></div><button class="btn primary" type="button" data-fitness="new">${icon('plus',17)}记一次运动</button></header><div class="fitness-toolbar"><div class="fitness-periods" role="group" aria-label="统计周期">${Object.entries(periods).map(([key,text])=>`<button type="button" data-fitness="period" data-period="${key}" aria-pressed="${view.period===key}">${text}</button>`).join('')}</div><div class="fitness-date-control"><button type="button" class="icon-btn" data-fitness="prev" aria-label="上一${periods[view.period]}">${icon('arrow-left',17)}</button><label><span class="sr-only">选择统计日期</span><input type="date" data-fitness-date value="${view.date}" min="1900-01-01" max="9999-12-31"></label><button type="button" class="icon-btn" data-fitness="next" aria-label="下一${periods[view.period]}">${icon('chevron-right',17)}</button><button class="btn compact" type="button" data-fitness="today">今天</button></div></div><div class="fitness-range-label" aria-live="polite"><span>${esc(label)}</span><span>${view.period==='week'?'周一至周日':view.period==='month'?'自然月':'单日统计'}</span></div><div class="fitness-stats">${metricCard('minutes',summary.minutes,summary.count)}<div class="fitness-stat fitness-count" style="--fitness-accent:#D8F649"><span>运动次数</span><strong data-fitness-total="count">${summary.count}<small>次</small></strong><small>${summary.activeDays||0} 天留下记录</small></div>${metricCard('distanceKm',summary.distanceKm,summary.distanceCount,summary.count)}${metricCard('caloriesKcal',summary.caloriesKcal,summary.caloriesCount,summary.count)}</div>${chart(entries)}<section class="fitness-records fitness-panel"><header class="fitness-panel-head"><div><h3>${view.archived?'已归档记录':'运动记录'}<span>${rows.length}</span></h3><p>${view.archived?'归档记录不计入上方统计，恢复后重新计入。':'手动录入，或抄录手表和 App 中已有的数值。'}</p></div><button type="button" class="btn compact fitness-archive-toggle" data-fitness="archived" aria-pressed="${view.archived}">${icon('archive',15)}${view.archived?'查看正常记录':'已归档'}</button></header><div class="fitness-record-list">${rows.length?rows.slice(0,view.limit).map(recordRow).join(''):`<div class="fitness-list-empty">${view.archived?'当前日期范围没有归档记录。':'这里还没有记录。点击「记一次运动」开始填写。'}</div>`}</div>${rows.length>view.limit?'<button type="button" class="btn fitness-more" data-fitness="more">显示更多记录</button>':''}</section><p class="fitness-source-note">${icon('info',14)}当前未接入设备自动同步，消耗与里程以你填写的数据为准。</p></section>`;
  }
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-fitness]');if(!button||!root.contains(button))return;
    const action=button.dataset.fitness;
    try{
      if(action==='new'||action==='edit')return openEntry(action==='edit'?button.dataset.id:null);
      if(action==='archive'){
        const entry=find(button.dataset.id);if(!entry)throw new Error('这条记录已不存在。');const archived=!entry.archived;
        await commit(()=>{entry.archived=archived;entry.updatedAt=stamp();});render();ctx.toast(archived?'记录已归档，不再计入统计。':'记录已恢复，重新计入统计。');return;
      }
      if(action==='period'&&periods[button.dataset.period])view.period=button.dataset.period;
      if(action==='metric'&&metrics[button.dataset.metric])view.metric=button.dataset.metric;
      if(action==='prev'||action==='next')view.date=shiftFitnessDate(view.date,view.period,action==='prev'?-1:1);
      if(action==='today')view.date=fitnessToday();
      if(action==='day'){view.date=button.dataset.date;view.period='day';}
      if(action==='archived')view.archived=!view.archived;
      if(action==='more')view.limit+=60;else view.limit=60;
      render();
    }catch(error){ctx.toast(error.message||'操作未保存，请重试。');}
  },{signal:controller.signal});
  root.addEventListener('change',event=>{if(!event.target.matches('[data-fitness-date]'))return;try{fitnessRange(event.target.value,view.period);view.date=event.target.value;view.limit=60;render();}catch(error){ctx.toast(error.message);event.target.value=view.date;}},{signal:controller.signal});
  render();return()=>{mounted=false;controller.abort();unbindColor?.();};
}
